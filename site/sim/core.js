// Wigglewood simulation core.
//
// Everything in here is deterministic: the same snapshot advanced to the same
// tick produces bit-identical results in Node (GitHub Actions) and in any
// browser. To keep it that way the simulation only uses +, -, *, /, Math.sqrt,
// Math.floor/min/max/abs/round and integer ops (Math.imul, bit ops). No
// Math.sin/cos/exp/pow/hypot/atan2 (those are implementation-approximated and
// can differ between engines), no Date, no Math.random, no object-key ordering
// tricks. State is normalised through JSON at every checkpoint so that a
// browser that started from an older snapshot follows the exact same path as
// the GitHub Action that produced a newer one.

export const SIM_VERSION = 1;
export const EPOCH_MS = Date.UTC(2026, 10, 23, 0, 0, 0); // world founded
export const TICK_MS = 250;
export const TPS = 1000 / TICK_MS;
export const CHECKPOINT_TICKS = 7200; // 30 real minutes
export const SEASON_TICKS = 43200; // one Wigglewood season = 3 real hours, a year = 12 hours
export const WEATHER_TICKS = 4800; // weather changes every 20 minutes
export const WORLD_W = 2400;
export const WORLD_H = 1600;
export const SEED = 0x77176c3d;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export const DUMPLING = 0;
export const GRUMBLE = 1;

// gene indices
export const G_SIZE = 0, G_SPEED = 1, G_SIGHT = 2, G_HUE = 3, G_TOP = 4, G_PAT = 5, G_EYE = 6, G_LIGHT = 7;

// creature states
export const ST = {
  WANDER: 0, FOOD: 1, EAT: 2, FLEE: 3, MATE: 4, SLEEP: 5, HUNT: 6, FOLLOW: 7, STUN: 8, FEAST: 9, GRAZE: 10,
};

export const SPECIES = [
  {
    key: 'dumpling', name: 'Dumpling', plural: 'Dumplings',
    speed: 6.5, // world units per tick at speed gene 1
    sight: 150,
    radius: 18,
    drain: 0.0165, // energy per tick at cost 1
    maxEnergy: 100,
    mature: 2400, // 10 min
    life: 19200, // 80 min
    cooldown: 2160, // 9 min
    litter: [1, 3],
    cap: 280,
  },
  {
    key: 'grumble', name: 'Grumble', plural: 'Grumbles',
    speed: 5.6,
    sight: 210,
    radius: 23,
    drain: 0.0155,
    maxEnergy: 120,
    mature: 4800, // 20 min
    life: 36000, // 150 min
    cooldown: 3600, // 15 min
    litter: [1, 2],
    cap: 60,
  },
];

export const GENE_RANGE = [
  [0.55, 1.8], // size
  [0.55, 1.8], // speed
  [0.5, 1.9], // sight
  [0, 360], // hue (wraps)
  [0, 5], // top accessory (int)
  [0, 3], // pattern (int)
  [0.75, 1.35], // eye size
  [-0.25, 0.25], // lightness tweak
];

// ---------------------------------------------------------------------------
// time helpers (these use Date only on the caller side)

export function tickAt(ms) { return Math.floor((ms - EPOCH_MS) / TICK_MS); }
export function msAt(tick) { return EPOCH_MS + tick * TICK_MS; }
// Day and night are NOT part of the simulation: they come from each viewer's
// own device clock in the renderer, so the shared world stays identical for
// every timezone. Seasons and weather are shared and run on world time.
export function seasonIndex(tick) { return Math.floor(tick / SEASON_TICKS) % 4; }
export function seasonProgress(tick) { return (tick % SEASON_TICKS) / SEASON_TICKS; }
export function yearIndex(tick) { return Math.floor(tick / (SEASON_TICKS * 4)); }
export function weatherAt(tick) {
  const block = Math.floor(tick / WEATHER_TICKS);
  const s = seasonIndex(tick);
  const h = hash01(block, 917, SEED);
  const wetChance = [0.32, 0.16, 0.3, 0.4][s];
  if (h < wetChance) return s === 3 ? 'snow' : 'rain';
  if (h < wetChance + 0.22) return 'cloudy';
  return 'clear';
}

// ---------------------------------------------------------------------------
// deterministic math

export function hashU32(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hash01(x, y, seed) { return hashU32(x, y, seed) / 4294967296; }

const PI = 3.141592653589793;
const TAU = 6.283185307179586;
// sine via range reduction + Taylor series (only +,-,*,/ so it's identical everywhere)
export function dsin(x) {
  x = x - TAU * Math.floor((x + PI) / TAU);
  if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 9; n++) { term = -term * x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
export function dcos(x) { return dsin(x + PI / 2); }

// rotation table for wandering: 33 small turn steps from -0.48 to +0.48 rad
const ROT_STEPS = 33;
const ROT = [];
for (let i = 0; i < ROT_STEPS; i++) { const a = (i - 16) * 0.03; ROT.push([dcos(a), dsin(a)]); }
// unit directions for random headings
const DIRS = [];
for (let i = 0; i < 64; i++) { const a = i * TAU / 64; DIRS.push([dcos(a), dsin(a)]); }

function rnd(w) {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(w, a, b) { return a + Math.floor(rnd(w) * (b - a + 1)); }
function rnorm(w) { return (rnd(w) + rnd(w) + rnd(w) - 1.5) * 1.1547; } // ~N(0,1)-ish, bounded
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function r4(x) { return Math.round(x * 10000) / 10000; }

// ---------------------------------------------------------------------------
// terrain

export const FIELD_CELL = 16;
export const FIELD_W = WORLD_W / FIELD_CELL + 1;
export const FIELD_H = WORLD_H / FIELD_CELL + 1;
export const LEVEL = {
  DEEP: -0.16, WATER: 0, SAND: 0.045, HILL: 0.52, PEAK: 0.66,
};
export const FOREST_MOIST = 0.57;

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, seed), b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed), d = hash01(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, seed, oct) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 1013);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

let FIELD = null; // { elev: Float64Array, moist: Float64Array }
export function terrain() {
  if (FIELD) return FIELD;
  const elev = new Float64Array(FIELD_W * FIELD_H);
  const moist = new Float64Array(FIELD_W * FIELD_H);
  for (let j = 0; j < FIELD_H; j++) {
    for (let i = 0; i < FIELD_W; i++) {
      const x = i * FIELD_CELL, y = j * FIELD_CELL;
      const nx = (x - WORLD_W / 2) / (WORLD_W / 2), ny = (y - WORLD_H / 2) / (WORLD_H / 2);
      // squircle-ish falloff so the island fills the rectangle nicely
      const d2 = nx * nx * nx * nx + ny * ny * ny * ny;
      const d = Math.sqrt(Math.sqrt(d2));
      let e = fbm(x / 420, y / 420, SEED, 5) * 1.25 - 0.18;
      e += 0.12 - d * d * 0.72;
      if (d > 0.8) e -= (d - 0.8) * 3.2; // always sea at the edges of the world
      // carve a couple of lakes
      const lake = fbm(x / 260 + 40, y / 260 - 17, SEED + 77, 3);
      if (lake > 0.66) e -= (lake - 0.66) * 3.2;
      // mountains: ridge noise in the interior
      const rn = fbm(x / 300 - 9, y / 300 + 31, SEED + 191, 4);
      const ridge = 1 - Math.abs(rn * 2 - 1);
      if (ridge > 0.88) e += (ridge - 0.88) * 5.5 * clamp(1 - d * 1.1, 0, 1);
      elev[j * FIELD_W + i] = e;
      moist[j * FIELD_W + i] = fbm(x / 350 + 100, y / 350 + 50, SEED + 555, 4);
    }
  }
  FIELD = { elev, moist };
  return FIELD;
}

// Catmull-Rom bicubic sampling of a field
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
function fget(arr, i, j) {
  i = i < 0 ? 0 : i >= FIELD_W ? FIELD_W - 1 : i;
  j = j < 0 ? 0 : j >= FIELD_H ? FIELD_H - 1 : j;
  return arr[j * FIELD_W + i];
}
export function sampleField(arr, x, y) {
  const gx = x / FIELD_CELL, gy = y / FIELD_CELL;
  const i = Math.floor(gx), j = Math.floor(gy);
  const tx = gx - i, ty = gy - j;
  const r0 = cr(fget(arr, i - 1, j - 1), fget(arr, i, j - 1), fget(arr, i + 1, j - 1), fget(arr, i + 2, j - 1), tx);
  const r1 = cr(fget(arr, i - 1, j), fget(arr, i, j), fget(arr, i + 1, j), fget(arr, i + 2, j), tx);
  const r2 = cr(fget(arr, i - 1, j + 1), fget(arr, i, j + 1), fget(arr, i + 1, j + 1), fget(arr, i + 2, j + 1), tx);
  const r3 = cr(fget(arr, i - 1, j + 2), fget(arr, i, j + 2), fget(arr, i + 1, j + 2), fget(arr, i + 2, j + 2), tx);
  return cr(r0, r1, r2, r3, ty);
}
export function elevAt(x, y) { return sampleField(terrain().elev, x, y); }
export function moistAt(x, y) { return sampleField(terrain().moist, x, y); }

// walkability is cached on a fine grid so the per-tick check is a lookup
const WALK_CELL = 8;
const WALK_W = WORLD_W / WALK_CELL, WALK_H = WORLD_H / WALK_CELL;
let WALK = null;
function walkGrid() {
  if (WALK) return WALK;
  WALK = new Uint8Array(WALK_W * WALK_H);
  for (let j = 0; j < WALK_H; j++) for (let i = 0; i < WALK_W; i++) {
    const e = elevAt(i * WALK_CELL + WALK_CELL / 2, j * WALK_CELL + WALK_CELL / 2);
    WALK[j * WALK_W + i] = e > LEVEL.WATER + 0.008 && e < LEVEL.PEAK ? 1 : 0;
  }
  return WALK;
}
export function walkable(x, y) {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > WORLD_H - 8) return false;
  return walkGrid()[Math.floor(y / WALK_CELL) * WALK_W + Math.floor(x / WALK_CELL)] === 1;
}

// trees, rocks and other scenery: static, generated from the seed
let SCENERY = null;
export function scenery() {
  if (SCENERY) return SCENERY;
  const trees = [], rocks = [], bushSpots = [], flowers = [], mushrooms = [], reeds = [];
  const step = 26;
  for (let y = step / 2; y < WORLD_H; y += step) {
    for (let x = step / 2; x < WORLD_W; x += step) {
      const ix = Math.floor(x / step), iy = Math.floor(y / step);
      const jx = x + (hash01(ix, iy, SEED + 1) - 0.5) * step * 0.9;
      const jy = y + (hash01(ix, iy, SEED + 2) - 0.5) * step * 0.9;
      const e = elevAt(jx, jy), m = moistAt(jx, jy);
      const h = hash01(ix, iy, SEED + 3);
      const k = hash01(ix, iy, SEED + 4);
      if (e > LEVEL.SAND + 0.02 && e < LEVEL.HILL) {
        if (m > FOREST_MOIST) {
          if (h < 0.11 + (m - FOREST_MOIST) * 1.2) trees.push({ x: jx, y: jy, k, kind: e > 0.36 ? 1 : 0 });
          else if (h > 0.985) mushrooms.push({ x: jx, y: jy, k });
        } else {
          if (h < 0.009) trees.push({ x: jx, y: jy, k, kind: 0 });
          else if (h > 0.97) flowers.push({ x: jx, y: jy, k });
        }
        if (k < 0.1 && m > 0.28) bushSpots.push({ x: jx, y: jy });
      } else if (e >= LEVEL.HILL && e < LEVEL.PEAK) {
        if (h < 0.06) rocks.push({ x: jx, y: jy, k, big: k > 0.6 });
        else if (h > 0.96) trees.push({ x: jx, y: jy, k, kind: 1 });
      } else if (e >= LEVEL.PEAK) {
        if (h < 0.05) rocks.push({ x: jx, y: jy, k, big: true });
      } else if (e > LEVEL.WATER + 0.006 && e <= LEVEL.SAND + 0.02) {
        if (h < 0.012) rocks.push({ x: jx, y: jy, k, big: false });
      } else if (e > LEVEL.WATER - 0.03 && e <= LEVEL.WATER) {
        if (h < 0.1) reeds.push({ x: jx, y: jy, k });
      }
    }
  }
  // keep bushes away from tree trunks
  const bushes = bushSpots.filter(b => !trees.some(t => (t.x - b.x) * (t.x - b.x) + (t.y - b.y) * (t.y - b.y) < 30 * 30));
  SCENERY = { trees, rocks, bushes, flowers, mushrooms, reeds };
  return SCENERY;
}

// ---------------------------------------------------------------------------
// names

const SYL = [
  ['mo', 'bi', 'pu', 'lo', 'mi', 'nu', 'po', 'bo', 'du', 'fi', 'wu', 'ti', 'pi', 'ba', 'mu', 'ni', 'bu', 'yo', 'pa', 'lu'],
  ['grak', 'zor', 'bru', 'kra', 'gor', 'vex', 'dro', 'mok', 'thu', 'gri', 'snar', 'bok', 'zug', 'rok', 'dag', 'kru'],
];
const END = [
  ['bo', 'mble', 'ppy', 'mo', 'ggle', 'nk', 'bbin', 'zzle', 'lly', 'p', 'b', 'mpkin', 'ffle', 'nny', 'bble', 'dle'],
  ['nash', 'gle', 'mble', 'k', 'th', 'za', 'gus', 'rot', 'mp', 'x', 'lump', 'ble', 'g', 'snik'],
];
function makeName(w, s) {
  const a = SYL[s], b = END[s];
  let n = a[rint(w, 0, a.length - 1)];
  if (rnd(w) < 0.35) n += a[rint(w, 0, a.length - 1)];
  n += b[rint(w, 0, b.length - 1)];
  return n[0].toUpperCase() + n.slice(1);
}

// ---------------------------------------------------------------------------
// world creation

const DUMPLING_HUES = [48, 330, 200, 150, 22, 275, 95, 0];
const GRUMBLE_HUES = [268, 350, 190, 15, 300];

function founderGenes(w, s) {
  const hues = s === DUMPLING ? DUMPLING_HUES : GRUMBLE_HUES;
  return [
    r4(clamp(1 + rnorm(w) * 0.09, 0.7, 1.4)),
    r4(clamp(1 + rnorm(w) * 0.09, 0.7, 1.4)),
    r4(clamp(1 + rnorm(w) * 0.09, 0.7, 1.4)),
    r4((hues[rint(w, 0, hues.length - 1)] + rnorm(w) * 8 + 360) % 360),
    rint(w, 0, 5),
    rint(w, 0, 3),
    r4(clamp(1 + rnorm(w) * 0.12, 0.8, 1.3)),
    r4(clamp(rnorm(w) * 0.08, -0.2, 0.2)),
  ];
}

function randomLand(w, minElev, maxElev) {
  for (let tries = 0; tries < 500; tries++) {
    const x = 80 + rnd(w) * (WORLD_W - 160), y = 80 + rnd(w) * (WORLD_H - 160);
    const e = elevAt(x, y);
    if (walkable(x, y) && e > minElev && e < maxElev) return [x, y];
  }
  return [WORLD_W / 2, WORLD_H / 2];
}

function newCreature(w, s, x, y, genes, gen, parents, ageTicks) {
  const sp = SPECIES[s];
  const d = DIRS[rint(w, 0, 63)];
  const c = {
    id: w.nextId++, s, x: r4(x), y: r4(y), hx: d[0], hy: d[1],
    e: 0, age: ageTicks, life: Math.floor(sp.life * (0.85 + rnd(w) * 0.3)),
    g: genes, gen, n: makeName(w, s),
    pa: parents ? parents[0].id : -1, pb: parents ? parents[1].id : -1,
    pn: parents ? [parents[0].n, parents[1].n] : null,
    kids: 0, st: ST.WANDER, tg: -1, cd: Math.floor(sp.cooldown * 0.5), sta: 40, stun: 0,
    ate: 0, kills: 0, born: w.tick - ageTicks, lt: 0, fat: rint(w, 0, AWAKE[s]),
  };
  c.e = maxEnergy(c) * (parents ? 0.55 : 0.75);
  return c;
}

export function genesis() {
  const w = {
    v: SIM_VERSION, tick: 0, rng: SEED, nextId: 1,
    creatures: [], bushes: [], graves: [], events: [],
    hist: { fine: [], coarse: [] },
    stats: { births: 0, deaths: 0, eaten: 0, starved: 0, old: 0, maxGen: [0, 0], oldest: [0, 0], arrivals: 0, extinctions: [0, 0] },
  };
  terrain();
  const sc = scenery();
  for (const b of sc.bushes) {
    const m = 3 + Math.floor(hash01(Math.floor(b.x), Math.floor(b.y), SEED + 9) * 3);
    w.bushes.push({ x: r4(b.x), y: r4(b.y), b: m, m });
  }
  // founders: little herds so families start near each other
  for (let herd = 0; herd < 9; herd++) {
    const [hx, hy] = randomLand(w, LEVEL.SAND + 0.03, LEVEL.HILL - 0.05);
    const base = founderGenes(w, DUMPLING);
    for (let k = 0; k < 6; k++) {
      const g = base.slice();
      g[G_SIZE] = r4(clamp(g[G_SIZE] + rnorm(w) * 0.04, 0.6, 1.6));
      g[G_SPEED] = r4(clamp(g[G_SPEED] + rnorm(w) * 0.04, 0.6, 1.6));
      g[G_SIGHT] = r4(clamp(g[G_SIGHT] + rnorm(w) * 0.04, 0.6, 1.6));
      g[G_TOP] = rnd(w) < 0.3 ? rint(w, 0, 5) : g[G_TOP];
      let x = hx + rnorm(w) * 40, y = hy + rnorm(w) * 40;
      if (!walkable(x, y)) { x = hx; y = hy; }
      w.creatures.push(newCreature(w, DUMPLING, x, y, g, 0, null, rint(w, 2400, 9000)));
    }
  }
  for (let k = 0; k < 7; k++) {
    const [x, y] = randomLand(w, LEVEL.SAND + 0.05, LEVEL.PEAK - 0.02);
    w.creatures.push(newCreature(w, GRUMBLE, x, y, founderGenes(w, GRUMBLE), 0, null, rint(w, 4800, 12000)));
  }
  logEvent(w, 'world', 'Wigglewood was founded. 54 dumplings and 7 grumbles moved in.');
  recordHistory(w, true);
  normalize(w);
  return w;
}

// ---------------------------------------------------------------------------
// creature math

export function growth(c) { return 0.55 + 0.45 * Math.min(1, c.age / SPECIES[c.s].mature); }
export function radius(c) { return SPECIES[c.s].radius * c.g[G_SIZE] * growth(c); }
export function maxEnergy(c) { return SPECIES[c.s].maxEnergy * c.g[G_SIZE]; }
export function sightOf(c) { return SPECIES[c.s].sight * c.g[G_SIGHT]; }
export function speedOf(c) { return SPECIES[c.s].speed * c.g[G_SPEED] * (0.75 + 0.25 * growth(c)) * (0.85 + 0.15 * c.g[G_SIZE]); }
export function cost(c) {
  const z = c.g[G_SIZE], v = c.g[G_SPEED], k = c.g[G_SIGHT];
  return 0.3 * z * z * z + 0.45 * v * v * z + 0.25 * k;
}
export function isAdult(c) { return c.age >= SPECIES[c.s].mature; }
export function ready(c) {
  return isAdult(c) && c.cd <= 0 && c.e > maxEnergy(c) * (c.s === DUMPLING ? 0.62 : 0.78) && c.age < c.life * 0.92;
}

// ---------------------------------------------------------------------------
// spatial hash

const CELL = 120;
const GW = Math.ceil(WORLD_W / CELL), GH = Math.ceil(WORLD_H / CELL);

function buildGrid(list) {
  const grid = new Array(GW * GH);
  for (let i = 0; i < grid.length; i++) grid[i] = [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const gx = clamp(Math.floor(o.x / CELL), 0, GW - 1), gy = clamp(Math.floor(o.y / CELL), 0, GH - 1);
    grid[gy * GW + gx].push(i);
  }
  return grid;
}
function forNear(grid, list, x, y, r, fn) {
  const x0 = clamp(Math.floor((x - r) / CELL), 0, GW - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, GW - 1);
  const y0 = clamp(Math.floor((y - r) / CELL), 0, GH - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, GH - 1);
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    const cell = grid[gy * GW + gx];
    for (let k = 0; k < cell.length; k++) fn(list[cell[k]]);
  }
}

let BUSH_GRID = null, BUSH_GRID_LIST = null;
function bushGrid(w) {
  if (BUSH_GRID_LIST !== w.bushes) { BUSH_GRID = buildGrid(w.bushes); BUSH_GRID_LIST = w.bushes; }
  return BUSH_GRID;
}

// ---------------------------------------------------------------------------
// movement

function steerTo(c, tx, ty, amt) {
  let dx = tx - c.x, dy = ty - c.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return d;
  dx /= d; dy /= d;
  let hx = c.hx * (1 - amt) + dx * amt, hy = c.hy * (1 - amt) + dy * amt;
  const l = Math.sqrt(hx * hx + hy * hy);
  if (l < 1e-6) { hx = dx; hy = dy; } else { hx /= l; hy /= l; }
  c.hx = hx; c.hy = hy;
  return d;
}
function steerAway(c, tx, ty, amt) {
  steerTo(c, c.x * 2 - tx, c.y * 2 - ty, amt);
}
function wanderTurn(w, c, spread) {
  const k = clamp(16 + Math.round(rnorm(w) * spread), 0, ROT_STEPS - 1);
  const r = ROT[k];
  const hx = c.hx * r[0] - c.hy * r[1], hy = c.hx * r[1] + c.hy * r[0];
  const l = Math.sqrt(hx * hx + hy * hy);
  c.hx = hx / l; c.hy = hy / l;
}
function move(w, c, spd) {
  let nx = c.x + c.hx * spd, ny = c.y + c.hy * spd;
  if (walkable(nx, ny)) { c.x = nx; c.y = ny; return true; }
  // blocked: try sliding along the shore by turning left or right
  const order = (c.id & 1) ? [1, -1] : [-1, 1];
  for (const turn of [0.5, 1, 1.6]) {
    for (const sgn of order) {
      const a = turn * sgn;
      // rotate by a using ROT-free math: build from DIRS-like vectors via dsin/dcos constants
      const ca = turn === 0.5 ? 0.8775825618903728 : turn === 1 ? 0.5403023058681398 : -0.029199522301288815;
      const sa = (turn === 0.5 ? 0.479425538604203 : turn === 1 ? 0.8414709848078965 : 0.9995736030415051) * (a < 0 ? -1 : 1);
      const hx = c.hx * ca - c.hy * sa, hy = c.hx * sa + c.hy * ca;
      nx = c.x + hx * spd; ny = c.y + hy * spd;
      if (walkable(nx, ny)) { c.hx = hx; c.hy = hy; c.x = nx; c.y = ny; return false; }
    }
  }
  c.hx = -c.hx; c.hy = -c.hy;
  return false;
}

// ---------------------------------------------------------------------------
// events + history

function logEvent(w, type, text, extra) {
  w.events.push(Object.assign({ t: w.tick, type, text }, extra || {}));
  if (w.events.length > 80) w.events.splice(0, w.events.length - 80);
}

function recordHistory(w, force) {
  if (!force && w.tick % 240 !== 0) return; // once per real minute
  let nd = 0, ng = 0, sd = [0, 0, 0], sg = [0, 0, 0];
  for (const c of w.creatures) {
    if (c.s === DUMPLING) { nd++; sd[0] += c.g[0]; sd[1] += c.g[1]; sd[2] += c.g[2]; }
    else { ng++; sg[0] += c.g[0]; sg[1] += c.g[1]; sg[2] += c.g[2]; }
  }
  let berries = 0;
  for (const b of w.bushes) berries += b.b;
  const m = (s, n) => n ? Math.round(s / n * 1000) / 1000 : 0;
  const row = [w.tick, nd, ng, berries, m(sd[0], nd), m(sd[1], nd), m(sd[2], nd), m(sg[0], ng), m(sg[1], ng), m(sg[2], ng)];
  w.hist.fine.push(row);
  // fine: last 24h at 1/min; coarse: last 30 days at 1/15min
  if (w.hist.fine.length > 1440) w.hist.fine.shift();
  if (w.tick % 3600 === 0) {
    w.hist.coarse.push(row);
    if (w.hist.coarse.length > 2880) w.hist.coarse.shift();
  }
}

// ---------------------------------------------------------------------------
// the step

export function step(w) {
  w.tick++;
  const tick = w.tick;
  const fx = (w.fx = []);
  const season = seasonIndex(tick);
  const list = w.creatures;
  const grid = buildGrid(list);
  const bgrid = bushGrid(w);
  const byId = new Map();
  for (const c of list) byId.set(c.id, c);
  const dead = new Set();
  const babies = [];
  const countD = countSpecies(list, DUMPLING), countG = list.length - countD;

  // berries regrow
  if (tick % 20 === 0) {
    const weather = weatherAt(tick);
    let chance = [0.015, 0.012, 0.0075, 0.0048][season];
    if (weather === 'rain') chance *= 1.6;
    for (const b of w.bushes) if (b.b < b.m && rnd(w) < chance) b.b++;
  }

  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (dead.has(c.id)) continue;
    const sp = SPECIES[c.s];
    c.age++;
    if (c.cd > 0) c.cd--;
    const rad = radius(c);
    const sight = sightOf(c);
    let spd = speedOf(c);
    let moving = true;
    let drainMul = 1;

    if (c.stun > 0) {
      c.stun--; c.st = ST.STUN; moving = false;
    } else if (c.s === DUMPLING) {
      // --- dumpling brain
      let threat = null, td = 1e9;
      const sleeping = c.st === ST.SLEEP;
      const look = sleeping ? sight * 0.35 : sight;
      forNear(grid, list, c.x, c.y, look, o => {
        if (o.s !== GRUMBLE || dead.has(o.id)) return;
        const dx = o.x - c.x, dy = o.y - c.y, d = dx * dx + dy * dy;
        if (d < look * look && d < td) { td = d; threat = o; }
      });
      if (threat) {
        if (c.st !== ST.FLEE) fx.push({ k: 'alert', id: c.id });
        c.st = ST.FLEE; c.tg = threat.id;
        steerAway(c, threat.x, threat.y, 0.45);
        spd *= 1.3;
      } else if (sleepy(w, c, 0.25)) {
        moving = false; drainMul = 0.35;
      } else {
        const hungry = c.e < maxEnergy(c) * (isAdult(c) ? 0.6 : 0.8);
        let acted = false;
        if (c.st === ST.EAT) {
          const b = w.bushes[c.tg];
          if (b && b.b > 0 && c.e < maxEnergy(c) * 0.92) {
            moving = false; acted = true;
            if ((c.age & 3) === 0) {
              b.b--; c.e = Math.min(maxEnergy(c), c.e + 24); c.ate++;
              fx.push({ k: 'munch', id: c.id, x: b.x, y: b.y });
            }
          } else { c.st = ST.WANDER; c.tg = -1; }
        }
        if (!acted && hungry) {
          let best = -1, bd = 1e12;
          forNear(bgrid, w.bushes, c.x, c.y, sight, b => {
            if (b.b <= 0) return;
            const dx = b.x - c.x, dy = b.y - c.y, d = dx * dx + dy * dy;
            if (d < sight * sight && d < bd) { bd = d; best = b; }
          });
          if (best !== -1) {
            const d = steerTo(c, best.x, best.y + 6, 0.35);
            c.st = ST.FOOD;
            if (d < rad + 10) { c.st = ST.EAT; c.tg = w.bushes.indexOf(best); moving = false; }
            acted = true;
          } else if (c.st === ST.GRAZE || rnd(w) < 0.02) {
            // nibble on grass: barely keeps a dumpling going, nothing grows under snow
            const e = elevAt(c.x, c.y);
            const rate = [0.012, 0.01, 0.006, 0][season];
            if (rate > 0 && e > LEVEL.SAND && e < LEVEL.HILL && moistAt(c.x, c.y) <= FOREST_MOIST) {
              if (c.st !== ST.GRAZE) c.lt = 30 + rint(w, 0, 40);
              c.st = ST.GRAZE; moving = false; acted = true;
              c.e = Math.min(maxEnergy(c), c.e + rate);
              if (--c.lt <= 0) { c.st = ST.WANDER; c.lt = 0; }
            } else if (c.st === ST.GRAZE) { c.st = ST.WANDER; c.lt = 0; }
          }
        }
        if (!acted && ready(c) && countD < sp.cap) acted = seekMate(w, c, grid, list, dead, babies, fx, sight);
        if (!acted && !isAdult(c) && c.pa >= 0) {
          const p = byId.get(c.pa) || byId.get(c.pb);
          if (p && !dead.has(p.id)) {
            const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d > 55 && d < 600) { steerTo(c, p.x, p.y, 0.25); c.st = ST.FOLLOW; acted = true; if (d < 80) spd *= 0.6; }
          }
        }
        if (!acted) {
          c.st = ST.WANDER;
          wanderTurn(w, c, 3.2);
          spd *= 0.55;
          if (rnd(w) < 0.004) c.lt = 12 + rint(w, 0, 30); // pause and look around
          if (c.lt > 0) { c.lt--; moving = false; }
        }
      }
    } else {
      // --- grumble brain
      if (c.sta < 60) c.sta += 0.25;
      if (c.st === ST.FEAST) {
        c.lt--; moving = false;
        if (c.lt <= 0) c.st = ST.WANDER;
      } else if (sleepy(w, c, 0.35)) {
        moving = false; drainMul = 0.35;
      } else {
        const hungry = c.e < maxEnergy(c) * 0.72;
        let acted = false;
        if (hungry) {
          let prey = null, pd = 1e12;
          const prev = c.st === ST.HUNT ? byId.get(c.tg) : null;
          forNear(grid, list, c.x, c.y, sight, o => {
            if (o.s !== DUMPLING || dead.has(o.id)) return;
            let vis = o.st === ST.SLEEP ? sight * 0.5 : sight;
            if (moistAt(o.x, o.y) > FOREST_MOIST) vis *= 0.6; // hard to spot under the trees
            const dx = o.x - c.x, dy = o.y - c.y;
            let d = dx * dx + dy * dy;
            if (d > vis * vis) return;
            if (o === prev) d *= 0.6; // stick with the current target
            if (d < pd) { pd = d; prey = o; }
          });
          if (prey) {
            acted = true;
            c.st = ST.HUNT; c.tg = prey.id;
            const d = steerTo(c, prey.x, prey.y, 0.5);
            if (c.sta > 0) { spd *= 1.55; c.sta -= 1; drainMul = 1.6; }
            if (d < rad + radius(prey) + 2) {
              const p = clamp(0.6 + (c.g[G_SIZE] * growth(c) - prey.g[G_SIZE] * growth(prey)) * 1.8, 0.15, 0.95);
              if (rnd(w) < p) {
                dead.add(prey.id);
                killed(w, prey, 'eaten', c);
                c.e = Math.min(maxEnergy(c), c.e + 50 * prey.g[G_SIZE] * growth(prey));
                c.kills++;
                c.st = ST.FEAST; c.lt = 24; moving = false;
                fx.push({ k: 'chomp', id: c.id, x: prey.x, y: prey.y });
              } else {
                // the dumpling wriggles free
                c.stun = 10; c.st = ST.STUN; moving = false;
                prey.stun = 0; prey.st = ST.FLEE;
                steerAway(prey, c.x, c.y, 1);
                prey.x = clamp(prey.x + prey.hx * 10, 10, WORLD_W - 10);
                prey.y = clamp(prey.y + prey.hy * 10, 10, WORLD_H - 10);
                if (!walkable(prey.x, prey.y)) { prey.x -= prey.hx * 10; prey.y -= prey.hy * 10; }
                fx.push({ k: 'escape', id: prey.id });
              }
            }
          }
        }
        if (!acted && ready(c) && countG < sp.cap && countD > countG * 10) acted = seekMate(w, c, grid, list, dead, babies, fx, sight * 1.4);
        if (!acted && !isAdult(c) && c.pa >= 0) {
          const p = byId.get(c.pa) || byId.get(c.pb);
          if (p && !dead.has(p.id)) {
            const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d > 70 && d < 700) { steerTo(c, p.x, p.y, 0.25); c.st = ST.FOLLOW; acted = true; }
          }
        }
        if (!acted) {
          c.st = ST.WANDER;
          wanderTurn(w, c, 2.4);
          spd *= 0.6;
        }
      }
    }

    if (moving) move(w, c, spd);
    else drainMul *= 0.55;

    // gentle separation from overlapping neighbours
    forNear(grid, list, c.x, c.y, rad * 2 + 20, o => {
      if (o === c || dead.has(o.id)) return;
      if (o.s !== c.s) return;
      const dx = c.x - o.x, dy = c.y - o.y, d2 = dx * dx + dy * dy;
      const min = rad + radius(o);
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.25;
        const nx = c.x + dx / d * push, ny = c.y + dy / d * push;
        if (walkable(nx, ny)) { c.x = nx; c.y = ny; }
      }
    });

    c.x = r4(clamp(c.x, 9, WORLD_W - 9)); c.y = r4(clamp(c.y, 9, WORLD_H - 9));
    c.e -= sp.drain * cost(c) * drainMul * (0.6 + 0.4 * growth(c));
    if (c.e <= 0) { dead.add(c.id); killed(w, c, 'starved'); }
    else if (c.age >= c.life) { dead.add(c.id); killed(w, c, 'old'); }
  }

  if (dead.size) w.creatures = list.filter(c => !dead.has(c.id));
  for (const b of babies) w.creatures.push(b);

  // graves fade after 10 minutes
  if (w.graves.length && w.graves[0].t < tick - 2400) w.graves = w.graves.filter(g => g.t >= tick - 2400);

  // migration keeps the world from staying empty
  if (tick % 2400 === 0) migrate(w);
  if (tick % SEASON_TICKS === 0) {
    logEvent(w, 'season', `${cap(SEASONS[seasonIndex(tick)])} arrived in Wigglewood.`);
  }
  recordHistory(w, false);

  if (tick % CHECKPOINT_TICKS === 0) normalize(w);
}

// creatures nap on their own rhythm: awake time builds tiredness, sleep pays it back
const AWAKE = [4200, 5400], NAP = [900, 1100];
function sleepy(w, c, minEnergy) {
  if (c.st === ST.SLEEP) {
    c.fat -= AWAKE[c.s] / NAP[c.s];
    if (c.fat > 0 && c.e > maxEnergy(c) * 0.12) return true;
    c.fat = 0; c.st = ST.WANDER;
    return false;
  }
  c.fat++;
  if (c.fat > AWAKE[c.s] && c.e > maxEnergy(c) * minEnergy && rnd(w) < 0.01) {
    c.st = ST.SLEEP; c.tg = -1;
    w.fx.push({ k: 'yawn', id: c.id });
    return true;
  }
  return false;
}

function countSpecies(list, s) { let n = 0; for (const c of list) if (c.s === s) n++; return n; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

function seekMate(w, c, grid, list, dead, babies, fx, sight) {
  let mate = null, md = 1e12;
  forNear(grid, list, c.x, c.y, sight, o => {
    if (o === c || o.s !== c.s || dead.has(o.id) || !ready(o)) return;
    if (o.id === c.pa || o.id === c.pb || c.id === o.pa || c.id === o.pb) return; // no parents/kids
    if (c.pa >= 0 && (o.pa === c.pa || o.pb === c.pb)) return; // no siblings
    const dx = o.x - c.x, dy = o.y - c.y, d = dx * dx + dy * dy;
    if (d < sight * sight && d < md) { md = d; mate = o; }
  });
  if (!mate) return false;
  c.st = ST.MATE; c.tg = mate.id;
  const d = steerTo(c, mate.x, mate.y, 0.4);
  if (d < radius(c) + radius(mate) + 6) {
    const sp = SPECIES[c.s];
    const n = rint(w, sp.litter[0], sp.litter[1]);
    for (let k = 0; k < n; k++) {
      const g = crossover(w, c.g, mate.g);
      const gen = Math.max(c.gen, mate.gen) + 1;
      const bx = (c.x + mate.x) / 2 + rnorm(w) * 10, by = (c.y + mate.y) / 2 + rnorm(w) * 10;
      const baby = newCreature(w, c.s, walkable(bx, by) ? bx : c.x, walkable(bx, by) ? by : c.y, g, gen, [c, mate], 0);
      babies.push(baby);
      w.stats.births++;
      if (gen > w.stats.maxGen[c.s]) {
        w.stats.maxGen[c.s] = gen;
        if (gen % 5 === 0 || gen <= 3) logEvent(w, 'gen', `${baby.n} is the first generation ${gen} ${sp.name.toLowerCase()}.`, { id: baby.id, s: c.s });
      }
    }
    for (const p of [c, mate]) {
      p.e -= maxEnergy(p) * (c.s === DUMPLING ? 0.3 : 0.34);
      p.cd = Math.floor(sp.cooldown * (0.9 + rnd(w) * 0.2));
      p.kids += n;
      p.st = ST.WANDER;
    }
    fx.push({ k: 'love', id: c.id, x: (c.x + mate.x) / 2, y: (c.y + mate.y) / 2, n });
  }
  return true;
}

function crossover(w, a, b) {
  const g = new Array(8);
  for (let i = 0; i < 8; i++) {
    const src = rnd(w) < 0.5 ? a : b;
    if (i === G_TOP || i === G_PAT) {
      g[i] = rnd(w) < 0.04 ? rint(w, GENE_RANGE[i][0], GENE_RANGE[i][1]) : src[i];
    } else if (i === G_HUE) {
      g[i] = r4((src[i] + rnorm(w) * 7 + 720) % 360);
    } else {
      const mix = rnd(w) < 0.6 ? (a[i] + b[i]) / 2 : src[i];
      const rate = i === G_LIGHT ? 0.03 : 0.045;
      g[i] = r4(clamp(mix + rnorm(w) * rate, GENE_RANGE[i][0], GENE_RANGE[i][1]));
    }
  }
  return g;
}

function killed(w, c, cause, by) {
  w.stats.deaths++;
  if (cause === 'eaten') w.stats.eaten++; else if (cause === 'starved') w.stats.starved++; else w.stats.old++;
  w.graves.push({ x: c.x, y: c.y, n: c.n, s: c.s, h: c.g[G_HUE], t: w.tick, cause, age: c.age, by: by ? by.n : null });
  if (w.graves.length > 60) w.graves.shift();
  w.fx.push({ k: 'poof', id: c.id, x: c.x, y: c.y, s: c.s, cause });
  if (c.age > w.stats.oldest[c.s]) {
    const was = w.stats.oldest[c.s];
    w.stats.oldest[c.s] = c.age;
    if (was > 0 && cause === 'old') {
      logEvent(w, 'record', `${c.n} the ${SPECIES[c.s].name.toLowerCase()} passed away at ${Math.round(c.age / 240)} minutes, the oldest yet.`, { s: c.s });
    }
  }
  if (c.kids >= 12 && cause !== 'old') {
    logEvent(w, 'death', `${c.n}, parent of ${c.kids}, was ${cause === 'eaten' ? `eaten by ${by.n}` : 'lost to hunger'}.`, { s: c.s });
  }
}

function migrate(w) {
  const nd = countSpecies(w.creatures, DUMPLING), ng = w.creatures.length - nd;
  if (nd === 0 && w.stats._dAlive !== false) { w.stats.extinctions[0]++; logEvent(w, 'extinct', 'The last dumpling is gone. Wigglewood is quiet.'); }
  if (ng === 0 && w.stats._gAlive !== false) { w.stats.extinctions[1]++; logEvent(w, 'extinct', 'The grumbles have died out.'); }
  w.stats._dAlive = nd > 0; w.stats._gAlive = ng > 0;
  if (nd < 8) {
    const [x, y] = randomLand(w, LEVEL.SAND + 0.03, LEVEL.HILL - 0.05);
    const base = founderGenes(w, DUMPLING);
    for (let k = 0; k < 5; k++) {
      const g = base.slice(); g[G_SIZE] = r4(clamp(g[G_SIZE] + rnorm(w) * 0.05, 0.6, 1.6));
      w.creatures.push(newCreature(w, DUMPLING, x + rnorm(w) * 20, y + rnorm(w) * 20, g, 0, null, 2600));
    }
    w.stats.arrivals += 5;
    logEvent(w, 'arrive', 'A family of five dumplings wandered in from over the hills.', { x, y, s: DUMPLING });
  }
  if (ng < 2 && nd > 40) {
    const [x, y] = randomLand(w, LEVEL.SAND + 0.05, LEVEL.PEAK - 0.02);
    for (let k = 0; k < 2; k++) w.creatures.push(newCreature(w, GRUMBLE, x + rnorm(w) * 20, y + rnorm(w) * 20, founderGenes(w, GRUMBLE), 0, null, 5000));
    w.stats.arrivals += 2;
    logEvent(w, 'arrive', 'Two hungry grumbles crept down from the mountains.', { x, y, s: GRUMBLE });
  }
}

// ---------------------------------------------------------------------------
// serialisation

const PERSIST = ['v', 'tick', 'rng', 'nextId', 'creatures', 'bushes', 'graves', 'events', 'hist', 'stats'];
export function serialize(w) {
  const o = {};
  for (const k of PERSIST) o[k] = w[k];
  return JSON.stringify(o);
}
export function deserialize(s) {
  const o = JSON.parse(s);
  if (o.v !== SIM_VERSION) throw new Error(`snapshot version ${o.v} != ${SIM_VERSION}`);
  return o;
}
// round-trip through JSON in place so every path through a checkpoint is identical
export function normalize(w) {
  const o = JSON.parse(serialize(w));
  for (const k of PERSIST) w[k] = o[k];
}

export function advance(w, target, budgetMs, now) {
  // advance up to `target`; if budgetMs and now() given, stop when out of time
  const t0 = now ? now() : 0;
  let n = 0;
  while (w.tick < target) {
    step(w);
    n++;
    if (budgetMs && (n & 63) === 0 && now() - t0 > budgetMs) break;
  }
  return w.tick >= target;
}

export function checksum(w) {
  const s = serialize(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
