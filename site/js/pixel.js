// Tiny toolkit for pixel art: a pixel buffer with shape fills and automatic
// ink outlines, colour helpers and a 5-pixel-tall bitmap font.
// Everything the island draws is built from these hard-edged pixels.

export const PX = 3; // world units per art pixel at the closest zoom level

// colours are packed little-endian RGBA, the layout ImageData uses
export function rgb(r, g, b, a = 255) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
export function hex(s, a = 255) { const n = parseInt(s.slice(1), 16); return rgb(n >> 16, (n >> 8) & 255, n & 255, a); }
export function css(c) {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255, a = c >>> 24;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
export function hslRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function hsl(h, s, l) { const [r, g, b] = hslRgb(h, s, l); return rgb(r, g, b); }
export function shade(c, f) { // f < 1 darker, > 1 lighter (towards white)
  const ch = [c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map(v => f <= 1 ? v * f : v + (255 - v) * (f - 1));
  return rgb(Math.round(ch[0]), Math.round(ch[1]), Math.round(ch[2]), c >>> 24);
}

export const INK = rgb(24, 20, 30);
export const INK_CSS = css(INK);
export const WHITE = rgb(255, 255, 255);

// 4x4 ordered dither threshold, 0..1
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export function bayer(x, y) { return BAYER[((y & 3) << 2) | (x & 3)]; }

// A sprite under construction. Coordinates given to the shape helpers are
// relative to the anchor (the spot that sits on the ground), in art pixels.
export class Pix {
  constructor(w, h, ax, ay) {
    this.w = w; this.h = h; this.ax = ax; this.ay = ay;
    this.d = new Uint32Array(w * h);
    this.flat = new Uint8Array(w * h); // 1 = drawn as a line: never gets an outline of its own
  }
  idx(x, y) { const i = x + this.ax, j = y + this.ay; return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  get(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : this.d[k]; }
  set(x, y, c, flat) { const k = this.idx(Math.floor(x), Math.floor(y)); if (k >= 0) { this.d[k] = c; this.flat[k] = flat ? 1 : 0; } }
  // fill every pixel whose centre passes the test
  fill(x0, y0, x1, y1, test, c) {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (test(x + 0.5, y + 0.5)) this.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    rx = Math.max(rx, 0.5); ry = Math.max(ry, 0.5);
    this.fill(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c);
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  poly(pts, c) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    this.fill(x0, y0, x1, y1, (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, c);
  }
  line(xa, ya, xb, yb, c) { // 1px line that stays thin (no outline)
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya))));
    for (let i = 0; i <= n; i++) this.set(Math.round(xa + (xb - xa) * i / n), Math.round(ya + (yb - ya) * i / n), c, true);
  }
  // recolour pixels that already have colour `only`
  paint(test, c, only) {
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i, x = i - this.ax, y = j - this.ay;
      if (this.d[k] && (only === undefined || this.d[k] === only) && test(x, y)) this.d[k] = typeof c === 'function' ? c(x, y, this.d[k]) : c;
    }
  }
  solid(x, y) { const k = this.idx(x, y); return k >= 0 && this.d[k] !== 0; }
  // the rim of a shape: rimmed pixels whose neighbour (dx, dy) is empty
  rim(dx, dy, c, only) {
    const hits = [];
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i, x = i - this.ax, y = j - this.ay;
      if (this.d[k] && !this.flat[k] && (only === undefined || this.d[k] === only) && !this.solid(x + dx, y + dy)) hits.push(k);
    }
    for (const k of hits) this.d[k] = c;
  }
  // classic 1px ink outline around everything that isn't a line
  outline(c = INK) {
    const { w, h, d, flat } = this;
    const out = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (d[k]) continue;
      const n = (ii, jj) => ii >= 0 && jj >= 0 && ii < w && jj < h && d[jj * w + ii] && !flat[jj * w + ii];
      if (n(i - 1, j) || n(i + 1, j) || n(i, j - 1) || n(i, j + 1)) out.push(k);
    }
    for (const k of out) { d[k] = c; flat[k] = 1; }
  }
  mirror() {
    const m = new Pix(this.w, this.h, this.w - this.ax, this.ay);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      m.d[j * this.w + (this.w - 1 - i)] = this.d[j * this.w + i];
      m.flat[j * this.w + (this.w - 1 - i)] = this.flat[j * this.w + i];
    }
    return m;
  }
  canvas() {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.d);
    cx.putImageData(img, 0, 0);
    cv.ax = this.ax; cv.ay = this.ay;
    return cv;
  }
}

// a tiny cache with a size limit (oldest entries go first)
export class Cache {
  constructor(max) { this.max = max; this.m = new Map(); }
  get(k, make) {
    let v = this.m.get(k);
    if (v === undefined) {
      v = make();
      this.m.set(k, v);
      if (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
    }
    return v;
  }
}

// draw a cached sprite canvas with its anchor at (x, y)
export function stamp(ctx, cv, x, y) { ctx.drawImage(cv, Math.round(x) - cv.ax, Math.round(y) - cv.ay); }

// ---------------------------------------------------------------------------
// bitmap font: 5 pixels tall, upper case

const GLYPHS = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], "'": ['#', '#', '.', '.', '.'], '-': ['...', '...', '###', '...', '...'],
  ':': ['.', '#', '.', '#', '.'], ' ': ['..', '..', '..', '..', '..'],
};

export function textWidth(s) {
  let w = 0;
  for (const ch of s.toUpperCase()) w += (GLYPHS[ch] || GLYPHS['?'])[0].length + 1;
  return Math.max(0, w - 1);
}

// text as a sprite with a 1px ink border, anchored at its bottom centre
const textCache = new Cache(300);
export function textSprite(s, color, border = INK) {
  return textCache.get(`${s}|${color}|${border}`, () => {
    const tw = textWidth(s);
    const p = new Pix(tw + 2, 7, Math.floor((tw + 2) / 2), 7);
    let x = 1;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] || GLYPHS['?'];
      for (let j = 0; j < 5; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '#') p.d[(j + 1) * p.w + x + i] = color;
      x += g[0].length + 1;
    }
    if (border) {
      // 8-way border so letters read on anything
      const d = p.d.slice();
      for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
        if (d[j * p.w + i]) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < p.w && jj < p.h && d[jj * p.w + ii]) { near = true; break; }
        }
        if (near) p.d[j * p.w + i] = border;
      }
    }
    return p.canvas();
  });
}
