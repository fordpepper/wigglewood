// HTML overlay: clock, counts, event feed, creature card, history chart, help.
import * as S from '../sim/core.js';
import * as SP from './sprites.js';

const $ = id => document.getElementById(id);
let app = null, act = null;
let lastFeedKey = '';
let chartView = 'pop', chartRange = '6';
let hoverX = null;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const timeFmtSec = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function init(a, actions) {
  app = a; act = actions;
  $('btn-random').addEventListener('click', () => act.pickRandom());
  $('count-d').addEventListener('click', () => act.pickRandom(0));
  $('count-g').addEventListener('click', () => act.pickRandom(1));
  $('card-close').addEventListener('click', () => act.deselect());
  $('btn-follow').addEventListener('click', () => act.setFollow(!app.following));
  $('btn-share').addEventListener('click', share);
  $('btn-graph').addEventListener('click', () => togglePanel('graph-panel', 'btn-graph'));
  $('btn-help').addEventListener('click', () => togglePanel('help-panel', 'btn-help'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closePanel(b.dataset.close)));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    chartView = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    drawChart();
  }));
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    chartRange = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    drawChart();
  }));
  const chart = $('chart');
  chart.addEventListener('pointermove', e => { hoverX = e.offsetX; drawChart(); });
  chart.addEventListener('pointerleave', () => { hoverX = null; drawChart(); });
  $('feed').addEventListener('click', e => {
    const el = e.target.closest('.feed-item');
    if (!el) return;
    if (el.dataset.id && app.w.creatures.some(c => c.id === +el.dataset.id)) act.select(+el.dataset.id, true);
    else if (el.dataset.x) act.flyTo(+el.dataset.x, +el.dataset.y);
  });
  for (const cv of document.querySelectorAll('canvas[data-portrait]')) drawCountPortrait(cv, +cv.dataset.portrait);
  const snap = app.snapshotTick >= 0 ? `This visit started from the checkpoint saved at ${dateFmt.format(new Date(S.msAt(app.snapshotTick)))}.` : 'No checkpoint was found, so your browser worked out the whole history itself.';
  $('sync-info').textContent = `${snap} Wigglewood was founded on ${new Date(S.EPOCH_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`;
  onTick(app);
  setInterval(updateClock, 1000);
  updateClock();
}

function updateClock() {
  if (!app) return;
  const now = new Date();
  $('clock-time').textContent = timeFmt.format(now);
  $('clock-time').title = now.toString();
  const s = S.seasonIndex(app.w.tick);
  const name = S.SEASONS[s];
  const left = Math.round((1 - S.seasonProgress(app.w.tick)) * S.SEASON_TICKS / S.TPS / 60);
  const el = $('clock-season');
  el.textContent = name;
  el.className = `chip ${name}`;
  el.title = `${name[0].toUpperCase() + name.slice(1)} in Wigglewood: about ${left >= 60 ? `${Math.floor(left / 60)} h ${left % 60} min` : `${left} min`} left`;
  const wx = S.weatherAt(app.w.tick);
  $('clock-weather').textContent = { clear: 'sunny', cloudy: 'cloudy', rain: 'raining', snow: 'snowing' }[wx];
  if (wx === 'clear' && (now.getHours() < 6 || now.getHours() >= 20)) $('clock-weather').textContent = 'clear night';
}

// ---------------------------------------------------------------------------
// called after every simulation step batch

let lastCardUpdate = 0;
export function onTick(a) {
  const w = a.w;
  let nd = 0, ng = 0, nb = 0;
  for (const c of w.creatures) if (c.s === 0) nd++; else ng++;
  for (const b of w.bushes) nb += b.b;
  $('n-d').textContent = nd; $('n-g').textContent = ng; $('n-b').textContent = nb;
  $('count-d').querySelector('span').textContent = nd === 1 ? 'dumpling' : 'dumplings';
  $('count-g').querySelector('span').textContent = ng === 1 ? 'grumble' : 'grumbles';
  updateFeed(w);
  const now = performance.now();
  if (a.selected >= 0 && now - lastCardUpdate > 240) { lastCardUpdate = now; updateCard(); }
  if (!$('graph-panel').hidden && w.tick % 240 === 0) drawChart();
}

function updateFeed(w) {
  const ev = w.events.slice(-3);
  const key = ev.map(e => e.t + e.text).join('|');
  if (key === lastFeedKey) return;
  lastFeedKey = key;
  const feed = $('feed');
  feed.replaceChildren(...ev.map(e => {
    const div = document.createElement('div');
    div.className = 'feed-item';
    const t = document.createElement('time');
    const d = new Date(S.msAt(e.t));
    t.dateTime = d.toISOString();
    t.textContent = Date.now() - d.getTime() > 20 * 3600e3 ? dateTimeFmt.format(d) : timeFmt.format(d);
    div.append(t, document.createTextNode(e.text));
    if (e.id !== undefined) div.dataset.id = e.id;
    if (e.x !== undefined) { div.dataset.x = e.x; div.dataset.y = e.y; }
    return div;
  }));
}

// ---------------------------------------------------------------------------
// creature card

function nameOf(id) {
  const c = app.w.creatures.find(c => c.id === id);
  return c ? c.n : null;
}

function statusText(c) {
  const target = c.tg >= 0 ? app.w.creatures.find(o => o.id === c.tg) : null;
  const D = c.s === 0;
  switch (c.st) {
    case S.ST.SLEEP: return 'Having a nap.';
    case S.ST.FOOD: return 'Heading for a berry bush.';
    case S.ST.EAT: return 'Munching berries.';
    case S.ST.GRAZE: return 'Nibbling on grass. It is not very filling.';
    case S.ST.FLEE: return target ? `Running away from ${target.n}!` : 'Running for its life!';
    case S.ST.MATE: return target ? `Smitten with ${target.n}.` : 'Looking for love.';
    case S.ST.FOLLOW: return `Tagging along after ${nameOf(c.pa) || nameOf(c.pb) || 'a parent'}.`;
    case S.ST.STUN: return D ? 'Dazed, but alive.' : 'Dazed after a missed pounce.';
    case S.ST.HUNT: return target ? `Chasing ${target.n}.` : 'On the hunt.';
    case S.ST.FEAST: return 'Enjoying a meal. Sorry.';
    default:
      if (c.e < S.maxEnergy(c) * 0.25) return D ? 'Wandering about, very hungry.' : 'Stomping around, very hungry.';
      return D ? 'Wandering about.' : 'Stomping around, grumbling.';
  }
}

export function showCard(a) {
  $('card').hidden = false;
  lastCardUpdate = 0;
  updateCard();
  drawPortraitLoop();
}
export function hideCard() { $('card').hidden = true; }
export function syncFollow(a) {
  const b = $('btn-follow');
  b.textContent = a.following ? 'Following' : 'Follow';
  b.classList.toggle('on', a.following);
  b.setAttribute('aria-pressed', String(a.following));
}

let deadInfo = null;
export function onSelectedDied(a, f) {
  const g = a.w.graves[a.w.graves.length - 1];
  deadInfo = g;
  a.following = false;
  syncFollow(a);
}

function updateCard() {
  const c = app.w.creatures.find(c => c.id === app.selected);
  if (!c) {
    if (deadInfo) {
      $('c-status').textContent = deadInfo.cause === 'eaten' ? `Was eaten by ${deadInfo.by}.` : deadInfo.cause === 'starved' ? 'Ran out of food.' : 'Passed away peacefully of old age.';
      $('btn-follow').disabled = true;
    }
    return;
  }
  deadInfo = null;
  $('btn-follow').disabled = false;
  const sp = S.SPECIES[c.s];
  $('c-name').textContent = c.n;
  $('c-kind').textContent = `${sp.name}, generation ${c.gen}${!S.isAdult(c) ? ', still a baby' : ''}`;
  $('c-status').textContent = statusText(c);
  const em = S.maxEnergy(c);
  $('c-energy').style.width = `${Math.max(0, Math.min(100, c.e / em * 100))}%`;
  $('c-energy').style.background = c.e < em * 0.25 ? '#e8344e' : c.e < em * 0.5 ? '#f2a541' : '#5dbb55';
  $('c-age').style.width = `${Math.min(100, c.age / c.life * 100)}%`;

  // genes vs. the species average
  const avg = [0, 0, 0]; let n = 0;
  for (const o of app.w.creatures) if (o.s === c.s) { avg[0] += o.g[0]; avg[1] += o.g[1]; avg[2] += o.g[2]; n++; }
  const names = ['Size', 'Speed', 'Sight'];
  const genes = $('c-genes');
  if (genes.children.length !== 3) {
    genes.replaceChildren(...names.map(() => {
      const row = document.createElement('div'); row.className = 'gene';
      row.innerHTML = '<span></span><span class="track"><span class="avg"></span><i></i></span><output></output>';
      return row;
    }));
  }
  [...genes.children].forEach((row, i) => {
    const [lo, hi] = S.GENE_RANGE[i];
    const pct = v => `${((v - lo) / (hi - lo)) * 100}%`;
    row.children[0].textContent = names[i];
    row.querySelector('i').style.left = pct(c.g[i]);
    row.querySelector('i').style.background = c.s === 0 ? SP.dumplingColors(c.g).body : SP.grumbleColors(c.g).body;
    row.querySelector('.avg').style.left = pct(avg[i] / n);
    row.querySelector('output').textContent = c.g[i].toFixed(2);
    row.title = `${names[i]} ${c.g[i].toFixed(2)}. The dashed line is the ${sp.plural.toLowerCase()} average (${(avg[i] / n).toFixed(2)}).`;
  });

  const facts = $('c-facts');
  const mins = Math.floor(c.age / S.TPS / 60);
  const rows = [
    ['Age', mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`],
    ['Born', timeFmt.format(new Date(S.msAt(c.born)))],
    ['Parents', c.pn ? null : 'Moved here, no family on the island'],
    ['Babies', String(c.kids)],
    [c.s === 0 ? 'Berries eaten' : 'Dumplings caught', String(c.s === 0 ? c.ate : c.kills)],
  ];
  facts.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd');
    if (k === 'Parents' && c.pn) {
      [[c.pa, c.pn[0]], [c.pb, c.pn[1]]].forEach(([id, nm], j) => {
        if (j) dd.append(' and ');
        const alive = app.w.creatures.some(o => o.id === id);
        if (alive) {
          const link = document.createElement('a'); link.textContent = nm; link.href = `#${id}`;
          link.addEventListener('click', e => { e.preventDefault(); act.select(id, true); });
          dd.append(link);
        } else dd.append(`${nm} †`);
      });
    } else dd.textContent = v;
    return [dt, dd];
  }));
}

let portraitRunning = false;
function drawPortraitLoop() {
  if (portraitRunning) return;
  portraitRunning = true;
  const cv = $('portrait');
  const pctx = cv.getContext('2d');
  const loop = () => {
    if ($('card').hidden) { portraitRunning = false; return; }
    requestAnimationFrame(loop);
    const c = app.w.creatures.find(c => c.id === app.selected);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, cv.width, cv.height);
    if (!c) {
      if (deadInfo) {
        pctx.translate(cv.width / 2, cv.height * 0.78);
        pctx.scale(3, 3);
        SP.drawGrave(pctx, deadInfo, 1);
      }
      return;
    }
    const t = performance.now() / 1000;
    const r = S.radius(c);
    const scale = Math.min(4.2, 62 / r);
    pctx.translate(cv.width / 2, cv.height * 0.84);
    pctx.scale(scale, scale);
    const moving = c.st !== S.ST.SLEEP && c.st !== S.ST.EAT && c.st !== S.ST.GRAZE && c.st !== S.ST.FEAST && c.st !== S.ST.STUN;
    const o = { t, walk: t * 1.6, moving: false, facing: 1, lookX: Math.sin(t * 0.5) * 0.6, lookY: 0.1, growth: S.growth(c), mood: 'open', mouth: 'smile' };
    if (c.s === 0) {
      if (c.st === S.ST.SLEEP) o.mood = 'closed';
      else if (c.st === S.ST.FLEE) { o.mood = 'wide'; o.mouth = 'scream'; }
      else if (c.st === S.ST.EAT || c.st === S.ST.GRAZE) o.mouth = 'chew';
      else if (c.st === S.ST.MATE) o.mood = 'happy';
      else if (c.st === S.ST.STUN) o.mood = 'dizzy';
      SP.drawDumpling(pctx, c, o);
    } else {
      o.mood = c.st === S.ST.SLEEP ? 'closed' : c.st === S.ST.HUNT ? 'open' : c.st === S.ST.FEAST ? 'happy' : 'grumpy';
      o.angry = c.st === S.ST.HUNT;
      o.mouth = c.st === S.ST.FEAST ? 'chomp' : c.st === S.ST.HUNT ? 'open' : 'smile';
      SP.drawGrumble(pctx, c, o);
    }
    void moving;
  };
  loop();
}

function share() {
  const url = `${location.origin}${location.pathname}#${app.selected}`;
  const done = () => toast('Link copied. Anyone who opens it will find the same creature.');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
  else prompt('Copy this link:', url);
}

// ---------------------------------------------------------------------------
// panels

function togglePanel(id, btnId) {
  const p = $(id);
  const open = p.hidden;
  closePanels();
  if (open) {
    p.hidden = false;
    $(btnId).setAttribute('aria-expanded', 'true');
    if (id === 'graph-panel') { drawChart(); renderStats(); }
    p.querySelector('.card-close').focus({ preventScroll: true });
  }
}
function closePanel(id) {
  $(id).hidden = true;
  document.querySelectorAll(`[aria-controls="${id}"]`).forEach(b => b.setAttribute('aria-expanded', 'false'));
}
export function closePanels() {
  let any = false;
  for (const id of ['graph-panel', 'help-panel']) if (!$(id).hidden) { closePanel(id); any = true; }
  return any;
}

let toastTimer = 0;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function renderStats() {
  const st = app.w.stats;
  const rows = [
    ['Babies born', st.births.toLocaleString()],
    ['Eaten', st.eaten.toLocaleString()],
    ['Starved', st.starved.toLocaleString()],
    ['Died of old age', st.old.toLocaleString()],
    ['Newest dumpling generation', String(st.maxGen[0])],
    ['Newest grumble generation', String(st.maxGen[1])],
    ['Oldest dumpling ever', `${Math.round(st.oldest[0] / S.TPS / 60)} min`],
    ['Oldest grumble ever', `${Math.round(st.oldest[1] / S.TPS / 60)} min`],
  ];
  $('stats').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

// ---------------------------------------------------------------------------
// history chart: small multiples sharing one time axis

const SERIES = {
  pop: [
    { title: 'Dumplings', col: 1, color: '#d98a1c' },
    { title: 'Grumbles', col: 2, color: '#7b4fc9' },
    { title: 'Berries on bushes', col: 3, color: '#d6304a' },
  ],
  genes: [
    { title: 'Dumpling genes (average)', lines: [[4, 'size', '#e07a1f'], [5, 'speed', '#2a78d6'], [6, 'sight', '#2e9e5b']] },
    { title: 'Grumble genes (average)', lines: [[7, 'size', '#e07a1f'], [8, 'speed', '#2a78d6'], [9, 'sight', '#2e9e5b']] },
  ],
};
const SEASON_TINT = ['rgba(120,200,90,0.12)', 'rgba(255,210,60,0.14)', 'rgba(240,140,60,0.13)', 'rgba(120,170,230,0.14)'];

function chartRows() {
  const h = app.w.hist;
  let rows;
  if (chartRange === 'all') {
    const first = h.fine.length ? h.fine[0][0] : Infinity;
    rows = h.coarse.filter(r => r[0] < first).concat(h.fine);
  } else {
    const since = app.w.tick - (+chartRange) * 3600 * S.TPS;
    rows = h.fine.filter(r => r[0] >= since);
  }
  return rows;
}

export function drawChart() {
  const cv = $('chart');
  if (!cv || $('graph-panel').hidden) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const rows = chartRows();
  const tip = $('chart-tip');
  if (rows.length < 2) {
    c.fillStyle = '#5c5c5c'; c.font = '700 15px "Comic Neue", sans-serif';
    c.fillText('Not enough history yet. Check back in a few minutes.', 10, 30);
    tip.hidden = true;
    return;
  }
  const defs = SERIES[chartView];
  const L = 44, R = 64, top = 8, gap = 14;
  const ph = (H - top - 22 - gap * (defs.length - 1)) / defs.length;
  const t0 = rows[0][0], t1 = rows[rows.length - 1][0];
  const xOf = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R);
  c.font = '700 13px "Comic Neue", sans-serif';

  // hovered row
  let hi = -1;
  if (hoverX !== null && hoverX >= L && hoverX <= W - R) {
    const tt = t0 + (hoverX - L) / (W - L - R) * (t1 - t0);
    let lo = 0, up = rows.length - 1;
    while (up - lo > 1) { const m = (lo + up) >> 1; if (rows[m][0] < tt) lo = m; else up = m; }
    hi = Math.abs(rows[lo][0] - tt) < Math.abs(rows[up][0] - tt) ? lo : up;
  }

  defs.forEach((d, k) => {
    const y0 = top + k * (ph + gap), y1 = y0 + ph;
    // seasons behind the plot
    for (let s = Math.floor(t0 / S.SEASON_TICKS) * S.SEASON_TICKS; s < t1; s += S.SEASON_TICKS) {
      const a = Math.max(t0, s), b = Math.min(t1, s + S.SEASON_TICKS);
      c.fillStyle = SEASON_TINT[S.seasonIndex(s)];
      c.fillRect(xOf(a), y0, xOf(b) - xOf(a), ph);
    }
    let max, min;
    if (d.col) { max = 0; for (const r of rows) max = Math.max(max, r[d.col]); max = niceMax(max); min = 0; }
    else { min = 0.5; max = 1.6; for (const r of rows) for (const [col] of d.lines) if (r[col]) { min = Math.min(min, r[col]); max = Math.max(max, r[col]); } }
    const yOf = v => y1 - (v - min) / (max - min || 1) * ph;
    // recessive grid
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 1;
    c.fillStyle = '#5c5c5c'; c.textAlign = 'right';
    const ticks = d.col ? [0, max / 2, max] : [0.5, 1, 1.5];
    for (const v of ticks) {
      const y = Math.round(yOf(v)) + 0.5;
      c.beginPath(); c.moveTo(L, y); c.lineTo(W - R, y); c.stroke();
      c.fillText(d.col ? String(Math.round(v)) : v.toFixed(1), L - 6, y + 4);
    }
    c.textAlign = 'left'; c.fillStyle = '#141414';
    c.fillText(d.title, L + 6, y0 + 14);
    const lines = d.col ? [[d.col, null, d.color]] : d.lines;
    for (const [col, label, color] of lines) {
      c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath();
      let started = false;
      for (const r of rows) {
        if (!d.col && !r[col]) { started = false; continue; } // species absent
        const x = xOf(r[0]), y = yOf(r[col]);
        if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
      }
      c.stroke();
      // direct label at the line end
      const last = rows[rows.length - 1];
      if (last[col] || d.col) {
        const y = yOf(last[col]);
        c.fillStyle = color;
        c.beginPath(); c.arc(xOf(last[0]), y, 3.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#141414';
        c.fillText(label || String(last[col]), W - R + 8, Math.max(y0 + 10, Math.min(y1, y + 4)));
      }
    }
    if (hi >= 0) {
      const x = Math.round(xOf(rows[hi][0])) + 0.5;
      c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
      for (const [col, , color] of lines) {
        if (!d.col && !rows[hi][col]) continue;
        c.fillStyle = color; c.strokeStyle = '#ffffff'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, yOf(rows[hi][col]), 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
  });
  // time axis
  c.fillStyle = '#5c5c5c'; c.textAlign = 'center';
  const span = t1 - t0;
  const fmt = span > 20 * 3600 * S.TPS ? dateFmt : timeFmt;
  for (let i = 0; i <= 4; i++) {
    const t = t0 + span * i / 4;
    c.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    c.fillText(fmt.format(new Date(S.msAt(t))), xOf(t), H - 5);
  }
  $('chart-note').textContent = chartView === 'pop'
    ? 'Background colour shows the season. Winters are lean: berries barely grow and grass is under snow.'
    : 'Genes are relative to the first settlers (1.00). Watch which way natural selection pushes them.';

  if (hi >= 0) {
    const r = rows[hi];
    const parts = [`<b>${fmt.format(new Date(S.msAt(r[0])))}</b>`];
    if (chartView === 'pop') {
      for (const d of defs) parts.push(`<span class="sw" style="background:${d.color}"></span>${d.title}: <b>${r[d.col]}</b>`);
    } else {
      for (const d of defs) parts.push(`${d.title.split(' ')[0]}: ${d.lines.map(([col, label]) => `${label} <b>${r[col] ? r[col].toFixed(2) : 'none'}</b>`).join(', ')}`);
    }
    tip.innerHTML = parts.join('<br>');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const x = xOf(r[0]);
    tip.style.left = `${x + 14 + tw > W ? x - tw - 14 : x + 14}px`;
    tip.style.top = '8px';
  } else tip.hidden = true;
}

function niceMax(v) {
  if (v <= 10) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return v;
}

// ---------------------------------------------------------------------------
// loader + little portraits

export function loaderProgress(frac, text) {
  $('loader-bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (text) $('loader-text').textContent = text;
}
export function hideLoader() { $('loader').classList.add('done'); setTimeout(() => { $('loader').hidden = true; }, 600); }
export function showLoader() { const l = $('loader'); l.hidden = false; l.classList.remove('done'); loaderProgress(0); }

const demoDumpling = { id: 3, s: 0, g: [1, 1, 1, 48, 1, 0, 1.1, 0], age: 99999, st: 0 };
const demoGrumble = { id: 5, s: 1, g: [1, 1, 1, 268, 0, 0, 1, 0], age: 99999, st: 0 };

export function drawLoaderArt(t) {
  const cv = $('loader-art');
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height - 14);
  const hop = Math.abs(Math.sin(t * 4)) * 18;
  c.scale(3, 3);
  c.translate(0, -hop / 3);
  SP.drawDumpling(c, demoDumpling, { t, walk: t * 2, moving: true, facing: 1, lookX: 0.4, lookY: -0.2, growth: 1, mood: 'open', mouth: 'smile' });
}

function drawCountPortrait(cv, s) {
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height - 5);
  const o = { t: 0.3, walk: 0, moving: false, facing: 1, lookX: 0.3, lookY: 0, growth: 1, mood: s ? 'grumpy' : 'open', mouth: 'smile' };
  if (s === 0) { c.scale(1.25, 1.25); SP.drawDumpling(c, demoDumpling, o); }
  else { c.scale(0.95, 0.95); SP.drawGrumble(c, demoGrumble, o); }
}
