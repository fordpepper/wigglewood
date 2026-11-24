// The little bit of HTML on top of the islands: the clock, the creature card
// and the loader. Kept deliberately small.
import * as S from '../sim/core.js';
import * as SP from './sprites.js';

const $ = id => document.getElementById(id);
let app = null, act = null;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function init(a, actions) {
  app = a; act = actions;
  $('card').addEventListener('click', () => act.deselect());
  initSearch();
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
    : cause === 'starved' ? 'Ran out of food.' : 'Passed away of old age.';
  $('c-energy').style.width = '0%';
}

function updateCard() {
  const c = app.w.creatures.find(c => c.id === app.selected);
  if (!c) { if (!gone) onSelectedDied(app, { cause: 'gone' }); return; }
  const sp = S.SPECIES[c.s];
  const mins = Math.floor(c.age / S.TPS / 60);
  $('c-name').textContent = c.n;
  $('c-kind').textContent = `${sp.name} from ${S.islandName(c.il)}, ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} old`;
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
    if (frame++ % 4) return; // 15 fps is plenty for a portrait
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, cv.width, cv.height);
    const c = app.w.creatures.find(c => c.id === app.selected);
    if (!c) return;
    const t = performance.now() / 1000;
    const u = Math.min(0.6, 9 / S.radius(c));
    const o = { t, frame: Math.floor(t * 1.1) & 1, facing: 1, lookX: Math.sin(t * 0.5) > 0 ? 0.8 : -0.4, lookY: 0.2, mood: 'open', mouth: 'smile', blink: (t % 4.2) < 0.15 };
    if (c.s === 0) {
      if (c.st === S.ST.SLEEP) o.mood = 'closed';
      else if (c.st === S.ST.FLEE) { o.mood = 'wide'; o.mouth = 'scream'; }
      else if (c.st === S.ST.EAT || c.st === S.ST.GRAZE) o.mouth = 'chew';
      else if (c.st === S.ST.MATE) o.mood = 'happy';
      else if (c.st === S.ST.STUN) o.mood = 'dizzy';
    } else {
      o.mood = c.st === S.ST.SLEEP ? 'closed' : c.st === S.ST.HUNT ? 'open' : c.st === S.ST.FEAST ? 'happy' : c.st === S.ST.STUN ? 'dizzy' : 'grumpy';
      o.angry = c.st === S.ST.HUNT;
      o.mouth = c.st === S.ST.FEAST ? 'chomp' : c.st === S.ST.HUNT ? 'open' : 'smile';
    }
    SP.drawCreature(pctx, c, Math.floor(cv.width / 2), cv.height - 6, o, u);
  };
  loop();
}

// ---------------------------------------------------------------------------
// name search (double tap anywhere, or press / on a keyboard)

const MAX_RESULTS = 8;
function initSearch() {
  const input = $('search-input');
  input.addEventListener('input', () => renderResults());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('search-results').querySelector('button'); if (first) first.click(); }
    else if (e.key === 'Escape') closeSearch();
    else if (e.key === 'ArrowDown') { const first = $('search-results').querySelector('button'); if (first) { e.preventDefault(); first.focus(); } }
    e.stopPropagation();
  });
  $('search-results').addEventListener('keydown', e => {
    const items = [...$('search-results').querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : input).focus(); }
    else if (e.key === 'Escape') closeSearch();
    e.stopPropagation();
  });
  $('search-close').addEventListener('click', () => closeSearch());
  setInterval(() => { if (searchOpen() && document.activeElement === input) renderResults(); }, 1500);
}
export function searchOpen() { return !$('search').hidden; }
export function openSearch() {
  $('search').hidden = false;
  const input = $('search-input');
  input.value = '';
  renderResults();
  input.focus();
}
export function closeSearch() {
  $('search').hidden = true;
  $('search-input').blur();
}
function renderResults() {
  const q = $('search-input').value.trim().toLowerCase();
  const ul = $('search-results');
  ul.textContent = '';
  if (!q) { $('search-hint').hidden = false; return; }
  $('search-hint').hidden = true;
  const starts = [], has = [];
  for (const c of app.w.creatures) {
    const n = c.n.toLowerCase();
    if (n.startsWith(q)) starts.push(c); else if (n.includes(q)) has.push(c);
  }
  const byName = (a, b) => a.n.localeCompare(b.n) || a.id - b.id;
  const list = starts.sort(byName).concat(has.sort(byName)).slice(0, MAX_RESULTS);
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'Nobody by that name right now.';
    ul.append(li);
    return;
  }
  for (const c of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const name = document.createElement('strong');
    name.textContent = c.n;
    const where = document.createElement('span');
    where.textContent = `${S.SPECIES[c.s].name}, ${S.islandName(c.il)}`;
    b.append(name, where);
    b.addEventListener('click', () => { closeSearch(); act.select(c.id); });
    li.append(b);
    ul.append(li);
  }
}

// ---------------------------------------------------------------------------
// loader

export function loaderProgress(frac, text) {
  $('loader-bar').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (text) $('loader-text').textContent = text;
}
export function hideLoader() { $('loader').classList.add('done'); setTimeout(() => { $('loader').hidden = true; }, 600); }
export function showLoader() { const l = $('loader'); l.hidden = false; l.classList.remove('done'); loaderProgress(0); }

const demo = { id: -7, s: 0, g: [1, 1, 1, 48, 1, 0, 1.1, 0], age: 99999, st: 0 };
export function drawLoaderArt(t) {
  const cv = $('loader-art');
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, cv.width, cv.height);
  const hop = Math.round(Math.abs(Math.sin(t * 4)) * 6);
  const X = Math.floor(cv.width / 2), Y = cv.height - 4;
  c.fillStyle = 'rgba(24,20,30,0.25)';
  c.fillRect(X - 5 + Math.floor(hop / 3), Y, 11 - Math.floor(hop / 3) * 2, 1);
  SP.drawCreature(c, demo, X, Y - hop, { t, frame: hop > 1 ? 2 + (Math.floor(t * 8) & 3) : 0, facing: 1, lookX: 0.6, lookY: -0.4, mood: 'open', mouth: 'smile' }, 0.5);
}
