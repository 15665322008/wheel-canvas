// Deterministic dot-grid renderers. Each returns a "scene": a list of primitives in a
// fixed design space. The same scene is drawn to <canvas> (screen, PNG) or serialised
// to SVG, so every export is identical to what you see.
import { DAY_MS, dayStartMs, RUNNING_GAP_MS } from './analyze.js';

export const BG = '#17171B';
export const DOT_IDLE = '#26262F';
export const DOT_FUTURE = '#1E1E25';

export const PALETTES = [
  { name: 'Sunflower', stops: ['#3b2a8c', '#9B45DE', '#F06BAE', '#F2C230', '#F8DC7A'] },
  { name: 'Night Shift', stops: ['#1f3f8f', '#2f7fe0', '#4fc6dd', '#bfeee0', '#F8DC7A'] },
  { name: 'Seed Husk', stops: ['#5E480A', '#84660F', '#C99A1A', '#F2C230', '#fff1b8'] },
  { name: 'Clover', stops: ['#164c3c', '#21885a', '#6cc26a', '#c6e46a', '#F8DC7A'] },
  { name: 'Ember', stops: ['#542693', '#b8366b', '#e85f3f', '#f8a838', '#ffd06a'] },
];
export const paletteFor = (fp) => PALETTES[parseInt(fp.slice(0, 2), 16) % PALETTES.length];

function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb2hex([r, g, b]) { return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''); }
export function ramp(stops, f) {
  f = Math.max(0, Math.min(1, f));
  const p = f * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), k = p - i;
  const a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
  return rgb2hex(a.map((x, j) => x + (b[j] - x) * k));
}

// Speed scale shared by all paintings so days are comparable.
export const V_MIN = 0.75, V_MAX = 1.35; // m/s — covers ~98% of Squeektoshi's running
const vFrac = (v) => Math.max(0, Math.min(1, (v - V_MIN) / (V_MAX - V_MIN)));

// Original 11x9 dot hamster (community glyph, not the Squeekchain logo).
const HAMSTER = [
  '.X.......X.',
  'XXX.....XXX',
  '.XXXXXXXXX.',
  'XXXXXXXXXXX',
  'XX.XXXXX.XX',
  'XXXXX.XXXXX',
  '.XXXXXXXXX.',
  '..XXXXXXX..',
  '...X...X...',
];

const BRUSH = [[0, 1], [-1, 0.5], [1, 0.5]];
const fmtInt = (n) => n.toLocaleString('en-US');
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

/**
 * Day painting: a 24-hour clock in dots.
 *  angle  = time of day (UTC, midnight at top, clockwise)
 *  radius = running speed (slow inside, fast outside)
 *  dot    = how many wheel turns landed in that cell
 *  colour = speed, through a palette picked by the data fingerprint
 */
export function dayScene(date, t, a, opts = {}) {
  const W = 1080, H = 1080, G = 60, C = W / G;
  const cx = 30, cy = 28.2, rIn = 8.6, rOut = 22.4;
  const pal = paletteFor(a.fingerprint);
  const t0 = dayStartMs(date);
  const nowFrac = opts.nowMs != null ? Math.max(0, Math.min(1, (opts.nowMs - t0) / DAY_MS)) : null;
  const prims = [];
  const ink = new Float64Array(G * G);
  const v = a.v;
  for (let i = 0; i < t.length; i++) {
    if (Number.isNaN(v[i])) continue;
    const th = (2 * Math.PI * (t[i] - t0)) / DAY_MS - Math.PI / 2;
    const r = rIn + 0.9 + vFrac(v[i]) * (rOut - rIn - 0.9);
    // a small radial brush: full weight at r, half weight one cell in and out
    for (const [dr, wgt] of BRUSH) {
      const gx = Math.round(cx + (r + dr) * Math.cos(th)), gy = Math.round(cy + (r + dr) * Math.sin(th));
      if (gx >= 0 && gx < G && gy >= 0 && gy < G) ink[gy * G + gx] += wgt;
    }
  }
  // hamster cells
  const ham = new Set();
  const hx0 = Math.round(cx) - 5, hy0 = Math.round(cy) - 4;
  HAMSTER.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') ham.add((hy0 + y) * G + hx0 + x); }));

  const K = 70; // turns per cell (at the outer ring) for a full-size dot
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const idx = gy * G + gx;
      const x = (gx + 0.5) * C, y = (gy + 0.5) * C;
      const dx = gx - cx, dy = gy - cy, d = Math.hypot(dx, dy);
      if (ham.has(idx)) {
        prims.push({ t: 'c', x, y, r: C * 0.32, fill: opts.running ? pal.stops[4] : pal.stops[3], a: 1 });
        continue;
      }
      if (ink[idx] > 0) {
        const w = Math.min(1, (ink[idx] * (d / rOut)) / K);
        const f = (d - rIn) / (rOut - rIn);
        prims.push({ t: 'c', x, y, r: C * (0.16 + 0.3 * Math.sqrt(w)), fill: ramp(pal.stops, f), a: 0.45 + 0.55 * Math.sqrt(w) });
        continue;
      }
      let fill = DOT_IDLE;
      if (nowFrac != null && d > rIn - 0.5 && d < rOut + 0.5) {
        let ang = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI);
        if (ang < 0) ang += 1;
        if (ang > nowFrac) fill = DOT_FUTURE;
      }
      prims.push({ t: 'c', x, y, r: C * 0.11, fill, a: 1 });
    }
  }
  // run sparks on the rim
  for (const run of a.runs) {
    const th = (2 * Math.PI * (run.start - t0)) / DAY_MS - Math.PI / 2;
    const r = rOut + 1.7;
    prims.push({ t: 'c', x: (cx + 0.5 + r * Math.cos(th)) * C, y: (cy + 0.5 + r * Math.sin(th)) * C, r: C * Math.min(0.42, 0.14 + 0.05 * Math.log2(1 + run.n / 50)), fill: '#fff4cc', a: 0.95 });
  }
  // hour ticks + labels
  for (let h = 0; h < 24; h++) {
    const th = (2 * Math.PI * h) / 24 - Math.PI / 2, r = rOut + 3.1, major = h % 6 === 0;
    prims.push({ t: 'c', x: (cx + 0.5 + r * Math.cos(th)) * C, y: (cy + 0.5 + r * Math.sin(th)) * C, r: C * (major ? 0.2 : 0.11), fill: major ? '#9A9AA6' : '#55555f', a: 1 });
    if (major) {
      const rl = rOut + 4.5;
      prims.push({ t: 'text', x: (cx + 0.5 + rl * Math.cos(th)) * C, y: (cy + 0.5 + rl * Math.sin(th)) * C + 6, s: 17, fill: '#6E6E7A', txt: String(h).padStart(2, '0'), anchor: 'middle', font: 'mono' });
    }
  }
  // "now" hand for a live day
  if (nowFrac != null && nowFrac < 1) {
    const th = 2 * Math.PI * nowFrac - Math.PI / 2;
    for (let r = rIn - 0.2; r <= rOut + 0.6; r += 0.9) {
      prims.push({ t: 'c', x: (cx + 0.5 + r * Math.cos(th)) * C, y: (cy + 0.5 + r * Math.sin(th)) * C, r: C * 0.08, fill: '#F8DC7A', a: 0.55 });
    }
  }
  if (!opts.bare) {
    prims.push({ t: 'text', x: C * 1.6, y: H - C * 2.1, s: 30, fill: '#E6E6EC', txt: date, anchor: 'start', font: 'display', weight: 600 });
    prims.push({ t: 'text', x: C * 1.6, y: H - C * 0.9, s: 15, fill: '#9A9AA6', txt: `${fmtInt(a.passages)} TURNS · ${(a.distanceM / 1000).toFixed(2)} KM · ${a.runs.length} RUNS · UTC`, anchor: 'start', font: 'mono' });
    prims.push({ t: 'text', x: W - C * 1.6, y: H - C * 2.1, s: 15, fill: '#9A9AA6', txt: `WHEEL CANVAS · ${pal.name.toUpperCase()}`, anchor: 'end', font: 'mono' });
    prims.push({ t: 'text', x: W - C * 1.6, y: H - C * 0.9, s: 15, fill: '#6E6E7A', txt: `#${a.fingerprint}`, anchor: 'end', font: 'mono' });
  }
  return { w: W, h: H, bg: opts.transparent ? null : BG, prims, palette: pal };
}

/**
 * Run portrait: a dot-matrix equaliser of one run.
 *  column = a slice of the run's time, height = average speed in the slice,
 *  pink dots under the baseline = stumbles (pauses of 5–60 s).
 */
export function runScene(date, t, a, run, opts = {}) {
  const W = 1200, H = 630, C = 20, COLS = 60, ROWS = 31;
  const x0 = 2, x1 = 57, base = 23, top = 4, height = base - top + 1;
  const pal = paletteFor(a.fingerprint);
  const n = x1 - x0 + 1;
  const sum = new Float64Array(n), cnt = new Float64Array(n), stumble = new Uint8Array(n);
  const dur = Math.max(1, run.end - run.start);
  for (let i = run.from; i <= run.to; i++) {
    const col = Math.min(n - 1, Math.floor(((t[i] - run.start) / dur) * n));
    if (!Number.isNaN(a.v[i])) { sum[col] += a.v[i]; cnt[col]++; }
    if (i > run.from && t[i] - t[i - 1] > RUNNING_GAP_MS) stumble[col] = 1;
  }
  const prims = [];
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    const x = (gx + 0.5) * C, y = (gy + 0.5) * C;
    const col = gx - x0;
    if (col >= 0 && col < n && gy >= top && gy <= base && cnt[col] > 0) {
      const f = Math.max(0.04, vFrac(sum[col] / cnt[col]));
      const hgt = Math.max(1, Math.round(f * height));
      const row = base - gy; // 0 at baseline
      if (row < hgt) {
        const isTop = row === hgt - 1;
        prims.push({ t: 'c', x, y, r: C * (isTop ? 0.4 : 0.33), fill: isTop ? pal.stops[4] : ramp(pal.stops, row / height), a: isTop ? 1 : 0.9 });
        continue;
      }
    }
    if (col >= 0 && col < n && gy === base + 1 && stumble[col]) {
      prims.push({ t: 'c', x, y, r: C * 0.22, fill: '#F06BAE', a: 0.9 });
      continue;
    }
    prims.push({ t: 'c', x, y, r: C * 0.1, fill: DOT_IDLE, a: 1 });
  }
  if (!opts.bare) {
    prims.push({ t: 'text', x: C * 2, y: C * 2.3, s: 30, fill: '#E6E6EC', txt: `RUN #${run.index} · ${date}`, anchor: 'start', font: 'display', weight: 600 });
    prims.push({ t: 'text', x: W - C * 2, y: C * 2.3, s: 15, fill: '#9A9AA6', txt: `${hhmm(run.start)}–${hhmm(run.end)} UTC`, anchor: 'end', font: 'mono' });
    prims.push({ t: 'text', x: C * 2, y: H - C * 2.2, s: 15, fill: '#9A9AA6', txt: `${fmtInt(run.n)} TURNS · ${run.distanceM.toFixed(0)} M · AVG ${run.avgSpeed.toFixed(2)} M/S · PEAK ${run.peakSpeed.toFixed(2)} M/S`, anchor: 'start', font: 'mono' });
    prims.push({ t: 'text', x: W - C * 2, y: H - C * 2.2, s: 15, fill: '#6E6E7A', txt: `WHEEL CANVAS · #${a.fingerprint}`, anchor: 'end', font: 'mono' });
  }
  return { w: W, h: H, bg: opts.transparent ? null : BG, prims, palette: pal };
}

const FONTS = { mono: '"IBM Plex Mono", ui-monospace, monospace', display: '"Barlow Condensed", "Arial Narrow", sans-serif' };

export function drawScene(canvas, scene, cssWidth, dprOverride) {
  const dpr = dprOverride || Math.min(2, globalThis.devicePixelRatio || 1);
  const w = cssWidth || scene.w;
  const scale = w / scene.w;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(scene.h * scale * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.clearRect(0, 0, scene.w, scene.h);
  if (scene.bg) { ctx.fillStyle = scene.bg; ctx.fillRect(0, 0, scene.w, scene.h); }
  for (const p of scene.prims) {
    ctx.globalAlpha = p.a ?? 1;
    ctx.fillStyle = p.fill;
    if (p.t === 'c') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    else if (p.t === 'text') {
      ctx.font = `${p.weight || 400} ${p.s}px ${FONTS[p.font] || FONTS.mono}`;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.txt, p.x, p.y);
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function sceneToSVG(scene, title = 'Wheel Canvas') {
  const r1 = (x) => Math.round(x * 10) / 10;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.w} ${scene.h}" width="${scene.w}" height="${scene.h}">`, `<title>${esc(title)}</title>`];
  if (scene.bg) out.push(`<rect width="100%" height="100%" fill="${scene.bg}"/>`);
  for (const p of scene.prims) {
    const op = p.a != null && p.a < 1 ? ` fill-opacity="${r1(p.a * 100) / 100}"` : '';
    if (p.t === 'c') out.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(p.r)}" fill="${p.fill}"${op}/>`);
    else out.push(`<text x="${r1(p.x)}" y="${r1(p.y)}" font-family='${FONTS[p.font] || FONTS.mono}' font-size="${p.s}" font-weight="${p.weight || 400}" text-anchor="${p.anchor || 'start'}" fill="${p.fill}">${esc(p.txt)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
