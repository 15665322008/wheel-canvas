#!/usr/bin/env node
// Wheel Canvas data snapshot.
// Pulls Squeektoshi's wheel passages from the public Squeekchain API and
// stores them as compact per-day (UTC) JSON files in public/data/.
// Incremental: resumes from the cursor saved in public/data/state.json.
// Respects the observations rate limit (2 req/s) by waiting >= 650 ms per page.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.SQUEEK_API || 'https://api.squeekchain.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const DAYS = path.join(OUT, 'days');
const PAGE_DELAY_MS = 650;
const FULL = process.argv.includes('--full');
const UA = 'wheel-canvas-snapshot/1.0 (+https://mstrsqueek.xyz; community project)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * (i + 1);
      console.warn(`  ${res.status} on ${url}, retrying in ${wait} ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${url}: ${await res.text()}`);
  }
  throw new Error(`gave up on ${url}`);
}

// ISO with micro/nano fraction -> epoch milliseconds with 3 decimals kept (µs precision)
function isoToMs(iso) {
  const m = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(iso);
  if (!m) return Date.parse(iso);
  const base = Date.parse(m[1] + 'Z');
  const frac = (m[2] || '0').padEnd(6, '0').slice(0, 6); // microseconds
  return base + Number(frac) / 1000;
}
const dayOf = (ms) => new Date(Math.floor(ms)).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00Z');

async function readJSON(p, fallback) {
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
}

// In-memory day store: date -> { segs: Map(segmentId -> {id, disc, elig, prov, t:[ms...]}) }
const days = new Map();

async function loadDay(date) {
  if (days.has(date)) return days.get(date);
  const file = await readJSON(path.join(DAYS, `${date}.json`), null);
  const d = { segs: new Map(), dirty: false };
  if (file) {
    const t0 = file.t0;
    let cur = t0;
    const abs = file.p.map((dt) => (cur += dt / 10)); // 0.1 ms ticks, delta encoded
    for (const s of file.segments) {
      d.segs.set(s.id, { id: s.id, disc: !!s.disc, elig: s.elig !== false, prov: s.prov || 'hardware', t: abs.slice(s.i, s.i + s.n) });
    }
  }
  days.set(date, d);
  return d;
}

async function saveDay(date, d) {
  const segs = [...d.segs.values()].filter((s) => s.t.length).sort((a, b) => a.t[0] - b.t[0]);
  const t0 = dayStart(date);
  const p = [];
  const segments = [];
  let prevTick = 0;
  for (const s of segs) {
    segments.push({ id: s.id, i: p.length, n: s.t.length, ...(s.disc ? { disc: 1 } : {}), ...(s.elig ? {} : { elig: false }), ...(s.prov !== 'hardware' ? { prov: s.prov } : {}) });
    for (const ms of s.t) {
      const tick = Math.round((ms - t0) * 10);
      p.push(tick - prevTick);
      prevTick = tick;
    }
  }
  const body = { schema: 'wheel-canvas.day.v1', date, t0, tickMs: 0.1, passages: p.length, segments, p };
  await writeFile(path.join(DAYS, `${date}.json`), JSON.stringify(body));
  return { date, passages: p.length, segments: segments.length, firstAt: segs.length ? new Date(segs[0].t[0]).toISOString() : null, lastAt: segs.length ? new Date(segs.at(-1).t.at(-1)).toISOString() : null };
}

async function main() {
  await mkdir(DAYS, { recursive: true });
  const state = FULL ? {} : await readJSON(path.join(OUT, 'state.json'), {});
  let cursor = state.cursor || null;
  let pages = 0, newSegs = 0;
  let meta = null;
  console.log(cursor ? `Resuming from saved cursor` : `Full crawl from the first segment`);
  for (;;) {
    const url = `${API}/v1/measurement/runs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await getJSON(url);
    pages++;
    meta = page;
    for (const it of page.items) {
      const base = isoToMs(it.startAt);
      // offsetNs is exact; keep µs precision
      const t = it.passages.map((p) => base + Number(BigInt(p.offsetNs) / 1000n) / 1000);
      // split across UTC days if needed
      const byDay = new Map();
      for (const ms of t) {
        const k = dayOf(ms);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ms);
      }
      for (const [k, arr] of byDay) {
        const d = await loadDay(k);
        const id = byDay.size > 1 ? `${it.segmentId}:${k}` : it.segmentId;
        if (!d.segs.has(id)) newSegs++;
        d.segs.set(id, { id, disc: it.discontinuity, elig: it.measurementEligible !== false, prov: it.provenance || 'hardware', t: arr });
        d.dirty = true;
      }
    }
    if (page.nextCursor) cursor = page.nextCursor;
    if (pages % 10 === 0) console.log(`  ${pages} pages, ${newSegs} new segments…`);
    if (!page.items.length || !page.nextCursor) break;
    await sleep(PAGE_DELAY_MS);
  }

  // Write dirty days
  for (const [date, d] of days) if (d.dirty) await saveDay(date, d);

  // Rebuild index from every day file on disk
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(DAYS)).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
  const index = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(DAYS, f), 'utf8'));
    let cur = j.t0, first = null, last = null;
    for (const dt of j.p) { cur += dt / 10; if (first === null) first = cur; last = cur; }
    index.push({ date: j.date, passages: j.passages, segments: j.segments.length, firstAt: first && new Date(first).toISOString(), lastAt: last && new Date(last).toISOString() });
  }

  await sleep(PAGE_DELAY_MS);
  let stats = null;
  try { stats = await getJSON(`${API}/v1/measurement/stats?range=30d`); } catch (e) { console.warn('stats failed', e.message); }
  const lifetime = stats?.lifetime;
  const mmPerPassage = lifetime ? Number(lifetime.observedDistanceMm) / Number(lifetime.acceptedWorkUnits) : null;
  const dayDistance = {};
  for (const d of stats?.activity?.days || []) if (d.distanceMm != null) dayDistance[d.date] = Number(d.distanceMm);
  for (const row of index) row.distanceMm = dayDistance[row.date] ?? null;

  const out = {
    schema: 'wheel-canvas.index.v1',
    generatedAt: new Date().toISOString(),
    source: `${API}/v1/measurement/runs`,
    installationId: meta?.installationId,
    coverageStartAt: meta?.coverageStartAt,
    coverageThroughAt: meta?.coverageThroughAt,
    mmPerPassage,
    lifetime: lifetime || null,
    records: stats?.records || null,
    days: index,
  };
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(out, null, 1));
  await writeFile(path.join(OUT, 'state.json'), JSON.stringify({ cursor, updatedAt: out.generatedAt }, null, 1));
  console.log(`Done: ${pages} pages, ${newSegs} new segments, ${index.length} days, mm/passage ≈ ${mmPerPassage?.toFixed(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
