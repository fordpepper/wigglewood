// Hand-drawn style sprites: flat colours, thick ink outlines, googly eyes.
// Everything is drawn in world units with the feet/base at (0, 0).
import * as S from '../sim/core.js';

export const INK = '#141414';
const TAU = Math.PI * 2;

export function hsl(h, s, l) { return `hsl(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%)`; }

export function dumplingColors(g) {
  const h = g[S.G_HUE];
  const l = 64 + g[S.G_LIGHT] * 40;
  return {
    body: hsl(h, 78, l),
    dark: hsl(h, 60, l - 16),
    light: hsl(h, 85, Math.min(92, l + 16)),
  };
}
export function grumbleColors(g) {
  const h = g[S.G_HUE];
  const l = 44 + g[S.G_LIGHT] * 40;
  return {
    body: hsl(h, 46, l),
    dark: hsl(h, 42, l - 14),
    light: hsl(h, 40, Math.min(85, l + 22)),
  };
}

function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, TAU); }

export function shadow(ctx, r) {
  ctx.fillStyle = 'rgba(20,30,20,0.18)';
  ellipse(ctx, 0, 0, r * 1.05, r * 0.36);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// eyes

function eye(ctx, x, y, r, lookX, lookY, mood, lw) {
  // mood: 'open' | 'wide' | 'closed' | 'grumpy' | 'happy' | 'dizzy' | 'dead'
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  if (mood === 'closed' || mood === 'happy') {
    ctx.beginPath();
    if (mood === 'closed') ctx.arc(x, y - r * 0.1, r * 0.7, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.arc(x, y + r * 0.35, r * 0.7, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, x, y, r, r * 1.06);
  ctx.fill(); ctx.stroke();
  if (mood === 'dizzy' || mood === 'dead') {
    ctx.lineWidth = lw * 1.1;
    const s = r * 0.45;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();
    return;
  }
  const pr = mood === 'wide' ? r * 0.36 : r * 0.5;
  const reach = r - pr - lw * 0.4;
  ctx.fillStyle = INK;
  ellipse(ctx, x + lookX * reach, y + lookY * reach, pr, pr * 1.08);
  ctx.fill();
  // tiny highlight
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, x + lookX * reach - pr * 0.35, y + lookY * reach - pr * 0.4, pr * 0.28, pr * 0.28);
  ctx.fill();
  if (mood === 'grumpy') {
    // heavy lid across the top of the eye, flat and a little tilted
    ctx.save();
    ellipse(ctx, x, y, r, r * 1.06); ctx.clip();
    ctx.fillStyle = ctx.__lid || '#555';
    ctx.fillRect(x - r * 1.2, y - r * 1.3, r * 2.4, r * 0.95);
    ctx.restore();
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x - r * 1.05, y - r * 0.32); ctx.lineTo(x + r * 1.05, y - r * 0.4); ctx.stroke();
    ellipse(ctx, x, y, r, r * 1.06); ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// dumpling: a soft gumdrop with big eyes, tiny feet and something on its head

export function drawDumpling(ctx, c, o) {
  // o: { t (seconds), walk (0..1 phase), moving, facing (+1/-1), lookX, lookY, mood, alpha }
  const g = c.g;
  const r = S.SPECIES[0].radius * g[S.G_SIZE] * (o.growth ?? 1);
  const col = dumplingColors(g);
  const lw = Math.max(1.6, r * 0.15);
  const bob = o.moving ? Math.abs(Math.sin(o.walk * Math.PI)) * r * 0.16 : Math.sin(o.t * 2.2 + c.id) * r * 0.025;
  const squash = o.moving ? 1 + Math.sin(o.walk * TAU) * 0.04 : 1 + Math.sin(o.t * 2.2 + c.id) * 0.03;
  const w = r * 1.0 * (2 - squash), h = r * 1.22 * squash;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  shadow(ctx, r);
  ctx.scale(o.facing, 1);

  // feet
  const step = o.moving ? Math.sin(o.walk * TAU) : 0;
  ctx.fillStyle = col.dark; ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.85;
  for (const s of [-1, 1]) {
    const lift = o.moving ? Math.max(0, step * s) * r * 0.22 : 0;
    ellipse(ctx, s * r * 0.48 + step * s * r * 0.08, -r * 0.08 - lift, r * 0.3, r * 0.17);
    ctx.fill(); ctx.stroke();
  }

  ctx.translate(0, -r * 0.2 - bob);
  // head accessory behind the body outline
  topAccessory(ctx, g[S.G_TOP], r, h, lw, col, o.t + c.id);

  // body
  ctx.beginPath();
  ctx.moveTo(-w, -h * 0.25);
  ctx.bezierCurveTo(-w * 1.02, -h * 1.45, w * 1.02, -h * 1.45, w, -h * 0.25);
  ctx.bezierCurveTo(w * 1.05, h * 0.22, w * 0.5, h * 0.3, 0, h * 0.3);
  ctx.bezierCurveTo(-w * 0.5, h * 0.3, -w * 1.05, h * 0.22, -w, -h * 0.25);
  ctx.closePath();
  ctx.fillStyle = col.body;
  ctx.fill();
  // pattern, clipped to the body
  if (g[S.G_PAT]) {
    ctx.save();
    ctx.clip();
    patternFill(ctx, g[S.G_PAT], w, h, col, c.id);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-w, -h * 0.25);
    ctx.bezierCurveTo(-w * 1.02, -h * 1.45, w * 1.02, -h * 1.45, w, -h * 0.25);
    ctx.bezierCurveTo(w * 1.05, h * 0.22, w * 0.5, h * 0.3, 0, h * 0.3);
    ctx.bezierCurveTo(-w * 0.5, h * 0.3, -w * 1.05, h * 0.22, -w, -h * 0.25);
    ctx.closePath();
  }
  ctx.strokeStyle = INK; ctx.lineWidth = lw;
  ctx.stroke();

  // cheeks
  ctx.fillStyle = 'rgba(255,120,140,0.45)';
  ellipse(ctx, w * 0.62, -h * 0.28, r * 0.17, r * 0.1); ctx.fill();
  ellipse(ctx, -w * 0.22, -h * 0.28, r * 0.15, r * 0.09); ctx.fill();

  // eyes: big, set to the facing side for a 3/4 look
  const er = r * 0.36 * g[S.G_EYE];
  const blink = o.mood === 'open' && ((o.t * 0.7 + c.id * 0.37) % 4.2) < 0.13;
  const mood = blink ? 'closed' : o.mood;
  eye(ctx, w * 0.02, -h * 0.72, er, o.lookX * o.facing, o.lookY, mood, lw * 0.9);
  eye(ctx, w * 0.62, -h * 0.68, er * 0.92, o.lookX * o.facing, o.lookY, mood, lw * 0.9);

  // mouth
  ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  if (o.mouth === 'chew') {
    const open = (Math.sin(o.t * 14) + 1) * 0.5;
    ctx.fillStyle = '#7a2230';
    ellipse(ctx, w * 0.33, -h * 0.24, r * 0.13, r * (0.04 + 0.08 * open));
    ctx.fill(); ctx.stroke();
  } else if (o.mouth === 'scream') {
    ctx.fillStyle = '#7a2230';
    ellipse(ctx, w * 0.33, -h * 0.22, r * 0.12, r * 0.15);
    ctx.fill(); ctx.stroke();
  } else if (o.mouth === 'o') {
    ellipse(ctx, w * 0.33, -h * 0.25, r * 0.07, r * 0.07); ctx.stroke();
  } else {
    ctx.arc(w * 0.33, -h * 0.34, r * 0.13, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

function patternFill(ctx, pat, w, h, col, seed) {
  if (pat === 1) { // spots
    ctx.fillStyle = col.dark;
    const spots = [[-0.55, -0.95, 0.2], [-0.2, -0.2, 0.16], [0.75, -1.05, 0.13], [-0.75, -0.35, 0.12], [0.35, -0.05, 0.1]];
    for (const [x, y, s] of spots) { ellipse(ctx, x * w, y * h, s * w, s * w * 0.9); ctx.fill(); }
  } else if (pat === 2) { // pale belly
    ctx.fillStyle = col.light;
    ellipse(ctx, w * 0.15, h * 0.05, w * 0.62, h * 0.42); ctx.fill();
  } else if (pat === 3) { // stripes over the top
    ctx.strokeStyle = col.dark; ctx.lineWidth = w * 0.16;
    for (const x of [-0.5, 0, 0.5]) {
      ctx.beginPath(); ctx.moveTo(x * w - w * 0.1, -h * 1.3); ctx.quadraticCurveTo(x * w + w * 0.12, -h * 0.85, x * w - w * 0.02, -h * 0.68); ctx.stroke();
    }
  }
}

function topAccessory(ctx, kind, r, h, lw, col, t) {
  ctx.strokeStyle = INK; ctx.lineWidth = lw;
  const top = -h * 1.08;
  const sway = Math.sin(t * 1.7) * 0.12;
  if (kind === 1) { // leaf sprout
    ctx.beginPath(); ctx.moveTo(0, top + r * 0.1); ctx.quadraticCurveTo(r * 0.05, top - r * 0.3, r * (0.1 + sway), top - r * 0.48); ctx.stroke();
    ctx.fillStyle = '#6cc04a';
    ctx.save(); ctx.translate(r * (0.1 + sway), top - r * 0.48); ctx.rotate(-0.5 + sway);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(r * 0.25, -r * 0.3, r * 0.55, -r * 0.05); ctx.quadraticCurveTo(r * 0.25, r * 0.15, 0, 0);
    ctx.fill(); ctx.stroke(); ctx.restore();
  } else if (kind === 2) { // single bobble antenna
    const tx = r * (0.15 + sway * 1.5), ty = top - r * 0.62;
    ctx.beginPath(); ctx.moveTo(-r * 0.05, top + r * 0.1); ctx.quadraticCurveTo(-r * 0.1, top - r * 0.35, tx, ty); ctx.stroke();
    ctx.fillStyle = col.light;
    ellipse(ctx, tx, ty, r * 0.17, r * 0.17); ctx.fill(); ctx.stroke();
  } else if (kind === 3) { // two round ears
    ctx.fillStyle = col.body;
    for (const s of [-1, 1]) { ellipse(ctx, s * r * 0.55, top + r * 0.28, r * 0.24, r * 0.26); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,140,160,0.6)';
    for (const s of [-1, 1]) { ellipse(ctx, s * r * 0.55, top + r * 0.3, r * 0.11, r * 0.13); ctx.fill(); }
  } else if (kind === 4) { // curly tuft
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, top + r * 0.12);
    ctx.bezierCurveTo(-r * 0.2, top - r * 0.4, r * (0.45 + sway), top - r * 0.45, r * (0.25 + sway), top - r * 0.15);
    ctx.bezierCurveTo(r * (0.1 + sway), top - r * 0.02, r * 0.02, top - r * 0.25, r * (0.18 + sway), top - r * 0.3);
    ctx.stroke();
  } else if (kind === 5) { // little flower
    ctx.beginPath(); ctx.moveTo(0, top + r * 0.1); ctx.lineTo(r * sway, top - r * 0.38); ctx.stroke();
    const fx = r * sway, fy = top - r * 0.48;
    ctx.fillStyle = '#ffffff'; ctx.lineWidth = lw * 0.7;
    for (let p = 0; p < 5; p++) { const a = p * TAU / 5 + t * 0.3; ellipse(ctx, fx + Math.cos(a) * r * 0.15, fy + Math.sin(a) * r * 0.15, r * 0.11, r * 0.11); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#ffcd3c'; ellipse(ctx, fx, fy, r * 0.09, r * 0.09); ctx.fill(); ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// grumble: a hunched, horned lump with heavy-lidded eyes and an underbite

export function drawGrumble(ctx, c, o) {
  const g = c.g;
  const r = S.SPECIES[1].radius * g[S.G_SIZE] * (o.growth ?? 1);
  const col = grumbleColors(g);
  const lw = Math.max(1.8, r * 0.13);
  const stride = o.moving ? Math.sin(o.walk * TAU) : 0;
  const bob = o.moving ? Math.abs(Math.sin(o.walk * Math.PI)) * r * 0.1 : Math.sin(o.t * 1.5 + c.id) * r * 0.02;
  const breathe = 1 + Math.sin(o.t * 1.5 + c.id) * 0.025;
  const w = r * 1.05, h = r * 1.15 * breathe;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  shadow(ctx, r * 1.05);
  ctx.scale(o.facing, 1);

  // stubby legs
  ctx.strokeStyle = INK; ctx.lineWidth = lw * 1.9;
  for (const s of [-1, 1]) {
    const lift = o.moving ? Math.max(0, stride * s) * r * 0.2 : 0;
    ctx.beginPath(); ctx.moveTo(s * r * 0.45, -r * 0.35); ctx.lineTo(s * r * 0.48 + stride * s * r * 0.12, -lift - r * 0.02); ctx.stroke();
  }
  ctx.strokeStyle = col.dark; ctx.lineWidth = lw * 0.8;
  for (const s of [-1, 1]) {
    const lift = o.moving ? Math.max(0, stride * s) * r * 0.2 : 0;
    ctx.beginPath(); ctx.moveTo(s * r * 0.45, -r * 0.35); ctx.lineTo(s * r * 0.48 + stride * s * r * 0.12, -lift - r * 0.02); ctx.stroke();
  }

  ctx.translate(0, -r * 0.3 - bob);
  // horns
  ctx.fillStyle = '#f3ead2'; ctx.strokeStyle = INK; ctx.lineWidth = lw;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * w * 0.25, -h * 1.12);
    ctx.quadraticCurveTo(s * w * 0.42, -h * 1.62, s * w * 0.72, -h * 1.6);
    ctx.quadraticCurveTo(s * w * 0.6, -h * 1.35, s * w * 0.62, -h * 1.02);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // body: wider at the shoulders, hunched
  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(-w * 0.95, -h * 0.1);
    ctx.bezierCurveTo(-w * 1.25, -h * 0.9, -w * 0.7, -h * 1.32, 0, -h * 1.28);
    ctx.bezierCurveTo(w * 0.8, -h * 1.3, w * 1.3, -h * 0.85, w * 0.98, -h * 0.1);
    ctx.bezierCurveTo(w * 0.85, h * 0.2, -w * 0.85, h * 0.2, -w * 0.95, -h * 0.1);
    ctx.closePath();
  };
  bodyPath();
  ctx.fillStyle = col.body; ctx.fill();
  ctx.save(); ctx.clip();
  // belly + a few scruffy tufts
  ctx.fillStyle = col.light;
  ellipse(ctx, w * 0.15, h * 0.02, w * 0.62, h * 0.4); ctx.fill();
  ctx.strokeStyle = col.dark; ctx.lineWidth = lw * 0.8;
  for (const [x, y] of [[-0.6, -0.7], [-0.35, -1.0], [-0.75, -0.35]]) {
    ctx.beginPath(); ctx.moveTo(x * w, y * h); ctx.lineTo(x * w + r * 0.12, y * h + r * 0.1); ctx.lineTo(x * w + r * 0.2, y * h - r * 0.02); ctx.stroke();
  }
  if (g[S.G_PAT] === 1) { ctx.fillStyle = col.dark; for (const [x, y, s] of [[-0.5, -0.95, 0.16], [0.6, -1.0, 0.12], [-0.8, -0.5, 0.1]]) { ellipse(ctx, x * w, y * h, s * w, s * w); ctx.fill(); } }
  if (g[S.G_PAT] === 3) { ctx.strokeStyle = col.dark; ctx.lineWidth = w * 0.13; for (const x of [-0.45, 0.05]) { ctx.beginPath(); ctx.moveTo(x * w, -h * 1.35); ctx.lineTo(x * w + w * 0.08, -h * 0.9); ctx.stroke(); } }
  ctx.restore();
  bodyPath();
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke();

  // eyes
  const er = r * 0.3 * g[S.G_EYE];
  ctx.__lid = col.dark;
  const mood = o.mood;
  eye(ctx, w * 0.05, -h * 0.78, er, o.lookX * o.facing, o.lookY, mood, lw * 0.9);
  eye(ctx, w * 0.62, -h * 0.75, er * 0.9, o.lookX * o.facing, o.lookY, mood, lw * 0.9);
  if (o.angry) {
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 1.2;
    ctx.beginPath(); ctx.moveTo(-w * 0.25, -h * 1.12); ctx.lineTo(w * 0.32, -h * 0.98); ctx.lineTo(w * 0.9, -h * 1.08); ctx.stroke();
  }

  // underbite with two little fangs
  const mo = o.mouth === 'chomp' ? (Math.sin(o.t * 18) + 1) * 0.5 : o.mouth === 'open' ? 0.7 : 0;
  ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.85;
  const mx = w * 0.32, my = -h * 0.36;
  if (mo > 0.05) {
    ctx.fillStyle = '#5b1424';
    ellipse(ctx, mx, my + r * 0.04, r * 0.3, r * (0.06 + 0.16 * mo)); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(mx - r * 0.32, my); ctx.quadraticCurveTo(mx, my + r * 0.1, mx + r * 0.32, my - r * 0.03); ctx.stroke();
  }
  ctx.fillStyle = '#ffffff'; ctx.lineWidth = lw * 0.6;
  for (const s of [-1, 1]) {
    const fx = mx + s * r * 0.17;
    ctx.beginPath(); ctx.moveTo(fx - r * 0.06, my + r * 0.02); ctx.lineTo(fx, my - r * 0.14 - mo * r * 0.05); ctx.lineTo(fx + r * 0.06, my + r * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// scenery

const TREE_COLORS = [
  ['#5dbb55', '#4a9e45'], // spring
  ['#4fae4a', '#3f923c'], // summer
  ['#e8963a', '#cf6f2c'], // autumn
  ['#e9f0f4', '#cbd9e2'], // winter (snow-dusted)
];

// ---- sprite cache: static scenery is drawn once per look and zoom bucket
let renderScale = 1;
export function setRenderScale(sc) {
  renderScale = Math.pow(2, Math.max(-1, Math.min(2, Math.ceil(Math.log2(sc)))));
}
const spriteCache = new Map();
function cached(key, x0, y0, x1, y1, draw) {
  const k = `${key}|${renderScale}`;
  let c = spriteCache.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.ceil((x1 - x0) * renderScale); c.height = Math.ceil((y1 - y0) * renderScale);
    const cx = c.getContext('2d');
    cx.setTransform(renderScale, 0, 0, renderScale, -x0 * renderScale, -y0 * renderScale);
    draw(cx);
    c.box = [x0, y0, x1 - x0, y1 - y0];
    spriteCache.set(k, c);
    if (spriteCache.size > 700) spriteCache.delete(spriteCache.keys().next().value);
  }
  return c;
}
function stamp(ctx, c) { ctx.drawImage(c, c.box[0], c.box[1], c.box[2], c.box[3]); }

export function drawTree(ctx, tr, season, t) {
  const kq = Math.round(tr.k * 5) / 5;
  const c = cached(`tree|${tr.kind}|${kq}|${season}`, -50, -96, 50, 14, cx => drawTreeRaw(cx, tr.kind, kq, season));
  const sway = Math.sin(t * 0.8 + tr.x * 0.01) * 0.02;
  ctx.save();
  ctx.transform(1, 0, sway, 1, 0, 0);
  stamp(ctx, c);
  ctx.restore();
}
export function drawRock(ctx, rk, season) {
  const kq = Math.round(rk.k * 5) / 5;
  stamp(ctx, cached(`rock|${rk.big}|${kq}|${season === 3}`, -36, -50, 36, 10, cx => drawRockRaw(cx, { big: rk.big, k: kq }, season)));
}

function drawTreeRaw(ctx, kind, k, season) {
  const tr = { kind, k };
  const sway = 0;
  const s = 0.72 + tr.k * 0.36;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
  ctx.fillStyle = 'rgba(20,40,20,0.2)';
  ellipse(ctx, 0, 0, 20 * s, 7 * s); ctx.fill();
  if (tr.kind === 1) {
    // pine: stacked wobbly triangles
    ctx.fillStyle = '#8a5a35';
    ctx.beginPath(); ctx.rect(-4 * s, -14 * s, 8 * s, 14 * s); ctx.fill(); ctx.stroke();
    const greens = season === 3 ? ['#3f7f5a', '#356f4e'] : season === 2 ? ['#3c8a52', '#2f7444'] : ['#3d9a5a', '#2f8049'];
    for (let i = 0; i < 3; i++) {
      const by = -12 * s - i * 15 * s, hw = (22 - i * 5) * s, ht = 24 * s;
      ctx.beginPath();
      ctx.moveTo(-hw, by);
      ctx.quadraticCurveTo(0, by + 5 * s, hw, by);
      ctx.lineTo(sway * (i + 1) * 0.5, by - ht);
      ctx.closePath();
      ctx.fillStyle = greens[i % 2]; ctx.fill(); ctx.stroke();
      if (season === 3) {
        ctx.fillStyle = '#f6fbff';
        ctx.beginPath();
        ctx.moveTo(sway * (i + 1) * 0.5, by - ht);
        ctx.lineTo(-hw * 0.45, by - ht * 0.52);
        ctx.quadraticCurveTo(0, by - ht * 0.38, hw * 0.45, by - ht * 0.52);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  } else {
    // round leafy tree: trunk + union of blobs
    ctx.fillStyle = '#8b5b38';
    ctx.beginPath();
    ctx.moveTo(-5 * s, 0); ctx.lineTo(-4 * s, -26 * s); ctx.lineTo(4 * s, -26 * s); ctx.lineTo(5 * s, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    const [c1, c2] = TREE_COLORS[season];
    const blobs = [[0, -44, 22], [-15, -34, 15], [15, -35, 16], [-6, -58, 14], [9, -55, 13]];
    ctx.lineWidth = 5.2;
    for (const [x, y, r] of blobs) { ellipse(ctx, x * s + sway * (-y / 50), y * s, r * s, r * s * 0.95); ctx.stroke(); }
    ctx.fillStyle = c1;
    for (const [x, y, r] of blobs) { ellipse(ctx, x * s + sway * (-y / 50), y * s, r * s, r * s * 0.95); ctx.fill(); }
    // little squiggle marks like leaves
    ctx.strokeStyle = c2; ctx.lineWidth = 2.2;
    for (const [x, y] of [[-8, -46], [7, -38], [2, -58], [-15, -33]]) {
      const px = x * s + sway * 0.6, py = y * s;
      ctx.beginPath(); ctx.moveTo(px - 4, py - 2); ctx.lineTo(px - 1, py + 2); ctx.lineTo(px + 2, py - 2); ctx.lineTo(px + 5, py + 2); ctx.stroke();
    }
    if (season === 3) {
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, sway * 0.9, -62 * s, 13 * s, 6 * s); ctx.fill();
    }
    if (season === 0 && tr.k > 0.55) {
      ctx.fillStyle = '#ffb3cf'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
      for (const [x, y] of [[-10, -50], [8, -42], [12, -60], [-16, -36]]) { ellipse(ctx, x * s + sway * 0.7, y * s, 3, 3); ctx.fill(); ctx.stroke(); }
    }
  }
  ctx.restore();
}

function drawRockRaw(ctx, rk, season) {
  const s = rk.big ? 1.1 + rk.k * 0.6 : 0.6 + rk.k * 0.4;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(20,30,20,0.18)';
  ellipse(ctx, 0, 0, 15 * s, 5 * s); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14 * s, 0);
  ctx.quadraticCurveTo(-16 * s, -12 * s, -6 * s, -17 * s);
  ctx.quadraticCurveTo(4 * s, -22 * s, 12 * s, -12 * s);
  ctx.quadraticCurveTo(17 * s, -4 * s, 13 * s, 0);
  ctx.closePath();
  ctx.fillStyle = '#a9a7a2'; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ellipse(ctx, -4 * s, -13 * s, 4 * s, 2 * s); ctx.fill();
  if (season === 3) {
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.moveTo(-10 * s, -13 * s); ctx.quadraticCurveTo(-4 * s, -21 * s, 8 * s, -15 * s); ctx.quadraticCurveTo(0, -12 * s, -10 * s, -13 * s);
    ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke();
  }
  ctx.restore();
}

export function drawBush(ctx, b, season, t, shake) {
  ctx.save();
  ctx.lineJoin = 'round';
  const sx = shake ? Math.sin(t * 40) * 1.2 : 0;
  ctx.translate(sx, 0);
  stamp(ctx, cached(`bush|${season}`, -26, -34, 26, 10, cx => {
    cx.lineJoin = 'round';
    cx.fillStyle = 'rgba(20,30,20,0.18)';
    ellipse(cx, 0, 0, 19, 6); cx.fill();
    const leaf = ['#4fb24c', '#47a446', '#8a9a3c', '#6b8a6a'][season];
    const blobs = [[-9, -10, 10], [9, -10, 10], [0, -17, 11]];
    cx.strokeStyle = INK; cx.lineWidth = 5;
    for (const [x, y, r] of blobs) { ellipse(cx, x, y, r, r * 0.92); cx.stroke(); }
    cx.fillStyle = leaf;
    for (const [x, y, r] of blobs) { ellipse(cx, x, y, r, r * 0.92); cx.fill(); }
    if (season === 3) {
      cx.fillStyle = '#f5fafd';
      ellipse(cx, 0, -25, 9, 4); cx.fill();
    }
  }));
  ctx.strokeStyle = INK;
  // berries
  const spots = [[-9, -12], [7, -8], [1, -20], [-3, -6], [11, -16], [-12, -18]];
  ctx.lineWidth = 1.6;
  for (let i = 0; i < b.b && i < spots.length; i++) {
    ctx.fillStyle = season === 2 ? '#7c3bd1' : '#e8344e';
    ellipse(ctx, spots[i][0], spots[i][1], 3.6, 3.6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ellipse(ctx, spots[i][0] - 1.1, spots[i][1] - 1.2, 1, 1); ctx.fill();
  }
  ctx.restore();
}

export function drawMushroom(ctx, m, t, glow) {
  ctx.save();
  ctx.lineJoin = 'round';
  if (glow > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(0, -8, 1, 0, -8, 26);
    gr.addColorStop(0, `rgba(190,140,255,${0.45 * glow})`); gr.addColorStop(1, 'rgba(190,140,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(-26, -34, 52, 52);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  for (const [x, s] of [[0, 1], [9, 0.7]]) {
    ctx.fillStyle = '#f4ecdf';
    ctx.beginPath(); ctx.rect(x - 2.5 * s, -9 * s, 5 * s, 9 * s); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#a77be8';
    ctx.beginPath(); ctx.moveTo(x - 9 * s, -8 * s); ctx.quadraticCurveTo(x, -22 * s, x + 9 * s, -8 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, x - 3 * s, -12 * s, 1.6 * s, 1.6 * s); ctx.fill();
    ellipse(ctx, x + 3 * s, -14 * s, 1.3 * s, 1.3 * s); ctx.fill();
  }
  ctx.restore();
}

export function drawReeds(ctx, r, t) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 5, sway = Math.sin(t * 1.3 + r.x * 0.05 + i) * 2;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x, -10, x + sway, -20 - i * 3); ctx.stroke();
    ctx.fillStyle = '#8a5a35';
    ellipse(ctx, x + sway, -21 - i * 3, 2.2, 4.5); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

export function drawGrave(ctx, gv, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(20,30,20,0.18)';
  ellipse(ctx, 0, 0, 10, 3.5); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-7, 0); ctx.lineTo(-7, -11);
  ctx.quadraticCurveTo(-7, -19, 0, -19); ctx.quadraticCurveTo(7, -19, 7, -11);
  ctx.lineTo(7, 0); ctx.closePath();
  ctx.fillStyle = '#b9bcc2'; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.moveTo(0, -14); ctx.lineTo(0, -5); ctx.stroke();
  // a tiny dot in the creature's colour so you can tell whose it was
  ctx.fillStyle = gv.s === 0 ? hsl(gv.h, 78, 64) : hsl(gv.h, 46, 44);
  ellipse(ctx, 0, -3, 2, 1.6); ctx.fill();
  ctx.restore();
}

export function drawGhost(ctx, k, s) {
  // k: 0..1 progress
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
  ctx.translate(Math.sin(k * 9) * 4, -k * 46);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-8, -10); ctx.quadraticCurveTo(-8, -20, 0, -20); ctx.quadraticCurveTo(8, -20, 8, -10);
  ctx.lineTo(8, 0); ctx.lineTo(5, -3); ctx.lineTo(2, 0); ctx.lineTo(-1, -3); ctx.lineTo(-4, 0); ctx.lineTo(-6, -3); ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = INK;
  ellipse(ctx, -3, -12, 1.4, 2); ctx.fill(); ellipse(ctx, 3, -12, 1.4, 2); ctx.fill();
  ctx.restore();
}

export function heart(ctx, x, y, s, fill) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-7, -2, -5, -9, 0, -5);
  ctx.bezierCurveTo(5, -9, 7, -2, 0, 3);
  ctx.closePath();
  ctx.fillStyle = fill || '#ff5a7a'; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5 / s * 1.2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}
