// The little bit of HTML on top of the island: the clock, the creature card,
// the loader and the odd toast. Kept deliberately small.
import * as S from '../sim/core.js';
import * as SP from './sprites.js';

const $ = id => document.getElementById(id);
let app = null, act = null;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function init(a, actions) {
  app = a; act = actions;
  $('card').addEventListener('click', () => act.deselect());
  const tick = () => { $('clock').textContent = timeFmt.format(new Date()); };
  tick();
  setInterval(tick, 1000);
}

export function onTick() {
  if (app.selected >= 0 && app.w.tick % 2 === 0) updateCard();
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
    case S.ST.GRAZE: return 'Nibbling on grass.';
    case S.ST.FLEE: return target ? `Running away from ${target.n}!` : 'Running for its life!';
    case S.ST.MATE: return target ? `Smitten with ${target.n}.` : 'Looking for love.';
    case S.ST.FOLLOW: return `Tagging along after ${nameOf(c.pa) || nameOf(c.pb) || 'a parent'}.`;
    case S.ST.STUN: return 'Dazed.';
    case S.ST.HUNT: return target ? `Chasing ${target.n}.` : 'On the hunt.';
    case S.ST.FEAST: return 'Enjoying a meal. Sorry.';
    default:
      if (c.e < S.maxEnergy(c) * 0.25) return 'Very hungry.';
      return D ? 'Wandering about.' : 'Stomping around, grumbling.';
  }
}

let gone = false;
export function showCard() {
  gone = false;
  $('card').hidden = false;
  updateCard();
  portraitLoop();
}
export function hideCard() { $('card').hidden = true; }

export function onSelectedDied(a, f) {
  gone = true;
  a.following = false;
  const g = a.w.graves.find(g => g.t === a.w.tick && g.n === $('c-name').textContent);
  const cause = g ? g.cause : f.cause;
  $('c-status').textContent = cause === 'eaten' ? `Was eaten${g && g.by ? ` by ${g.by}` : ''}.`
    : cause === 'starved' ? 'Ran out of food.' : cause === 'poked' ? 'Was poked one too many times.' : 'Passed away of old age.';
  $('c-energy').style.width = '0%';
}

function updateCard() {
  const c = app.w.creatures.find(c => c.id === app.selected);
  if (!c) { if (!gone) onSelectedDied(app, { cause: 'gone' }); return; }
  const sp = S.SPECIES[c.s];
  const mins = Math.floor(c.age / S.TPS / 60);
  $('c-name').textContent = c.n;
  $('c-kind').textContent = `${sp.name}, generation ${c.gen}, ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} old`;
  $('c-status').textContent = statusText(c);
  const em = S.maxEnergy(c);
  const e = $('c-energy');
  e.style.width = `${Math.max(0, Math.min(100, c.e / em * 100))}%`;
  e.style.background = c.e < em * 0.25 ? '#e8344e' : c.e < em * 0.5 ? '#f2a541' : '#5dbb55';
}

let portraitRunning = false;
function portraitLoop() {
  if (portraitRunning) return;
  portraitRunning = true;
  const cv = $('portrait');
  const pctx = cv.getContext('2d');
  let frame = 0;
  const loop = () => {
    if ($('card').hidden) { portraitRunning = false; return; }
    requestAnimationFrame(loop);
    if (frame++ % 3) return; // 20 fps is plenty for a portrait
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, cv.width, cv.height);
    const c = app.w.creatures.find(c => c.id === app.selected);
    if (!c) return;
    const t = performance.now() / 1000;
    const r = S.radius(c);
    const scale = Math.min(3.2, 48 / r);
    pctx.translate(cv.width / 2, cv.height * 0.86);
    pctx.scale(scale, scale);
    const o = { t, walk: 0, moving: false, facing: 1, lookX: Math.sin(t * 0.5) * 0.6, lookY: 0.1, growth: S.growth(c), mood: 'open', mouth: 'smile' };
    if (c.s === 0) {
      if (c.st === S.ST.SLEEP) o.mood = 'closed';
      else if (c.st === S.ST.FLEE) { o.mood = 'wide'; o.mouth = 'scream'; }
      else if (c.st === S.ST.EAT || c.st === S.ST.GRAZE) o.mouth = 'chew';
      else if (c.st === S.ST.MATE) o.mood = 'happy';
      else if (c.st === S.ST.STUN) o.mood = 'dizzy';
      SP.drawDumpling(pctx, c, o);
    } else {
      o.mood = c.st === S.ST.SLEEP ? 'closed' : c.st === S.ST.HUNT ? 'open' : c.st === S.ST.FEAST ? 'happy' : c.st === S.ST.STUN ? 'dizzy' : 'grumpy';
      o.angry = c.st === S.ST.HUNT;
      o.mouth = c.st === S.ST.FEAST ? 'chomp' : c.st === S.ST.HUNT ? 'open' : 'smile';
      SP.drawGrumble(pctx, c, o);
    }
  };
  loop();
}

// ---------------------------------------------------------------------------
// toast + loader

let toastTimer = 0;
export function toast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function loaderProgress(frac, text) {
  $('loader-bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (text) $('loader-text').textContent = text;
}
export function hideLoader() { $('loader').classList.add('done'); setTimeout(() => { $('loader').hidden = true; }, 600); }
export function showLoader() { const l = $('loader'); l.hidden = false; l.classList.remove('done'); loaderProgress(0); }

const demo = { id: 3, s: 0, g: [1, 1, 1, 48, 1, 0, 1.1, 0], age: 99999, st: 0 };
export function drawLoaderArt(t) {
  const cv = $('loader-art');
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.translate(cv.width / 2, cv.height - 14);
  c.scale(3, 3);
  c.translate(0, -Math.abs(Math.sin(t * 4)) * 6);
  SP.drawDumpling(c, demo, { t, walk: t * 2, moving: true, facing: 1, lookX: 0.4, lookY: -0.2, growth: 1, mood: 'open', mouth: 'smile' });
}
