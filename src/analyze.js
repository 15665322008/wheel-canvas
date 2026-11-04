// Pure analysis of a day's passages (absolute epoch ms, sorted ascending).
// Every number shown on the site comes from here, so pages, art and exports agree.

export const RUN_BREAK_MS = 60_000; // a rest longer than this ends a run
export const RUNNING_GAP_MS = 5_000; // gaps up to this count as running (speed is defined)
export const DEFAULT_MM_PER_PASSAGE = 878; // wheel circumference, ≈ lifetime distance / work units

export const DAY_MS = 86_400_000;
export const dayStartMs = (date) => Date.parse(date + 'T00:00:00Z');
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Smoothed speed (m/s) at passage i: circumference / median of the last 5 running gaps. */
export function speeds(t, mm = DEFAULT_MM_PER_PASSAGE) {
  const v = new Float64Array(t.length).fill(NaN);
  const win = [];
  for (let i = 1; i < t.length; i++) {
    const g = t[i] - t[i - 1];
    if (g > RUNNING_GAP_MS) { win.length = 0; continue; }
    win.push(g);
    if (win.length > 5) win.shift();
    v[i] = mm / median(win); // mm per ms == m per s
  }
  return v;
}

export function splitRuns(t) {
  const runs = [];
  if (!t.length) return runs;
  let s = 0;
  for (let i = 1; i <= t.length; i++) {
    if (i === t.length || t[i] - t[i - 1] > RUN_BREAK_MS) {
      runs.push({ from: s, to: i - 1 });
      s = i;
    }
  }
  return runs;
}

export function analyzeRun(t, v, from, to, mm = DEFAULT_MM_PER_PASSAGE) {
  const n = to - from + 1;
  let active = 0, maxGap = 0, pauses = 0, peak = 0, sumV = 0, nV = 0;
  for (let i = from + 1; i <= to; i++) {
    const g = t[i] - t[i - 1];
    if (g > maxGap) maxGap = g;
    if (g <= RUNNING_GAP_MS) active += g; else pauses++;
    if (!Number.isNaN(v[i])) { sumV += v[i]; nV++; if (v[i] > peak) peak = v[i]; }
  }
  return {
    from, to, n,
    start: t[from], end: t[to],
    durMs: t[to] - t[from],
    activeMs: active,
    distanceM: (n * mm) / 1000,
    avgSpeed: nV ? sumV / nV : 0,
    peakSpeed: peak,
    maxGapMs: maxGap,
    pauses,
  };
}

export function analyzeDay(t, mm = DEFAULT_MM_PER_PASSAGE) {
  const v = speeds(t, mm);
  const runs = splitRuns(t).map((r, k) => ({ ...analyzeRun(t, v, r.from, r.to, mm), index: k + 1 }));
  const hours = new Array(24).fill(0);
  for (const x of t) hours[new Date(x).getUTCHours()]++;
  let longestRest = 0, activeMs = 0, peak = 0, sumV = 0, nV = 0;
  for (let k = 1; k < runs.length; k++) longestRest = Math.max(longestRest, runs[k].start - runs[k - 1].end);
  for (const r of runs) activeMs += r.activeMs;
  for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i])) { sumV += v[i]; nV++; if (v[i] > peak) peak = v[i]; }
  const longestRun = runs.reduce((a, r) => (!a || r.durMs > a.durMs ? r : a), null);
  return {
    passages: t.length,
    distanceM: (t.length * mm) / 1000,
    runs, hours, v,
    activeMs, longestRestMs: longestRest,
    peakSpeed: peak, avgSpeed: nV ? sumV / nV : 0,
    longestRun,
    firstAt: t.length ? t[0] : null,
    lastAt: t.length ? t[t.length - 1] : null,
    fingerprint: fingerprint(t),
  };
}

/** FNV-1a 32-bit over passage times rounded to 0.1 ms. Same data => same fingerprint => same painting. */
export function fingerprint(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    let x = Math.round(t[i] * 10) % 4294967296;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff; x = Math.floor(x / 256);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
