import * as S from '../sim/core.js';
import * as T from './terrain.js';
import * as SP from './sprites.js';
import * as UI from './ui.js';
import { PX, textSprite, hex } from './pixel.js';

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

const app = {
  w: null,
  live: false,
  snapshotTick: -1,
  prev: new Map(), // id -> [x, y] before the latest step
  facing: new Map(), // id -> +1 / -1
  flipAt: new Map(), // id -> when it last turned around (s)
  walk: new Map(), // id -> walk phase
  look: new Map(), // id -> [lx, ly] smoothed
  seen: new Set(), // ids we've drawn (to spot newborns)
  particles: [],
  cam: { x: S.WORLD_W / 2, y: S.WORLD_H / 2, z: 1 },
  camTarget: null,
  selected: -1,
  following: false,
  hover: -1,
  W: 0, H: 0, dpr: 1,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  fireflies: [],
  lastFrame: performance.now(),
  keys: new Set(),
  shake: new Map(), // bush index -> until (ms)
  lastInput: 0,
  zoomedAt: 0,
  view: { L: 0, k: 3, u: 1 / PX },
};
window.__wigglewood = app; // handy for poking around in the console

// The heartbeat workflow keeps the newest checkpoint on the repo's `state`
// branch; read it straight from there (it changes without a Pages deploy) and
// fall back to the copy bundled with the site. This is the only time the page
// talks to the network: once it's loaded, the world runs entirely on this
// device (it's a pure function of time, so it stays in step with everyone).
function stateSources() {
  const out = [];
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (m) {
    const repo = location.pathname.split('/').filter(Boolean)[0] || `${m[1]}.github.io`;
    out.push(`https://raw.githubusercontent.com/${m[1]}/${repo}/state/`);
  }
  out.push('state/');
  return out;
}
async function fetchState(file) {
  let best = null;
  for (const base of stateSources()) {
    try {
      const res = await fetch(`${base}${file}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const w = S.deserialize(await res.text());
      if (!best || w.tick > best.tick) best = w;
      if (base !== 'state/') break; // the branch copy is the newest there is
    } catch (e) { /* try the next source */ }
  }
  return best;
}
// preview helpers (renderer only, the shared world is unaffected): ?season=0..3&hour=0..24
const params = new URLSearchParams(location.search);
const previewSeason = params.has('season') ? +params.get('season') % 4 : null;
const previewHour = params.has('hour') ? +params.get('hour') : null;
function seasonNow() { return previewSeason ?? S.seasonIndex(app.w.tick); }

// ---------------------------------------------------------------------------
// boot

async function boot() {
  resize();
  UI.drawLoaderArt(0);
  // load both font weights now, so nothing is fetched once the world is running
  await Promise.all([document.fonts.load('700 1em "Pixelify Sans"'), document.fonts.load('400 1em "Pixelify Sans"')]).catch(() => {});
  S.terrain(); S.scenery();
  let w = await fetchState('latest.json');
  if (w) app.snapshotTick = w.tick;
  if (!w) w = S.genesis();
  app.w = w;
  await catchUp(true);
  T.warmup(seasonNow());
  UI.init(app, { deselect, select });
  chooseStartView();
  app.live = true;
  UI.hideLoader();
  requestAnimationFrame(frame);
}

function catchUp(first) {
  return new Promise(resolve => {
    const start = app.w.tick;
    const tick = () => {
      const target = S.tickAt(Date.now());
      // stop at checkpoint boundaries so we can remember them
      const boundary = (Math.floor(app.w.tick / S.CHECKPOINT_TICKS) + 1) * S.CHECKPOINT_TICKS;
      S.advance(app.w, Math.min(target, boundary), 28, () => performance.now());
      const done = app.w.tick >= target;
      const total = Math.max(1, target - start);
      const mins = Math.round((target - start) / S.TPS / 60);
      UI.loaderProgress((app.w.tick - start) / total, first
        ? (mins > 1 ? `Catching up on ${mins} minutes of island life…` : 'Waking up Wigglewood…')
        : `You were away. Catching up on ${mins} minutes…`);
      UI.drawLoaderArt(performance.now() / 1000);
      if (done) { app.prev.clear(); resolve(); } else setTimeout(tick, 0);
    };
    tick();
  });
}

let resyncing = false;
async function resync() {
  // the tab was asleep for a while: simulate what happened meanwhile, right here
  if (resyncing) return;
  resyncing = true;
  app.live = false;
  UI.showLoader();
  await catchUp(false);
  app.live = true;
  UI.hideLoader();
  resyncing = false;
}

function chooseStartView() {
  setZoom(defaultZoom());
  director.next(true);
}

// a comfortable zoom: an art pixel is 3 CSS pixels on big screens, 2 on phones
function defaultZoom() {
  const cssPerArt = Math.min(app.W, app.H) >= 700 ? 3 : 2;
  return snapZoom(cssPerArt / PX);
}
function minZoom() { return 0.6 * Math.min(app.W / S.WORLD_W, app.H / S.WORLD_H); } // room to see the whole world
function maxZoom() { return 4; }
function setZoom(z) { app.cam.z = Math.max(minZoom(), Math.min(maxZoom(), z)); }
function clampCam() {
  const hw = app.W / 2 / app.cam.z, hh = app.H / 2 / app.cam.z;
  const m = 100;
  app.cam.x = hw * 2 > S.WORLD_W + m * 2 ? S.WORLD_W / 2 : Math.max(hw - m, Math.min(S.WORLD_W + m - hw, app.cam.x));
  app.cam.y = hh * 2 > S.WORLD_H + m * 2 ? S.WORLD_H / 2 : Math.max(hh - m, Math.min(S.WORLD_H + m - hh, app.cam.y));
}

function resize() {
  app.dpr = window.devicePixelRatio || 1;
  app.W = window.innerWidth; app.H = window.innerHeight;
  if (app.w) { setZoom(app.cam.z); clampCam(); }
}
window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !app.w || !app.live) return;
  const behind = S.tickAt(Date.now()) - app.w.tick;
  if (behind > S.TPS * 60 * 3) resync();
});

// ---------------------------------------------------------------------------
// stepping the world in real time

function stepLive() {
  const target = S.tickAt(Date.now());
  const behind = target - app.w.tick;
  if (behind > S.TPS * 60 * 3) { resync(); return; }
  let n = 0;
  while (app.w.tick < target && n < 60) {
    app.prev.clear();
    for (const c of app.w.creatures) app.prev.set(c.id, [c.x, c.y]);
    S.step(app.w);
    n++;
    handleFx(app.w.fx, target - app.w.tick < 4);
  }
  if (n) UI.onTick(app);
  // forget render state of creatures that are gone
  if (n && app.w.tick % 240 === 0) {
    const alive = new Set(app.w.creatures.map(c => c.id));
    for (const m of [app.facing, app.flipAt, app.walk, app.look]) for (const id of m.keys()) if (!alive.has(id)) m.delete(id);
    for (const id of app.seen) if (!alive.has(id)) app.seen.delete(id);
  }
}

function handleFx(fx, visible) {
  if (!visible) {
    for (const f of fx) if (f.k === 'poof' && f.id === app.selected) UI.onSelectedDied(app, f);
    return;
  }
  const now = performance.now();
  for (const f of fx) {
    const c = byId(f.id);
    switch (f.k) {
      case 'love':
        for (let i = 0; i < 4; i++) addParticle({ kind: 'heart', x: f.x + (Math.random() - 0.5) * 20, y: f.y - 20, vx: (Math.random() - 0.5) * 14, vy: -22 - Math.random() * 14, life: 1.6 + Math.random() * 0.6, s: 0.9 + Math.random() * 0.5 });
        break;
      case 'alert':
        addParticle({ kind: 'text', text: '!', follow: f.id, dy: -44, life: 1.1, size: 20, color: '#ffd23f' });
        break;
      case 'munch':
        app.shake.set(f.x * 7 + f.y, now + 220);
        for (let i = 0; i < 3; i++) addParticle({ kind: 'crumb', x: f.x + (Math.random() - 0.5) * 14, y: f.y - 14, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, g: 140, life: 0.6, color: '#e8344e' });
        break;
      case 'chomp':
        addParticle({ kind: 'text', text: 'CHOMP', x: f.x, y: f.y - 30, vy: -14, life: 1.2, size: 18, color: '#ffffff', rot: (Math.random() - 0.5) * 0.4 });
        for (let i = 0; i < 6; i++) addParticle({ kind: 'puff', x: f.x + (Math.random() - 0.5) * 20, y: f.y - 10 - Math.random() * 10, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 15, life: 0.8, r: 6 + Math.random() * 5 });
        break;
      case 'poof':
        for (let i = 0; i < 7; i++) addParticle({ kind: 'puff', x: f.x + (Math.random() - 0.5) * 20, y: f.y - 8 - Math.random() * 12, vx: (Math.random() - 0.5) * 30, vy: -8 - Math.random() * 12, life: 0.9, r: 5 + Math.random() * 6 });
        addParticle({ kind: 'ghost', x: f.x, y: f.y - 6, life: 2.6, s: f.s === 1 ? 1.2 : 0.9 });
        if (f.id === app.selected) UI.onSelectedDied(app, f);
        break;
      case 'escape':
        addParticle({ kind: 'text', text: '!?', follow: f.id, dy: -46, life: 1.2, size: 18, color: '#ffffff' });
        break;
      case 'yawn':
        break;
    }
    if (c && f.k === 'love') addParticle({ kind: 'sparkle', x: f.x, y: f.y - 10, life: 0.8 });
  }
}

function addParticle(p) {
  p.t0 = performance.now() / 1000;
  if (typeof p.color === 'string') p.color = hex(p.color);
  if (p.x === undefined) { p.x = 0; p.y = 0; }
  p.vx = p.vx || 0; p.vy = p.vy || 0;
  app.particles.push(p);
  if (app.particles.length > 400) app.particles.shift();
}

let idMap = null, idMapTick = -1, idMapList = null;
function byId(id) {
  if (idMapTick !== app.w.tick || idMapList !== app.w.creatures) {
    idMap = new Map();
    for (const c of app.w.creatures) idMap.set(c.id, c);
    idMapTick = app.w.tick; idMapList = app.w.creatures;
  }
  return idMap.get(id) || null;
}

// ---------------------------------------------------------------------------
// render
//
// The world is painted into a small art buffer (the canvas itself), one
// buffer pixel per art pixel, and the browser blows it up with hard pixel
// edges. At the closest zoom levels an art pixel is PX world units; further
// out each level doubles that. The buffer always starts on a whole art pixel
// and the leftover fraction is a CSS shift, so panning stays smooth while the
// pixels stay crisp.

// Quality adapts to the device: if frames take too long we drop to 30 fps and
// skip the little extras; if it gets cheap again we switch back.
app.low = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;
const perf = app.perf = { cost: 4, gap: 16, slowFor: 0, fastFor: 0, frame: 0 };
const forcedQuality = new URLSearchParams(location.search).get('quality'); // 'high' | 'low' for testing
if (forcedQuality) app.low = forcedQuality === 'low';
function adaptQuality(cost, dt) {
  perf.cost += (cost - perf.cost) * 0.05;
  perf.gap += (dt * 1000 - perf.gap) * 0.05;
  if (forcedQuality || document.hidden) return;
  if (!app.low && (perf.cost > 10 || perf.gap > 26)) perf.slowFor += dt; else perf.slowFor = 0;
  if (app.low && perf.cost < 4) perf.fastFor += dt; else perf.fastFor = 0;
  if (perf.slowFor > 2 || perf.fastFor > 30) { app.low = !app.low; perf.slowFor = perf.fastFor = 0; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - app.lastFrame) / 1000);
  const t0 = performance.now();
  if (app.live) stepLive();
  if (!app.w) return;
  perf.frame++;
  if (app.low && perf.frame % 2 && !document.hidden) return;
  app.lastFrame = now;
  updateCamera(dt);
  render(now / 1000, dt);
  T.pumpTiles(app.low ? 4 : 7);
  adaptQuality(performance.now() - t0, dt);
}

// zoom: s = device pixels per art pixel at level 0. Crisp zooms are whole
// numbers of device pixels per art pixel (or a power-of-two level further out).
function viewParams(z = app.cam.z) {
  const s = z * app.dpr * PX;
  let L = 0;
  // an art pixel is at least two device pixels (except at the coarsest level),
  // which keeps the number of ground tiles on screen small
  while (L < T.MAX_LEVEL && s * (1 << L) < 1.999) L++;
  return { L, k: s * (1 << L), u: 1 / (PX << L) };
}
// every crisp zoom: whole device pixels per art pixel at some level
let STEPS = null;
function zoomSteps() {
  if (STEPS) return STEPS;
  const set = new Set();
  for (let L = T.MAX_LEVEL; L >= 1; L--) for (let k = 2; k <= (L === T.MAX_LEVEL ? 7 : 3); k++) set.add(k / (1 << L));
  for (let k = 2; k <= 64; k++) set.add(k);
  return (STEPS = [...set].sort((a, b) => a - b));
}
function snapZoom(z) {
  const s = z * app.dpr * PX;
  const toZ = v => v / (app.dpr * PX);
  let best = null, bd = Infinity;
  for (const v of zoomSteps()) {
    if (toZ(v) < minZoom() - 1e-9 || toZ(v) > maxZoom() + 1e-9) continue;
    const d = Math.abs(Math.log(v / s));
    if (d < bd) { bd = d; best = v; }
  }
  return best === null ? z : toZ(best);
}

function updateCamera(dt) {
  const k = app.keys;
  const pan = 520 / app.cam.z * dt;
  let mx = 0, my = 0;
  if (k.has('ArrowLeft') || k.has('a')) mx -= 1;
  if (k.has('ArrowRight') || k.has('d')) mx += 1;
  if (k.has('ArrowUp') || k.has('w')) my -= 1;
  if (k.has('ArrowDown') || k.has('s')) my += 1;
  if (mx || my) { app.cam.x += mx * pan; app.cam.y += my * pan; app.following = false; app.camTarget = null; touched(); }
  director.update(dt);
  if (app.following && app.selected >= 0) {
    const p = renderPos(byId(app.selected), alphaNow());
    // keep the creature visible above the card on narrow screens
    const card = document.getElementById('card');
    const off = !card.hidden && app.W <= 720 ? card.offsetHeight / 2 / app.cam.z : 0;
    if (p) {
      // a long way off: rise up, glide over the sea, come back down
      const far = Math.hypot(p[0] - app.cam.x, p[1] - app.cam.y);
      if (far > 1600) app.flying = true;
      let z = app.camTarget && app.camTarget.z;
      if (app.flying) { z = far > 700 ? Math.max(minZoom(), defaultZoom() * 0.2) : defaultZoom(); if (far <= 700) app.flying = false; }
      app.camTarget = { x: p[0], y: p[1] - 10 + off, z };
    }
  }
  if (app.camTarget) {
    const ease = 1 - Math.pow(app.flying ? 0.35 : 0.0025, dt);
    app.cam.x += (app.camTarget.x - app.cam.x) * ease;
    app.cam.y += (app.camTarget.y - app.cam.y) * ease;
    if (app.camTarget.z) {
      app.cam.z += (app.camTarget.z - app.cam.z) * ease;
      if (Math.abs(app.camTarget.z - app.cam.z) < 0.003) { app.cam.z = app.camTarget.z; app.camTarget.z = undefined; }
    }
    if (!app.following && Math.abs(app.camTarget.x - app.cam.x) < 1 && Math.abs(app.camTarget.y - app.cam.y) < 1) app.camTarget = null;
  }
  // settle on a crisp zoom once nobody is zooming
  if (performance.now() - app.zoomedAt > 250 && pointers.size < 2 && !(app.camTarget && app.camTarget.z)) {
    const zs = snapZoom(app.cam.z);
    if (Math.abs(zs - app.cam.z) < 0.002) app.cam.z = zs;
    else app.cam.z += (zs - app.cam.z) * (1 - Math.pow(0.0001, dt));
  }
  clampCam();
}

function alphaNow() {
  return Math.max(0, Math.min(1, (Date.now() - S.msAt(app.w.tick)) / S.TICK_MS));
}
function renderPos(c, a) {
  if (!c) return null;
  const p = app.prev.get(c.id);
  if (!p) return [c.x, c.y];
  return [p[0] + (c.x - p[0]) * a, p[1] + (c.y - p[1]) * a];
}

// the sky follows the viewer's own clock
export function localDaylight(date = new Date()) {
  const h = previewHour ?? date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const day = ss(5.6, 7.4, h) * (1 - ss(18.4, 20.4, h));
  const dusk = Math.max(0, 1 - Math.abs(h - 19.2) / 1.3) + Math.max(0, 1 - Math.abs(h - 6.4) / 1.1) * 0.7;
  return { day, dusk: Math.min(1, dusk), h };
}

let lastCss = '';
function render(t, dt) {
  const { W, H, dpr, cam } = app;
  const w = app.w;
  const season = seasonNow();
  const a = alphaNow();
  const { L, k, u } = viewParams();
  app.view = { L, k, u };
  // size the art buffer and place it on screen
  const bw = Math.ceil(W * dpr / k) + 2, bh = Math.ceil(H * dpr / k) + 2;
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const leftArt = (cam.x - W / 2 / cam.z) * u, topArt = (cam.y - H / 2 / cam.z) * u;
  const ox = Math.floor(leftArt), oy = Math.floor(topArt);
  const cssSize = `${bw * k / dpr}px|${bh * k / dpr}px`;
  if (cssSize !== lastCss) { lastCss = cssSize; canvas.style.width = `${bw * k / dpr}px`; canvas.style.height = `${bh * k / dpr}px`; }
  canvas.style.transform = `translate(${(-(leftArt - ox) * k / dpr).toFixed(2)}px,${(-(topArt - oy) * k / dpr).toFixed(2)}px)`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = T.seaColor(season);
  ctx.fillRect(0, 0, bw, bh);
  ctx.setTransform(1, 0, 0, 1, -ox, -oy);
  const view = { x0: ox, y0: oy, x1: ox + bw, y1: oy + bh }; // art pixels
  T.drawGround(ctx, season, L, view);

  if (!app.low) drawWaterSparkles(t, view, u, season);
  drawCloudShadows(t, view, u, w);

  // everything that stands up, sorted by where it touches the ground
  const items = [];
  const padX = 40, padTop = 10, padBot = 70; // art pixels
  const vx0 = (view.x0 - padX) / u, vx1 = (view.x1 + padX) / u, vy0 = (view.y0 - padTop) / u, vy1 = (view.y1 + padBot) / u;
  const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
  const sun = localDaylight();
  const night = 1 - sun.day;
  if (L < T.BAKE_LEVEL) T.sceneryIn(vx0, vy0, vx1, vy1, it => items.push(it)); // further out they're baked into the ground tiles
  w.bushes.forEach((b, i) => { if (inView(b.x, b.y)) items.push([b.y, 2, b, i]); });
  for (const gv of w.graves) if (inView(gv.x, gv.y)) items.push([gv.y, 5, gv]);
  const drawn = [];
  for (const c of w.creatures) {
    const p = renderPos(c, a);
    if (!inView(p[0], p[1])) continue;
    items.push([p[1], 6, c, p]);
    drawn.push([c, p]);
  }
  items.sort((p, q) => p[0] - q[0]);

  // see-through trees and rocks when someone is standing behind them
  const occluded = o => {
    const hw = o.kind === undefined ? 26 : 30, ht = o.big !== undefined ? 30 : 78;
    for (const [, p] of drawn) if (p[1] < o.y - 2 && p[1] > o.y - ht && Math.abs(p[0] - o.x) < hw) return true;
    return false;
  };

  const sel = app.selected >= 0 ? byId(app.selected) : null;
  if (sel) {
    const p = renderPos(sel, a);
    drawRing(Math.round(p[0] * u), Math.round(p[1] * u), Math.max(3, Math.round(S.radius(sel) * u * 1.5 + 2)), t);
  }

  const nowMs = performance.now();
  for (const it of items) {
    const kind = it[1], o = it[2];
    if (kind === 6) {
      const p = it[3];
      const X = Math.round(p[0] * u), Y = Math.round(p[1] * u);
      SP.drawShadow(ctx, X, Y, S.radius(o) * u * 0.95);
      drawCreature(o, p, X, Y, t, dt, u);
      continue;
    }
    const X = Math.round(o.x * u), Y = Math.round(o.y * u);
    if (kind === 0 || kind === 1) {
      const cv = kind === 0 ? SP.tree(o, season, u) : SP.rock(o, season, u, SP.rockTint(o));
      if (!app.low && L === 0 && occluded(o)) { ctx.globalAlpha = 0.45; SP.stamp(ctx, cv, X, Y); ctx.globalAlpha = 1; }
      else SP.stamp(ctx, cv, X, Y);
    } else if (kind === 2) SP.drawBush(ctx, o, X, Y, season, u, (app.shake.get(o.x * 7 + o.y) || 0) > nowMs, SP.bushKind(o));
    else if (kind === 3) {
      SP.stamp(ctx, SP.mushroom(u), X, Y);
      if (night > 0.2 && !app.low) glow(X, Y - Math.round(9 * u), Math.max(2, Math.round(10 * u)), [190, 140, 255], 0.35 * night);
    } else if (kind === 4) SP.drawReeds(ctx, X, Y, t, u, o.k * 10);
    else if (kind === 5) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (o.t + 2400 - w.tick) / 400));
      SP.stamp(ctx, SP.grave(o, u), X, Y);
      ctx.globalAlpha = 1;
    } else if (kind === 7) SP.stamp(ctx, SP.shrub(season, u, SP.shrubKind(o)), X, Y);
  }

  if (L === 0) for (const [c, p] of drawn) drawEmote(c, p, t, u);
  drawParticles(t, dt, u);
  placeTag(tagSel, sel, sel && renderPos(sel, a), u);
  const hc = app.hover >= 0 && app.hover !== app.selected ? byId(app.hover) : null;
  placeTag(tagHover, hc, hc && renderPos(hc, a), u);

  // light: weather + time of day (the viewer's own clock)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const weather = localWeather(S.weatherAt(w.tick), season);
  drawSky(sun, weather, bw, bh);
  drawWeather(t, dt, weather, bw, bh);
  ctx.setTransform(1, 0, 0, 1, -ox, -oy);
  if (night > 0.05 && !app.low) drawNightLights(t, dt, view, u, drawn, night);
}

// a soft pixel glow (additive), drawn as stacked squares so it stays blocky
function glow(X, Y, r, rgbc, a) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = r; i >= 1; i -= Math.max(1, Math.floor(r / 3))) {
    ctx.fillStyle = `rgba(${rgbc[0]},${rgbc[1]},${rgbc[2]},${(a / 3).toFixed(3)})`;
    ctx.fillRect(X - i, Y - Math.ceil(i * 0.7), i * 2 + 1, Math.ceil(i * 0.7) * 2 + 1);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// a dashed pixel ellipse that crawls around the selected creature
const ringCache = new Map();
function drawRing(X, Y, rx, t) {
  const ry = Math.max(2, Math.round(rx * 0.4));
  const key = `${rx}|${ry}`;
  let pts = ringCache.get(key);
  if (!pts) {
    pts = [];
    const seen = new Set();
    const n = Math.ceil((rx + ry) * 8);
    for (let i = 0; i < n; i++) {
      const ang = i / n * Math.PI * 2;
      const x = Math.round(Math.cos(ang) * rx), y = Math.round(Math.sin(ang) * ry);
      const kk = `${x},${y}`;
      if (!seen.has(kk)) { seen.add(kk); pts.push([x, y]); }
    }
    ringCache.set(key, pts);
  }
  const off = Math.floor(t * 8);
  ctx.fillStyle = '#ffd23f';
  for (let i = 0; i < pts.length; i++) if (((i + off) >> 2) % 2 === 0) ctx.fillRect(X + pts[i][0], Y + pts[i][1], 1, 1);
}

function drawCreature(c, p, X, Y, t, dt, u) {
  // facing with a little hysteresis so they don't flicker
  // facing, with hysteresis and a short hold so they don't flip back and forth
  let f = app.facing.get(c.id) || (c.hx >= 0 ? 1 : -1);
  const flipAt = app.flipAt.get(c.id) || 0;
  if (t - flipAt > 0.6 && ((c.hx > 0.45 && f < 0) || (c.hx < -0.45 && f > 0))) { f = -f; app.flipAt.set(c.id, t); }
  app.facing.set(c.id, f);
  const prev = app.prev.get(c.id);
  const moving = !!prev && (Math.abs(prev[0] - c.x) + Math.abs(prev[1] - c.y)) > 0.3;
  let ph = app.walk.get(c.id) ?? Math.random();
  if (moving) ph += dt * (c.s === 0 ? 3.4 : 2.6) * Math.min(1.8, S.speedOf(c) / 5.5);
  app.walk.set(c.id, ph);

  // where to look
  let lx = c.hx, ly = c.hy * 0.6;
  let tgt = null;
  if ((c.st === S.ST.FLEE || c.st === S.ST.HUNT || c.st === S.ST.MATE) && c.tg >= 0) tgt = byId(c.tg);
  else if (c.st === S.ST.EAT && c.tg >= 0 && app.w.bushes[c.tg]) tgt = app.w.bushes[c.tg];
  if (tgt) {
    const dx = tgt.x - p[0], dy = tgt.y - p[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
    lx = dx / d; ly = dy / d * 0.8;
  } else if (!moving) {
    // idle: glance around now and then
    const k = Math.floor(t * 0.25 + c.id * 0.37);
    lx = Math.sin(k * 12.9898 + c.id) > 0 ? 1 : -1; ly = Math.sin(k * 78.233) > 0.4 ? 1 : 0;
    lx *= f;
  }
  if (c.st === S.ST.GRAZE) { lx = 0.3 * f; ly = 1; }
  const o = {
    t, facing: f, lookX: lx * f, lookY: ly,
    frame: moving ? 2 + (Math.floor(ph * 4) & 3) : ((t * 0.3 + c.id * 0.31) % 1 < 0.2 ? 1 : 0), // slow breaths
    mood: 'open', mouth: 'smile',
    blink: ((t * 0.7 + c.id * 0.37) % 4.2) < 0.15,
  };
  if (app.reducedMotion && !moving) o.frame = 0;
  if (!app.seen.has(c.id)) {
    app.seen.add(c.id);
    if (c.age < 40) addParticle({ kind: 'sparkle', x: p[0], y: p[1] - 12, life: 0.9 });
  }
  if (c.s === 0) {
    if (c.st === S.ST.SLEEP) o.mood = 'closed';
    else if (c.st === S.ST.FLEE) { o.mood = 'wide'; o.mouth = 'scream'; }
    else if (c.st === S.ST.EAT || c.st === S.ST.GRAZE) { o.mouth = 'chew'; o.mood = c.st === S.ST.EAT ? 'happy' : 'open'; }
    else if (c.st === S.ST.MATE) o.mood = 'happy';
    else if (c.st === S.ST.STUN) o.mood = 'dizzy';
    else if (c.e < S.maxEnergy(c) * 0.2) o.mouth = 'o';
  } else {
    o.mood = 'grumpy';
    if (c.st === S.ST.SLEEP) o.mood = 'closed';
    else if (c.st === S.ST.HUNT) { o.mood = 'open'; o.angry = true; o.mouth = 'open'; }
    else if (c.st === S.ST.FEAST) { o.mood = 'happy'; o.mouth = 'chomp'; }
    else if (c.st === S.ST.STUN) o.mood = 'dizzy';
    else if (c.st === S.ST.MATE) o.mood = 'open';
  }
  SP.drawCreature(ctx, c, X, Y, o, u);
}

function headY(c, u) { return SP.headTop(c, u) - 2; }

function drawEmote(c, p, t, u) {
  const X = Math.round(p[0] * u), Y = Math.round(p[1] * u) + headY(c, u);
  if (c.st === S.ST.SLEEP) {
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.35 + i / 2 + c.id * 0.13) % 1;
      if (k > 0.85) continue;
      SP.stamp(ctx, SP.fx('z'), X + 3 + Math.round(k * 5), Y + 3 - Math.round(k * 8));
    }
  } else if (c.st === S.ST.FLEE && c.s === 0) {
    SP.stamp(ctx, SP.fx('drop'), X - Math.round(S.radius(c) * u) - 1, Y + 4 + (Math.floor(t * 8) & 1));
  } else if (c.st === S.ST.MATE) {
    SP.stamp(ctx, SP.fx('heart'), X, Y - 1 - (Math.floor(t * 4) & 1));
  } else if (c.st === S.ST.STUN) {
    for (let i = 0; i < 3; i++) {
      const ang = t * 5 + i * 2.1;
      SP.stamp(ctx, SP.fx('star'), X + Math.round(Math.cos(ang) * 6), Y + 3 + Math.round(Math.sin(ang) * 2));
    }
  } else if (c.s === 1 && c.st === S.ST.HUNT) {
    SP.stamp(ctx, SP.fx('anger'), X + Math.round(S.radius(c) * u * 0.8), Y + 3);
  }
}

// Name tags are real text in the page (the pixel font at a readable size),
// pinned above the creature's head.
const tagSel = document.getElementById('tag'), tagHover = document.getElementById('tag-hover');
function placeTag(el, c, p, u) {
  if (!c || !p) { if (!el.hidden) el.hidden = true; return; }
  const wy = p[1] + (headY(c, u) - (c.st === S.ST.SLEEP ? 10 : 3)) / u;
  const sx = (p[0] - app.cam.x) * app.cam.z + app.W / 2, sy = (wy - app.cam.y) * app.cam.z + app.H / 2;
  if (sx < -100 || sx > app.W + 100 || sy < -40 || sy > app.H + 60) { el.hidden = true; return; }
  if (el.textContent !== c.n) el.textContent = c.n;
  el.hidden = false;
  el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
}

function drawParticles(t, dt, u) {
  const ps = app.particles;
  let keep = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const k = (t - p.t0) / p.life;
    if (k >= 1) continue;
    ps[keep++] = p;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.g) p.vy += p.g * dt;
    let X, Y;
    if (p.follow !== undefined) {
      const c = byId(p.follow);
      if (!c) continue;
      const q = renderPos(c, alphaNow());
      X = Math.round(q[0] * u); Y = Math.round(q[1] * u) + headY(c, u) - Math.round(k * 4);
      p.dy = 0;
    } else { X = Math.round(p.x * u); Y = Math.round(p.y * u); }
    switch (p.kind) {
      case 'heart':
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        SP.stamp(ctx, SP.fx('heart'), X + Math.round(Math.sin(k * 8) * 2), Y);
        break;
      case 'crumb':
        SP.stamp(ctx, SP.fx('crumb'), X, Y);
        break;
      case 'puff':
        ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
        SP.stamp(ctx, SP.puff(p.r * u * (0.6 + k * 0.8)), X, Y);
        break;
      case 'ghost':
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
        SP.stamp(ctx, SP.fx('ghost'), X + Math.round(Math.sin(k * 9) * 2), Y - Math.round(k * 16));
        break;
      case 'sparkle':
        if ((Math.floor(t * 12) & 1) || k < 0.5) for (let j = 0; j < 4; j++) {
          const r = 3 + Math.round(k * 6);
          SP.stamp(ctx, SP.fx('sparkle'), X + Math.round(Math.cos(j * 1.57 + k * 2) * r), Y + Math.round(Math.sin(j * 1.57 + k * 2) * r * 0.8));
        }
        break;
      case 'text':
        if (k > 0.8 && (Math.floor(t * 16) & 1)) break; // blink out
        SP.stamp(ctx, textSprite(p.text, p.color), X, Y + (p.dy ? Math.round(p.dy * u) : 0) - (k < 0.1 ? 1 : 0));
        break;
    }
    ctx.globalAlpha = 1;
  }
  ps.length = keep;
}

// little white wave crests that come and go on open water
function drawWaterSparkles(t, view, u, season) {
  if (season === 3 && u < 0.2) return;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const C = 26;
  for (let gy = Math.floor(view.y0 / C); gy <= Math.floor(view.y1 / C); gy++) {
    for (let gx = Math.floor(view.x0 / C); gx <= Math.floor(view.x1 / C); gx++) {
      const h = S.hash01(gx, gy, 99 + app.view.L);
      const k = (t * 0.22 + h * 7) % 1;
      if (k > 0.5) continue;
      const X = gx * C + Math.floor(S.hash01(gx, gy, 98) * C), Y = gy * C + Math.floor(S.hash01(gx, gy, 97) * C);
      const wx = X / u, wy = Y / u;
      if (wx < 0 || wy < 0 || wx > S.WORLD_W || wy > S.WORLD_H || S.elevAt(wx, wy) > S.LEVEL.WATER - 0.03) continue;
      const len = k < 0.12 || k > 0.38 ? 2 : 4;
      ctx.fillRect(X - (len >> 1), Y, len, 1);
      if (len === 4) { ctx.fillRect(X - 3, Y + 1, 1, 1); ctx.fillRect(X + 2, Y + 1, 1, 1); }
    }
  }
}

// The shared weather, as it falls where the camera is: deserts stay dry,
// the tropics get rain instead of snow, the far north gets snow instead of rain.
function localWeather(weather, season) {
  if (weather !== 'rain' && weather !== 'snow') return weather;
  const b = S.biomeAt(Math.max(0, Math.min(S.WORLD_W, app.cam.x)), Math.max(0, Math.min(S.WORLD_H, app.cam.y)));
  const B = S.BIOME;
  if (b === B.DESERT) return 'cloudy';
  if (S.isHot(b)) return 'rain';
  if (S.isCold(b) && season !== 1) return 'snow';
  return weather;
}

function drawCloudShadows(t, view, u, w) {
  const weather = S.weatherAt(w.tick);
  const n = Math.round((weather === 'clear' ? 4 : 9) * S.WORLD_W * S.WORLD_H / (7200 * 4800) * 0.6);
  ctx.fillStyle = 'rgba(30,40,80,0.08)';
  for (let i = 0; i < n; i++) {
    const sp = 10 + S.hash01(i, 1, 5) * 8;
    const span = S.WORLD_W + 1600;
    const x = (((S.hash01(i, 2, 5) * span + t * sp) % span) - 800) * u;
    const y = S.hash01(i, 3, 5) * S.WORLD_H * u;
    const r = (160 + S.hash01(i, 4, 5) * 200) * u;
    if (x + r * 2 < view.x0 || x - r * 2 > view.x1 || y + r < view.y0 || y - r > view.y1) continue;
    // blocky: stack a few rectangles instead of a smooth ellipse
    const rows = 6, hh = r * 0.55 / rows;
    for (let j = -rows; j <= rows; j++) {
      const f = Math.sqrt(1 - (j / (rows + 0.5)) ** 2);
      const ya = Math.round(y + j * hh), yb = Math.round(y + (j + 1) * hh);
      if (yb > ya) ctx.fillRect(Math.round(x - r * f * 1.3), ya, Math.round(r * f * 2.6), yb - ya);
    }
  }
}

function drawSky(sun, weather, cw, ch) {
  const night = 1 - sun.day;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  if (weather !== 'clear') {
    ctx.fillStyle = weather === 'cloudy' ? 'rgb(228,232,240)' : 'rgb(204,212,226)';
    ctx.fillRect(0, 0, cw, ch);
  }
  if (sun.dusk > 0.02 && sun.day > 0.05) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = sun.dusk * 0.6 * Math.min(1, sun.day * 2);
    ctx.fillStyle = 'rgb(255,140,70)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
  }
  if (night > 0.01) {
    const r = Math.round(255 - night * 165), g = Math.round(255 - night * 150), b = Math.round(255 - night * 80);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.restore();
}

const drops = [];
function drawWeather(t, dt, weather, cw, ch) {
  if ((weather !== 'rain' && weather !== 'snow') || app.reducedMotion) { drops.length = 0; return; }
  const want = Math.round(cw * ch / (weather === 'rain' ? 420 : 380) / (app.low ? 2 : 1));
  while (drops.length < want) drops.push({ x: Math.random() * cw, y: Math.random() * ch, s: 0.6 + Math.random() * 0.8, p: Math.random() * 6 });
  drops.length = Math.min(drops.length, want);
  if (weather === 'rain') {
    ctx.fillStyle = 'rgba(220,235,255,0.6)';
    for (const d of drops) {
      d.y += 260 * d.s * dt; d.x += 40 * d.s * dt;
      if (d.y > ch) { d.y -= ch + 6; d.x = Math.random() * cw; }
      if (d.x > cw) d.x -= cw;
      const x = Math.floor(d.x), y = Math.floor(d.y);
      ctx.fillRect(x, y, 1, 2); ctx.fillRect(x - 1, y - 2, 1, 2);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    for (const d of drops) {
      d.y += 16 * d.s * dt; d.x += Math.sin(t * 1.3 + d.p) * 7 * dt;
      if (d.y > ch) { d.y -= ch + 4; d.x = Math.random() * cw; }
      const sz = d.s > 1.15 ? 2 : 1;
      ctx.fillRect(Math.floor(d.x), Math.floor(d.y), sz, sz);
    }
  }
}

function drawNightLights(t, dt, view, u, drawn, night) {
  // fireflies drift around the visible area (positions in art pixels)
  const want = Math.round(24 * night);
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  while (app.fireflies.length < want) app.fireflies.push({ x: view.x0 + Math.random() * vw, y: view.y0 + Math.random() * vh, p: Math.random() * 10, v: 0.5 + Math.random() });
  app.fireflies.length = Math.min(app.fireflies.length, want);
  for (const f of app.fireflies) {
    f.x += Math.sin(t * 0.7 * f.v + f.p) * 5 * dt; f.y += Math.cos(t * 0.5 * f.v + f.p * 2) * 4 * dt;
    if (f.x < view.x0 - 10 || f.x > view.x1 + 10 || f.y < view.y0 - 10 || f.y > view.y1 + 10) {
      f.x = view.x0 + Math.random() * vw; f.y = view.y0 + Math.random() * vh;
    }
    const blink = Math.sin(t * 2 * f.v + f.p);
    if (blink < 0.2) continue;
    const X = Math.round(f.x), Y = Math.round(f.y);
    glow(X, Y, 3, [220, 255, 120], 0.5 * night * blink);
    ctx.fillStyle = `rgba(255,250,170,${(night * blink).toFixed(2)})`;
    ctx.fillRect(X, Y, 1, 1);
  }
  // grumbles' eyes catch the light at night
  if (app.view.L > 0) return;
  for (const [c, p] of drawn) {
    if (c.s !== 1 || c.st === S.ST.SLEEP) continue;
    const r = S.radius(c) * u, f = app.facing.get(c.id) || 1;
    const X = Math.round(p[0] * u + f * r * 0.2), Y = Math.round(p[1] * u - r * 1.2);
    glow(X, Y, Math.max(2, Math.round(r * 0.45)), [255, 220, 110], 0.3 * night);
  }
}

// ---------------------------------------------------------------------------
// interaction

function screenToWorld(sx, sy) {
  return [app.cam.x + (sx - app.W / 2) / app.cam.z, app.cam.y + (sy - app.H / 2) / app.cam.z];
}

function creatureAt(sx, sy) {
  const [wx, wy] = screenToWorld(sx, sy);
  const a = alphaNow();
  let best = null, bd = Infinity;
  for (const c of app.w.creatures) {
    const p = renderPos(c, a);
    const r = S.radius(c);
    const cy = p[1] - r * (c.s === 0 ? 1.1 : 1.4);
    const dx = wx - p[0], dy = wy - cy;
    const d = dx * dx + dy * dy;
    const reach = Math.max(r * 1.6, 16 / app.cam.z + r);
    if (d < reach * reach && d < bd) { bd = d; best = c; }
  }
  return best;
}

// Gestures (looking only: nothing a visitor does changes the world):
//   drag: look around      pinch / wheel: zoom      tap a creature: see who it is
const pointers = new Map();
let drag = null;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  touched();
  if (pointers.size === 1) {
    drag = { x: e.clientX, y: e.clientY, cx: app.cam.x, cy: app.cam.y, t: performance.now(), moved: 0 };
  } else if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    drag = { pinch: true, d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: app.cam.z, moved: 99 };
  }
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse' && app.w) {
      const c = creatureAt(e.clientX, e.clientY);
      app.hover = c ? c.id : -1;
      canvas.classList.toggle('pointing', !!c);
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  touched();
  if (drag.pinch && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, drag.z * d / drag.d / app.cam.z);
    return;
  }
  if (drag.pinch) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
  if (drag.moved > 8) {
    canvas.classList.add('dragging');
    app.cam.x = drag.cx - dx / app.cam.z; app.cam.y = drag.cy - dy / app.cam.z;
    app.camTarget = null;
    app.following = false;
    clampCam();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (drag && !drag.pinch && drag.moved <= 8 && performance.now() - drag.t < 500 && e.type === 'pointerup') tap(e.clientX, e.clientY);
  if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    drag = { x: p.x, y: p.y, cx: app.cam.x, cy: app.cam.y, t: 0, moved: 99 };
  } else if (pointers.size === 0) drag = null;
}

// a single tap shows who's there; a double tap anywhere opens the name search
let lastTap = { t: 0, x: 0, y: 0 };
function tap(sx, sy) {
  const now = performance.now();
  if (now - lastTap.t < 380 && Math.abs(sx - lastTap.x) + Math.abs(sy - lastTap.y) < 40) {
    lastTap.t = 0;
    UI.openSearch();
    return;
  }
  lastTap = { t: now, x: sx, y: sy };
  if (UI.searchOpen()) { UI.closeSearch(); return; }
  const c = creatureAt(sx, sy);
  if (c) select(c.id);
  else deselect();
}

// no emulated mouse events after a touch: they would steal focus from the search box
canvas.addEventListener('touchend', e => e.preventDefault(), { passive: false });
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { app.hover = -1; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  touched();
  const dz = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
  zoomAt(e.clientX, e.clientY, dz);
}, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function zoomAt(sx, sy, factor) {
  app.zoomedAt = performance.now();
  const [wx, wy] = screenToWorld(sx, sy);
  setZoom(app.cam.z * factor);
  if (app.camTarget) app.camTarget.z = undefined;
  if (!app.following) {
    app.cam.x = wx - (sx - app.W / 2) / app.cam.z;
    app.cam.y = wy - (sy - app.H / 2) / app.cam.z;
  }
  clampCam();
}

window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
    if (e.target.closest && e.target.closest('[role=tablist], .ranges') && k.startsWith('Arrow')) return;
    app.keys.add(k); e.preventDefault();
  } else if (k === '+' || k === '=') stepZoom(1);
  else if (k === '-' || k === '_') stepZoom(-1);
  else if (k === 'Escape') { if (UI.searchOpen()) UI.closeSearch(); else deselect(); }
  else if (k === '/' || k === 'f') { e.preventDefault(); UI.openSearch(); }
});
window.addEventListener('keyup', e => app.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => app.keys.clear());

// keyboard zoom: hop to the next crisp zoom level
function stepZoom(dir) {
  const z0 = snapZoom(app.cam.z);
  let z = z0;
  for (let f = 1.05; f < 8 && z === z0; f *= 1.05) z = snapZoom(z0 * (dir > 0 ? f : 1 / f));
  zoomAt(app.W / 2, app.H / 2, z / app.cam.z);
  app.zoomedAt = 0;
}

function select(id) {
  app.selected = id;
  app.following = true;
  if (app.cam.z < defaultZoom() * 0.9) app.camTarget = { x: app.cam.x, y: app.cam.y, z: defaultZoom() };
  UI.showCard(app);
}
function deselect() {
  app.selected = -1;
  app.following = false;
  UI.hideCard();
}

// ---------------------------------------------------------------------------
// the director: when nobody touches anything, the camera wanders from one
// interesting creature to the next so the island is nice to just watch

function touched() { app.lastInput = performance.now(); director.until = 0; }
const director = {
  id: -1, until: 0,
  idle() { return performance.now() - app.lastInput > 15000 && app.selected < 0; },
  next(first) {
    const list = app.w.creatures;
    if (!list.length) return;
    const score = c => {
      let v = Math.random();
      if (c.st === S.ST.HUNT || c.st === S.ST.FLEE) v += 3;
      if (c.st === S.ST.MATE) v += 2;
      if (c.st === S.ST.FOLLOW || c.age < 1200) v += 1.2;
      if (c.s === 1) v += 0.6;
      if (c.st === S.ST.SLEEP) v -= 1;
      return v;
    };
    let best = null, bv = -1e9;
    for (const c of list) { const v = score(c) + (c.il !== this.il ? 0.5 : 0); if (v > bv) { bv = v; best = c; } }
    this.id = best.id; this.il = best.il;
    this.until = performance.now() + 25000 + Math.random() * 20000;
    if (first) { app.cam.x = best.x; app.cam.y = best.y; clampCam(); }
  },
  update(dt) {
    if (!this.idle()) return;
    const c = byId(this.id);
    const now = performance.now();
    if (!c) { if (!this.lostAt) this.lostAt = now; if (now - this.lostAt > 3000) { this.lostAt = 0; this.next(); } return; }
    this.lostAt = 0;
    if (now > this.until && c.st !== S.ST.HUNT && c.st !== S.ST.FLEE) { this.next(); return; }
    const p = renderPos(c, alphaNow());
    // a long way off (another island): rise up, glide over the sea, come back down
    const far = Math.hypot(p[0] - app.cam.x, p[1] - app.cam.y) > 1600;
    const ease = 1 - Math.pow(far ? 0.6 : 0.3, dt);
    app.cam.x += (p[0] - app.cam.x) * ease;
    app.cam.y += (p[1] - 20 - app.cam.y) * ease;
    const zWant = far ? Math.max(minZoom(), defaultZoom() * 0.2) : defaultZoom();
    if (Math.abs(zWant - app.cam.z) > 0.002) { app.cam.z += (zWant - app.cam.z) * (1 - Math.pow(0.5, dt)); app.zoomedAt = performance.now(); }
    clampCam();
  },
};

boot();
