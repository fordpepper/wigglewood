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
// the GitHub Action that produced a newer one. Nothing from outside ever
// changes the world: it is a pure function of time.

export const SIM_VERSION = 4;
export const EPOCH_MS = Date.UTC(2026, 10, 23, 0, 0, 0); // world founded
export const TICK_MS = 250;
export const TPS = 1000 / TICK_MS;
export const CHECKPOINT_TICKS = 7200; // 30 real minutes
export const SEASON_TICKS = 43200; // one Wigglewood season = 3 real hours, a year = 12 hours
export const WEATHER_TICKS = 4800; // weather changes every 20 minutes
export const WORLD_W = 19200;
export const WORLD_H = 12800;
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
    cap: 12, // per grove on the island
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
    cap: 1.75, // per grove, on islands with at least two
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
//
// An archipelago: a handful of big islands with open sea between them, plus
// scattered islets. The north is cold and the south is hot; together with
// moisture that gives each island its own biomes. Creatures can't swim, so
// every island's population evolves on its own.

export const FIELD_CELL = 20;
export const FIELD_W = WORLD_W / FIELD_CELL + 1;
export const FIELD_H = WORLD_H / FIELD_CELL + 1;
export const LEVEL = {
  DEEP: -0.16, WATER: 0, SAND: 0.045, HILL: 0.52, PEAK: 0.66,
};

export const BIOME = { MEADOW: 0, FOREST: 1, STEPPE: 2, SWAMP: 3, DESERT: 4, SAVANNA: 5, JUNGLE: 6, TAIGA: 7, TUNDRA: 8 };
export const BIOME_NAMES = ['meadow', 'forest', 'steppe', 'swamp', 'desert', 'savanna', 'jungle', 'taiga', 'tundra'];
// t: 0 = polar, 1 = tropical; m: 0 = parched, 1 = soaked
export function classify(t, m) {
  if (t < 0.2) return BIOME.TUNDRA;
  if (t < 0.34) return m > 0.46 ? BIOME.TAIGA : BIOME.TUNDRA;
  if (t < 0.66) return m < 0.33 ? BIOME.STEPPE : m < 0.57 ? BIOME.MEADOW : m < 0.72 ? BIOME.FOREST : BIOME.SWAMP;
  return m < 0.38 ? BIOME.DESERT : m < 0.56 ? BIOME.SAVANNA : BIOME.JUNGLE;
}
export const isWooded = b => b === BIOME.FOREST || b === BIOME.JUNGLE || b === BIOME.TAIGA;
export const isHot = b => b === BIOME.DESERT || b === BIOME.SAVANNA || b === BIOME.JUNGLE;
export const isCold = b => b === BIOME.TAIGA || b === BIOME.TUNDRA;

// the big islands: centre, half sizes, and a nudge to their climate
export const ISLANDS = [
  { name: 'Snowmuffin', x: 4500, y: 2350, rx: 2900, ry: 1500, t: 0.02, m: 0.06, hues: [[196, 212, 178, 280], [232, 258]] },
  { name: 'Pinecrumb', x: 13900, y: 2300, rx: 2400, ry: 1350, t: 0.03, m: 0.14, hues: [[140, 158, 96], [18, 350]] },
  { name: 'Wigglewood', x: 9300, y: 6600, rx: 3900, ry: 2250, t: 0, m: 0, hues: [[48, 330, 22, 200], [268, 300]] },
  { name: 'Bogbottom', x: 16500, y: 6900, rx: 1800, ry: 2400, t: 0.03, m: 0.26, hues: [[82, 112, 62], [300, 328]] },
  { name: 'Junglejam', x: 3700, y: 9800, rx: 2700, ry: 1950, t: 0.06, m: 0.24, hues: [[0, 330, 275], [188, 160]] },
  { name: 'Sunbiscuit', x: 12900, y: 10700, rx: 3500, ry: 1450, t: 0.06, m: -0.3, hues: [[30, 42, 14], [350, 12]] },
  { name: 'Little Puddle', x: 1650, y: 5900, rx: 950, ry: 1150, t: 0, m: 0.06, hues: [[275, 250], [268]] },
];
// islets out in the open sea (scenery only: nobody lives there)
const ISLETS = [];
for (let i = 0; i < 300 && ISLETS.length < 26; i++) {
  const x = 700 + hash01(i, 1, SEED + 901) * (WORLD_W - 1400), y = 700 + hash01(i, 2, SEED + 901) * (WORLD_H - 1400);
  const r = 200 + hash01(i, 3, SEED + 901) * 420;
  let clear = true;
  for (const s of ISLANDS) {
    const dx = (x - s.x) / (s.rx + r + 550), dy = (y - s.y) / (s.ry + r + 550);
    if (dx * dx + dy * dy < 1) clear = false;
  }
  for (const s of ISLETS) {
    const dx = x - s.x, dy = y - s.y;
    if (dx * dx + dy * dy < 1100 * 1100) clear = false;
  }
  if (clear) ISLETS.push({ x, y, rx: r, ry: r * (0.7 + hash01(i, 4, SEED + 901) * 0.6) });
}

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

// distance-like measure from an island's centre: 0 in the middle, 1 at its rim
function islandDist(s, x, y) {
  const dx = (x - s.x) / s.rx, dy = (y - s.y) / s.ry;
  const r2 = dx * dx + dy * dy;
  return 0.72 * Math.sqrt(r2) + 0.28 * Math.sqrt(Math.sqrt(dx * dx * dx * dx + dy * dy * dy * dy));
}
function bendAt(x, y) { return (fbm(x / 1700 + 7, y / 1700 - 3, SEED + 31, 3) - 0.5) * 0.62 + (fbm(x / 600 - 5, y / 600 + 2, SEED + 32, 2) - 0.5) * 0.3; }
// which big island a spot belongs to (-1: an islet or the open sea), and how far in
function nearestIsland(x, y, bend) {
  let best = 1e9, bi = -1;
  for (let i = 0; i < ISLANDS.length; i++) {
    const d = islandDist(ISLANDS[i], x, y) + bend;
    if (d < best) { best = d; bi = i; }
  }
  for (const s of ISLETS) {
    const d = islandDist(s, x, y) + bend * 0.6;
    if (d < best) { best = d; bi = -1; }
  }
  return [bi, best];
}
export function islandSpecAt(x, y) { return nearestIsland(x, y, bendAt(x, y))[0]; }

// Coarse, slow-changing noise (bend, warmth) is sampled every 4th field cell
// and interpolated, which keeps start-up quick on phones.
function coarse(fn) {
  const S4 = 4, CW = Math.ceil((FIELD_W - 1) / S4) + 2, CH = Math.ceil((FIELD_H - 1) / S4) + 2;
  const g = new Float64Array(CW * CH);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) g[j * CW + i] = fn(i * S4 * FIELD_CELL, j * S4 * FIELD_CELL);
  return (i, j) => {
    const gi = Math.floor(i / S4), gj = Math.floor(j / S4), fx = (i - gi * S4) / S4, fy = (j - gj * S4) / S4;
    const a = g[gj * CW + gi], b = g[gj * CW + gi + 1], c = g[(gj + 1) * CW + gi], d = g[(gj + 1) * CW + gi + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

let FIELD = null; // { elev, moist, temp: Float64Array }
export function terrain() {
  if (FIELD) return FIELD;
  const N = FIELD_W * FIELD_H;
  const elev = new Float64Array(N), moist = new Float64Array(N), temp = new Float64Array(N);
  const bendC = coarse(bendAt);
  const warmC = coarse((x, y) => fbm(x / 2600 + 13, y / 2600 + 5, SEED + 404, 3));
  for (let j = 0; j < FIELD_H; j++) {
    for (let i = 0; i < FIELD_W; i++) {
      const x = i * FIELD_CELL, y = j * FIELD_CELL;
      const [bi, d] = nearestIsland(x, y, bendC(i, j));
      const sp = bi >= 0 ? ISLANDS[bi] : null;
      const near = clamp(1.6 - d, 0, 1); // how much the island's own climate counts here
      let t = 0.04 + y / WORLD_H * 0.96 + (warmC(i, j) - 0.5) * 0.3 + (sp ? sp.t * near : 0);
      let m = (fbm(x / 900 + 100, y / 900 + 50, SEED + 555, 5) - 0.5) * 2.1 + 0.5 + (sp ? sp.m * near : 0);
      let e = fbm(x / 520, y / 520, SEED, 6) * 1.25 - 0.18;
      e += 0.13 - d * d * 0.7;
      if (d > 0.8) e -= (d - 0.8) * 2.6; // open sea between the islands
      // the edge of the world is always deep sea
      const edge = Math.min(x, y, WORLD_W - x, WORLD_H - y);
      if (edge < 900) e -= (900 - edge) / 900 * 0.6;
      // wet, warm lowlands are flat and boggy
      const wet = clamp((m - 0.68) / 0.12, 0, 1) * clamp((t - 0.3) / 0.1, 0, 1);
      if (wet > 0 && e > 0.05) e += (0.05 + (e - 0.05) * 0.35 - e) * wet;
      if (e > 0.44) e = 0.44 + (e - 0.44) * 0.55; // rolling highlands rather than ice caps
      // lakes (fewer where it's dry), and ponds in the bogs
      const lake = fbm(x / 300 + 40, y / 300 - 17, SEED + 77, 3);
      const lakeT = 0.68 + (m < 0.35 ? (0.35 - m) * 0.5 : 0);
      if (lake > lakeT) e -= (lake - lakeT) * 3.4;
      if (wet > 0.5) {
        const pond = fbm(x / 130 + 3, y / 130 + 9, SEED + 88, 2);
        if (pond > 0.64) e -= (pond - 0.64) * 1.6 * wet;
      }
      // mountain ranges in the interiors
      const rn = fbm(x / 760 - 9, y / 760 + 31, SEED + 191, 4);
      const ridge = 1 - Math.abs(rn * 2 - 1);
      if (ridge > 0.88) e += (ridge - 0.88) * 4.6 * clamp(1.05 - d * 1.1, 0, 1) * (1 - wet);
      // it's colder up high
      if (e > 0.25) t -= (e - 0.25) * 0.35;
      const k = j * FIELD_W + i;
      elev[k] = e; moist[k] = m; temp[k] = t;
    }
  }
  FIELD = { elev, moist, temp };
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
// bilinear, for slow fields where it's plenty
export function sampleLinear(arr, x, y) {
  const gx = clamp(x / FIELD_CELL, 0, FIELD_W - 1.0001), gy = clamp(y / FIELD_CELL, 0, FIELD_H - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, k = j * FIELD_W + i;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + FIELD_W] * (1 - fx) + arr[k + FIELD_W + 1] * fx) * fy;
}
export function elevAt(x, y) { return sampleField(terrain().elev, x, y); }
export function moistAt(x, y) { return sampleLinear(terrain().moist, x, y); }
export function tempAt(x, y) { return sampleLinear(terrain().temp, x, y); }
export function biomeAt(x, y) { return classify(tempAt(x, y), moistAt(x, y)); }

// walkability is cached on a fine grid so the per-tick check is a lookup
const WALK_CELL = 8;
const WALK_W = WORLD_W / WALK_CELL, WALK_H = WORLD_H / WALK_CELL;
let WALK = null, LABEL = null, COMP_SIZE = null;
function walkGrid() {
  if (WALK) return WALK;
  WALK = new Uint8Array(WALK_W * WALK_H);
  const elev = terrain().elev;
  for (let j = 0; j < WALK_H; j++) for (let i = 0; i < WALK_W; i++) {
    const e = sampleField(elev, i * WALK_CELL + WALK_CELL / 2, j * WALK_CELL + WALK_CELL / 2);
    WALK[j * WALK_W + i] = e > LEVEL.WATER + 0.008 && e < LEVEL.PEAK ? 1 : 0;
  }
  return WALK;
}
export function walkable(x, y) {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > WORLD_H - 8) return false;
  return walkGrid()[Math.floor(y / WALK_CELL) * WALK_W + Math.floor(x / WALK_CELL)] === 1;
}
// every connected stretch of walkable land gets a number: creatures stay on theirs
function labels() {
  if (LABEL) return LABEL;
  const g = walkGrid();
  LABEL = new Int32Array(WALK_W * WALK_H);
  const stack = new Int32Array(WALK_W * WALK_H);
  const sizes = [0];
  let next = 0;
  for (let s0 = 0; s0 < g.length; s0++) {
    if (!g[s0] || LABEL[s0]) continue;
    next++;
    let sp = 0, size = 0;
    stack[sp++] = s0; LABEL[s0] = next;
    while (sp) {
      const k = stack[--sp]; size++;
      const i = k % WALK_W, j = (k - i) / WALK_W;
      if (i > 0 && g[k - 1] && !LABEL[k - 1]) { LABEL[k - 1] = next; stack[sp++] = k - 1; }
      if (i < WALK_W - 1 && g[k + 1] && !LABEL[k + 1]) { LABEL[k + 1] = next; stack[sp++] = k + 1; }
      if (j > 0 && g[k - WALK_W] && !LABEL[k - WALK_W]) { LABEL[k - WALK_W] = next; stack[sp++] = k - WALK_W; }
      if (j < WALK_H - 1 && g[k + WALK_W] && !LABEL[k + WALK_W]) { LABEL[k + WALK_W] = next; stack[sp++] = k + WALK_W; }
    }
    sizes.push(size);
  }
  COMP_SIZE = sizes;
  return LABEL;
}
export function landAt(x, y) {
  if (x < 8 || y < 8 || x > WORLD_W - 8 || y > WORLD_H - 8) return 0;
  return labels()[Math.floor(y / WALK_CELL) * WALK_W + Math.floor(x / WALK_CELL)];
}

// Groves: sheltered spots with berry bushes, spread over the big islands.
// This is where the dumplings live, so life gathers in a few places and the
// rest of the world stays quiet.
export const GROVE_R = 340;
let GROVES = null, HOMES = null;
export function groves() {
  if (GROVES) return GROVES;
  labels();
  const cand = [];
  const step = 200;
  for (let y = step; y < WORLD_H - step; y += step) for (let x = step; x < WORLD_W - step; x += step) {
    const il = landAt(x, y);
    if (!il || COMP_SIZE[il] < 6000) continue;
    const e = elevAt(x, y);
    if (e < LEVEL.SAND + 0.05 || e > LEVEL.HILL - 0.08) continue;
    let ok = 0;
    for (let k = 0; k < 16; k++) {
      const d = DIRS[k * 4];
      if (landAt(x + d[0] * 220, y + d[1] * 220) === il) ok++;
    }
    if (ok < 15) continue;
    cand.push({ x, y, il, h: hash01(x, y, SEED + 61) });
  }
  cand.sort((a, b) => a.h - b.h);
  GROVES = [];
  for (const c of cand) {
    if (GROVES.length >= 30) break;
    if (GROVES.some(g => (g.x - c.x) * (g.x - c.x) + (g.y - c.y) * (g.y - c.y) < 1500 * 1500)) continue;
    GROVES.push({ x: c.x, y: c.y, il: c.il, isl: islandSpecAt(c.x, c.y), b: biomeAt(c.x, c.y) });
  }
  // the groves on each island, in order
  HOMES = new Map();
  GROVES.forEach((g, i) => { if (!HOMES.has(g.il)) HOMES.set(g.il, []); HOMES.get(g.il).push(i); });
  return GROVES;
}
// islands with groves, i.e. the ones creatures live on
export function homes() { groves(); return HOMES; }
export function islandName(il) {
  const h = homes().get(il);
  const s = h ? ISLANDS[GROVES[h[0]].isl] : null;
  return s ? s.name : 'a little islet';
}
function nearestGrove(x, y, il) {
  const gs = groves(), list = HOMES.get(il);
  if (!list) return 0;
  let best = list[0], bd = Infinity;
  for (const i of list) {
    const dx = gs[i].x - x, dy = gs[i].y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// trees, rocks and other scenery: static, generated from the seed
// tree kinds: 0 leafy, 1 pine, 2 jungle, 3 palm, 4 acacia, 5 cactus, 6 willow
let SCENERY = null;
export function scenery() {
  if (SCENERY) return SCENERY;
  const trees = [], rocks = [], bushSpots = [], mushrooms = [], reeds = [], shrubs = [];
  const gs = groves();
  const { elev } = terrain();
  const step = 26;
  for (let y = step / 2; y < WORLD_H; y += step) {
    for (let x = step / 2; x < WORLD_W; x += step) {
      const ix = Math.floor(x / step), iy = Math.floor(y / step);
      const jx = x + (hash01(ix, iy, SEED + 1) - 0.5) * step * 0.9;
      const jy = y + (hash01(ix, iy, SEED + 2) - 0.5) * step * 0.9;
      const e = sampleField(elev, jx, jy);
      if (e < LEVEL.WATER - 0.03) continue; // open water: nothing grows
      const h = hash01(ix, iy, SEED + 3);
      const k = hash01(ix, iy, SEED + 4);
      const b = biomeAt(jx, jy);
      if (e > LEVEL.SAND + 0.02 && e < LEVEL.HILL) {
        let inGrove = false;
        for (const g of gs) {
          const dx = g.x - jx, dy = g.y - jy;
          if (dx * dx + dy * dy < GROVE_R * GROVE_R) { inGrove = true; break; }
        }
        const m = moistAt(jx, jy);
        if (b === BIOME.MEADOW) {
          if (h < (inGrove ? 0.02 : 0.008)) trees.push({ x: jx, y: jy, k, kind: 0 });
        } else if (b === BIOME.FOREST) {
          if (h < 0.13 + (m - 0.57) * 1.2) trees.push({ x: jx, y: jy, k, kind: e > 0.36 ? 1 : 0 });
          else if (h > 0.985) mushrooms.push({ x: jx, y: jy, k });
        } else if (b === BIOME.STEPPE) {
          if (h < 0.008) shrubs.push({ x: jx, y: jy, k });
          else if (h < 0.011) trees.push({ x: jx, y: jy, k, kind: 0 });
          else if (h > 0.996) rocks.push({ x: jx, y: jy, k, big: false });
        } else if (b === BIOME.SWAMP) {
          if (h < 0.05) trees.push({ x: jx, y: jy, k, kind: 6 });
          else if (h > 0.99) mushrooms.push({ x: jx, y: jy, k });
          else if (h > 0.98) reeds.push({ x: jx, y: jy, k });
        } else if (b === BIOME.DESERT) {
          if (h < 0.007) trees.push({ x: jx, y: jy, k, kind: 5 });
          else if (h < 0.01) rocks.push({ x: jx, y: jy, k, big: false });
          else if (h > 0.994) shrubs.push({ x: jx, y: jy, k });
        } else if (b === BIOME.SAVANNA) {
          if (h < 0.011) trees.push({ x: jx, y: jy, k, kind: 4 });
          else if (h > 0.99) shrubs.push({ x: jx, y: jy, k });
        } else if (b === BIOME.JUNGLE) {
          if (h < 0.18) trees.push({ x: jx, y: jy, k, kind: 2 });
          else if (h < 0.21) trees.push({ x: jx, y: jy, k, kind: 3 });
        } else if (b === BIOME.TAIGA) {
          if (h < 0.14) trees.push({ x: jx, y: jy, k, kind: 1 });
          else if (h > 0.995) rocks.push({ x: jx, y: jy, k, big: false });
        } else { // tundra
          if (h < 0.006) trees.push({ x: jx, y: jy, k, kind: 1 });
          else if (h > 0.99) rocks.push({ x: jx, y: jy, k, big: k > 0.6 });
        }
        if (inGrove ? k < 0.03 : k < 0.0012 && b !== BIOME.DESERT && b !== BIOME.TUNDRA) bushSpots.push({ x: jx, y: jy });
      } else if (e >= LEVEL.HILL && e < LEVEL.PEAK) {
        if (h < 0.03) rocks.push({ x: jx, y: jy, k, big: k > 0.7 });
        else if (h > 0.96 && !isHot(b)) trees.push({ x: jx, y: jy, k, kind: 1 });
      } else if (e >= LEVEL.PEAK) {
        if (h < 0.025) rocks.push({ x: jx, y: jy, k, big: true });
      } else if (e > LEVEL.WATER + 0.006) { // beach
        if (h < 0.012) rocks.push({ x: jx, y: jy, k, big: false });
        else if (h > 0.97 && (b === BIOME.JUNGLE || b === BIOME.SAVANNA)) trees.push({ x: jx, y: jy, k, kind: 3 });
      } else if (e <= LEVEL.WATER) { // shallows
        if (h < (b === BIOME.SWAMP ? 0.3 : 0.1) && !isCold(b)) reeds.push({ x: jx, y: jy, k });
      }
    }
  }
  // keep bushes away from tree trunks and on the inhabited islands
  const near = new Map();
  for (const t of trees) {
    const key = Math.floor(t.y / 30) * 1000 + Math.floor(t.x / 30);
    if (!near.has(key)) near.set(key, []);
    near.get(key).push(t);
  }
  const clearOfTrees = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const t of near.get((Math.floor(y / 30) + dy) * 1000 + Math.floor(x / 30) + dx) || []) {
        if ((t.x - x) * (t.x - x) + (t.y - y) * (t.y - y) < 900) return false;
      }
    }
    return true;
  };
  const bushes = [];
  for (const b of bushSpots) {
    const il = landAt(b.x, b.y);
    if (homes().has(il) && clearOfTrees(b.x, b.y)) bushes.push({ x: b.x, y: b.y, il });
  }
  SCENERY = { trees, rocks, bushes, mushrooms, reeds, shrubs };
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

// every island has its own colours, so you can tell where a creature is from
function founderGenes(w, s, isl) {
  const hues = isl >= 0 ? ISLANDS[isl].hues[s] : s === DUMPLING ? DUMPLING_HUES : GRUMBLE_HUES;
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

// somewhere walkable inside a grove
function groveSpot(w, gi) {
  const g = groves()[gi];
  for (let tries = 0; tries < 200; tries++) {
    const d = DIRS[rint(w, 0, 63)], r = rnd(w) * GROVE_R * 0.8;
    const x = g.x + d[0] * r, y = g.y + d[1] * r;
    if (landAt(x, y) === g.il) return [x, y];
  }
  return [g.x, g.y];
}

function newCreature(w, s, x, y, genes, gen, parents, ageTicks, il) {
  const sp = SPECIES[s];
  const home = HOMES.get(il);
  const d = DIRS[rint(w, 0, 63)];
  const c = {
    id: w.nextId++, s, x: r4(x), y: r4(y), hx: d[0], hy: d[1],
    e: 0, age: ageTicks, life: Math.floor(sp.life * (0.85 + rnd(w) * 0.3)),
    g: genes, gen, n: makeName(w, s),
    pa: parents ? parents[0].id : -1, pb: parents ? parents[1].id : -1,
    pn: parents ? [parents[0].n, parents[1].n] : null,
    kids: 0, st: ST.WANDER, tg: -1, cd: Math.floor(sp.cooldown * 0.5), sta: 40, stun: 0,
    ate: 0, kills: 0, born: w.tick - ageTicks, lt: 0, fat: rint(w, 0, AWAKE[s]),
    il, hm: s === GRUMBLE ? home[rint(w, 0, home.length - 1)] : nearestGrove(x, y, il), dt: 0,
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
    w.bushes.push({ x: r4(b.x), y: r4(b.y), b: m, m, il: b.il });
  }
  // founders: a little herd in every grove, and a pair of grumbles on every
  // island with room to roam
  const gs = groves();
  for (let gi = 0; gi < gs.length; gi++) addHerd(w, gi, 4, rint(w, 2400, 9000), false);
  for (const [il, list] of homes()) {
    if (list.length < 2) continue;
    addGrumbles(w, list[rint(w, 0, list.length - 1)], 2, rint(w, 4800, 12000), false);
  }
  const nd = countSpecies(w.creatures, DUMPLING);
  logEvent(w, 'world', `The islands were founded. ${nd} dumplings and ${w.creatures.length - nd} grumbles moved in.`);
  recordHistory(w, true);
  normalize(w);
  return w;
}

function addHerd(w, gi, n, age, arrive) {
  const g = groves()[gi];
  const [hx, hy] = groveSpot(w, gi);
  const base = founderGenes(w, DUMPLING, g.isl);
  for (let k = 0; k < n; k++) {
    const gn = base.slice();
    gn[G_SIZE] = r4(clamp(gn[G_SIZE] + rnorm(w) * 0.04, 0.6, 1.6));
    gn[G_SPEED] = r4(clamp(gn[G_SPEED] + rnorm(w) * 0.04, 0.6, 1.6));
    gn[G_SIGHT] = r4(clamp(gn[G_SIGHT] + rnorm(w) * 0.04, 0.6, 1.6));
    gn[G_TOP] = rnd(w) < 0.3 ? rint(w, 0, 5) : gn[G_TOP];
    let x = hx + rnorm(w) * 40, y = hy + rnorm(w) * 40;
    if (landAt(x, y) !== g.il) { x = hx; y = hy; }
    w.creatures.push(newCreature(w, DUMPLING, x, y, gn, 0, null, age, g.il));
  }
  if (arrive) {
    w.stats.arrivals += n;
    logEvent(w, 'arrive', `A family of ${n} dumplings drifted ashore on ${islandName(g.il)}.`, { x: hx, y: hy, s: DUMPLING });
  }
}
function addGrumbles(w, gi, n, age, arrive) {
  const g = groves()[gi];
  const [x, y] = groveSpot(w, gi);
  for (let k = 0; k < n; k++) {
    let gx = x + rnorm(w) * 20, gy = y + rnorm(w) * 20;
    if (landAt(gx, gy) !== g.il) { gx = x; gy = y; }
    w.creatures.push(newCreature(w, GRUMBLE, gx, gy, founderGenes(w, GRUMBLE, g.isl), 0, null, age, g.il));
  }
  if (arrive) {
    w.stats.arrivals += n;
    logEvent(w, 'arrive', `Two hungry grumbles crept down from the hills of ${islandName(g.il)}.`, { x, y, s: GRUMBLE });
  }
}

// how many creatures an island can hold
function capOf(s, il) {
  const n = HOMES.get(il).length;
  return s === DUMPLING ? SPECIES[0].cap * n : n >= 2 ? Math.floor(SPECIES[1].cap * n) : 0;
}

// ---------------------------------------------------------------------------
// creature math

export function growth(c) { return 0.55 + 0.45 * Math.min(1, c.age / SPECIES[c.s].mature); }
export function radius(c) { return SPECIES[c.s].radius * c.g[G_SIZE] * growth(c); }
export function maxEnergy(c) { return SPECIES[c.s].maxEnergy * c.g[G_SIZE]; }
export function sightOf(c) { return SPECIES[c.s].sight * c.g[G_SIGHT]; }
export function speedOf(c) { return SPECIES[c.s].speed * c.g[G_SPEED] * (0.75 + 0.25 * growth(c)) * (0.65 + 0.35 * c.g[G_SIZE]); }
export function cost(c) {
  const z = c.g[G_SIZE], v = c.g[G_SPEED], k = c.g[G_SIGHT];
  return 0.3 * z * z * z + 0.45 * v * v * z + 0.25 * k;
}
export function isAdult(c) { return c.age >= SPECIES[c.s].mature; }
export function ready(c) {
  return isAdult(c) && c.cd <= 0 && c.e > maxEnergy(c) * (c.s === DUMPLING ? 0.62 : 0.66) && c.age < c.life * 0.92;
}

// ---------------------------------------------------------------------------
// spatial hash

const CELL = 120;
const GW = Math.ceil(WORLD_W / CELL), GH = Math.ceil(WORLD_H / CELL);

// flat linked lists (head per cell, next per item), rebuilt every tick without allocating
function buildGrid(list, grid) {
  const n = list.length;
  if (!grid || grid.next.length < n) grid = { head: new Int32Array(GW * GH), next: new Int32Array(Math.max(64, n * 2)) };
  grid.head.fill(-1);
  for (let i = n - 1; i >= 0; i--) { // backwards, so each cell lists its items in order
    const o = list[i];
    const gx = clamp(Math.floor(o.x / CELL), 0, GW - 1), gy = clamp(Math.floor(o.y / CELL), 0, GH - 1);
    const cell = gy * GW + gx;
    grid.next[i] = grid.head[cell];
    grid.head[cell] = i;
  }
  return grid;
}
function forNear(grid, list, x, y, r, fn) {
  const x0 = clamp(Math.floor((x - r) / CELL), 0, GW - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, GW - 1);
  const y0 = clamp(Math.floor((y - r) / CELL), 0, GH - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, GH - 1);
  const head = grid.head, next = grid.next;
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    for (let k = head[gy * GW + gx]; k >= 0; k = next[k]) fn(list[k]);
  }
}
let CREATURE_GRID = null;

let BUSH_GRID = null, BUSH_GRID_LIST = null;
function bushGrid(w) {
  if (BUSH_GRID_LIST !== w.bushes) { BUSH_GRID = buildGrid(w.bushes, null); BUSH_GRID_LIST = w.bushes; }
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

// how fast berries grow back on each kind of land, per season
const REGROW = [
  [0.015, 0.012, 0.0075, 0.0048], // meadow
  [0.015, 0.012, 0.0075, 0.0048], // forest
  [0.013, 0.01, 0.0065, 0.0042], // steppe
  [0.015, 0.013, 0.008, 0.004], // swamp
  [0.008, 0.006, 0.007, 0.009], // desert: cactus fruit, best in the cool season
  [0.012, 0.007, 0.01, 0.013], // savanna: the dry season is summer
  [0.012, 0.012, 0.012, 0.012], // jungle: always something ripe
  [0.011, 0.014, 0.007, 0.0035], // taiga
  [0.01, 0.014, 0.006, 0.003], // tundra
];
// grass to nibble on when there are no berries (per tick)
const GRAZE = [
  [0.012, 0.01, 0.006, 0], // meadow
  [0, 0, 0, 0.009], // forest: only worth it in winter, under the trees
  [0.008, 0.005, 0.004, 0], // steppe
  [0.01, 0.01, 0.008, 0.003], // swamp
  [0.002, 0, 0, 0.003], // desert
  [0.011, 0.003, 0.008, 0.01], // savanna
  [0.009, 0.009, 0.009, 0.009], // jungle
  [0.004, 0.006, 0.003, 0.004], // taiga
  [0.002, 0.005, 0.001, 0.002], // tundra: lichen under the snow
];
// static facts about the bushes (the list itself is replaced at every checkpoint)
let BUSH_BIOME = null, BUSH_BY_IL = null, BUSH_LIST = null;
function bushInfo(w) {
  if (BUSH_LIST !== w.bushes) {
    BUSH_LIST = w.bushes;
    BUSH_BIOME = w.bushes.map(b => biomeAt(b.x, b.y));
    BUSH_BY_IL = new Map();
    for (const b of w.bushes) { if (!BUSH_BY_IL.has(b.il)) BUSH_BY_IL.set(b.il, []); BUSH_BY_IL.get(b.il).push(b); }
  }
}
let COUNT = null;

export function step(w) {
  w.tick++;
  const tick = w.tick;
  const fx = (w.fx = []);
  const season = seasonIndex(tick);
  const list = w.creatures;
  const grid = (CREATURE_GRID = buildGrid(list, CREATURE_GRID));
  const bgrid = bushGrid(w);
  const byId = new Map();
  for (const c of list) byId.set(c.id, c);
  const dead = new Set();
  const babies = [];
  // head counts per island
  if (!COUNT) { labels(); COUNT = [new Int32Array(COMP_SIZE.length), new Int32Array(COMP_SIZE.length)]; }
  const countD = COUNT[0], countG = COUNT[1];
  countD.fill(0); countG.fill(0);
  for (const c of list) (c.s === DUMPLING ? countD : countG)[c.il]++;

  // berries regrow
  if (tick % 20 === 0) {
    const rain = weatherAt(tick) === 'rain' ? 1.6 : 1;
    bushInfo(w);
    const bb = BUSH_BIOME;
    for (let i = 0; i < w.bushes.length; i++) {
      const b = w.bushes[i];
      if (b.b < b.m && rnd(w) < REGROW[bb[i]][season] * rain) b.b++;
    }
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
        if (o.s !== GRUMBLE || o.il !== c.il || dead.has(o.id)) return;
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
            const rate = GRAZE[biomeAt(c.x, c.y)][season];
            if (rate > 0 && e > LEVEL.SAND && e < LEVEL.HILL) {
              if (c.st !== ST.GRAZE) c.lt = 30 + rint(w, 0, 40);
              c.st = ST.GRAZE; moving = false; acted = true;
              c.e = Math.min(maxEnergy(c), c.e + rate);
              if (--c.lt <= 0) { c.st = ST.WANDER; c.lt = 0; }
            } else if (c.st === ST.GRAZE) { c.st = ST.WANDER; c.lt = 0; }
          }
        }
        if (!acted && ready(c) && countD[c.il] < capOf(DUMPLING, c.il)) acted = seekMate(w, c, grid, list, dead, babies, fx, sight);
        if (!acted && !isAdult(c) && c.pa >= 0) {
          const p = byId.get(c.pa) || byId.get(c.pb);
          if (p && !dead.has(p.id)) {
            const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d > 55 && d < 600) { steerTo(c, p.x, p.y, 0.25); c.st = ST.FOLLOW; acted = true; if (d < 80) spd *= 0.6; }
          }
        }
        if (!acted && hungry && c.dt === 0) {
          // they remember where the bushes are: head for the nearest one that still has berries
          let best = null, bd = 900 * 900;
          bushInfo(w);
          for (const b of BUSH_BY_IL.get(c.il) || []) {
            if (b.b <= 0) continue;
            const dx = b.x - c.x, dy = b.y - c.y, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = b; }
          }
          if (best) { wanderTurn(w, c, 2); steerTo(c, best.x, best.y + 6, 0.15); c.st = ST.FOOD; spd *= 0.85; acted = true; }
        }
        if (!acted && homeward(w, c, 420)) { acted = true; c.st = ST.WANDER; spd *= 0.55; }
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
            if (o.s !== DUMPLING || o.il !== c.il || dead.has(o.id)) return;
            let vis = o.st === ST.SLEEP ? sight * 0.5 : sight;
            if (isWooded(biomeAt(o.x, o.y))) vis *= 0.6; // hard to spot under the trees
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
              const p = clamp(0.6 + (c.g[G_SIZE] * growth(c) - prey.g[G_SIZE] * growth(prey)) * 2.2, 0.12, 0.95);
              if (rnd(w) < p) {
                dead.add(prey.id);
                killed(w, prey, 'eaten', c);
                c.e = Math.min(maxEnergy(c), c.e + 50 * prey.g[G_SIZE] * growth(prey));
                c.kills++;
                if (c.kills === 20 || c.kills === 40) logEvent(w, 'hunter', `${c.n} the grumble has now caught ${c.kills} dumplings.`, { id: c.id, s: GRUMBLE });
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
        const roomForGrumbles = countG[c.il] < capOf(GRUMBLE, c.il) && countD[c.il] > countG[c.il] * 8;
        if (!acted && ready(c) && roomForGrumbles) acted = seekMate(w, c, grid, list, dead, babies, fx, 1100); // grumbles can smell each other from far away
        if (!acted && !isAdult(c) && c.pa >= 0) {
          const p = byId.get(c.pa) || byId.get(c.pb);
          if (p && !dead.has(p.id)) {
            const dx = p.x - c.x, dy = p.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d > 70 && d < 700) { steerTo(c, p.x, p.y, 0.25); c.st = ST.FOLLOW; acted = true; }
          }
        }
        if (!acted) {
          // roam from grove to grove, lingering a while at each
          // grumbles that are ready for a family all head for the same grove (it changes every hour)
          const home = HOMES.get(c.il);
          if (ready(c) && roomForGrumbles) c.hm = home[Math.floor(tick / 14400 + 3) * 5 % home.length];
          const g = groves()[c.hm];
          const dx = g.x - c.x, dy = g.y - c.y;
          if (dx * dx + dy * dy < GROVE_R * GROVE_R && rnd(w) < 1 / 2400) c.hm = home[rint(w, 0, home.length - 1)];
          c.st = ST.WANDER;
          if (!homeward(w, c, GROVE_R * 0.7)) wanderTurn(w, c, 2.4);
          spd *= 0.6;
        }
      }
    }

    if (moving && !move(w, c, spd) && c.dt === 0) c.dt = -1;
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
    // grumbles slow right down in winter, a bit like hibernating (not in the tropics)
    const warmth = tempAt(c.x, c.y);
    if (c.s === GRUMBLE && season === 3 && warmth < 0.66) drainMul *= 0.55;
    // big bodies keep warm in the cold and overheat in the heat, so over many
    // generations the polar islands breed big creatures and the tropics small ones
    drainMul *= 1 + (c.g[G_SIZE] - 1) * (warmth - 0.5) * 0.9;
    c.e -= sp.drain * cost(c) * drainMul * (0.6 + 0.4 * growth(c));
    if (c.e <= 0) { dead.add(c.id); killed(w, c, 'starved'); }
    else if (c.age >= c.life) { dead.add(c.id); killed(w, c, 'old'); }
  }

  if (dead.size) w.creatures = list.filter(c => !dead.has(c.id));
  for (const b of babies) w.creatures.push(b);

  // graves fade after 10 minutes
  if (w.graves.length && w.graves[0].t < tick - 2400) w.graves = w.graves.filter(g => g.t >= tick - 2400);

  // migration keeps the world from staying empty
  if (tick % 2400 === 0) { migrate(w); tenMinuteNews(w); }
  if (tick % SEASON_TICKS === 0) {
    logEvent(w, 'season', `${cap(SEASONS[seasonIndex(tick)])} arrived on the islands.`);
  }
  recordHistory(w, false);

  if (tick % CHECKPOINT_TICKS === 0) normalize(w);
}

// Walk back towards the home grove when further than `far` from it. A creature
// that bumps into water or cliffs on the way wanders off for a bit before trying again.
function homeward(w, c, far) {
  if (c.dt < 0) c.dt = 30 + rint(w, 0, 60);
  if (c.dt > 0) { c.dt--; wanderTurn(w, c, 4); return true; }
  const g = groves()[c.hm];
  if (!g) return false;
  const dx = g.x - c.x, dy = g.y - c.y;
  if (dx * dx + dy * dy < far * far) return false;
  wanderTurn(w, c, 2);
  steerTo(c, g.x, g.y, 0.12);
  return true;
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

// a few headlines about the last ten minutes
function tenMinuteNews(w) {
  const st = w.stats;
  const last = st.last || { births: st.births, starved: st.starved, eaten: st.eaten };
  const births = st.births - last.births, starved = st.starved - last.starved, eaten = st.eaten - last.eaten;
  st.last = { births: st.births, starved: st.starved, eaten: st.eaten };
  if (w.tick - (st.newsAt ?? -1e9) < 14400) return; // at most one headline an hour
  let text = null;
  if (births >= 90) text = `Baby boom! ${births} babies were born in the last ten minutes.`;
  else if (starved >= 40) text = `Hard times: ${starved} creatures went hungry and didn't make it in the last ten minutes.`;
  else if (eaten >= 30) text = `The grumbles are feasting: ${eaten} dumplings eaten in ten minutes.`;
  if (text) { st.newsAt = w.tick; logEvent(w, 'news', text); }
}

function countSpecies(list, s) { let n = 0; for (const c of list) if (c.s === s) n++; return n; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

function seekMate(w, c, grid, list, dead, babies, fx, sight) {
  let mate = null, md = 1e12;
  forNear(grid, list, c.x, c.y, sight, o => {
    if (o === c || o.s !== c.s || o.il !== c.il || dead.has(o.id) || !ready(o)) return;
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
      const ok = landAt(bx, by) === c.il;
      const baby = newCreature(w, c.s, ok ? bx : c.x, ok ? by : c.y, g, gen, [c, mate], 0, c.il);
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
  if (cause === 'eaten') w.stats.eaten++;
  else if (cause === 'starved') w.stats.starved++;
  else if (cause === 'old') w.stats.old++;
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
  if (c.kids >= 12 && (cause === 'eaten' || cause === 'starved')) {
    logEvent(w, 'death', `${c.n}, parent of ${c.kids}, was ${cause === 'eaten' ? `eaten by ${by.n}` : 'lost to hunger'}.`, { s: c.s });
  }
}

// newcomers keep the islands from staying empty
function migrate(w) {
  const nd = countSpecies(w.creatures, DUMPLING), ng = w.creatures.length - nd;
  if (nd === 0 && w.stats._dAlive !== false) { w.stats.extinctions[0]++; logEvent(w, 'extinct', 'The last dumpling is gone. The islands are quiet.'); }
  if (ng === 0 && w.stats._gAlive !== false) { w.stats.extinctions[1]++; logEvent(w, 'extinct', 'The grumbles have died out.'); }
  w.stats._dAlive = nd > 0; w.stats._gAlive = ng > 0;
  const cd = new Map(), cg = new Map();
  for (const c of w.creatures) { const m = c.s === DUMPLING ? cd : cg; m.set(c.il, (m.get(c.il) || 0) + 1); }
  for (const [il, list] of homes()) {
    const d = cd.get(il) || 0, g = cg.get(il) || 0;
    if (d < 4) addHerd(w, list[rint(w, 0, list.length - 1)], 5, 2600, true);
    if (list.length >= 2 && g < 2 && d > 15) addGrumbles(w, list[rint(w, 0, list.length - 1)], 2, 5000, true);
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
  // advance up to `target`; if budgetMs and now() given, stop when out of time.
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
