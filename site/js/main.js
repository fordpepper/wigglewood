import * as S from '../sim/core.js';
import * as T from './terrain.js';
import * as SP from './sprites.js';
import * as UI from './ui.js';

// older Safari has no roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

const app = {
  w: null,
  live: false,
  snapshotTick: -1,
  prev: new Map(), // id -> [x, y] before the latest step
  facing: new Map(), // id -> +1 / -1
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
  sums: new Map(), // checkpoint tick -> checksum we computed ourselves
};

// Every few minutes compare our own checkpoint with the one GitHub saved. If they
// ever disagree (say the rules changed while this tab was open) start over from theirs.
setInterval(async () => {
  if (!app.live || document.visibilityState !== 'visible') return;
  try {
    const meta = await fetchState('meta.json');
    if (!meta) return;
    const mine = app.sums.get(meta.tick);
    if (mine && mine !== meta.checksum) {
      console.warn(`checkpoint ${meta.tick} differs (${mine} here, ${meta.checksum} on GitHub); reloading`);
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ }
      location.reload();
    }
  } catch (e) { /* offline is fine, keep going */ }
}, 5 * 60 * 1000);
window.__wigglewood = app; // handy for poking around in the console

// The heartbeat workflow keeps the newest checkpoint on the repo's `state`
// branch; read it straight from there (it changes without a Pages deploy) and
// fall back to the copy bundled with the site.
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
      const text = await res.text();
      if (file === 'meta.json') return JSON.parse(text);
      const w = S.deserialize(text);
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
  S.terrain(); S.scenery();
  let w = await fetchState('latest.json');
  if (w) app.snapshotTick = w.tick;
  // a checkpoint this browser saved itself on an earlier visit may be newer
  // (only trusted if it was made by exactly the same simulation code)
  app.simHash = await simFingerprint();
  const mine = loadLocalCheckpoint();
  if (mine && (!w || mine.tick > w.tick) && mine.tick <= S.tickAt(Date.now())) w = mine;
  if (!w) w = S.genesis();
  app.w = w;
  await catchUp(true);
  T.warmup(seasonNow());
  UI.init(app, { flyTo, select, deselect, pickRandom, setFollow });
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
      if (app.w.tick === boundary) saveLocalCheckpoint();
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
  // called when the tab comes back after a long sleep: grab a fresher checkpoint if there is one
  if (resyncing) return;
  resyncing = true;
  app.live = false;
  UI.showLoader();
  const w = await fetchState('latest.json');
  if (w && w.tick > app.w.tick) { app.w = w; app.snapshotTick = w.tick; }
  await catchUp(false);
  app.live = true;
  UI.hideLoader();
  resyncing = false;
}

// ---------------------------------------------------------------------------
// local checkpoints: returning visitors resume from their own last checkpoint
// when it is newer than GitHub's, which keeps loading fast even if the Action is late

const LOCAL_KEY = 'wigglewood-checkpoint';
async function simFingerprint() {
  try {
    const src = await (await fetch(new URL('../sim/core.js', import.meta.url))).text();
    let h = 0x811c9dc5;
    for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  } catch (e) { return null; }
}
function loadLocalCheckpoint() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw || !app.simHash) return null;
    const cut = raw.indexOf('|');
    if (raw.slice(0, cut) !== app.simHash) return null;
    return S.deserialize(raw.slice(cut + 1));
  } catch (e) { return null; }
}
function saveLocalCheckpoint() {
  if (!app.simHash) return;
  try { localStorage.setItem(LOCAL_KEY, `${app.simHash}|${S.serialize(app.w)}`); } catch (e) { /* full or blocked */ }
}

function chooseStartView() {
  const fromHash = parseInt(location.hash.slice(1), 10);
  const c = Number.isFinite(fromHash) ? app.w.creatures.find(c => c.id === fromHash) : null;
  setZoom(defaultZoom());
  if (c) { select(c.id, true); setFollow(true); app.cam.x = c.x; app.cam.y = c.y; return; }
  if (Number.isFinite(fromHash)) UI.toast('That creature is no longer around. Here is everyone else.');
  // start where the most creatures are
  let best = null, bestN = -1;
  const list = app.w.creatures;
  for (let i = 0; i < list.length; i += 3) {
    let n = 0;
    for (const o of list) { const dx = o.x - list[i].x, dy = o.y - list[i].y; if (dx * dx + dy * dy < 250 * 250) n += o.s === 1 ? 3 : 1; }
    if (n > bestN) { bestN = n; best = list[i]; }
  }
  if (best) { app.cam.x = best.x; app.cam.y = best.y; }
  clampCam();
}

function defaultZoom() {
  const short = Math.min(app.W, app.H);
  return Math.max(minZoom(), Math.min(2.2, Math.max(0.95, short / 560)));
}
function minZoom() { return Math.min(app.W / (S.WORLD_W + 200), app.H / (S.WORLD_H + 200)); }
function setZoom(z) { app.cam.z = Math.max(minZoom(), Math.min(4, z)); }
function clampCam() {
  const hw = app.W / 2 / app.cam.z, hh = app.H / 2 / app.cam.z;
  const m = 100;
  app.cam.x = hw * 2 > S.WORLD_W + m * 2 ? S.WORLD_W / 2 : Math.max(hw - m, Math.min(S.WORLD_W + m - hw, app.cam.x));
  app.cam.y = hh * 2 > S.WORLD_H + m * 2 ? S.WORLD_H / 2 : Math.max(hh - m, Math.min(S.WORLD_H + m - hh, app.cam.y));
}

function resize() {
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  app.W = window.innerWidth; app.H = window.innerHeight;
  canvas.width = Math.round(app.W * app.dpr); canvas.height = Math.round(app.H * app.dpr);
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
    if (app.w.tick % S.CHECKPOINT_TICKS === 0) { app.sums.set(app.w.tick, S.checksum(app.w)); saveLocalCheckpoint(); }
    handleFx(app.w.fx, target - app.w.tick < 4);
  }
  if (n) UI.onTick(app);
  // forget render state of creatures that are gone
  if (n && app.w.tick % 240 === 0) {
    const alive = new Set(app.w.creatures.map(c => c.id));
    for (const m of [app.facing, app.walk, app.look]) for (const id of m.keys()) if (!alive.has(id)) m.delete(id);
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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - app.lastFrame) / 1000);
  app.lastFrame = now;
  if (app.live) stepLive();
  if (!app.w) return;
  updateCamera(dt);
  render(now / 1000, dt);
  T.pumpTiles(6);
}

function updateCamera(dt) {
  // keyboard panning
  const k = app.keys;
  const pan = 520 / app.cam.z * dt;
  let mx = 0, my = 0;
  if (k.has('ArrowLeft') || k.has('a')) mx -= 1;
  if (k.has('ArrowRight') || k.has('d')) mx += 1;
  if (k.has('ArrowUp') || k.has('w')) my -= 1;
  if (k.has('ArrowDown') || k.has('s')) my += 1;
  if (mx || my) { app.cam.x += mx * pan; app.cam.y += my * pan; app.following = false; app.camTarget = null; UI.syncFollow(app); }
  if (app.following && app.selected >= 0) {
    const p = renderPos(byId(app.selected), alphaNow());
    // keep the creature visible above the card on narrow screens
    const card = document.getElementById('card');
    const off = !card.hidden && app.W <= 720 ? card.offsetHeight / 2 / app.cam.z : 0;
    if (p) app.camTarget = { x: p[0], y: p[1] - 10 + off, z: app.camTarget && app.camTarget.z };
  }
  if (app.camTarget) {
    const ease = 1 - Math.pow(0.0025, dt);
    app.cam.x += (app.camTarget.x - app.cam.x) * ease;
    app.cam.y += (app.camTarget.y - app.cam.y) * ease;
    if (app.camTarget.z) {
      app.cam.z += (app.camTarget.z - app.cam.z) * ease;
      if (Math.abs(app.camTarget.z - app.cam.z) < 0.01) app.camTarget.z = undefined;
    }
    if (!app.following && Math.abs(app.camTarget.x - app.cam.x) < 1 && Math.abs(app.camTarget.y - app.cam.y) < 1) app.camTarget = null;
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

function render(t, dt) {
  const { W, H, dpr, cam } = app;
  const w = app.w;
  const season = seasonNow();
  const a = alphaNow();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const deep = T.palette(season).deep;
  ctx.fillStyle = `rgb(${deep[0]},${deep[1]},${deep[2]})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const z = cam.z;
  const view = {
    x0: cam.x - W / 2 / z, x1: cam.x + W / 2 / z,
    y0: cam.y - H / 2 / z, y1: cam.y + H / 2 / z,
  };
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
  ctx.imageSmoothingEnabled = true;
  T.drawGround(ctx, season, z * dpr, view);
  SP.setRenderScale(z * dpr);

  drawWaterSparkles(t, view, season);
  drawCloudShadows(t, view, w);

  // gather everything that stands up, sort by base y
  const sc = S.scenery();
  const items = [];
  const pad = 80;
  const inView = (x, y) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - 40 && y < view.y1 + pad * 1.5;
  const sun = localDaylight();
  const night = 1 - sun.day;
  for (const tr of sc.trees) if (inView(tr.x, tr.y)) items.push([tr.y, 0, tr]);
  for (const rk of sc.rocks) if (inView(rk.x, rk.y)) items.push([rk.y, 1, rk]);
  for (const m of sc.mushrooms) if (inView(m.x, m.y)) items.push([m.y, 3, m]);
  for (const r of sc.reeds) if (inView(r.x, r.y)) items.push([r.y, 4, r]);
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
    for (const [, p] of drawn) {
      if (p[1] < o.y - 2 && p[1] > o.y - ht && Math.abs(p[0] - o.x) < hw) return true;
    }
    return false;
  };

  // selection ring goes on the ground first
  const sel = app.selected >= 0 ? byId(app.selected) : null;
  if (sel) {
    const p = renderPos(sel, a);
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 20;
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.2;
    const r = S.radius(sel) * 1.6 + 6;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  const nowMs = performance.now();
  for (const it of items) {
    const kind = it[1];
    const o = it[2];
    ctx.save();
    if (kind === 6) {
      ctx.translate(it[3][0], it[3][1]);
      drawCreature(o, it[3], t, dt);
    } else {
      ctx.translate(o.x, o.y);
      if ((kind === 0 || kind === 1) && occluded(o)) {
        drawFaded(kind === 0 ? 46 : 40, kind === 0 ? 95 : 45, c2 => kind === 0 ? SP.drawTree(c2, o, season, t, night) : SP.drawRock(c2, o, season));
      } else if (kind === 0) SP.drawTree(ctx, o, season, t, night);
      else if (kind === 1) SP.drawRock(ctx, o, season);
      else if (kind === 2) SP.drawBush(ctx, o, season, t, (app.shake.get(o.x * 7 + o.y) || 0) > nowMs);
      else if (kind === 3) SP.drawMushroom(ctx, o, t, night);
      else if (kind === 4) SP.drawReeds(ctx, o, t);
      else if (kind === 5) SP.drawGrave(ctx, o, Math.min(1, (o.t + 2400 - w.tick) / 400));
    }
    ctx.restore();
  }

  // emotes and particles on top
  if (z * dpr > 0.75) for (const [c, p] of drawn) drawEmote(c, p, t);
  drawParticles(t, dt);
  if (sel) drawNameTag(sel, renderPos(sel, a), true);
  if (app.hover >= 0 && app.hover !== app.selected) {
    const hc = byId(app.hover);
    if (hc) drawNameTag(hc, renderPos(hc, a), false);
  }

  // light: weather + time of day (viewer's local time)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const weather = S.weatherAt(w.tick);
  drawSky(sun, weather, season);
  drawWeather(t, dt, weather);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
  if (night > 0.05) drawNightLights(t, dt, view, drawn, night);
}

// draw something into a scratch canvas, then stamp it semi-transparent
const fadeCanvas = document.createElement('canvas');
const fadeCtx = fadeCanvas.getContext('2d');
function drawFaded(hw, ht, fn) {
  const sc = app.cam.z * app.dpr;
  const pw = Math.ceil(hw * 2 * sc), phh = Math.ceil((ht + 12) * sc);
  if (fadeCanvas.width < pw || fadeCanvas.height < phh) { fadeCanvas.width = Math.max(pw, fadeCanvas.width); fadeCanvas.height = Math.max(phh, fadeCanvas.height); }
  fadeCtx.setTransform(1, 0, 0, 1, 0, 0);
  fadeCtx.clearRect(0, 0, pw, phh);
  fadeCtx.setTransform(sc, 0, 0, sc, hw * sc, ht * sc);
  fn(fadeCtx);
  ctx.globalAlpha = 0.4;
  ctx.drawImage(fadeCanvas, 0, 0, pw, phh, -hw, -ht, pw / sc, phh / sc);
  ctx.globalAlpha = 1;
}

function drawCreature(c, p, t, dt) {
  // facing with a little hysteresis so they don't flicker
  let f = app.facing.get(c.id) || (c.hx >= 0 ? 1 : -1);
  if (c.hx > 0.25) f = 1; else if (c.hx < -0.25) f = -1;
  app.facing.set(c.id, f);
  const prev = app.prev.get(c.id);
  const moving = !!prev && (Math.abs(prev[0] - c.x) + Math.abs(prev[1] - c.y)) > 0.3;
  let ph = app.walk.get(c.id) || Math.random();
  if (moving) ph += dt * (c.s === 0 ? 3.4 : 2.6) * Math.min(1.8, S.speedOf(c) / 5.5);
  app.walk.set(c.id, ph);

  // where to look
  let lx = c.hx * 0.7, ly = c.hy * 0.5;
  let tgt = null;
  if ((c.st === S.ST.FLEE || c.st === S.ST.HUNT || c.st === S.ST.MATE) && c.tg >= 0) tgt = byId(c.tg);
  else if ((c.st === S.ST.FOOD || c.st === S.ST.EAT) && c.tg >= 0 && app.w.bushes[c.tg]) tgt = app.w.bushes[c.tg];
  if (tgt) {
    const dx = tgt.x - p[0], dy = tgt.y - p[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
    lx = dx / d; ly = dy / d * 0.7;
  } else if (!moving) {
    lx = Math.sin(t * 0.6 + c.id) * 0.8; ly = Math.sin(t * 0.37 + c.id * 2) * 0.4;
  }
  if (c.st === S.ST.GRAZE) { lx = 0.3; ly = 0.9; }
  const prevLook = app.look.get(c.id) || [lx, ly];
  const k = Math.min(1, dt * 8);
  const look = [prevLook[0] + (lx - prevLook[0]) * k, prevLook[1] + (ly - prevLook[1]) * k];
  app.look.set(c.id, look);

  const o = {
    t, walk: ph, moving, facing: f, lookX: look[0], lookY: look[1], growth: S.growth(c),
    mood: 'open', mouth: 'smile',
  };
  if (!app.seen.has(c.id)) {
    app.seen.add(c.id);
    if (c.age < 40) addParticle({ kind: 'sparkle', x: p[0], y: p[1] - 12, life: 0.9 });
  }
  if (S.radius(c) * app.cam.z * app.dpr < 11) {
    if (c.st === S.ST.SLEEP) o.mood = 'closed';
    SP.drawTiny(ctx, c, o);
    return;
  }
  if (c.s === 0) {
    if (c.st === S.ST.SLEEP) o.mood = 'closed';
    else if (c.st === S.ST.FLEE) { o.mood = 'wide'; o.mouth = 'scream'; }
    else if (c.st === S.ST.EAT || c.st === S.ST.GRAZE) { o.mouth = 'chew'; o.mood = c.st === S.ST.EAT ? 'happy' : 'open'; }
    else if (c.st === S.ST.MATE) o.mood = 'happy';
    else if (c.st === S.ST.STUN) o.mood = 'dizzy';
    else if (c.e < S.maxEnergy(c) * 0.2) o.mouth = 'o';
    SP.drawDumpling(ctx, c, o);
  } else {
    o.mood = 'grumpy';
    if (c.st === S.ST.SLEEP) o.mood = 'closed';
    else if (c.st === S.ST.HUNT) { o.mood = 'open'; o.angry = true; o.mouth = 'open'; }
    else if (c.st === S.ST.FEAST) { o.mood = 'happy'; o.mouth = 'chomp'; }
    else if (c.st === S.ST.STUN) o.mood = 'dizzy';
    else if (c.st === S.ST.MATE) o.mood = 'open';
    SP.drawGrumble(ctx, c, o);
  }
}

function headY(c) { return -S.radius(c) * (c.s === 0 ? 2.3 : 2.9) - 6; }

function drawEmote(c, p, t) {
  const y = headY(c);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.font = '700 15px "Comic Neue", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  if (c.st === S.ST.SLEEP) {
    for (let i = 0; i < 3; i++) {
      const k = ((t * 0.5 + i / 3 + c.id * 0.13) % 1);
      ctx.globalAlpha = Math.sin(k * Math.PI);
      ctx.font = `700 ${10 + k * 8}px "Comic Neue", sans-serif`;
      outlinedText('z', 8 + k * 14 + Math.sin(k * 6) * 3, y + 8 - k * 26, '#ffffff', 3);
    }
  } else if (c.st === S.ST.FLEE && c.s === 0) {
    // sweat drop
    const r = S.radius(c);
    ctx.fillStyle = '#8fd3ff'; ctx.strokeStyle = SP.INK; ctx.lineWidth = 1.6;
    const sx = -r * 0.9, sy = -r * 2.0 + Math.sin(t * 10) * 1.5;
    ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.quadraticCurveTo(sx + 4.5, sy + 1, sx, sy + 3); ctx.quadraticCurveTo(sx - 4.5, sy + 1, sx, sy - 6); ctx.fill(); ctx.stroke();
  } else if (c.st === S.ST.MATE) {
    SP.heart(ctx, 0, y + 2 + Math.sin(t * 6) * 2, 1 + Math.sin(t * 8) * 0.1);
  } else if (c.st === S.ST.STUN) {
    for (let i = 0; i < 3; i++) {
      const ang = t * 6 + i * 2.1;
      drawStar(Math.cos(ang) * 14, y + 10 + Math.sin(ang) * 4, 4);
    }
  } else if (c.s === 1 && c.st === S.ST.HUNT) {
    // little anger mark
    ctx.strokeStyle = '#e8344e'; ctx.lineWidth = 2.4;
    const ax = S.radius(c) * 0.9, ay = y + 12;
    ctx.beginPath();
    ctx.moveTo(ax - 4, ay - 1); ctx.lineTo(ax - 1, ay - 1); ctx.lineTo(ax - 1, ay - 4);
    ctx.moveTo(ax + 4, ay - 1); ctx.lineTo(ax + 1, ay - 1); ctx.lineTo(ax + 1, ay - 4);
    ctx.moveTo(ax - 4, ay + 3); ctx.lineTo(ax - 1, ay + 3); ctx.lineTo(ax - 1, ay + 6);
    ctx.moveTo(ax + 4, ay + 3); ctx.lineTo(ax + 1, ay + 3); ctx.lineTo(ax + 1, ay + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStar(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd23f'; ctx.fill();
  ctx.strokeStyle = SP.INK; ctx.lineWidth = 1.2; ctx.stroke();
}

function outlinedText(s, x, y, fill, lw) {
  ctx.strokeStyle = SP.INK; ctx.lineWidth = lw;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill; ctx.fillText(s, x, y);
}

function drawNameTag(c, p, strong) {
  if (!p) return;
  ctx.save();
  ctx.translate(p[0], p[1] + headY(c) - (c.st === S.ST.SLEEP ? 22 : 6));
  const s = Math.max(0.8, 1.1 / Math.sqrt(app.cam.z));
  ctx.scale(s, s);
  ctx.font = '700 14px "Comic Neue", sans-serif';
  const tw = ctx.measureText(c.n).width;
  ctx.fillStyle = strong ? '#ffd23f' : '#ffffff';
  ctx.strokeStyle = SP.INK; ctx.lineWidth = 2.2;
  const bw = tw + 14, bh = 20;
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh, bw, bh, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SP.INK; ctx.textAlign = 'center';
  ctx.fillText(c.n, 0, -5);
  ctx.restore();
}

function drawParticles(t, dt) {
  const ps = app.particles;
  let keep = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const k = (t - p.t0) / p.life;
    if (k >= 1) continue;
    ps[keep++] = p;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.g) p.vy += p.g * dt;
    ctx.save();
    if (p.follow !== undefined) {
      const c = byId(p.follow);
      if (!c) { ctx.restore(); continue; }
      const q = renderPos(c, alphaNow());
      ctx.translate(q[0], q[1] + headY(c) + 8 - k * 10);
    } else ctx.translate(p.x, p.y);
    switch (p.kind) {
      case 'heart':
        ctx.globalAlpha = 1 - k * k;
        SP.heart(ctx, Math.sin(k * 8) * 4, 0, p.s);
        break;
      case 'crumb':
        ctx.fillStyle = p.color; ctx.strokeStyle = SP.INK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      case 'puff':
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = SP.INK; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, p.r * (0.6 + k * 0.8), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      case 'ghost':
        SP.drawGhost(ctx, k, p.s);
        break;
      case 'sparkle':
        ctx.globalAlpha = 1 - k;
        for (let j = 0; j < 4; j++) drawStar(Math.cos(j * 1.57 + k * 2) * (8 + k * 16), Math.sin(j * 1.57 + k * 2) * (8 + k * 12), 3.5 * (1 - k * 0.5));
        break;
      case 'text': {
        const pop = Math.min(1, k * 6);
        ctx.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
        ctx.rotate(p.rot || 0);
        ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
        ctx.font = `700 ${p.size}px "Comic Neue", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        outlinedText(p.text, 0, (p.dy || 0), p.color, 4);
        break;
      }
    }
    ctx.restore();
  }
  ps.length = keep;
}

// soft sparkles on the water so the sea feels alive
function drawWaterSparkles(t, view, season) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  const C = 90;
  for (let gy = Math.floor(view.y0 / C); gy <= Math.floor(view.y1 / C); gy++) {
    for (let gx = Math.floor(view.x0 / C); gx <= Math.floor(view.x1 / C); gx++) {
      const h = S.hash01(gx, gy, 99);
      const x = gx * C + h * C, y = gy * C + S.hash01(gx, gy, 98) * C;
      if (x < -200 || y < -200 || x > S.WORLD_W + 200 || y > S.WORLD_H + 200) continue;
      if (S.elevAt(Math.max(0, Math.min(S.WORLD_W, x)), Math.max(0, Math.min(S.WORLD_H, y))) > S.LEVEL.WATER - 0.03) continue;
      const k = (t * 0.25 + h * 7) % 1;
      const s = Math.sin(k * Math.PI);
      if (s < 0.05) continue;
      ctx.globalAlpha = s * 0.8;
      const wv = 6 + s * 6;
      ctx.beginPath();
      ctx.moveTo(x - wv, y); ctx.quadraticCurveTo(x - wv / 2, y - 4, x, y); ctx.quadraticCurveTo(x + wv / 2, y - 4, x + wv, y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCloudShadows(t, view, w) {
  const weather = S.weatherAt(w.tick);
  const n = weather === 'clear' ? 3 : 7;
  ctx.save();
  ctx.fillStyle = 'rgba(30,50,80,0.09)';
  for (let i = 0; i < n; i++) {
    const sp = 10 + S.hash01(i, 1, 5) * 8;
    const span = S.WORLD_W + 1200;
    const x = ((S.hash01(i, 2, 5) * span + t * sp) % span) - 600;
    const y = S.hash01(i, 3, 5) * S.WORLD_H;
    const r = 140 + S.hash01(i, 4, 5) * 160;
    if (x + r * 2 < view.x0 || x - r * 2 > view.x1 || y + r < view.y0 || y - r > view.y1) continue;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.7, y + r * 0.1, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(x - r * 0.6, y + r * 0.12, r * 0.6, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSky(sun, weather, season) {
  const cw = canvas.width, ch = canvas.height;
  const night = 1 - sun.day;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  if (weather !== 'clear') {
    ctx.fillStyle = weather === 'cloudy' ? 'rgb(232,236,242)' : 'rgb(210,218,230)';
    ctx.fillRect(0, 0, cw, ch);
  }
  if (sun.dusk > 0.02 && sun.day > 0.05) {
    // golden hour: warm the colours without muddying them
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = sun.dusk * 0.6 * Math.min(1, sun.day * 2);
    ctx.fillStyle = 'rgb(255,150,70)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
  }
  if (night > 0.01) {
    const r = Math.round(255 - night * 158), g = Math.round(255 - night * 146), b = Math.round(255 - night * 78);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.restore();
}

const drops = [];
function drawWeather(t, dt, weather) {
  const cw = canvas.width, ch = canvas.height, dpr = app.dpr;
  if ((weather !== 'rain' && weather !== 'snow') || app.reducedMotion) { drops.length = 0; return; }
  const want = Math.round((cw * ch) / (weather === 'rain' ? 9000 : 14000) / dpr);
  while (drops.length < want) drops.push({ x: Math.random() * cw, y: Math.random() * ch, s: 0.6 + Math.random() * 0.8, p: Math.random() * 6 });
  drops.length = Math.min(drops.length, want);
  ctx.save();
  if (weather === 'rain') {
    ctx.strokeStyle = 'rgba(220,235,255,0.55)';
    ctx.lineWidth = 1.6 * dpr; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const d of drops) {
      d.y += 900 * d.s * dt * dpr; d.x += 120 * d.s * dt * dpr;
      if (d.y > ch) { d.y -= ch + 20; d.x = Math.random() * cw; }
      if (d.x > cw) d.x -= cw;
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 4 * dpr * d.s, d.y - 22 * dpr * d.s);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(120,140,170,0.6)';
    ctx.lineWidth = 1 * dpr;
    for (const d of drops) {
      d.y += 50 * d.s * dt * dpr; d.x += Math.sin(t * 1.3 + d.p) * 22 * dt * dpr;
      if (d.y > ch) { d.y -= ch + 10; d.x = Math.random() * cw; }
      ctx.beginPath(); ctx.arc(d.x, d.y, 2.4 * d.s * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawNightLights(t, dt, view, drawn, night) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // fireflies drift around the visible area
  const want = Math.round(28 * night);
  while (app.fireflies.length < want) app.fireflies.push({ x: view.x0 + Math.random() * (view.x1 - view.x0), y: view.y0 + Math.random() * (view.y1 - view.y0), p: Math.random() * 10, v: 0.5 + Math.random() });
  app.fireflies.length = Math.min(app.fireflies.length, want);
  for (const f of app.fireflies) {
    f.x += Math.sin(t * 0.7 * f.v + f.p) * 14 * dt; f.y += Math.cos(t * 0.5 * f.v + f.p * 2) * 10 * dt;
    if (f.x < view.x0 - 50 || f.x > view.x1 + 50 || f.y < view.y0 - 50 || f.y > view.y1 + 50) {
      f.x = view.x0 + Math.random() * (view.x1 - view.x0); f.y = view.y0 + Math.random() * (view.y1 - view.y0);
    }
    const blink = Math.max(0, Math.sin(t * 2 * f.v + f.p));
    if (blink < 0.05) continue;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 14);
    g.addColorStop(0, `rgba(255,240,140,${0.9 * blink * night})`);
    g.addColorStop(0.25, `rgba(220,255,120,${0.35 * blink * night})`);
    g.addColorStop(1, 'rgba(200,255,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x - 14, f.y - 14, 28, 28);
  }
  // grumbles' eyes catch the light at night
  for (const [c, p] of drawn) {
    if (c.s !== 1 || c.st === S.ST.SLEEP) continue;
    const r = S.radius(c), f = app.facing.get(c.id) || 1;
    for (const ex of [0.05, 0.62]) {
      const x = p[0] + ex * r * 1.05 * f, y = p[1] - r * 0.3 - r * 1.15 * 0.77;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.6);
      g.addColorStop(0, `rgba(255,230,120,${0.5 * night})`); g.addColorStop(1, 'rgba(255,230,120,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
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

const pointers = new Map();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: app.cam.x, cy: app.cam.y, t: performance.now(), moved: 0 };
  else if (pointers.size === 2) {
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
  if (drag.pinch && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    zoomAt(mx, my, drag.z * d / drag.d / app.cam.z);
  } else if (!drag.pinch) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved > 6) {
      canvas.classList.add('dragging');
      app.cam.x = drag.cx - dx / app.cam.z; app.cam.y = drag.cy - dy / app.cam.z;
      app.camTarget = null;
      if (app.following) { app.following = false; UI.syncFollow(app); }
      clampCam();
    }
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (drag && !drag.pinch && drag.moved <= 6 && performance.now() - drag.t < 600 && e.type === 'pointerup') {
    const c = creatureAt(e.clientX, e.clientY);
    if (c) select(c.id, false); else deselect();
  }
  if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    drag = { x: p.x, y: p.y, cx: app.cam.x, cy: app.cam.y, t: 0, moved: 99 };
  } else if (pointers.size === 0) drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { app.hover = -1; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const dz = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
  zoomAt(e.clientX, e.clientY, dz);
}, { passive: false });
canvas.addEventListener('dblclick', e => zoomAt(e.clientX, e.clientY, 1.8));

function zoomAt(sx, sy, factor) {
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
  } else if (k === '+' || k === '=') zoomAt(app.W / 2, app.H / 2, 1.25);
  else if (k === '-' || k === '_') zoomAt(app.W / 2, app.H / 2, 0.8);
  else if (k === 'f' && app.selected >= 0) setFollow(!app.following);
  else if (k === 'Escape') { if (!UI.closePanels()) deselect(); }
});
window.addEventListener('keyup', e => app.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => app.keys.clear());

function select(id, follow) {
  app.selected = id;
  if (follow) setFollow(true);
  history.replaceState(null, '', `#${id}`);
  UI.showCard(app);
}
function deselect() {
  app.selected = -1;
  app.following = false;
  history.replaceState(null, '', location.pathname + location.search);
  UI.hideCard();
}
function setFollow(on) {
  app.following = on && app.selected >= 0;
  if (app.following && app.cam.z < 1.4) app.camTarget = { x: app.cam.x, y: app.cam.y, z: Math.max(app.cam.z, 1.6) };
  UI.syncFollow(app);
}
function flyTo(x, y, z) {
  app.following = false;
  app.camTarget = { x, y, z: z || Math.max(app.cam.z, 1.4) };
  UI.syncFollow(app);
}
function pickRandom(species) {
  const pool = app.w.creatures.filter(c => (species === undefined || c.s === species));
  if (!pool.length) { UI.toast(species === 1 ? 'There are no grumbles right now.' : 'Nobody is around right now.'); return; }
  // prefer someone who is up to something
  const busy = pool.filter(c => c.st !== S.ST.SLEEP && c.st !== S.ST.WANDER);
  const list = busy.length && Math.random() < 0.7 ? busy : pool;
  const c = list[Math.floor(Math.random() * list.length)];
  select(c.id, true);
}

boot();
