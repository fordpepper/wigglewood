// Pixel art sprites: creatures, scenery and little effects. Everything is
// built procedurally from the shapes in pixel.js and cached, then stamped onto
// the low-resolution art buffer with its anchor (the feet) at a whole pixel.
// `u` is art pixels per world unit, so sprites shrink with the zoom level.
import * as S from '../sim/core.js';
import { Pix, Cache, INK, WHITE, rgb, hex, hsl, shade, css, stamp } from './pixel.js';

export { INK };
const sprites = new Cache(2600);

// ---------------------------------------------------------------------------
// colours

export function creatureColors(s, g) {
  const h = g[S.G_HUE];
  if (s === 0) {
    const l = 64 + g[S.G_LIGHT] * 40;
    return { body: hsl(h, 78, l), dark: hsl(h, 62, l - 17), light: hsl(h, 90, Math.min(92, l + 15)), lid: hsl(h, 55, l - 25) };
  }
  const l = 44 + g[S.G_LIGHT] * 40;
  return { body: hsl(h, 46, l), dark: hsl(h, 44, l - 14), light: hsl(h, 40, Math.min(85, l + 22)), lid: hsl(h, 44, l - 16) };
}
export function bodyCss(s, g) { return css(creatureColors(s, g).body); }

const PINK = rgb(255, 128, 150), MOUTH = rgb(122, 34, 48), CREAM = hex('#f3ead2'), LEAF = hex('#6cc04a');
const YELLOW = hex('#ffd23f'), BERRY = hex('#e8344e'), PLUM = hex('#7c3bd1');

// ---------------------------------------------------------------------------
// creatures
//
// frames: 0 = standing, 1 = breathing in, 2..5 = walk cycle

export function creatureR(c, u) { return S.radius(c) * u; }

function bodyBox(R) { const w = Math.ceil(R * 3.2) + 6, h = Math.ceil(R * 3.6) + 8; return [w, h, Math.floor(w / 2), h - 2]; }

function buildDumpling(c, R, frame) {
  const g = c.g, col = creatureColors(0, g);
  const [w, h, ax, ay] = bodyBox(R);
  const p = new Pix(w, h, ax, ay);
  const walking = frame >= 2, step = frame - 2;
  const bob = 0; // bodies stay put while the feet step: steadier, less jittery
  const squash = frame === 1 ? 1 : 0;
  const footH = Math.max(1, Math.round(R * 0.22));
  // feet (one lifts while walking)
  if (R >= 2.5) {
    for (const sd of [-1, 1]) {
      const lift = walking && ((step === 1 && sd < 0) || (step === 3 && sd > 0)) ? 1 : 0;
      p.ellipse(sd * R * 0.5, -footH * 0.5 - lift, Math.max(1, R * 0.3), Math.max(0.8, footH * 0.6), col.dark);
    }
  }
  const rx = R * (1 + squash * 0.05), rTop = R * 1.32 - squash, rBot = R * 0.42;
  const yc = -footH - rBot + 0.6 - bob;
  const top = yc - rTop;
  // ears sit behind the body
  if (g[S.G_TOP] === 3 && R >= 3) for (const sd of [-1, 1]) p.ellipse(sd * R * 0.58, top + R * 0.3, R * 0.28, R * 0.3, col.body);
  const inBody = (x, y) => { const dy = y - yc; return (x / rx) ** 2 + (dy / (dy < 0 ? rTop : rBot)) ** 2 <= 1; };
  p.fill(-rx - 1, top - 1, rx + 1, yc + rBot + 1, inBody, col.body);
  // pattern
  const pat = g[S.G_PAT];
  const onBody = (x, y) => inBody(x + 0.5, y + 0.5);
  if (pat === 1 && R >= 3) {
    for (const [sx, sy, sr] of [[-0.5, -0.75, 0.24], [0.1, -0.15, 0.17], [0.7, -0.95, 0.15], [-0.75, -0.2, 0.14]]) {
      p.paint((x, y) => onBody(x, y) && ((x + 0.5 - sx * R) ** 2 + (y + 0.5 - (yc + sy * rTop)) ** 2) <= (sr * R + 0.4) ** 2, col.dark, col.body);
    }
  } else if (pat === 2) {
    p.paint((x, y) => onBody(x, y) && ((x + 0.5 - R * 0.15) / (R * 0.62)) ** 2 + ((y + 0.5 - yc - rBot * 0.2) / (R * 0.55)) ** 2 <= 1, col.light, col.body);
  } else if (pat === 3 && R >= 3) {
    for (const sx of [-0.5, 0, 0.5]) p.paint((x, y) => onBody(x, y) && Math.abs(x + 0.5 - sx * R) < Math.max(0.5, R * 0.1) && y + 0.5 < yc - rTop * 0.45, col.dark, col.body);
  }
  // shading: dark along the bottom and back, a highlight on the top
  if (R >= 2.5) {
    p.rim(0, 1, col.dark, col.body);
    p.rim(-1, 0, col.dark, col.body);
    p.paint((x, y) => {
      const hx = x + 0.5 + R * 0.38, hy = y + 0.5 - (top + rTop * 0.32);
      return hx * hx / (R * 0.24 + 0.3) ** 2 + hy * hy / (R * 0.16 + 0.3) ** 2 <= 1;
    }, col.light, col.body);
  }
  accessory(p, g[S.G_TOP], R, top, col);
  p.outline();
  return { p, yc, rTop, rBot, top, R };
}

function accessory(p, kind, R, top, col) {
  if (R < 3) return;
  if (kind === 1) { // leaf sprout
    p.line(0, top - 1, 0, top - R * 0.35, INK);
    p.ellipse(R * 0.3, top - R * 0.5, R * 0.3, R * 0.17, LEAF);
  } else if (kind === 2) { // bobble antenna
    p.line(0, top - 1, R * 0.15, top - R * 0.5, INK);
    p.ellipse(R * 0.18, top - R * 0.7, R * 0.19 + 0.3, R * 0.19 + 0.3, col.light);
  } else if (kind === 4) { // curly tuft
    const x0 = Math.round(R * 0.05), y0 = Math.round(top);
    for (const [dx, dy] of [[0, -1], [0, -2], [1, -3], [2, -3], [3, -2], [2, -1]]) p.set(x0 + dx, y0 + dy, INK, true);
  } else if (kind === 5) { // little flower
    p.line(0, top - 1, 0, top - R * 0.32, INK);
    const fy = Math.round(top - R * 0.5) - 1;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) p.set(dx, fy + dy, WHITE);
    p.set(0, fy, YELLOW);
  }
}

function buildGrumble(c, R, frame) {
  const g = c.g, col = creatureColors(1, g);
  const [w, h, ax, ay] = bodyBox(R * 1.05);
  const p = new Pix(w, h, ax, ay);
  const walking = frame >= 2, step = frame - 2;
  const bob = 0; // bodies stay put while the feet step: steadier, less jittery
  const legH = Math.max(1, Math.round(R * 0.3));
  if (R >= 2.5) {
    for (const sd of [-1, 1]) {
      const lift = walking && ((step === 1 && sd < 0) || (step === 3 && sd > 0)) ? 1 : 0;
      const lw = Math.max(1, Math.round(R * 0.32));
      p.rect(Math.round(sd * R * 0.5 - lw / 2), -legH - lift + 1, lw, legH, col.dark);
    }
  }
  const breathe = frame === 1 ? 1 : 0;
  const rx = R * 1.05, ryT = R * 1.0 - breathe * 0.5, ryB = R * 0.38;
  const yc = -legH - ryB + 0.8 - bob;
  // hunched: a round body with a big shoulder hump behind the head
  const inBody = (x, y) => {
    const dy = y - yc;
    if ((x / rx) ** 2 + (dy / (dy < 0 ? ryT : ryB)) ** 2 <= 1) return true;
    const hx = x + R * 0.25, hy = y - (yc - R * 0.42);
    return (hx / (R * 0.78)) ** 2 + (hy / (R * 0.78)) ** 2 <= 1;
  };
  const top = yc - R * 1.2;
  // horns
  if (R >= 3) {
    for (const sd of [-1, 1]) {
      const bx = sd * R * 0.12 + R * 0.05;
      p.poly([[bx + sd * R * 0.15, top + R * 0.45], [bx + sd * R * 0.42, top - R * 0.3], [bx + sd * R * 0.78, top - R * 0.32], [bx + sd * R * 0.58, top + R * 0.5]], CREAM);
    }
  }
  p.fill(-rx - R, top - 1, rx + 1, yc + ryB + 1, inBody, col.body);
  const onBody = (x, y) => inBody(x + 0.5, y + 0.5);
  // pale belly
  p.paint((x, y) => onBody(x, y) && ((x + 0.5 - R * 0.2) / (R * 0.62)) ** 2 + ((y + 0.5 - yc - ryB * 0.3) / (R * 0.5)) ** 2 <= 1, col.light, col.body);
  if (g[S.G_PAT] === 1 && R >= 3) {
    for (const [sx, sy, sr] of [[-0.55, -0.95, 0.18], [0.45, -0.85, 0.13], [-0.85, -0.45, 0.12]]) {
      p.paint((x, y) => ((x + 0.5 - sx * R) ** 2 + (y + 0.5 - (yc + sy * R)) ** 2) <= (sr * R + 0.4) ** 2, col.dark, col.body);
    }
  } else if (g[S.G_PAT] === 3 && R >= 3) {
    for (const sx of [-0.5, 0]) p.paint((x, y) => Math.abs(x + 0.5 - sx * R) < Math.max(0.5, R * 0.09) && y + 0.5 < yc - R * 0.55, col.dark, col.body);
  }
  if (R >= 2.5) {
    p.rim(0, 1, col.dark, col.body);
    p.rim(-1, 0, col.dark, col.body);
    // scruffy tufts on the back
    if (R >= 5) for (const [sx, sy] of [[-0.75, -0.75], [-0.45, -1.05]]) {
      const x = Math.round(sx * R), y = Math.round(yc + sy * R);
      if (p.get(x, y) === col.body) { p.set(x, y, col.dark); p.set(x + 1, y + 1, col.dark); p.set(x + 2, y, col.dark); }
    }
  }
  p.outline();
  return { p, yc, rTop: R * 1.2, rBot: ryB, top, R };
}

function bodySprite(c, u, frame, facing) {
  const R = Math.max(1.2, Math.round(creatureR(c, u) * 2) / 2);
  return sprites.get(`c${c.id}|${R}|${frame}|${facing}|${c.g[S.G_HUE]}`, () => {
    const b = c.s === 0 ? buildDumpling(c, R, frame) : buildGrumble(c, R, frame);
    const p = facing < 0 ? b.p.mirror() : b.p;
    const cv = p.canvas();
    cv.meta = b;
    return cv;
  });
}

// pixels helper for the live overlay (eyes, mouth): x is relative to the
// anchor and mirrored for creatures facing left
function dot(ctx, X, Y, f, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(f > 0 ? X + x : X - x - w, Y + y, w, h);
}

const INK_C = css(INK), WHITE_C = '#ffffff', MOUTH_C = css(MOUTH), PINK_C = css(PINK);

function eye(ctx, X, Y, f, x0, y0, E, o, lidColor) {
  const mood = o.mood;
  if (E <= 1) { dot(ctx, X, Y, f, x0, y0, 1, mood === 'closed' || mood === 'happy' ? 1 : 2, INK_C); return; }
  if (mood === 'closed') { dot(ctx, X, Y, f, x0, y0 + Math.floor(E / 2), E, 1, INK_C); return; }
  if (mood === 'dizzy' || mood === 'dead') { // little x eyes
    const n = Math.min(E, 3), xo = x0 + Math.floor((E - n) / 2), yo = y0 + Math.floor((E - n) / 2);
    for (let i = 0; i < n; i++) { dot(ctx, X, Y, f, xo + i, yo + i, 1, 1, INK_C); dot(ctx, X, Y, f, xo + n - 1 - i, yo + i, 1, 1, INK_C); }
    return;
  }
  if (mood === 'happy') {
    const m = y0 + Math.floor(E / 2);
    dot(ctx, X, Y, f, x0, m, 1, 1, INK_C); dot(ctx, X, Y, f, x0 + E - 1, m, 1, 1, INK_C);
    if (E >= 3) dot(ctx, X, Y, f, x0 + 1, m - 1, E - 2, 1, INK_C);
    return;
  }
  // ink frame with the corners knocked off, white inside
  dot(ctx, X, Y, f, x0, y0 - 1, E, 1, INK_C); dot(ctx, X, Y, f, x0, y0 + E, E, 1, INK_C);
  dot(ctx, X, Y, f, x0 - 1, y0, 1, E, INK_C); dot(ctx, X, Y, f, x0 + E, y0, 1, E, INK_C);
  dot(ctx, X, Y, f, x0, y0, E, E, WHITE_C);
  const P = mood === 'wide' || E < 4 ? 1 : 2;
  const lx = Math.max(-1, Math.min(1, o.lookX)), ly = Math.max(-1, Math.min(1, o.lookY));
  const px = x0 + Math.round((E - P) * (0.5 + 0.35 * lx)), py = y0 + Math.round((E - P) * (0.5 + 0.35 * ly));
  dot(ctx, X, Y, f, px, py, P, P, INK_C);
  if (lidColor) { // heavy grumble lids
    const lh = Math.max(1, Math.floor(E / 2));
    dot(ctx, X, Y, f, x0, y0, E, lh, lidColor);
    if (E >= 3) dot(ctx, X, Y, f, x0, y0 + lh, E, 1, INK_C);
  }
}

// o: { frame, facing, mood, mouth, lookX, lookY, t, angry, blink }
export function drawCreature(ctx, c, X, Y, o, u) {
  const cv = bodySprite(c, u, o.frame, o.facing);
  const b = cv.meta, R = b.R, f = o.facing;
  ctx.drawImage(cv, X - cv.ax, Y - cv.ay);
  if (R < 2) return;
  const D = c.s === 0;
  const col = creatureColors(c.s, c.g);
  const E = Math.max(1, Math.min(5, Math.round(R * (D ? 0.5 : 0.4) * c.g[S.G_EYE])));
  const ey = Math.round(b.yc - (D ? b.rTop * 0.45 : R * 0.55) - E / 2);
  const ex2 = Math.round(R * (D ? 0.55 : 0.62) - E / 2);
  const ex1 = ex2 - E - 1;
  const mood = o.blink && o.mood === 'open' ? 'closed' : o.mood;
  const oo = { mood, lookX: o.lookX, lookY: o.lookY };
  const lid = !D && mood === 'grumpy' ? css(col.lid) : null;
  if (!D && mood === 'grumpy') oo.mood = 'open';
  eye(ctx, X, Y, f, ex1, ey, E, oo, lid);
  eye(ctx, X, Y, f, ex2, ey, E, oo, lid);
  if (o.angry && E >= 2) { // brows
    dot(ctx, X, Y, f, ex1 - 1, ey - 3, 2, 1, INK_C); dot(ctx, X, Y, f, ex1 + 1, ey - 2, E, 1, INK_C);
    dot(ctx, X, Y, f, ex2, ey - 2, E, 1, INK_C); dot(ctx, X, Y, f, ex2 + E - 1, ey - 3, 2, 1, INK_C);
  }
  const my = ey + E + 2, mx = Math.round(R * (D ? 0.3 : 0.25));
  if (D) {
    if (R >= 4 && mood !== 'closed') { dot(ctx, X, Y, f, ex1 - 1, my - 1, 1, 1, PINK_C); dot(ctx, X, Y, f, ex2 + E, my - 1, 1, 1, PINK_C); }
    const chewOpen = o.mouth === 'chew' && Math.floor(o.t * 6) % 2 === 0;
    if (o.mouth === 'scream' || chewOpen) {
      dot(ctx, X, Y, f, mx - 1, my - 1, 4, o.mouth === 'scream' ? 4 : 3, INK_C);
      dot(ctx, X, Y, f, mx, my, 2, o.mouth === 'scream' ? 2 : 1, MOUTH_C);
    } else if (o.mouth === 'o') {
      dot(ctx, X, Y, f, mx, my, 2, 2, INK_C);
    } else if (R >= 4) {
      dot(ctx, X, Y, f, mx - 1, my, 1, 1, INK_C); dot(ctx, X, Y, f, mx, my + 1, 2, 1, INK_C); dot(ctx, X, Y, f, mx + 2, my, 1, 1, INK_C);
    } else dot(ctx, X, Y, f, mx, my, 2, 1, INK_C);
  } else {
    // underbite with two little fangs pointing up
    const open = o.mouth === 'open' || (o.mouth === 'chomp' && Math.floor(o.t * 8) % 2 === 0);
    const mw = Math.max(3, Math.round(R * 0.7)), x0 = mx - Math.floor(mw / 2);
    if (open) {
      dot(ctx, X, Y, f, x0 - 1, my - 1, mw + 2, 4, INK_C);
      dot(ctx, X, Y, f, x0, my, mw, 2, MOUTH_C);
      dot(ctx, X, Y, f, x0, my + 1, 1, 1, WHITE_C); dot(ctx, X, Y, f, x0 + mw - 1, my + 1, 1, 1, WHITE_C);
    } else {
      dot(ctx, X, Y, f, x0, my + 1, mw, 1, INK_C);
      if (R >= 4) { dot(ctx, X, Y, f, x0, my, 1, 1, WHITE_C); dot(ctx, X, Y, f, x0 + mw - 1, my, 1, 1, WHITE_C); }
    }
  }
}

export function headTop(c, u) { // pixels above the anchor where the head ends
  return Math.round(-creatureR(c, u) * (c.s === 0 ? 2.1 : 2.6)) - 1;
}

const shadowCv = new Cache(64);
export function drawShadow(ctx, X, Y, rx) {
  rx = Math.max(1, Math.round(rx));
  const cv = shadowCv.get(rx, () => {
    const ry = Math.max(1, Math.round(rx * 0.36));
    const p = new Pix(rx * 2 + 2, ry * 2 + 2, rx + 1, ry + 1);
    p.ellipse(0, 0, rx, ry, rgb(20, 30, 40, 60));
    return p.canvas();
  });
  stamp(ctx, cv, X, Y);
}

// ---------------------------------------------------------------------------
// scenery

const TREE_COLORS = [
  [hex('#5dbb55'), hex('#3f9a45'), hex('#9ae07a')], // spring
  [hex('#4fae4a'), hex('#36873b'), hex('#86d46a')], // summer
  [hex('#e8963a'), hex('#c0622a'), hex('#ffc563')], // autumn
  [hex('#eef4f8'), hex('#b9cad8'), hex('#ffffff')], // winter
];
const BARK = hex('#8b5b38'), BARK_D = hex('#6a4129');

function shaded(p, base, dark, light) {
  p.rim(0, 1, dark, base); p.rim(1, 0, dark, base);
  p.rim(0, -1, light, base);
}

export function tree(tr, season, u) {
  const kq = Math.round(tr.k * 4) / 4;
  return sprites.get(`tree|${tr.kind}|${kq}|${season}|${u}`, () => {
    const s = (0.72 + kq * 0.36) * u;
    const W = Math.ceil(54 * s) * 2 + 4, H = Math.ceil(100 * s) + 6;
    const p = new Pix(W, H, W / 2, H - 3);
    if (tr.kind >= 2) {
      exoticTree(p, tr.kind, kq, season, s);
    } else if (tr.kind === 1) {
      p.rect(Math.round(-3.5 * s), Math.round(-14 * s), Math.max(1, Math.round(7 * s)), Math.round(14 * s) + 1, BARK);
      const greens = season === 3 ? [hex('#3f7f5a'), hex('#2d6446'), hex('#5e9c78')] : season === 2 ? [hex('#3c8a52'), hex('#2a6a3d'), hex('#5aa86c')] : [hex('#3d9a5a'), hex('#2b7a44'), hex('#5dbb76')];
      for (let i = 0; i < 3; i++) {
        const by = (-12 - i * 15) * s, hw = (22 - i * 5) * s, ht = 24 * s;
        p.poly([[-hw, by], [hw, by], [0, by - ht]], greens[0]);
        if (season === 3) p.poly([[0, by - ht], [-hw * 0.45, by - ht * 0.5], [hw * 0.45, by - ht * 0.5]], WHITE);
      }
      shaded(p, greens[0], greens[1], greens[2]);
    } else {
      p.poly([[-5 * s, 1], [-4 * s, -26 * s], [4 * s, -26 * s], [5 * s, 1]], BARK);
      p.rim(1, 0, BARK_D, BARK);
      const [c1, c2, c3] = TREE_COLORS[season];
      const blobs = [[0, -44, 22], [-15, -34, 15], [15, -35, 16], [-6, -58, 14], [9, -55, 13]];
      for (const [x, y, r] of blobs) p.ellipse(x * s, y * s, r * s, r * s * 0.95, c1);
      shaded(p, c1, c2, c3);
      // a few leafy flecks
      for (const [x, y] of [[-8, -46], [7, -38], [2, -58], [-15, -33], [12, -50]]) {
        const X = Math.round(x * s), Y = Math.round(y * s);
        if (p.get(X, Y) === c1 && p.get(X + 1, Y + 1) === c1) { p.set(X, Y, c2); p.set(X + 1, Y + 1, c2); }
      }
      if (season === 0 && kq > 0.5) for (const [x, y] of [[-10, -50], [8, -42], [12, -60], [-16, -36], [0, -64]]) {
        const X = Math.round(x * s), Y = Math.round(y * s);
        if (p.solid(X, Y)) p.set(X, Y, hex('#ffb3cf'));
      }
    }
    p.outline();
    return p.canvas();
  });
}

// the jungle, the tropics, the savanna, the desert and the bogs each get their own trees
function exoticTree(p, kind, kq, season, s) {
  const r = (x, y, w, h, c) => p.rect(Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), c);
  if (kind === 2) { // jungle giant: thick trunk, broad dark canopy, hanging vines
    p.poly([[-7 * s, 1], [-5 * s, -34 * s], [5 * s, -34 * s], [7 * s, 1]], BARK);
    p.rim(1, 0, BARK_D, BARK);
    const c1 = hex('#2f8f3e'), c2 = hex('#1f6a2e'), c3 = hex('#56b456');
    for (const [x, y, rx, ry] of [[0, -52, 30, 18], [-20, -44, 16, 12], [20, -45, 17, 12], [-8, -64, 17, 12], [11, -62, 16, 11]]) p.ellipse(x * s, y * s, rx * s, ry * s, c1);
    shaded(p, c1, c2, c3);
    const vine = hex('#226b2b');
    for (const x of [-22, -9, 6, 21]) for (let y = -40; y < -26 + (x & 3) * 3; y++) if (p.solid(Math.round(x * s), Math.round((y - 4) * s))) p.set(Math.round(x * s), Math.round(y * s), vine);
  } else if (kind === 3) { // palm: a leaning ringed trunk and drooping fronds
    const lean = kq > 0.5 ? 1 : -1;
    for (let i = 0; i < 12; i++) {
      const y = -i * 4.6, x = lean * (i * i) * 0.09;
      r(x - 2.5, y - 5, 5, 5, i % 2 ? BARK : hex('#a87850'));
    }
    const tx = lean * 13, ty = -55;
    const c1 = hex('#3f9e45'), c2 = hex('#2c7a35'), c3 = hex('#69c25c');
    for (const [dx, dy] of [[-26, 10], [26, 10], [-18, -10], [18, -11], [-30, 0], [30, -1], [0, -14]]) {
      p.poly([[tx * s, (ty - 3) * s], [(tx + dx) * s, (ty + dy) * s], [(tx + dx * 0.55) * s, (ty + dy * 0.4 + 5) * s], [tx * s, (ty + 3) * s]], c1);
    }
    shaded(p, c1, c2, c3);
    if (s >= 0.3) for (const dx of [-2, 2]) p.ellipse((tx + dx) * s, (ty + 4) * s, 2.2 * s, 2.2 * s, hex('#7a4b2a'));
  } else if (kind === 4) { // acacia: forked trunk under a flat umbrella
    p.poly([[-3 * s, 1], [-2 * s, -20 * s], [2 * s, -20 * s], [3 * s, 1]], BARK);
    p.poly([[-2 * s, -18 * s], [-14 * s, -34 * s], [-11 * s, -35 * s], [0, -20 * s]], BARK);
    p.poly([[1 * s, -18 * s], [13 * s, -33 * s], [16 * s, -32 * s], [3 * s, -16 * s]], BARK);
    const c1 = season === 1 ? hex('#8fa13e') : season === 3 ? hex('#7f9a4a') : hex('#6f9a3c');
    for (const [x, y, rx, ry] of [[0, -38, 32, 7], [-14, -42, 15, 5], [13, -42, 15, 5]]) p.ellipse(x * s, y * s, rx * s, ry * s, c1);
    shaded(p, c1, shade(c1, 0.72), shade(c1, 1.3));
  } else if (kind === 5) { // cactus: a column with two arms
    const c1 = hex('#4f9a52'), c2 = hex('#357a3d'), c3 = hex('#7cc276');
    p.fill(-6 * s, -42 * s, 6 * s, 0, (x, y) => Math.abs(x) <= 5.5 * s && (y > -36 * s || (x * x + (y + 36 * s) * (y + 36 * s)) <= 30 * s * s), c1);
    const arm = (sd, y0, h) => {
      p.rect(Math.round(sd > 0 ? 5 * s : -13 * s), Math.round(y0 * s), Math.max(1, Math.round(8 * s)), Math.max(1, Math.round(4 * s)), c1);
      p.fill((sd > 0 ? 9 : -13) * s, (y0 - h) * s, (sd > 0 ? 13 : -9) * s, (y0 + 3) * s, (x, y) => (y > (y0 - h + 3) * s || Math.abs(x - sd * 11 * s) * Math.abs(x - sd * 11 * s) + (y - (y0 - h + 3) * s) * (y - (y0 - h + 3) * s) <= 5 * s * s), c1);
    };
    arm(1, -22, 12 + kq * 6); if (kq > 0.3) arm(-1, -16, 10);
    shaded(p, c1, c2, c3);
    if (s >= 0.3) p.paint((x, y) => (x & 1) === 0 && (y & 3) === 1, c2, c1);
    if (season === 0 && s >= 0.3) { p.set(0, Math.round(-42 * s), hex('#ff7bd0')); p.set(1, Math.round(-42 * s), hex('#ffd23f')); }
  } else { // willow: a bent dark trunk and long hanging strands
    p.poly([[-5 * s, 1], [-3 * s, -24 * s], [4 * s, -24 * s], [5 * s, 1]], hex('#6a5040'));
    const c1 = season === 2 ? hex('#a59440') : season === 3 ? hex('#8e9c86') : hex('#6f9a4a');
    p.ellipse(0, -40 * s, 24 * s, 15 * s, c1);
    for (let x = -22; x <= 22; x += 4) {
      const len = 14 + ((x * 7 + 40) % 9);
      p.rect(Math.round(x * s), Math.round(-38 * s), Math.max(1, Math.round(2.4 * s)), Math.round(len * s), c1);
    }
    shaded(p, c1, shade(c1, 0.72), shade(c1, 1.25));
  }
}

const ROCK = hex('#a9a7a2'), ROCK_D = hex('#7f7d79'), ROCK_L = hex('#cfcdc7');
const RED = hex('#c27f62'), RED_D = hex('#9a5c45'), RED_L = hex('#dea084');
// rocks in the desert and savanna are red sandstone
export function rockTint(o) {
  if (o._t === undefined) { const b = S.biomeAt(o.x, o.y); o._t = b === S.BIOME.DESERT || b === S.BIOME.SAVANNA ? 1 : 0; }
  return o._t;
}
export function rock(rk, season, u, tint = 0) {
  const kq = Math.round(rk.k * 4) / 4;
  return sprites.get(`rock|${rk.big}|${kq}|${season === 3}|${u}|${tint}`, () => {
    const s = (rk.big ? 1.1 + kq * 0.6 : 0.6 + kq * 0.4) * u;
    const W = Math.ceil(20 * s) * 2 + 4, H = Math.ceil(24 * s) + 5;
    const p = new Pix(W, H, W / 2, H - 2);
    const [c1, c2, c3] = tint ? [RED, RED_D, RED_L] : [ROCK, ROCK_D, ROCK_L];
    p.fill(-16 * s, -22 * s, 16 * s, 0, (x, y) => y <= 0.5 && ((x + s) / (15 * s)) ** 2 + ((y + 8 * s) / (12 * s)) ** 2 <= 1 || ((x - 4 * s) / (8 * s)) ** 2 + ((y + 15 * s) / (7 * s)) ** 2 <= 1, c1);
    shaded(p, c1, c2, c3);
    if (season === 3 && !tint) p.paint((x, y) => !p.solid(x, y - 2) || !p.solid(x, y - 1), WHITE);
    p.outline();
    return p.canvas();
  });
}

// berry bushes look different on every kind of land:
// 0 leafy, 1 prickly pear (desert), 2 jungle fruit, 3 low lingonberry (cold), 4 savanna, 5 bog blueberry
export function bushKind(b) {
  if (b._k === undefined) {
    const bi = S.biomeAt(b.x, b.y), B = S.BIOME;
    b._k = bi === B.DESERT ? 1 : bi === B.JUNGLE ? 2 : bi === B.TAIGA || bi === B.TUNDRA ? 3 : bi === B.SAVANNA ? 4 : bi === B.SWAMP ? 5 : 0;
  }
  return b._k;
}
const BUSH = [hex('#4fb24c'), hex('#47a446'), hex('#8a9a3c'), hex('#6b8a6a')];
const BERRIES = [BERRY, hex('#ff5fa0'), hex('#ff9a2a'), hex('#e02c3c'), hex('#e8344e'), hex('#5b5ee8')];
export function bush(season, u, kind = 0) {
  return sprites.get(`bush|${season}|${u}|${kind}`, () => {
    const s = u;
    const W = Math.ceil(26 * s) * 2 + 4, H = Math.ceil(32 * s) + 5;
    const p = new Pix(W, H, W / 2, H - 2);
    if (kind === 1) {
      const c1 = hex('#5fa85a');
      for (const [x, y, rx, ry] of [[0, -9, 9, 10], [-10, -18, 7, 8], [9, -20, 7, 8], [-1, -26, 6, 7]]) p.ellipse(x * s, y * s, Math.max(1.6, rx * s), Math.max(1.8, ry * s), c1);
      shaded(p, c1, shade(c1, 0.72), shade(c1, 1.3));
      if (s >= 0.3) p.paint((x, y) => ((x * 3 + y * 5) & 7) === 0, hex('#f6f0c8'), c1);
    } else {
      const c1 = kind === 2 ? hex('#2f8a3a') : kind === 3 ? (season === 3 ? hex('#5f7f62') : hex('#4f8a50')) : kind === 4 ? (season === 1 ? hex('#9aa244') : hex('#78a046')) : kind === 5 ? hex('#4a7a4a') : BUSH[season];
      const blobs = kind === 3 ? [[-11, -6, 10, 6], [10, -6, 10, 6], [0, -10, 11, 7]]
        : kind === 2 ? [[-11, -10, 11, 9], [11, -10, 11, 9], [0, -18, 12, 10], [-4, -24, 7, 6]]
          : [[-9, -10, 10, 9.2], [9, -10, 10, 9.2], [0, -17, 11, 10.1]];
      for (const [x, y, rx, ry] of blobs) p.ellipse(x * s, y * s, rx * s, ry * s, c1);
      shaded(p, c1, shade(c1, 0.75), shade(c1, 1.25));
      if (season === 3 && kind !== 2) p.paint((x, y) => !p.solid(x, y - 1), WHITE);
    }
    p.outline();
    return p.canvas();
  });
}
const BERRY_SPOTS = [[-9, -12], [7, -8], [1, -20], [-3, -6], [11, -16], [-12, -18]];
const BERRY_SPOTS_LOW = [[-12, -7], [6, -5], [0, -12], [-4, -4], [12, -8], [-8, -10]];
const BERRY_SPOTS_CACTUS = [[-9, -23], [8, -25], [-1, -30], [5, -15], [-6, -15], [12, -19]];
export function drawBush(ctx, b, X, Y, season, u, shake, kind = 0) {
  stamp(ctx, bush(season, u, kind), X + (shake ? 1 : 0), Y);
  if (u < 0.2) return;
  const c = kind === 0 && season === 2 ? css(PLUM) : css(BERRIES[kind]);
  const spots = kind === 3 ? BERRY_SPOTS_LOW : kind === 1 ? BERRY_SPOTS_CACTUS : BERRY_SPOTS;
  for (let i = 0; i < b.b && i < spots.length; i++) {
    const x = Math.round(X + spots[i][0] * u) + (shake ? 1 : 0), y = Math.round(Y + spots[i][1] * u);
    ctx.fillStyle = INK_C; ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = c; ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = '#ffd0d8'; ctx.fillRect(x, y, 1, 1);
  }
}

// shrubs: green-gold tussocks on the steppe, bare tumbleweed twigs in the desert
export function shrubKind(o) {
  if (o._k === undefined) { const b = S.biomeAt(o.x, o.y); o._k = b === S.BIOME.DESERT ? 1 : 0; }
  return o._k;
}
export function shrub(season, u, kind = 0) {
  return sprites.get(`shrub|${season}|${u}|${kind}`, () => {
    const s = u, W = Math.ceil(16 * s) * 2 + 4, H = Math.ceil(18 * s) + 5;
    const p = new Pix(W, H, W / 2, H - 2);
    if (kind === 1) {
      const c = hex('#9a7048');
      for (const [x0, y0, x1, y1] of [[0, 0, -9, -12], [0, 0, 8, -13], [0, 0, 0, -15], [-4, -6, -12, -8], [4, -7, 12, -9]]) p.line(x0 * s, y0 * s, x1 * s, y1 * s, c);
      if (s >= 0.3) p.outline();
      return p.canvas();
    }
    const c1 = season === 3 ? hex('#c9c2b0') : hex('#a39654');
    for (const [x, y, r] of [[-6, -6, 7], [6, -6, 7], [0, -11, 7]]) p.ellipse(x * s, y * s, r * s, r * s * 0.85, c1);
    shaded(p, c1, shade(c1, 0.75), shade(c1, 1.2));
    p.outline();
    return p.canvas();
  });
}

export function mushroom(u) {
  return sprites.get(`mush|${u}`, () => {
    const s = u, W = Math.ceil(22 * s) * 2 + 4, H = Math.ceil(24 * s) + 5;
    const p = new Pix(W, H, W / 2, H - 2);
    const cap = hex('#a77be8');
    for (const [x, k] of [[0, 1], [9, 0.7]]) {
      p.rect(Math.round((x - 2) * s), Math.round(-9 * k * s), Math.max(1, Math.round(4 * k * s)), Math.round(9 * k * s) + 1, hex('#f4ecdf'));
      p.fill((x - 9 * k) * s, -20 * k * s, (x + 9 * k) * s, -7 * k * s, (px, py) => ((px - x * s) / (9 * k * s)) ** 2 + ((py + 8 * k * s) / (9 * k * s)) ** 2 <= 1 && py <= -7 * k * s + 0.5, cap);
    }
    p.paint((x, y) => (x * 7 + y * 3) % 5 === 0, WHITE, cap);
    p.outline();
    return p.canvas();
  });
}

export function drawReeds(ctx, X, Y, t, u, seed) {
  if (u < 0.2) return;
  for (let i = 0; i < 3; i++) {
    const x = X + Math.round((i - 1) * 5 * u);
    const hgt = Math.round((20 + i * 3) * u);
    const sway = Math.round(Math.sin(t * 1.3 + seed + i));
    ctx.fillStyle = INK_C;
    ctx.fillRect(x, Y - hgt + 2, 1, hgt - 2);
    ctx.fillRect(x + sway - 1, Y - hgt - 3, 3, 5);
    ctx.fillStyle = '#8a5a35';
    ctx.fillRect(x + sway, Y - hgt - 2, 1, 3);
  }
}

export function grave(gv, u) {
  return sprites.get(`grave|${gv.s}|${Math.round(gv.h / 10)}|${u}`, () => {
    const s = u, W = Math.ceil(10 * s) * 2 + 4, H = Math.ceil(20 * s) + 5;
    const p = new Pix(W, H, W / 2, H - 2);
    const stone = hex('#b9bcc2');
    p.fill(-7 * s, -19 * s, 7 * s, 0, (x, y) => y > -11 * s || (x * x + (y + 11 * s) ** 2) <= (7 * s) ** 2, stone);
    p.rim(1, 0, hex('#8f939b'), stone);
    if (s * 10 >= 4) {
      const cy = Math.round(-11 * s);
      p.set(0, cy - 1, hex('#6c6f76')); p.set(0, cy, hex('#6c6f76')); p.set(-1, cy, hex('#6c6f76')); p.set(1, cy, hex('#6c6f76')); p.set(0, cy + 1, hex('#6c6f76'));
      p.set(0, -2, gv.s === 0 ? hsl(gv.h, 78, 64) : hsl(gv.h, 46, 44));
    }
    p.outline();
    return p.canvas();
  });
}

// ---------------------------------------------------------------------------
// little effects

function fromRows(rows, colors, outline = true) {
  const h = rows.length, w = rows[0].length;
  const p = new Pix(w + 2, h + 2, Math.floor((w + 2) / 2), Math.floor((h + 2) / 2));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = rows[j][i];
    if (colors[ch] !== undefined) p.d[(j + 1) * p.w + i + 1] = colors[ch];
  }
  if (outline) p.outline();
  return p.canvas();
}

const FX = {};
export function fx(name) {
  if (FX[name]) return FX[name];
  const R = hex('#ff5a7a'), L = hex('#ffc0cc'), Y = YELLOW, W = WHITE, B = hex('#8fd3ff'), K = INK, G = hex('#e8344e');
  const defs = {
    heart: [['.##.##.', '#l#####', '#######', '.#####.', '..###..', '...#...'], { '#': R, l: L }],
    star: [['..#..', '.###.', '#####', '.#.#.'], { '#': Y }],
    sparkle: [['.#.', '###', '.#.'], { '#': W }, false],
    z: [['###', '..#', '.#.', '###'], { '#': W }],
    drop: [['.#.', '###', '###', '.#.'], { '#': B }],
    anger: [['#.#', '...', '#.#'], { '#': G }, false],
    ghost: [['.####.', '######', '#k##k#', '#k##k#', '######', '######', '#.##.#'], { '#': W, k: K }],
    crumb: [['##', '##'], { '#': BERRY }, false],
  };
  const [rows, colors, outline] = defs[name];
  return (FX[name] = fromRows(rows, colors, outline !== false));
}

const puffs = new Cache(16);
export function puff(r) {
  r = Math.max(1, Math.min(7, Math.round(r)));
  return puffs.get(r, () => {
    const p = new Pix(r * 2 + 3, r * 2 + 3, r + 1, r + 1);
    p.ellipse(0, 0, r, r, WHITE);
    p.rim(0, 1, hex('#d8dde6'), WHITE);
    p.outline();
    return p.canvas();
  });
}

export { stamp };
