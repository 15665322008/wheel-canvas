// Squeekchain rounds: 600-second windows counted from roundSchedule.genesisTimestamp
// (GET /v1/measurement/blocks). Round n covers [genesis + (n-1)·600 s, genesis + n·600 s);
// /v1/status reports the closed rounds (oracle.latestClosure.lastRound) and the work in
// the open round (builder.queued.openRoundWorkUnits).
import { API, live, getDay, loadDay } from './data.js';
import { isoDay } from './analyze.js';

const LS_SCHEDULE = 'wc-round-schedule';
// Last schedule seen while building (installation sepolia-core-sepolia-20261103).
const FALLBACK = { genesis: 1793735400, dur: 600, installationId: 'sepolia-core-sepolia-20261103', fallback: true };

let schedule = null;
try { schedule = JSON.parse(localStorage.getItem(LS_SCHEDULE) || 'null'); } catch { /* ignore */ }
let schedulePromise = null;

export const getSchedule = () => schedule || FALLBACK;

/** Fetch the live round schedule once per page load (falls back to the cached one). */
export function loadSchedule() {
  if (schedulePromise) return schedulePromise;
  schedulePromise = (async () => {
    try {
      const res = await fetch(`${API}/v1/measurement/blocks`, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const g = Number(j?.roundSchedule?.genesisTimestamp), d = Number(j?.roundSchedule?.roundDurationSeconds);
      if (Number.isFinite(g) && d > 0) {
        schedule = { genesis: g, dur: d, installationId: j.installationId || null };
        localStorage.setItem(LS_SCHEDULE, JSON.stringify(schedule));
      }
    } catch (e) { console.warn('round schedule unavailable, using cached', e.message); }
    return getSchedule();
  })();
  return schedulePromise;
}

export function roundAt(ms, s = getSchedule()) { return Math.floor((ms / 1000 - s.genesis) / s.dur) + 1; }
export function roundWindow(n, s = getSchedule()) {
  const start = (s.genesis + (n - 1) * s.dur) * 1000;
  return { round: n, start, end: start + s.dur * 1000, installationId: s.installationId };
}
export const currentRound = (now = Date.now()) => roundWindow(roundAt(now));

/** Live work in the open round, straight from /v1/status. */
export function openRoundWork() {
  const v = live.status?.builder?.queued?.openRoundWorkUnits;
  return v == null ? null : Number(v);
}
export function lastClosedRound() {
  const v = live.status?.oracle?.latestClosure?.lastRound;
  return v == null ? null : Number(v);
}

/** Passage times (absolute ms) inside [start, end), from snapshot + live segments. */
export async function passagesIn(start, end) {
  const dates = [...new Set([isoDay(start), isoDay(end - 1)])];
  await Promise.all(dates.map((d) => loadDay(d)));
  const out = [];
  for (const d of dates) for (const x of getDay(d)) if (x >= start && x < end) out.push(x);
  return out.sort((a, b) => a - b);
}

/**
 * Is the window fully covered by the passage evidence we have?
 *  - the live crawl finished after the window ended and reports coverage past it, or
 *  - the window is inside the static snapshot (older rounds), or
 *  - the installation has no segments at all yet and the round is closed (it really was 0).
 */
export function coverageFor(win, indexInfo) {
  const cov = live.coverageThroughAt ? Date.parse(live.coverageThroughAt) : null;
  if (cov && cov >= win.end && live.crawledAt > win.end) return 'live';
  const snapThrough = indexInfo?.coverageThroughAt ? Date.parse(indexInfo.coverageThroughAt) : null;
  if (snapThrough && snapThrough >= win.end && (!indexInfo.installationId || !win.installationId || indexInfo.installationId === win.installationId)) return 'snapshot';
  const closed = lastClosedRound();
  if (live.runsFreshness === 'unavailable' && live.crawledAt > win.end && closed != null && closed >= win.round
    && (!win.installationId || win.installationId === live.status?.installationId)) return 'empty';
  return null;
}

/** Recent-round hint: API stats when available, else computed from local passages. */
export async function roundHint() {
  let api = null;
  try {
    const res = await fetch(`${API}/v1/measurement/stats?range=7d`, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const r = (await res.json()).rounds;
      if (r && r.medianActiveWork != null) api = { source: 'api', median: Number(r.medianActiveWork), p90: Number(r.p90ActiveWork), avg: Number(r.averageActiveWorkMilli) / 1000, activeRate: r.activeRateBps / 100, max: Number(r.mostActiveWork) };
    }
  } catch { /* fall back */ }
  if (api) return api;
  // Local: bucket the last 7 days of passages into 600 s windows on the round grid.
  const s = getSchedule();
  const counts = new Map();
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, k) => isoDay(now - k * 86_400_000));
  await Promise.all(days.map((d) => loadDay(d).catch(() => null)));
  for (const d of days) {
    for (const x of getDay(d)) {
      const r = Math.floor((x / 1000 - s.genesis) / s.dur);
      counts.set(r, (counts.get(r) || 0) + 1);
    }
  }
  const vals = [...counts.values()].filter((v) => v >= 5).sort((a, b) => a - b);
  if (!vals.length) return null;
  const q = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
  return { source: 'local', median: q(0.5), p90: q(0.9), avg: vals.reduce((a, b) => a + b, 0) / vals.length, activeRate: null, max: vals[vals.length - 1], n: vals.length };
}
