// Ground rendering: the island is drawn into 256px tiles straight from the
// same elevation field the simulation walks on, with analytic outlines so the
// coast stays crisp at any zoom. Tiles are cached per season and zoom level.
import * as S from '../sim/core.js';

const TILE = 256;
const INK = [20, 20, 20];

const PALETTES = [
  { // spring
    grass: [142, 212, 104], forest: [92, 172, 84], sand: [243, 221, 156], rock: [196, 190, 172], rockDark: [174, 168, 150],
    snow: [244, 247, 250], shallow: [116, 202, 242], deep: [78, 160, 226], band: [150, 218, 247],
    mark: 'rgba(60,140,60,0.55)', markSnow: 'rgba(150,170,190,0.5)',
  },
  { // summer
    grass: [168, 214, 92], forest: [104, 162, 72], sand: [246, 220, 146], rock: [204, 194, 168], rockDark: [180, 170, 146],
    snow: [244, 247, 250], shallow: [104, 198, 240], deep: [66, 150, 222], band: [142, 216, 246],
    mark: 'rgba(84,140,40,0.55)', markSnow: 'rgba(150,170,190,0.5)',
  },
  { // autumn
    grass: [206, 196, 98], forest: [176, 140, 70], sand: [238, 214, 150], rock: [196, 184, 162], rockDark: [172, 160, 140],
    snow: [244, 247, 250], shallow: [98, 184, 228], deep: [64, 138, 206], band: [134, 204, 236],
    mark: 'rgba(150,110,40,0.5)', markSnow: 'rgba(150,170,190,0.5)',
  },
  { // winter
    grass: [236, 243, 247], forest: [214, 228, 236], sand: [226, 222, 208], rock: [168, 170, 172], rockDark: [140, 144, 150],
    snow: [250, 252, 255], shallow: [160, 214, 240], deep: [90, 150, 210], band: [204, 236, 250],
    mark: 'rgba(140,165,190,0.55)', markSnow: 'rgba(140,165,190,0.5)',
  },
];
export function palette(season) { return PALETTES[season]; }

const cache = new Map();
const MAX_TILES = 140;
let queue = [];
const queued = new Set();

function key(season, z, tx, ty) { return `${season}|${z}|${tx}|${ty}`; }

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export function renderTile(season, z, tx, ty) {
  const ps = 1 / Math.pow(2, z); // world units per pixel
  const wx0 = tx * TILE * ps, wy0 = ty * TILE * ps;
  const P = PALETTES[season];
  const N = TILE + 2;
  const { elev, moist } = S.terrain();
  // the bicubic field is the expensive part: sample it every 2 px and fill in
  // between with cheap bilinear interpolation (the field is smooth anyway)
  const CS = 2, CN = (TILE >> 1) + 3;
  const C = new Float32Array(CN * CN);
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
    C[j * CN + i] = S.sampleField(elev, wx0 + (i * CS - 2) * ps, wy0 + (j * CS - 2) * ps);
  }
  const E = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const cy = (j - 0.5 + 2) / CS, cj = Math.floor(cy), fy = cy - cj;
    for (let i = 0; i < N; i++) {
      const cx = (i - 0.5 + 2) / CS, ci = Math.floor(cx), fx = cx - ci;
      const o = cj * CN + ci;
      E[j * N + i] = (C[o] * (1 - fx) + C[o + 1] * fx) * (1 - fy) + (C[o + CN] * (1 - fx) + C[o + CN + 1] * fx) * fy;
    }
  }
  // moisture is smooth, sample it on a coarse grid and interpolate
  const MS = 8, MN = TILE / MS + 2;
  const M = new Float32Array(MN * MN);
  for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) M[j * MN + i] = S.sampleField(moist, wx0 + i * MS * ps, wy0 + j * MS * ps);

  const canvas = document.createElement('canvas');
  canvas.width = TILE; canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  const L = S.LEVEL;
  const coastW = 1.6, hillW = 1.1, peakW = 1.35;
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const k = (j + 1) * N + (i + 1);
      const e = E[k];
      const gx = (E[k + 1] - E[k - 1]) / (2 * ps), gy = (E[k + N] - E[k - N]) / (2 * ps);
      const g = Math.sqrt(gx * gx + gy * gy) + 1e-9;
      const mi = i / MS, mj = j / MS, mi0 = Math.floor(mi), mj0 = Math.floor(mj), fx = mi - mi0, fy = mj - mj0;
      const m = (M[mj0 * MN + mi0] * (1 - fx) + M[mj0 * MN + mi0 + 1] * fx) * (1 - fy) + (M[(mj0 + 1) * MN + mi0] * (1 - fx) + M[(mj0 + 1) * MN + mi0 + 1] * fx) * fy;
      const wx = wx0 + i * ps, wy = wy0 + j * ps;
      let c;
      const dc = (e - L.WATER) / g; // signed distance to the coast in world units
      if (e < L.WATER) {
        const deep = smooth(L.DEEP + 0.03, L.DEEP - 0.03, e);
        c = mix(P.shallow, P.deep, deep);
        const band = smooth(-15, -11, dc);
        c = mix(c, P.band, band * 0.9);
      } else {
        const ds = (e - L.SAND) / g;
        const sandT = Math.min(1, Math.max(0, ds / ps + 0.5));
        let land = mix(P.grass, P.forest, smooth(S.FOREST_MOIST - 0.07, S.FOREST_MOIST + 0.02, m));
        // gentle patchiness so big meadows don't look flat
        const n = Math.sin(wx * 0.021 + Math.sin(wy * 0.017) * 2) * Math.sin(wy * 0.019 + Math.sin(wx * 0.013) * 2);
        land = mix(land, mix(land, [255, 255, 230], 0.25), Math.max(0, n) * 0.35);
        c = mix(P.sand, land, sandT);
        if (e > L.HILL - 0.02) {
          const rockT = Math.min(1, Math.max(0, ((e - L.HILL) / g) / ps + 0.5));
          const rk = mix(P.rock, P.rockDark, Math.max(0, n) * 0.6);
          c = mix(c, rk, rockT);
          if (e > L.PEAK - 0.02) {
            const pk = Math.min(1, Math.max(0, ((e - L.PEAK) / g) / ps + 0.5));
            c = mix(c, P.snow, pk);
          }
        }
      }
      // ink outlines
      let ink = Math.min(1, Math.max(0, (coastW - Math.abs(dc)) / ps + 0.5));
      if (e > L.HILL - 0.05) {
        const dh = Math.abs((e - L.HILL) / g);
        ink = Math.max(ink, Math.min(1, Math.max(0, (hillW - dh) / ps + 0.5)) * 0.85);
        const dp = Math.abs((e - L.PEAK) / g);
        ink = Math.max(ink, Math.min(1, Math.max(0, (peakW - dp) / ps + 0.5)));
      }
      if (ink > 0) c = mix(c, INK, ink);
      const o = (j * TILE + i) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  drawDecals(ctx, season, ps, wx0, wy0, P);
  return canvas;
}

// little hand-drawn marks on the ground: grass flicks, sand dots, wave squiggles, flowers
function drawDecals(ctx, season, ps, wx0, wy0, P) {
  const span = TILE * ps;
  ctx.save();
  ctx.setTransform(1 / ps, 0, 0, 1 / ps, -wx0 / ps, -wy0 / ps);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const C = 30;
  const i0 = Math.floor((wx0 - 20) / C), i1 = Math.floor((wx0 + span + 20) / C);
  const j0 = Math.floor((wy0 - 20) / C), j1 = Math.floor((wy0 + span + 20) / C);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const h = S.hash01(i, j, 4242), h2 = S.hash01(i, j, 777), h3 = S.hash01(i, j, 31);
    const x = i * C + h2 * C, y = j * C + h3 * C;
    const e = S.elevAt(x, y);
    if (e > S.LEVEL.SAND + 0.01 && e < S.LEVEL.HILL - 0.01) {
      if (h < 0.3) {
        // grass flick: a little "w"
        ctx.strokeStyle = P.mark;
        ctx.lineWidth = 1.9;
        const s = 4 + h2 * 2.5;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s * 0.6);
        ctx.lineTo(x - s * 0.45, y + s * 0.25);
        ctx.lineTo(x, y - s * 0.5);
        ctx.lineTo(x + s * 0.45, y + s * 0.25);
        ctx.lineTo(x + s, y - s * 0.6);
        ctx.stroke();
      }
    } else if (e > S.LEVEL.WATER + 0.004 && e <= S.LEVEL.SAND) {
      if (h < 0.35) {
        ctx.fillStyle = 'rgba(190,160,100,0.45)';
        ctx.beginPath(); ctx.arc(x, y, 1.3 + h2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (e < S.LEVEL.WATER - 0.02 && season !== 3) {
      if (h < 0.06) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        const s = 7 + h2 * 5;
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.quadraticCurveTo(x - s / 2, y - 4, x, y);
        ctx.quadraticCurveTo(x + s / 2, y - 4, x + s, y);
        ctx.stroke();
      }
    } else if (e >= S.LEVEL.PEAK + 0.01 && h < 0.22) {
      // little mountain-top peaks so snowfields don't read as lakes
      ctx.strokeStyle = 'rgba(120,130,150,0.55)';
      ctx.lineWidth = 1.8;
      const s = 5 + h2 * 4;
      ctx.beginPath();
      ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(x - s * 0.3, y - s * 0.5); ctx.lineTo(x + s * 0.2, y + s * 0.1);
      ctx.lineTo(x + s * 0.6, y - s * 0.25); ctx.lineTo(x + s, y + s * 0.4);
      ctx.stroke();
    } else if (e >= S.LEVEL.HILL && e < S.LEVEL.PEAK && h < 0.12) {
      ctx.strokeStyle = 'rgba(90,85,80,0.45)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x, y - 2); ctx.lineTo(x + 4, y + 1); ctx.stroke();
    }
  }
  // flowers from the scenery list
  if (season !== 3) {
    const petals = season === 2 ? ['#f2a541', '#e0603a', '#f7d046'] : ['#ffffff', '#ffd23f', '#ff8fb8', '#b48cff'];
    for (const f of S.scenery().flowers) {
      if (f.x < wx0 - 12 || f.x > wx0 + span + 12 || f.y < wy0 - 12 || f.y > wy0 + span + 12) continue;
      const col = petals[Math.floor(f.k * petals.length)];
      for (let n = 0; n < 3; n++) {
        const fx = f.x + (n - 1) * 9 + f.k * 4, fy = f.y + ((n * 7) % 5) - 2;
        ctx.fillStyle = col; ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.4;
        for (let p = 0; p < 5; p++) {
          const a = p * 1.2566 + f.k;
          ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 2.6, fy + Math.sin(a) * 2.6, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = '#ffcc33';
        ctx.beginPath(); ctx.arc(fx, fy, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function chooseZoomLevel(scalePx) {
  // scalePx = screen pixels per world unit (incl. devicePixelRatio)
  const z = Math.ceil(Math.log2(scalePx) - 0.15);
  return Math.max(-2, Math.min(2, z));
}

export function getTile(season, z, tx, ty, request) {
  const k = key(season, z, tx, ty);
  const t = cache.get(k);
  if (t) { cache.delete(k); cache.set(k, t); return t; }
  if (request && !queued.has(k)) { queued.add(k); queue.push([season, z, tx, ty, k]); }
  return null;
}

export function pumpTiles(budgetMs) {
  const t0 = performance.now();
  // newest requests first: they're what's on screen right now
  while (queue.length && performance.now() - t0 < budgetMs) {
    const [season, z, tx, ty, k] = queue.pop();
    queued.delete(k);
    if (cache.has(k)) continue;
    cache.set(k, renderTile(season, z, tx, ty));
    while (cache.size > MAX_TILES) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }
  return queue.length;
}

export function clearQueue() { queue = []; queued.clear(); }

// draw the ground for the visible world rect; falls back to coarser tiles
export function drawGround(ctx, season, scalePx, view) {
  const z = chooseZoomLevel(scalePx);
  const ps = 1 / Math.pow(2, z);
  const span = TILE * ps;
  const tx0 = Math.floor(Math.max(0, view.x0) / span), tx1 = Math.floor(Math.min(S.WORLD_W - 1, view.x1) / span);
  const ty0 = Math.floor(Math.max(0, view.y0) / span), ty1 = Math.floor(Math.min(S.WORLD_H - 1, view.y1) / span);
  clearQueue();
  let missing = 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = getTile(season, z, tx, ty, true);
    if (t) { ctx.drawImage(t, tx * span, ty * span, span + ps * 0.5, span + ps * 0.5); continue; }
    missing++;
    // fallback: any coarser tile that covers this one
    let drawn = false;
    for (let zz = z - 1; zz >= -2 && !drawn; zz--) {
      const pss = 1 / Math.pow(2, zz), sp2 = TILE * pss;
      const ftx = Math.floor(tx * span / sp2), fty = Math.floor(ty * span / sp2);
      const ft = getTile(season, zz, ftx, fty, zz === -2);
      if (ft) {
        const sx = (tx * span - ftx * sp2) / pss, sy = (ty * span - fty * sp2) / pss, sw = span / pss;
        ctx.drawImage(ft, sx, sy, sw, sw, tx * span, ty * span, span, span);
        drawn = true;
      }
    }
    // fallback for other seasons (during a season change)
    if (!drawn) {
      for (let s2 = 0; s2 < 4 && !drawn; s2++) {
        const t2 = getTile(s2, z, tx, ty, false);
        if (t2) { ctx.drawImage(t2, tx * span, ty * span, span, span); drawn = true; }
      }
    }
    if (!drawn) { ctx.fillStyle = '#5aa6e0'; ctx.fillRect(tx * span, ty * span, span, span); }
  }
  return missing;
}

// pre-render the coarsest level so there is always something to show
export function warmup(season) {
  const ps = 4, span = TILE * ps;
  for (let ty = 0; ty * span < S.WORLD_H; ty++) for (let tx = 0; tx * span < S.WORLD_W; tx++) {
    const k = key(season, -2, tx, ty);
    if (!cache.has(k)) cache.set(k, renderTile(season, -2, tx, ty));
  }
}
