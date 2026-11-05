// Data layer: static daily snapshots in /data first, the live Squeekchain API on top.
// The runs endpoint is limited to 2 requests/second, so pages are fetched one at a time
// with a pause, and only while the tab is visible.
import { isoDay } from './analyze.js';

export const API = 'https://api.squeekchain.com';
const PAGE_GAP_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const days = new Map(); // date -> Map(segmentId -> Float64Array)
const cache = new Map(); // date -> { version, t }
const loadedSnapshot = new Set();
let version = 0;
let index = null, state = null;
let cursor = null;
let crawling = null;
const listeners = new Set();
export const onData = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (info) => listeners.forEach((fn) => fn(info));

export const live = { status: null, statusAt: 0, error: null, catchingUp: false, pages: 0, coverageThroughAt: null, runsFreshness: null, installationId: null, crawledAt: 0 };

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, ...opts });
  if (!res.ok) { const e = new Error(`${res.status} ${url}`); e.status = res.status; throw e; }
  return res.json();
}

function decodeDay(j) {
  let cur = j.t0;
  const abs = new Float64Array(j.p.length);
  for (let i = 0; i < j.p.length; i++) abs[i] = cur += j.p[i] / 10;
  const m = days.get(j.date) || new Map();
  for (const s of j.segments) if (!m.has(s.id)) m.set(s.id, abs.subarray(s.i, s.i + s.n));
  days.set(j.date, m);
  version++;
}

export async function loadIndex() {
  if (index) return index;
  try {
    [index, state] = await Promise.all([getJSON('/data/index.json', { cache: 'no-cache' }), getJSON('/data/state.json', { cache: 'no-cache' })]);
    cursor = state.cursor;
  } catch {
    index = { days: [], mmPerPassage: 878, snapshotMissing: true };
  }
  return index;
}
export const getIndex = () => index;

export async function loadDay(date) {
  await loadIndex();
  if (!loadedSnapshot.has(date) && index.days.some((d) => d.date === date)) {
    loadedSnapshot.add(date);
    try { decodeDay(await getJSON(`/data/days/${date}.json`)); } catch (e) { console.warn('snapshot day missing', date, e); }
  }
  return getDay(date);
}

/** Sorted passages for a day, merged from snapshot + live segments. */
export function getDay(date) {
  const c = cache.get(date);
  if (c && c.version === version) return c.t;
  const m = days.get(date);
  if (!m) return new Float64Array(0);
  const parts = [...m.values()].sort((a, b) => a[0] - b[0]);
  const len = parts.reduce((s, p) => s + p.length, 0);
  const t = new Float64Array(len);
  let o = 0;
  for (const p of parts) { t.set(p, o); o += p.length; }
  t.sort();
  cache.set(date, { version, t });
  return t;
}

/** All dates we know about: snapshot days plus any newer live days. */
export function knownDates() {
  const set = new Set((index?.days || []).map((d) => d.date));
  for (const k of days.keys()) set.add(k);
  set.add(isoDay(Date.now()));
  return [...set].sort();
}

function isoToMs(iso) {
  const m = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(iso);
  if (!m) return Date.parse(iso);
  return Date.parse(m[1] + 'Z') + Number((m[2] || '0').padEnd(6, '0').slice(0, 6)) / 1000;
}

function ingest(items) {
  let added = 0;
  for (const it of items) {
    const base = isoToMs(it.startAt);
    const t = it.passages.map((p) => base + Number(BigInt(p.offsetNs) / 1000n) / 1000);
    const byDay = new Map();
    for (const ms of t) { const k = isoDay(ms); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(ms); }
    for (const [k, arr] of byDay) {
      const id = byDay.size > 1 ? `${it.segmentId}:${k}` : it.segmentId;
      const m = days.get(k) || new Map();
      if (!m.has(id)) added += arr.length;
      m.set(id, Float64Array.from(arr));
      days.set(k, m);
    }
  }
  if (added) version++;
  return added;
}

/** Pull new run segments from the live API, starting where the snapshot ended. */
export function catchUp() {
  if (crawling) return crawling;
  crawling = (async () => {
    await loadIndex();
    // Make sure today's + yesterday's snapshot is merged before live data lands on top.
    const today = isoDay(Date.now());
    await loadDay(today);
    live.catchingUp = true;
    // The snapshot cursor only works for the installation it came from. After a re-deploy the API
    // answers 400 invalid_cursor, so check /v1/status (not rate-limited) first and skip the doomed request.
    if (cursor && cursor === state?.cursor && index?.installationId) {
      if (!live.status) await fetchStatus();
      const inst = live.status?.installationId;
      if (inst && inst !== index.installationId) cursor = null;
    }
    let added = 0;
    try {
      for (let guard = 0; guard < 400; guard++) {
        if (document.hidden && guard > 0) break;
        const url = `${API}/v1/measurement/runs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        let page;
        try { page = await getJSON(url, { cache: 'no-store' }); }
        catch (e) {
          if (e.status === 429) { await sleep(2000); continue; }
          // The API was re-deployed (new installation): the snapshot cursor is invalid.
          // Keep the snapshot days and read the new installation from its first page.
          if (e.status === 400 && cursor) { console.warn('cursor rejected, restarting from the first page'); cursor = null; continue; }
          throw e;
        }
        live.pages++;
        live.coverageThroughAt = page.coverageThroughAt;
        live.runsFreshness = page.freshness;
        live.installationId = page.installationId;
        added += ingest(page.items);
        if (page.nextCursor) cursor = page.nextCursor;
        if (page.items.length) emit({ type: 'runs', added });
        if (!page.items.length || !page.nextCursor) break;
        await sleep(PAGE_GAP_MS);
      }
      live.error = null;
      live.crawledAt = Date.now();
    } catch (e) {
      live.error = e.message;
    } finally {
      live.catchingUp = false;
      crawling = null;
      emit({ type: 'runs', added });
    }
    return added;
  })();
  return crawling;
}

export async function fetchStatus() {
  try {
    live.status = await getJSON(`${API}/v1/status`, { cache: 'no-store' });
    live.statusAt = Date.now();
    live.error = null;
  } catch (e) { live.error = e.message; }
  emit({ type: 'status' });
  return live.status;
}

/** Wheel state for the UI: running / resting / asleep / offline. */
export function wheelState() {
  const m = live.status?.measurement;
  if (!m) return { key: 'unknown' };
  if (m.freshness === 'stale') return { key: 'offline', m };
  if (m.coreStatus === 'ACTIVE' || m.rpmMilli > 0) return { key: 'running', m };
  const t = getDay(isoDay(Date.now()));
  const last = t.length ? t[t.length - 1] : 0;
  if (Date.now() - last < 10 * 60_000) return { key: 'resting', m, last };
  return { key: 'asleep', m, last };
}

let timer = null, lastRunsPoll = 0, lastWork = null;
/** Poll status every ~10 s; fetch new run segments when the wheel moved (max every 15 s) or every 60 s. */
export function startLive() {
  if (timer) return;
  const tick = async () => {
    if (!document.hidden) {
      const s = await fetchStatus();
      const work = s?.measurement?.cumulativeWorkUnits;
      const moved = work != null && work !== lastWork;
      const since = Date.now() - lastRunsPoll;
      if ((moved && since > 15_000) || since > 60_000) {
        lastRunsPoll = Date.now();
        lastWork = work;
        catchUp();
      }
    }
    timer = setTimeout(tick, 10_000 + Math.random() * 1000);
  };
  lastRunsPoll = Date.now();
  // An overlay inside the Studio preview shares the runs rate limit (2 req/s) with the page around it.
  if (window.top !== window) setTimeout(catchUp, 1500 + Math.random() * 1000); else catchUp();
  tick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); tick(); } });
}
