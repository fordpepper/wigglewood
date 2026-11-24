// Pixel art ground. The islands are painted pixel by pixel straight from the
// same fields the simulation walks on: flat colour bands per biome, ordered
// dithering where biomes meet, ink outlines along the coast, cliff faces under
// the highlands and a few hand-placed-looking decals. Tiles are 128 art pixels
// and cached per season and zoom level (level L: one pixel = 3 * 2^L world units).
import * as S from '../sim/core.js';
import { PX, rgb, hex, shade, bayer } from './pixel.js';
import * as SP from './sprites.js';

export const TILE = 128;
export const MAX_LEVEL = 5;
const B = S.BIOME;

const H3 = a => a.map(x => hex(x));
// ground colours per biome and season, each [shadow, normal, sunlit]
const GROUND = [];
GROUND[B.MEADOW] = [
  ['#76c158', '#8ed468', '#a8e27c'], ['#93bf4e', '#a8d65c', '#bfe274'], ['#b8a84e', '#cebe62', '#ddd07a'], ['#d0dde6', '#e8f0f5', '#f8fbfd'],
];
GROUND[B.FOREST] = [
  ['#3f8f45', '#4fa552', '#62b860'], ['#4a8c3c', '#5ea047', '#72b456'], ['#a86e34', '#c2843e', '#d69a4c'], ['#bccbd6', '#d4e0e8', '#e6eef3'],
];
GROUND[B.STEPPE] = [
  ['#a9be62', '#bccf70', '#cfdd84'], ['#c2b45a', '#d3c46a', '#e2d482'], ['#b49a5a', '#c6ab68', '#d6bd7e'], ['#d6dbe0', '#e8ecef', '#f6f8fa'],
];
GROUND[B.SWAMP] = [
  ['#4f7a4a', '#5f8c52', '#729e5e'], ['#557a3e', '#668c48', '#7a9e56'], ['#6e6a3a', '#827c44', '#958e52'], ['#8d9a8c', '#a3ae9f', '#b9c2b4'],
];
GROUND[B.DESERT] = [
  ['#e0b56e', '#ecc77e', '#f6d996'], ['#e3b066', '#efc476', '#f8d68e'], ['#dcb26e', '#e8c47e', '#f3d696'], ['#d9b87a', '#e6c98c', '#f0d9a4'],
];
GROUND[B.SAVANNA] = [
  ['#b5c25a', '#c6d16a', '#d6de7e'], ['#d6b04e', '#e4c25c', '#efd274'], ['#ccb052', '#dcc060', '#e8cf76'], ['#a9b85c', '#bac86a', '#cad67c'],
];
GROUND[B.JUNGLE] = [
  ['#2f7d3f', '#3a9148', '#4aa554'], ['#2f7d3f', '#3a9148', '#4aa554'], ['#357c3a', '#409045', '#52a250'], ['#2f7a44', '#3a8e4d', '#4aa058'],
];
GROUND[B.TAIGA] = [
  ['#4c7d5c', '#5a8e68', '#6c9f76'], ['#4f8458', '#5e9664', '#70a872'], ['#6f7d4f', '#7f8e5a', '#919f68'], ['#c6d3de', '#dfe8ef', '#f2f6f9'],
];
GROUND[B.TUNDRA] = [
  ['#c9d6e2', '#e2eaf1', '#f4f8fb'], ['#8f9e86', '#a3b096', '#b7c2a8'], ['#b49a78', '#c6ad8a', '#d6bf9e'], ['#d6e2ec', '#f4f8fb', '#ffffff'],
];
const G = GROUND.map(b => b.map(H3));
// little grass tufts: a darker shade of the ground
const TUFT = G.map(b => b.map(t => shade(t[0], 0.84)));

// everything else per season (water, beaches, rock, snow, outlines)
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? H3(v) : hex(v)]));
const SEASON = [
  P({ // spring
    sand: ['#e3c886', '#f3dd9c', '#fbeab4'], rock: ['#8f8a7e', '#aea99c', '#c8c3b4'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#6f6a5f', cliffSnow: '#9fb0c0', shallow: '#74caf2', deep: '#4e9fe2', deeper: '#3f8ad0', band: '#9ad9f6', foam: '#e8f8ff',
    flower: ['#ffffff', '#ffd23f', '#ff8fb8', '#b48cff'],
  }),
  P({ // summer
    sand: ['#e8c880', '#f6dc92', '#fde9ae'], rock: ['#958d7c', '#b3aa98', '#cdc5b2'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#736b5c', cliffSnow: '#9fb0c0', shallow: '#68c6f0', deep: '#4296de', deeper: '#3480c8', band: '#8ed8f6', foam: '#e8f8ff',
    flower: ['#ffffff', '#ffd23f', '#ff7b54', '#ff8fb8'],
  }),
  P({ // autumn
    sand: ['#dcc286', '#eed69a', '#f6e4b2'], rock: ['#8d8578', '#aba393', '#c4bdac'], snow: ['#c9d6e2', '#eef3f8', '#ffffff'],
    cliff: '#6b6458', cliffSnow: '#9fb0c0', shallow: '#62b8e4', deep: '#408ace', deeper: '#3474b8', band: '#86ccec', foam: '#e8f8ff',
    flower: ['#f2a541', '#e0603a', '#f7d046'],
  }),
  P({ // winter
    sand: ['#cfc8b6', '#e2dccc', '#eeeadf'], rock: ['#86898e', '#a3a6ab', '#bec1c6'], snow: ['#d6e2ec', '#f4f8fb', '#ffffff'],
    cliff: '#63676e', cliffSnow: '#a3b4c4', shallow: '#9fd3ee', deep: '#5a96d2', deeper: '#4a82bc', band: '#c8e8f7', foam: '#ffffff',
    flower: [],
  }),
];
const CLIMATE = P({
  coldSand: ['#b3ada0', '#c8c3b6', '#d9d5ca'], hotSand: ['#efdcae', '#f8e9c2', '#fff4d8'],
  redRock: ['#a86a52', '#c27f62', '#d8987a'], redCliff: '#87503e',
  coldShallow: '#7fb4d6', coldBand: '#a9cfe6', coldDeep: '#4a86c2',
  hotShallow: '#5fd6d2', hotBand: '#9cecea', hotDeep: '#3aa6d8',
  ice: ['#c4dbea', '#dceaf3', '#eef6fb'],
  coast: '#3b3a4a', puddle: '#6a9ab0', dune: '#d29f5c', jungleFlower: ['#ff5a5a', '#ff9a3c', '#ff7bd0'],
});
export function palette(season) { return SEASON[season]; }
export function seaColor(season) {
  const c = SEASON[season].deeper;
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
  const C = SEASON[season];
  const { elev, moist, temp } = S.terrain();
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
  // climate on a coarse grid, interpolated per pixel
  const MS = 8, MN = TILE / MS + 2;
  const Mo = new Float32Array(MN * MN), Te = new Float32Array(MN * MN);
  for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) {
    Mo[j * MN + i] = S.sampleLinear(moist, wx0 + i * MS * ps, wy0 + j * MS * ps);
    Te[j * MN + i] = S.sampleLinear(temp, wx0 + i * MS * ps, wy0 + j * MS * ps);
  }
  const lerp = (A, i, j) => {
    const mi = i / MS, mj = j / MS, mi0 = Math.floor(mi), mj0 = Math.floor(mj), fx = mi - mi0, fy = mj - mj0, k = mj0 * MN + mi0;
    return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + MN] * (1 - fx) + A[k + MN + 1] * fx) * fy;
  };

  const canvas = document.createElement('canvas');
  canvas.width = TILE; canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const out = new Uint32Array(img.data.buffer);
  const gx0 = tx * TILE, gy0 = ty * TILE; // global pixel coords for dithering
  const cliffH = Math.max(1, 3 - L);
  const at = (i, j) => E[(j + M) * N + i + M];
  const frozen = season === 3 ? 0.3 : season === 1 ? 0 : 0.14; // sea ice below this warmth

  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const e = at(i, j);
      const ex = (at(i + 1, j) - at(i - 1, j)) / 2, ey = (at(i, j + 1) - at(i, j - 1)) / 2; // per pixel
      const g = Math.sqrt(ex * ex + ey * ey) + 1e-9;
      const dith = bayer(gx0 + i, gy0 + j);
      const t = lerp(Te, i, j) + (dith - 0.5) * 0.05;
      let c;
      if (e < L_.WATER) {
        const dc = (L_.WATER - e) / g; // pixels to the coast
        const cold = t < 0.3, hot = t > 0.68;
        const shallow = cold ? CLIMATE.coldShallow : hot ? CLIMATE.hotShallow : C.shallow;
        const deep = cold ? CLIMATE.coldDeep : hot ? CLIMATE.hotDeep : C.deep;
        if (e < L_.DEEP - 0.08) c = C.deeper;
        else if (e < L_.DEEP) c = (L_.DEEP - e) / 0.08 > dith ? C.deeper : deep;
        else c = (e - L_.DEEP) / 0.05 > dith ? shallow : deep;
        if (t < frozen && e > L_.DEEP - 0.02) {
          // frozen shallows: pale ice, shading with depth
          const k = (L_.WATER - e) / (L_.WATER - L_.DEEP + 0.02);
          c = CLIMATE.ice[k + dith * 0.3 > 0.7 ? 0 : k + dith * 0.3 > 0.3 ? 1 : 2];
          if (dc < 1.2) c = CLIMATE.coast;
        } else if (dc < 1.2) c = C.foam;
        else if (dc > 2.5 && dc < 4.5 - L * 0.6) c = cold ? CLIMATE.coldBand : hot ? CLIMATE.hotBand : C.band;
      } else {
        const dl = (e - L_.WATER) / g;
        // sunlight from the top left, in three bands with dithering in between
        const light = (-ex - ey) * 420 / ps;
        const tone = light > 0.7 + dith * 0.6 ? 2 : light < -0.7 - dith * 0.6 ? 0 : 1;
        const m = lerp(Mo, i, j) + (dith - 0.5) * 0.06;
        const b = S.classify(t, m);
        const dryHot = b === B.DESERT || b === B.SAVANNA;
        if (e < L_.SAND) c = (t < 0.32 ? CLIMATE.coldSand : t > 0.66 ? CLIMATE.hotSand : C.sand)[tone];
        else {
          c = G[b][season][tone];
          if ((e - L_.SAND) / g < 1.5 && dith > 0.5 && b !== B.DESERT) c = (t < 0.32 ? CLIMATE.coldSand : t > 0.66 ? CLIMATE.hotSand : C.sand)[tone]; // ragged beach edge
        }
        const rock = dryHot ? CLIMATE.redRock : C.rock, cliff = dryHot ? CLIMATE.redCliff : C.cliff;
        const snowy = !dryHot && b !== B.JUNGLE;
        if (e >= L_.HILL) c = e >= L_.PEAK && snowy ? C.snow[tone] : e >= L_.PEAK ? shade(rock[tone], 1.12) : rock[tone];
        else {
          // a cliff face just below the edge of the highlands
          for (let k = 1; k <= cliffH; k++) {
            const up = at(i, j - k);
            if (up >= L_.HILL) { c = up >= L_.PEAK && snowy ? C.cliffSnow : cliff; break; }
          }
        }
        if (e >= L_.HILL && e < L_.PEAK && snowy) {
          for (let k = 1; k <= cliffH; k++) if (at(i, j - k) >= L_.PEAK) { c = C.cliffSnow; break; }
        }
        // ink outlines: coast and the top edges of plateaus
        if (dl < 1) c = CLIMATE.coast;
        const rimH = (e - L_.HILL) / g, rimP = (e - L_.PEAK) / g;
        if ((rimH >= 0 && rimH < 1) || (rimP >= 0 && rimP < 1)) c = CLIMATE.coast;
      }
      out[j * TILE + i] = c;
    }
  }
  if (L <= 1) decals(out, season, L, ps, wx0, wy0, at, C);
  ctx.putImageData(img, 0, 0);
  // (from very far away single trees are only noise: the ground colours carry the forests)
  if (L >= BAKE_LEVEL && L <= 3) bakeScenery(ctx, season, L, wx0, wy0, ps);
  return canvas;
}

// Zoomed out, the trees and rocks are painted straight into the ground tiles
// so a view of the whole world costs no more than a close-up.
export const BAKE_LEVEL = 1;
let BUCKETS = null;
const BUCKET = 512;
// scenery sorted into 512-unit squares: [y, kind, object]
export function buckets() {
  if (BUCKETS) return BUCKETS;
  BUCKETS = new Map();
  const sc = S.scenery();
  const add = (kind, o) => {
    const k = Math.floor(o.y / BUCKET) * 4096 + Math.floor(o.x / BUCKET);
    if (!BUCKETS.has(k)) BUCKETS.set(k, []);
    BUCKETS.get(k).push([o.y, kind, o]);
  };
  for (const o of sc.trees) add(0, o);
  for (const o of sc.rocks) add(1, o);
  for (const o of sc.mushrooms) add(3, o);
  for (const o of sc.reeds) add(4, o);
  for (const o of sc.shrubs) add(7, o);
  return BUCKETS;
}
// every piece of scenery inside a world rectangle
export function sceneryIn(x0, y0, x1, y1, fn) {
  const b = buckets();
  for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++) {
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
      const list = b.get(by * 4096 + bx);
      if (list) for (const it of list) { const o = it[2]; if (o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1) fn(it); }
    }
  }
}
function bakeScenery(ctx, season, L, wx0, wy0, ps) {
  const u = 1 / ps, span = TILE * ps;
  const list = [];
  sceneryIn(wx0 - 70, wy0 - 30, wx0 + span + 70, wy0 + span + 130, it => { if (it[1] !== 4) list.push(it); });
  list.sort((p, q) => p[0] - q[0]);
  ctx.imageSmoothingEnabled = false;
  for (const [, kind, o] of list) {
    const X = Math.round((o.x - wx0) * u), Y = Math.round((o.y - wy0) * u);
    const cv = kind === 0 ? SP.tree(o, season, u) : kind === 1 ? SP.rock(o, season, u, SP.rockTint(o)) : kind === 3 ? SP.mushroom(u) : SP.shrub(season, u, SP.shrubKind(o));
    SP.stamp(ctx, cv, X, Y);
  }
}

// small marks: grass tufts, flowers, ripples in the dunes, puddles, pebbles, wave squiggles
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
    const wx = Math.max(0, Math.min(S.WORLD_W, wx0 + x * ps)), wy = Math.max(0, Math.min(S.WORLD_H, wy0 + y * ps));
    if (e > L_.SAND + 0.012 && e < L_.HILL - 0.012) {
      const b = S.biomeAt(wx, wy);
      const tuft = TUFT[b][season], base = G[b][season];
      if (b === B.DESERT) {
        // ripples in the sand
        if (h < 0.35) { const c = base[0]; put(x, y + 1, c); put(x + 1, y, c); put(x + 2, y, c); put(x + 3, y + 1, c); put(x + 4, y + 1, c); }
        else if (h > 0.97) { put(x, y, CLIMATE.redRock[0]); put(x + 1, y, CLIMATE.redRock[1]); }
      } else if (b === B.SWAMP && h > 0.86 && season !== 3) {
        // a puddle
        put(x + 1, y, CLIMATE.puddle); put(x + 2, y, CLIMATE.puddle); put(x, y + 1, CLIMATE.puddle); put(x + 1, y + 1, CLIMATE.puddle); put(x + 2, y + 1, CLIMATE.puddle); put(x + 3, y + 1, CLIMATE.puddle);
        put(x + 1, y + 2, tuft); put(x + 2, y + 2, tuft);
      } else if (h < (isWoodedish(b) ? 0.4 : 0.32)) {
        // tuft: two little blades (taller in the savanna)
        put(x, y, tuft); put(x, y + 1, tuft); put(x + 2, y + 1, tuft); put(x + 1, y + 2, tuft);
        if (b === B.SAVANNA) { put(x, y - 1, tuft); put(x + 2, y, tuft); }
      } else if (L === 0 && h > 0.965) {
        const fl = b === B.JUNGLE ? CLIMATE.jungleFlower : b === B.MEADOW || b === B.STEPPE ? C.flower : null;
        if (fl && fl.length) {
          const c = fl[Math.floor(h2 * fl.length)];
          put(x + 1, y, c); put(x, y + 1, c); put(x + 2, y + 1, c); put(x + 1, y + 2, c); put(x + 1, y + 1, fl.length > 1 ? hex('#ffcc33') : c);
        } else if (b === B.TUNDRA) { put(x, y, C.rock[0]); put(x + 1, y, C.rock[1]); }
      }
    } else if (e > L_.WATER + 0.006 && e < L_.SAND - 0.004) {
      if (h < 0.3) put(x, y, C.sand[0]);
    } else if (e < L_.WATER - 0.03 && e > L_.DEEP - 0.1 && season !== 3) {
      if (h < 0.1) { const c = C.band; put(x, y + 1, c); put(x + 1, y, c); put(x + 2, y, c); put(x + 3, y + 1, c); }
    } else if (e >= L_.PEAK + 0.01) {
      if (h < 0.2) { put(x, y + 1, C.snow[0]); put(x + 1, y, C.snow[0]); put(x + 2, y + 1, C.snow[0]); }
    } else if (e >= L_.HILL + 0.01 && e < L_.PEAK) {
      if (h < 0.18) { put(x, y, C.rock[0]); put(x + 1, y, C.rock[0]); put(x + 1, y - 1, C.rock[2]); }
    }
  }
}
const isWoodedish = b => b === B.FOREST || b === B.JUNGLE || b === B.TAIGA || b === B.SWAMP;

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
