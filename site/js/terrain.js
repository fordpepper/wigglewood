// Pixel art ground. The island is painted pixel by pixel straight from the
// same elevation field the simulation walks on: flat colour bands, ordered
// dithering where biomes meet, ink outlines along the coast, cliff faces under
// the highlands and a few hand-placed-looking decals. Tiles are 128 art pixels
// and cached per season and zoom level (level L: one pixel = 3 * 2^L world units).
import * as S from '../sim/core.js';
import { PX, rgb, hex, bayer } from './pixel.js';
import * as SP from './sprites.js';

export const TILE = 128;
export const MAX_LEVEL = 4;

const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(x => hex(x)) : hex(v)]));
// each land colour comes as [shadow, normal, sunlit]
const PALETTES = [
  P({ // spring
    grass: ['#76c158', '#8ed468', '#a8e27c'], forest: ['#3f8f45', '#4fa552', '#62b860'], dry: ['#a9be62', '#bccf70', '#cfdd84'],
    sand: ['#e3c886', '#f3dd9c', '#fbeab4'], rock: ['#8f8a7e', '#aea99c', '#c8c3b4'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#6f6a5f', cliffSnow: '#9fb0c0', shallow: '#74caf2', deep: '#4e9fe2', deeper: '#3f8ad0', band: '#9ad9f6', foam: '#e8f8ff',
    coast: '#3b3a4a', tuft: '#5fa847', tuftForest: '#2f7a3a', flower: ['#ffffff', '#ffd23f', '#ff8fb8', '#b48cff'],
  }),
  P({ // summer
    grass: ['#93bf4e', '#a8d65c', '#bfe274'], forest: ['#4a8c3c', '#5ea047', '#72b456'], dry: ['#c2b45a', '#d3c46a', '#e2d482'],
    sand: ['#e8c880', '#f6dc92', '#fde9ae'], rock: ['#958d7c', '#b3aa98', '#cdc5b2'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#736b5c', cliffSnow: '#9fb0c0', shallow: '#68c6f0', deep: '#4296de', deeper: '#3480c8', band: '#8ed8f6', foam: '#e8f8ff',
    coast: '#3b3a4a', tuft: '#7ea83c', tuftForest: '#3b6e2c', flower: ['#ffffff', '#ffd23f', '#ff7b54', '#ff8fb8'],
  }),
  P({ // autumn
    grass: ['#b8a84e', '#cebe62', '#ddd07a'], forest: ['#a86e34', '#c2843e', '#d69a4c'], dry: ['#b49a5a', '#c6ab68', '#d6bd7e'],
    sand: ['#dcc286', '#eed69a', '#f6e4b2'], rock: ['#8d8578', '#aba393', '#c4bdac'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#6b6458', cliffSnow: '#9fb0c0', shallow: '#62b8e4', deep: '#408ace', deeper: '#3474b8', band: '#86ccec', foam: '#e8f8ff',
    coast: '#3b3a4a', tuft: '#9c8a3a', tuftForest: '#8a5226', flower: ['#f2a541', '#e0603a', '#f7d046'],
  }),
  P({ // winter
    grass: ['#d0dde6', '#e8f0f5', '#f8fbfd'], forest: ['#bccbd6', '#d4e0e8', '#e6eef3'], dry: ['#d6dbe0', '#e8ecef', '#f6f8fa'],
    sand: ['#cfc8b6', '#e2dccc', '#eeeadf'], rock: ['#86898e', '#a3a6ab', '#bec1c6'], snow: ['#d6e2ec', '#f4f8fb', '#ffffff'],
    cliff: '#63676e', cliffSnow: '#a3b4c4', shallow: '#9fd3ee', deep: '#5a96d2', deeper: '#4a82bc', band: '#c8e8f7', foam: '#ffffff',
    coast: '#3b3a4a', tuft: '#b6c6d2', tuftForest: '#9fb2c0', flower: [],
  }),
];
export function palette(season) { return PALETTES[season]; }
export function seaColor(season) {
  const c = PALETTES[season].deeper;
  return `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;
}

const cache = new Map();
let maxTiles = 110; // grows to fit the view, so tiles on screen never evict each other
let queue = [];
const queued = new Set();
const key = (season, L, tx, ty) => `${season}|${L}|${tx}|${ty}`;

export function renderTile(season, L, tx, ty) {
  const ps = PX * (1 << L); // world units per pixel
  const wx0 = tx * TILE * ps, wy0 = ty * TILE * ps;
  const C = PALETTES[season];
  const { elev, moist } = S.terrain();
  const L_ = S.LEVEL;
  // elevation per pixel centre, with a margin for neighbours and cliffs
  const M = 4, N = TILE + M * 2;
  const E = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = wx0 + (i - M + 0.5) * ps, y = wy0 + (j - M + 0.5) * ps;
    // past the edge of the world the sea keeps getting deeper (no smeared edge rows)
    const out = Math.max(0, -x, x - S.WORLD_W) + Math.max(0, -y, y - S.WORLD_H);
    E[j * N + i] = S.sampleField(elev, x, y) - out / 150;
  }
  const MS = 8, MN = TILE / MS + 2;
  const Mo = new Float32Array(MN * MN);
  for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) Mo[j * MN + i] = S.sampleField(moist, wx0 + i * MS * ps, wy0 + j * MS * ps);

  const canvas = document.createElement('canvas');
  canvas.width = TILE; canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const out = new Uint32Array(img.data.buffer);
  const gx0 = tx * TILE, gy0 = ty * TILE; // global pixel coords for dithering
  const cliffH = Math.max(1, 3 - L);
  const at = (i, j) => E[(j + M) * N + i + M];

  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const e = at(i, j);
      const ex = (at(i + 1, j) - at(i - 1, j)) / 2, ey = (at(i, j + 1) - at(i, j - 1)) / 2; // per pixel
      const g = Math.sqrt(ex * ex + ey * ey) + 1e-9;
      const dith = bayer(gx0 + i, gy0 + j);
      let c;
      if (e < L_.WATER) {
        const dc = (L_.WATER - e) / g; // pixels to the coast
        if (e < L_.DEEP - 0.08) c = C.deeper;
        else if (e < L_.DEEP) c = (L_.DEEP - e) / 0.08 > dith ? C.deeper : C.deep;
        else c = (e - L_.DEEP) / 0.05 > dith ? C.shallow : C.deep;
        if (dc < 1.2) c = C.foam;
        else if (dc > 2.5 && dc < 4.5 - L * 0.6) c = C.band;
      } else {
        const dl = (e - L_.WATER) / g;
        // sunlight from the top left, in three bands with dithering in between
        const light = (-ex - ey) * 420 / ps;
        const tone = light > 0.7 + dith * 0.6 ? 2 : light < -0.7 - dith * 0.6 ? 0 : 1;
        const mi = i / MS, mj = j / MS, mi0 = Math.floor(mi), mj0 = Math.floor(mj), fx = mi - mi0, fy = mj - mj0;
        const m = (Mo[mj0 * MN + mi0] * (1 - fx) + Mo[mj0 * MN + mi0 + 1] * fx) * (1 - fy) + (Mo[(mj0 + 1) * MN + mi0] * (1 - fx) + Mo[(mj0 + 1) * MN + mi0 + 1] * fx) * fy;
        if (e < L_.SAND) c = C.sand[tone];
        else {
          const fT = (m - (S.FOREST_MOIST - 0.04)) / 0.05, dT = (0.42 - m) / 0.05;
          c = fT > dith ? C.forest[tone] : dT > dith ? C.dry[tone] : C.grass[tone];
          if ((e - L_.SAND) / g < 1.5 && dith > 0.5) c = C.sand[tone]; // ragged beach edge
        }
        if (e >= L_.HILL) c = e >= L_.PEAK ? C.snow[tone] : C.rock[tone];
        else {
          // a cliff face just below the edge of the highlands
          for (let k = 1; k <= cliffH; k++) {
            const up = at(i, j - k);
            if (up >= L_.HILL) { c = up >= L_.PEAK ? C.cliffSnow : C.cliff; break; }
          }
        }
        if (e >= L_.HILL && e < L_.PEAK) {
          for (let k = 1; k <= cliffH; k++) if (at(i, j - k) >= L_.PEAK) { c = C.cliffSnow; break; }
        }
        // ink outlines: coast and the top edges of plateaus
        if (dl < 1) c = C.coast;
        const rimH = (e - L_.HILL) / g, rimP = (e - L_.PEAK) / g;
        if ((rimH >= 0 && rimH < 1) || (rimP >= 0 && rimP < 1)) c = C.coast;
      }
      out[j * TILE + i] = c;
    }
  }
  if (L <= 1) decals(out, season, L, ps, wx0, wy0, at, C);
  ctx.putImageData(img, 0, 0);
  if (L >= BAKE_LEVEL) bakeScenery(ctx, season, L, wx0, wy0, ps);
  return canvas;
}

// Zoomed out, the trees and rocks are painted straight into the ground tiles
// so a view of the whole island costs no more than a close-up.
export const BAKE_LEVEL = 1;
let BUCKETS = null;
const BUCKET = 512;
function buckets() {
  if (BUCKETS) return BUCKETS;
  BUCKETS = new Map();
  const sc = S.scenery();
  const add = (kind, o) => {
    const k = `${Math.floor(o.x / BUCKET)},${Math.floor(o.y / BUCKET)}`;
    if (!BUCKETS.has(k)) BUCKETS.set(k, []);
    BUCKETS.get(k).push([o.y, kind, o]);
  };
  for (const o of sc.trees) add(0, o);
  for (const o of sc.rocks) add(1, o);
  for (const o of sc.mushrooms) add(3, o);
  for (const o of sc.shrubs) add(7, o);
  return BUCKETS;
}
function bakeScenery(ctx, season, L, wx0, wy0, ps) {
  const u = 1 / ps, span = TILE * ps;
  const list = [];
  const b = buckets();
  for (let by = Math.floor((wy0 - 40) / BUCKET); by <= Math.floor((wy0 + span + 130) / BUCKET); by++) {
    for (let bx = Math.floor((wx0 - 70) / BUCKET); bx <= Math.floor((wx0 + span + 70) / BUCKET); bx++) {
      for (const it of b.get(`${bx},${by}`) || []) {
        const o = it[2];
        if (o.x > wx0 - 70 && o.x < wx0 + span + 70 && o.y > wy0 - 30 && o.y < wy0 + span + 130) list.push(it);
      }
    }
  }
  list.sort((p, q) => p[0] - q[0]);
  ctx.imageSmoothingEnabled = false;
  for (const [, kind, o] of list) {
    const X = Math.round((o.x - wx0) * u), Y = Math.round((o.y - wy0) * u);
    const cv = kind === 0 ? SP.tree(o, season, u) : kind === 1 ? SP.rock(o, season, u) : kind === 3 ? SP.mushroom(u) : SP.shrub(season, u);
    SP.stamp(ctx, cv, X, Y);
  }
}

// small marks: grass tufts, flowers, pebbles, wave squiggles
function decals(out, season, L, ps, wx0, wy0, at, C) {
  const L_ = S.LEVEL;
  const cell = L === 0 ? 9 : 14;
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < TILE && y < TILE) out[y * TILE + x] = c; };
  const gx0 = Math.floor(wx0 / ps), gy0 = Math.floor(wy0 / ps);
  const ci0 = Math.floor((gx0 - 4) / cell), ci1 = Math.floor((gx0 + TILE + 4) / cell);
  const cj0 = Math.floor((gy0 - 4) / cell), cj1 = Math.floor((gy0 + TILE + 4) / cell);
  for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
    const h = S.hash01(ci, cj, 4242 + L), h2 = S.hash01(ci, cj, 777);
    const x = ci * cell + Math.floor(h2 * (cell - 3)) - gx0, y = cj * cell + Math.floor(S.hash01(ci, cj, 31) * (cell - 3)) - gy0;
    if (x < -3 || y < -3 || x > TILE + 2 || y > TILE + 2) continue;
    const e = at(Math.max(-3, Math.min(TILE + 2, x)), Math.max(-3, Math.min(TILE + 2, y)));
    const m = S.moistAt(Math.max(0, Math.min(S.WORLD_W, wx0 + x * ps)), Math.max(0, Math.min(S.WORLD_H, wy0 + y * ps)));
    if (e > L_.SAND + 0.012 && e < L_.HILL - 0.012) {
      const forest = m > S.FOREST_MOIST - 0.01;
      if (h < (forest ? 0.4 : 0.32)) { // tuft: two little blades
        const c = forest ? C.tuftForest : C.tuft;
        put(x, y, c); put(x, y + 1, c); put(x + 2, y + 1, c); put(x + 1, y + 2, c);
      } else if (L === 0 && h > 0.965 && C.flower.length && !forest) {
        const c = C.flower[Math.floor(h2 * C.flower.length)];
        put(x + 1, y, c); put(x, y + 1, c); put(x + 2, y + 1, c); put(x + 1, y + 2, c); put(x + 1, y + 1, C.flower.length > 1 ? hex('#ffcc33') : c);
      }
    } else if (e > L_.WATER + 0.006 && e < L_.SAND - 0.004) {
      if (h < 0.3) put(x, y, C.sand[0]);
    } else if (e < L_.WATER - 0.03 && season !== 3) {
      if (h < 0.1) { const c = C.band; put(x, y + 1, c); put(x + 1, y, c); put(x + 2, y, c); put(x + 3, y + 1, c); }
    } else if (e >= L_.PEAK + 0.01) {
      if (h < 0.2) { put(x, y + 1, C.snow[0]); put(x + 1, y, C.snow[0]); put(x + 2, y + 1, C.snow[0]); }
    } else if (e >= L_.HILL + 0.01 && e < L_.PEAK) {
      if (h < 0.18) { put(x, y, C.rock[0]); put(x + 1, y, C.rock[0]); put(x + 1, y - 1, C.rock[2]); }
    }
  }
}

export function getTile(season, L, tx, ty, request) {
  const k = key(season, L, tx, ty);
  const t = cache.get(k);
  if (t) { cache.delete(k); cache.set(k, t); return t; }
  if (request && !queued.has(k)) { queued.add(k); queue.push([season, L, tx, ty, k]); }
  return null;
}

// least recently used first, but the coarsest level always stays: it is the
// fallback whenever anything else is missing
function evict() {
  for (const k of cache.keys()) {
    if (cache.size <= maxTiles) return;
    if (!k.includes(`|${MAX_LEVEL}|`)) cache.delete(k);
  }
}

export function pumpTiles(budgetMs) {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < budgetMs) {
    const [season, L, tx, ty, k] = queue.pop(); // newest first: that's what's on screen
    queued.delete(k);
    if (cache.has(k)) continue;
    cache.set(k, renderTile(season, L, tx, ty));
    evict();
  }
  return queue.length;
}

// draw the ground for the visible rect (in art pixels at level L);
// missing tiles borrow a coarser level, scaled up with hard pixels
export function drawGround(ctx, season, L, view) {
  queue = []; queued.clear();
  const tx0 = Math.max(0, Math.floor(view.x0 / TILE)), ty0 = Math.max(0, Math.floor(view.y0 / TILE));
  const wpx = S.WORLD_W / (PX << L), hpx = S.WORLD_H / (PX << L);
  const tx1 = Math.min(Math.ceil(wpx / TILE) - 1, Math.floor(view.x1 / TILE)), ty1 = Math.min(Math.ceil(hpx / TILE) - 1, Math.floor(view.y1 / TILE));
  maxTiles = Math.max(maxTiles, (tx1 - tx0 + 1) * (ty1 - ty0 + 1) * 2 + 60);
  let missing = 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = getTile(season, L, tx, ty, true);
    if (t) { ctx.drawImage(t, tx * TILE, ty * TILE); continue; }
    missing++;
    let drawn = false;
    for (let LL = L + 1; LL <= MAX_LEVEL && !drawn; LL++) {
      const f = 1 << (LL - L);
      const ftx = Math.floor(tx / f), fty = Math.floor(ty / f);
      const ft = getTile(season, LL, ftx, fty, LL === MAX_LEVEL);
      if (ft) {
        const sub = TILE / f;
        ctx.drawImage(ft, (tx - ftx * f) * sub, (ty - fty * f) * sub, sub, sub, tx * TILE, ty * TILE, TILE, TILE);
        drawn = true;
      }
    }
    if (!drawn) for (let s2 = 0; s2 < 4 && !drawn; s2++) {
      const t2 = getTile(s2, L, tx, ty, false);
      if (t2) { ctx.drawImage(t2, tx * TILE, ty * TILE); drawn = true; }
    }
  }
  return missing;
}

// pre-render the coarsest level so there is always something to show
export function warmup(season) {
  const span = TILE * PX * (1 << MAX_LEVEL);
  for (let ty = 0; ty * span < S.WORLD_H; ty++) for (let tx = 0; tx * span < S.WORLD_W; tx++) {
    const k = key(season, MAX_LEVEL, tx, ty);
    if (!cache.has(k)) cache.set(k, renderTile(season, MAX_LEVEL, tx, ty));
  }
}

export { rgb };
