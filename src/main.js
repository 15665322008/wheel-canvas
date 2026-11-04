import './style.css';
import { analyzeDay, isoDay, dayStartMs, DEFAULT_MM_PER_PASSAGE, RUN_BREAK_MS, RUNNING_GAP_MS } from './analyze.js';
import { dayScene, runScene, drawScene, sceneToSVG, PALETTES, ramp, V_MIN, V_MAX } from './art.js';
import { loadIndex, loadDay, getDay, knownDates, startLive, onData, live, wheelState, getIndex } from './data.js';
import { t, getLang, setLang, ago } from './i18n.js';

const REPO_URL = 'https://github.com/15665322008/wheel-canvas';
const FIRST_DAY = '2026-10-26';
const params = new URLSearchParams(location.search);
const OVERLAY = params.get('overlay') === '1';
const app = document.getElementById('app');

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const d = document.createElement('template'); d.innerHTML = html.trim(); return d.content; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => Number(n).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const km = (m) => fmt(m / 1000, 2) + ' km';
const ms2 = (v) => fmt(v, 2) + ' m/s';
const hms = (ms) => (ms == null ? '—' : new Date(ms).toISOString().slice(11, 19) + ' UTC');
function dur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
const mm = () => getIndex()?.mmPerPassage || DEFAULT_MM_PER_PASSAGE;
const today = () => isoDay(Date.now());
const shiftDay = (d, k) => isoDay(dayStartMs(d) + k * 86_400_000);
const siteUrl = (hash) => `${location.origin}/${hash}`;

const analysisCache = new Map();
function analysis(date) {
  const tt = getDay(date);
  const c = analysisCache.get(date);
  if (c && c.t === tt) return c.a;
  const a = analyzeDay(tt, mm());
  analysisCache.set(date, { t: tt, a });
  return a;
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportPNG(scene, name) {
  const c = document.createElement('canvas');
  drawScene(c, scene, scene.w, 2);
  c.toBlob((b) => download(name, b), 'image/png');
}
function exportSVG(scene, name, title) { download(name, new Blob([sceneToSVG(scene, title)], { type: 'image/svg+xml' })); }
const xIntent = (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

function stat(label, value, sub = '') {
  return `<div class="stat"><div class="stat-l">${esc(label)}</div><div class="stat-v">${value}</div>${sub ? `<div class="stat-s">${sub}</div>` : ''}</div>`;
}

function stateBadge() {
  const s = wheelState();
  const names = { running: 'stRunning', resting: 'stResting', asleep: 'stAsleep', offline: 'stOffline', unknown: 'stUnknown' };
  const desc = t(names[s.key] + 'D', { ago: s.last ? ago(s.last) : '—' });
  return { s, html: `<span class="state state-${s.key}"><i></i>${esc(t(names[s.key]))}</span>`, desc };
}

function legendHTML() {
  const pal = PALETTES[0].stops;
  const dots = Array.from({ length: 12 }, (_, i) => `<i style="background:${ramp(pal, i / 11)};width:${6 + i * 0.6}px;height:${6 + i * 0.6}px"></i>`).join('');
  return `<div class="legend"><span>${esc(t('legendSlow'))} ${V_MIN} m/s</span><span class="legend-dots">${dots}</span><span>${V_MAX} m/s ${esc(t('legendFast'))}</span></div>`;
}

// ---------- layout ----------
function shell(content, active) {
  const nav = [['#/', 'navToday', 'today'], ['#/gallery', 'navGallery', 'gallery'], ['#/how', 'navHow', 'how']]
    .map(([href, k, id]) => `<a href="${href}" class="${active === id ? 'on' : ''}">${esc(t(k))}</a>`).join('');
  app.innerHTML = '';
  app.append(h(`
  <header class="top">
    <a class="logo" href="#/" aria-label="Wheel Canvas home">
      <svg viewBox="0 0 10 10" width="28" height="28" aria-hidden="true">${logoDots()}</svg>
      <span><b>${esc(t('brand'))}</b><small>${esc(t('brandSub'))}</small></span>
    </a>
    <nav>${nav}</nav>
    <button class="lang" id="lang" aria-label="Switch language">${getLang() === 'zh' ? 'EN' : '中文'}</button>
  </header>
  <main id="view">${content}</main>
  <footer class="foot">
    <p><b>${esc(t('footer'))}</b></p>
    <p>${esc(t('footerData'))} ${esc(t('utcNote'))}</p>
    <p class="foot-links"><a href="${REPO_URL}" rel="noopener">${esc(t('source'))}</a> · <a href="https://docs.squeekchain.com/developers/api/" rel="noopener">API</a> · <a href="#/how">${esc(t('navHow'))}</a> · <a href="#/how#overlay">${esc(t('navOverlay'))}</a> · MIT</p>
  </footer>`));
  $('#lang').onclick = () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); route(); };
}
function logoDots() {
  let s = '';
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const d = Math.hypot(x - 4.5, y - 4.5);
    const on = d > 2.6 && d < 4.6 && !(x > 5 && y < 4);
    s += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="${on ? 0.42 : 0.16}" fill="${on ? (d > 3.6 ? '#F2C230' : '#9B45DE') : '#3a3a44'}"/>`;
  }
  return s;
}

// ---------- canvases ----------
function paintDay(canvas, date, width, extra = {}) {
  const tt = getDay(date), a = analysis(date);
  const isToday = date === today();
  const scene = dayScene(date, tt, a, { nowMs: isToday ? Date.now() : null, running: isToday && wheelState().key === 'running', ...extra });
  drawScene(canvas, scene, width || canvas.clientWidth || 540);
  return { scene, a };
}

// ---------- views ----------
let unsub = null;
const cleanup = () => { if (unsub) { unsub(); unsub = null; } };

async function viewHome() {
  const date = today();
  shell(`
  <section class="hero">
    <div class="hero-copy">
      <p class="kicker">${esc(t('heroKicker'))}</p>
      <h1>${esc(t('heroTitle'))}</h1>
      <p class="lead">${esc(t('heroBody'))}</p>
      <div class="status-card" id="status"></div>
      <div class="stats" id="todayStats"></div>
      <div class="actions" id="todayActions"></div>
    </div>
    <figure class="art-frame">
      <canvas id="todayArt" class="art" aria-label="Today's painting"></canvas>
      <figcaption><span id="todayCap"></span>${legendHTML()}</figcaption>
    </figure>
  </section>
  <section class="band">
    <div class="band-head"><h2>${esc(t('navGallery'))}</h2><a href="#/gallery">${esc(t('allDays'))} →</a></div>
    <div class="cards cards-4" id="recent"></div>
  </section>`, 'today');
  await loadDay(date);
  const render = () => {
    const canvas = $('#todayArt');
    if (!canvas) return;
    const { scene, a } = paintDay(canvas, date, canvas.clientWidth);
    const b = stateBadge();
    const m = b.s.m;
    const proj = live.status?.builder?.projected?.blockHeight;
    $('#status').innerHTML = `<div class="status-row">${b.html}<span class="muted">${esc(b.desc)}</span></div>
      <div class="status-nums">
        ${stat(t('rpm'), m ? fmt(m.rpmMilli / 1000, 1) : '—')}
        ${stat(t('speed'), m ? ms2(m.speedMmPerSecond / 1000) : '—')}
        ${stat(t('todayDist'), m ? km(m.distanceMm / 1000) : '—')}
        ${stat(t('block'), proj ? '#' + fmt(proj) : '—')}
      </div>`;
    $('#todayStats').innerHTML = stat(t('passages'), fmt(a.passages)) + stat(t('distance'), km(a.distanceM)) + stat(t('runs'), fmt(a.runs.length)) + stat(t('activeTime'), dur(a.activeMs));
    $('#todayCap').textContent = `${t('todayTitle')} · ${date} · ${live.catchingUp ? t('catching') : t('liveGrowing')}`;
    const acts = $('#todayActions');
    if (!acts.dataset.ready) {
      acts.dataset.ready = 1;
      acts.innerHTML = `<a class="btn primary" href="#/day/${date}">${esc(t('openDay'))}</a>
        <button class="btn" id="dlPng">${esc(t('downloadPng'))}</button><button class="btn" id="dlSvg">${esc(t('downloadSvg'))}</button>
        <a class="btn" id="shareX" target="_blank" rel="noopener">${esc(t('shareX'))}</a>`;
    }
    $('#dlPng').onclick = () => exportPNG(dayScene(date, getDay(date), analysis(date), {}), `wheel-canvas-${date}.png`);
    $('#dlSvg').onclick = () => exportSVG(dayScene(date, getDay(date), analysis(date), {}), `wheel-canvas-${date}.svg`, `Wheel Canvas ${date}`);
    $('#shareX').href = xIntent(t('shareDayText', { date, n: fmt(a.passages), km: fmt(a.distanceM / 1000, 2) }), siteUrl(`#/day/${date}`));
    void scene;
  };
  render();
  unsub = onData(throttle(render, 1500));
  const clock = setInterval(() => { if ($('#todayArt')) render(); else clearInterval(clock); }, 30_000);
  // recent days
  const dates = knownDates().filter((d) => d < date).slice(-4).reverse();
  $('#recent').innerHTML = dates.map(cardHTML).join('');
  hydrateCards($('#recent'));
  const onResize = throttle(() => { if ($('#todayArt')) render(); }, 300);
  window.addEventListener('resize', onResize);
  const prevUnsub = unsub;
  unsub = () => { prevUnsub && prevUnsub(); window.removeEventListener('resize', onResize); clearInterval(clock); };
}

function cardHTML(date) {
  return `<a class="card" href="#/day/${date}" data-date="${date}"><canvas class="thumb" width="1" height="1"></canvas><div class="card-meta"><b>${date}</b><span class="muted" data-meta>…</span></div></a>`;
}
function hydrateCards(root) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const date = e.target.dataset.date;
      loadDay(date).then(() => {
        const c = $('canvas', e.target);
        const { a } = paintDay(c, date, c.clientWidth || 260, { bare: false });
        $('[data-meta]', e.target).textContent = `${fmt(a.passages)} · ${km(a.distanceM)}`;
      });
    }
  }, { rootMargin: '800px 0px' });
  root.querySelectorAll('.card').forEach((el) => io.observe(el));
}

async function viewGallery() {
  shell(`<section class="page-head"><h1>${esc(t('galleryTitle'))}</h1><p class="lead">${esc(t('gallerySub'))}</p></section>
    <div class="cards" id="grid"></div>`, 'gallery');
  await loadIndex();
  const dates = knownDates().filter((d) => d >= FIRST_DAY).reverse();
  $('#grid').innerHTML = dates.map(cardHTML).join('');
  hydrateCards($('#grid'));
}

async function viewDay(date) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return viewNotFound();
  shell(`<div class="loading">${esc(t('loading'))}</div>`, 'gallery');
  await loadDay(date);
  const render = () => {
    const a = analysis(date);
    const prev = shiftDay(date, -1), next = shiftDay(date, 1);
    const isToday = date === today();
    $('#view').innerHTML = `
    <section class="page-head row">
      <div><p class="kicker">${isToday ? esc(t('liveGrowing')) : esc(t('finished'))} · UTC</p><h1>${date}</h1></div>
      <div class="pager">${prev >= FIRST_DAY ? `<a class="btn" href="#/day/${prev}">${esc(t('prev'))}</a>` : ''}${next <= today() ? `<a class="btn" href="#/day/${next}">${esc(t('next'))}</a>` : ''}</div>
    </section>
    <section class="detail">
      <figure class="art-frame"><canvas id="dayArt" class="art"></canvas><figcaption>${legendHTML()}</figcaption></figure>
      <div class="side">
        ${a.passages ? '' : `<p class="empty">${esc(t('noData'))}</p>`}
        <div class="stats stats-2">
          ${stat(t('passages'), fmt(a.passages))}
          ${stat(t('distance'), km(a.distanceM), `≈ ${fmt(mm(), 0)} mm / turn`)}
          ${stat(t('runs'), fmt(a.runs.length), `> ${RUN_BREAK_MS / 1000}s rest = new run`)}
          ${stat(t('activeTime'), dur(a.activeMs))}
          ${stat(t('avgSpeed'), ms2(a.avgSpeed))}
          ${stat(t('peakSpeed'), ms2(a.peakSpeed), '5-turn median')}
          ${stat(t('longestRun'), a.longestRun ? dur(a.longestRun.durMs) : '—', a.longestRun ? `<a href="#/run/${date}/${a.longestRun.index}">${t('run')} #${a.longestRun.index}</a>` : '')}
          ${stat(t('longestRest'), a.longestRestMs ? dur(a.longestRestMs) : '—')}
          ${stat(t('firstTurn'), hms(a.firstAt))}
          ${stat(t('lastTurn'), hms(a.lastAt))}
          ${stat(t('fingerprint'), `<code>#${a.fingerprint}</code>`)}
          ${stat(t('palette'), dayScene(date, new Float64Array(0), a, { bare: true }).palette.name)}
          ${officialDistance(date)}
        </div>
        <div class="actions">
          <button class="btn" id="dlPng">${esc(t('downloadPng'))}</button><button class="btn" id="dlSvg">${esc(t('downloadSvg'))}</button>
          <a class="btn primary" target="_blank" rel="noopener" href="${xIntent(t('shareDayText', { date, n: fmt(a.passages), km: fmt(a.distanceM / 1000, 2) }), siteUrl(`#/day/${date}`))}">${esc(t('shareX'))}</a>
        </div>
      </div>
    </section>
    <section class="band"><h2>${esc(t('hourly'))}</h2>${hourlyHTML(a.hours)}</section>
    <section class="band"><h2>${esc(t('runsList'))} <span class="muted">(${a.runs.length})</span></h2>${runsTable(date, a)}</section>`;
    paintDay($('#dayArt'), date, $('#dayArt').clientWidth);
    $('#dlPng').onclick = () => exportPNG(dayScene(date, getDay(date), analysis(date), {}), `wheel-canvas-${date}.png`);
    $('#dlSvg').onclick = () => exportSVG(dayScene(date, getDay(date), analysis(date), {}), `wheel-canvas-${date}.svg`, `Wheel Canvas ${date}`);
  };
  render();
  if (date === today()) unsub = onData(throttle(render, 3000));
}
function officialDistance(date) {
  const row = getIndex()?.days?.find((d) => d.date === date);
  return row?.distanceMm ? stat(t('officialDist'), km(row.distanceMm / 1000), '/v1/measurement/stats') : '';
}
function hourlyHTML(hours) {
  const max = Math.max(1, ...hours), rows = 10;
  const cols = hours.map((n, hr) => {
    const lit = n ? Math.max(1, Math.round((n / max) * rows)) : 0;
    const dots = Array.from({ length: rows }, (_, r) => { const on = rows - r <= lit; return `<i class="${on ? 'on' : ''}" style="${on ? `background:${ramp(PALETTES[0].stops, (rows - r) / rows)}` : ''}"></i>`; }).join('');
    return `<div class="hcol" title="${String(hr).padStart(2, '0')}:00 UTC · ${n}"><div class="hdots">${dots}</div><span>${hr % 3 === 0 ? String(hr).padStart(2, '0') : ''}</span></div>`;
  }).join('');
  return `<div class="hourly">${cols}</div>`;
}
function runsTable(date, a) {
  if (!a.runs.length) return `<p class="muted">${esc(t('noData'))}</p>`;
  const rows = a.runs.map((r) => `<tr><td><a href="#/run/${date}/${r.index}">#${r.index}</a></td><td>${hms(r.start).slice(0, 8)}</td><td>${dur(r.durMs)}</td><td>${fmt(r.n)}</td><td>${fmt(r.distanceM, 0)} m</td><td>${ms2(r.avgSpeed)}</td><td>${ms2(r.peakSpeed)}</td><td>${r.pauses}</td></tr>`).join('');
  return `<div class="table-wrap"><table class="runs"><thead><tr><th>${esc(t('run'))}</th><th>${esc(t('start'))} (UTC)</th><th>${esc(t('duration'))}</th><th>${esc(t('passages'))}</th><th>${esc(t('distance'))}</th><th>${esc(t('avgSpeed'))}</th><th>${esc(t('peakSpeed'))}</th><th>${esc(t('stumbles'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function viewRun(date, idx) {
  shell(`<div class="loading">${esc(t('loading'))}</div>`, 'gallery');
  await loadDay(date);
  const a = analysis(date), tt = getDay(date);
  const run = a.runs[Number(idx) - 1];
  if (!run) return viewNotFound();
  const scene = runScene(date, tt, a, run);
  $('#view').innerHTML = `
  <section class="page-head row">
    <div><p class="kicker"><a href="#/day/${date}">${date}</a> · UTC</p><h1>${esc(t('run'))} #${run.index}</h1></div>
    <div class="pager"><a class="btn" href="#/day/${date}">${esc(t('back'))}</a>${run.index > 1 ? `<a class="btn" href="#/run/${date}/${run.index - 1}">${esc(t('prev'))}</a>` : ''}${run.index < a.runs.length ? `<a class="btn" href="#/run/${date}/${run.index + 1}">${esc(t('next'))}</a>` : ''}</div>
  </section>
  <figure class="art-frame wide"><canvas id="runArt" class="art"></canvas></figure>
  <section class="stats stats-4">
    ${stat(t('start'), hms(run.start))}${stat(t('end'), hms(run.end))}${stat(t('duration'), dur(run.durMs))}${stat(t('activeTime'), dur(run.activeMs))}
    ${stat(t('passages'), fmt(run.n))}${stat(t('distance'), fmt(run.distanceM, 0) + ' m')}${stat(t('avgSpeed'), ms2(run.avgSpeed))}${stat(t('peakSpeed'), ms2(run.peakSpeed))}
    ${stat(t('maxGap'), dur(run.maxGapMs))}${stat(t('stumbles'), fmt(run.pauses), `> ${RUNNING_GAP_MS / 1000}s`)}${stat(t('fingerprint'), `<code>#${a.fingerprint}</code>`, 'day')}${stat(t('palette'), scene.palette.name)}
  </section>
  <div class="actions">
    <button class="btn" id="dlPng">${esc(t('downloadPng'))}</button><button class="btn" id="dlSvg">${esc(t('downloadSvg'))}</button>
    <a class="btn primary" target="_blank" rel="noopener" href="${xIntent(t('shareRunText', { date, i: run.index, n: fmt(run.n), peak: fmt(run.peakSpeed, 2) }), siteUrl(`#/run/${date}/${run.index}`))}">${esc(t('shareX'))}</a>
  </div>`;
  drawScene($('#runArt'), scene, $('#runArt').clientWidth);
  $('#dlPng').onclick = () => exportPNG(scene, `wheel-canvas-${date}-run${run.index}.png`);
  $('#dlSvg').onclick = () => exportSVG(scene, `wheel-canvas-${date}-run${run.index}.svg`, `Wheel Canvas ${date} run ${run.index}`);
}

async function viewHow() {
  const zh = getLang() === 'zh';
  const overlayUrl = `${location.origin}/?overlay=1${zh ? '&lang=zh' : ''}`;
  const S = zh ? HOW_ZH : HOW_EN;
  shell(`<article class="prose">
    <p class="kicker">${esc(t('navHow'))}</p>
    <h1>${S.title}</h1>
    <p class="lead">${S.intro}</p>
    <figure class="how-fig"><canvas id="howArt" class="art"></canvas><figcaption>${S.figcap}</figcaption></figure>
    ${S.body}
    ${legendHTML()}
    <h2 id="overlay">${esc(t('overlayTitle'))}</h2>
    <p>${esc(t('overlayBody'))}</p>
    <div class="copyrow"><code id="ovUrl">${esc(overlayUrl)}</code><button class="btn" id="copyOv">${esc(t('copy'))}</button></div>
    <p class="muted">${S.overlayOpts}</p>
    ${S.data}
  </article>`, 'how');
  $('#copyOv').onclick = async () => { try { await navigator.clipboard.writeText(overlayUrl); $('#copyOv').textContent = t('copied'); } catch { /* ignore */ } };
  await loadIndex();
  const best = (getIndex()?.days || []).reduce((b, d) => (!b || d.passages > b.passages ? d : b), null);
  const date = best?.date || today();
  await loadDay(date);
  paintDay($('#howArt'), date, $('#howArt').clientWidth);
  if (location.hash.endsWith('#overlay')) $('#overlay')?.scrollIntoView();
}

const HOW_EN = {
  title: 'How a day becomes a painting',
  intro: 'Nothing here is random. The painting is a pure function of the passage timestamps the wheel sensor signed, so anyone with the same data gets the same picture, dot for dot.',
  figcap: "The busiest day so far. Read it like a clock: midnight UTC at the top, clockwise through the day.",
  body: `
  <h2>1 · The raw data</h2>
  <p>Every time the magnet on WHEELY9000 passes the sensor, the device records the exact time (nanosecond offsets). Those passages are published by <code>GET /v1/measurement/runs</code>. One passage is one wheel turn and one unit of Squeekchain work. One turn ≈ 878 mm (lifetime distance ÷ lifetime work units).</p>
  <h2>2 · Turns → speed</h2>
  <p>For each turn we look at the gap to the previous one. Gaps up to 5 s count as running; speed = 0.878 m ÷ the median of the last five gaps (the median removes sensor jitter). Gaps of 5–60 s are <em>stumbles</em>. A rest longer than 60 s ends a <em>run</em>.</p>
  <h2>3 · The day painting</h2>
  <ul>
    <li><b>Grid:</b> a 60 × 60 dot matrix, the same on every day.</li>
    <li><b>Angle = time of day.</b> 24 hours around the circle, 00:00 UTC at the top, clockwise. The outer dots are hour ticks.</li>
    <li><b>Distance from the centre = speed.</b> 0.75 m/s at the inner ring, 1.35 m/s at the outer ring (fixed, so days are comparable).</li>
    <li><b>Dot size and brightness = how many turns</b> landed in that cell (each turn inks its cell fully and the cells just inside and outside at half strength), corrected for the cell's angular width so the outer ring is not unfairly faint.</li>
    <li><b>Colour</b> follows speed through a five-stop palette. The palette is chosen by the day's <b>fingerprint</b>: an FNV-1a hash of all passage times (0.1 ms precision). Five palettes: Sunflower, Night Shift, Seed Husk, Clover, Ember.</li>
    <li><b>Sparks</b> on the rim mark the start of each run; bigger spark = longer run.</li>
    <li><b>The hamster</b> in the middle is a small original dot glyph. On a live day it lights up while Squeektoshi is running, and a faint hand shows the current time; hours still to come are dimmed.</li>
  </ul>
  <h2>4 · The run portrait</h2>
  <p>Each run gets its own 1200 × 630 card: a dot-matrix equaliser. The run's duration is split into 56 equal columns; column height is the average speed in that slice; the top dot is highlighted; pink dots under the baseline mark stumbles.</p>
  <h2>5 · Exports</h2>
  <p>The renderer produces a list of dots and labels. The same list is drawn on the screen, rasterised into the PNG (2×) and serialised into the SVG, so downloads always match what you see.</p>`,
  overlayOpts: 'Options: <code>&amp;lang=zh</code> or <code>&amp;lang=en</code>, <code>&amp;size=320</code> (painting width in px), <code>&amp;stats=0</code> (painting only). Suggested OBS source size: 360 × 470.',
  data: `<h2>Data &amp; respect for the API</h2>
  <p>A GitHub Action runs <code>scripts/snapshot.mjs</code> every day and commits compact JSON to <code>/data</code>, so the gallery loads from static files. In the browser only the newest segments are fetched live (one page at a time, ≥ 0.7 s apart, only while the tab is visible), and <code>/v1/status</code> is polled about every 10 s. The data comes from Squeekchain's Sepolia testnet deployment and is device evidence, not certified core work: it is for display only.</p>`,
};
const HOW_ZH = {
  title: '一天是怎样变成一幅画的',
  intro: '这里没有任何随机数。画作完全由跑轮传感器签名的经过时间计算得出，任何人拿到同样的数据，都会得到一模一样的画，每一个点都相同。',
  figcap: '目前最忙的一天。像看时钟一样看它：UTC 午夜在正上方，顺时针走完一天。',
  body: `
  <h2>1 · 原始数据</h2>
  <p>WHEELY9000 上的磁铁每经过一次传感器，设备就记录下精确时间（纳秒级偏移），通过 <code>GET /v1/measurement/runs</code> 公开。一次经过 = 跑轮转一圈 = Squeekchain 的一份工作量。一圈约 878 毫米（累计距离 ÷ 累计工作量）。</p>
  <h2>2 · 圈数 → 速度</h2>
  <p>每一圈都看它和上一圈的间隔。间隔不超过 5 秒算在跑；速度 = 0.878 米 ÷ 最近五个间隔的中位数（中位数可以去掉传感器抖动）。5–60 秒的间隔算作<em>停顿</em>；休息超过 60 秒，这一次<em>跑步</em>就结束了。</p>
  <h2>3 · 每日画作</h2>
  <ul>
    <li><b>网格：</b>60 × 60 的点阵，每天都一样。</li>
    <li><b>角度 = 一天中的时间。</b>一圈 24 小时，UTC 00:00 在正上方，顺时针。最外圈的小点是小时刻度。</li>
    <li><b>离圆心的距离 = 速度。</b>内圈 0.75 米/秒，外圈 1.35 米/秒（固定刻度，不同日子可以直接比较）。</li>
    <li><b>点的大小和亮度 = 落在这个格子里的圈数</b>（每一圈给所在格子记满一份，内外相邻格子各记半份），并按格子的角宽度做了校正，外圈不会显得偏暗。</li>
    <li><b>颜色</b>按速度沿五色调色板变化。调色板由当天的<b>数据指纹</b>决定：对全部经过时间（0.1 毫秒精度）做 FNV-1a 哈希。共五套：Sunflower、Night Shift、Seed Husk、Clover、Ember。</li>
    <li>边缘的<b>火花</b>标出每次跑步的开始，火花越大，那次跑得越久。</li>
    <li>中间的<b>小仓鼠</b>是原创的点阵图形。当天直播时，Squeektoshi 在跑它就会亮起来；一根淡淡的指针指向当前时间，还没到的时段会变暗。</li>
  </ul>
  <h2>4 · 单次跑步画像</h2>
  <p>每次跑步都有一张 1200 × 630 的卡片：点阵均衡器。把这次跑步的时长平均分成 56 列，每列高度是这段时间的平均速度，顶端的点会高亮；基线下方的粉色点表示停顿。</p>
  <h2>5 · 导出</h2>
  <p>渲染器先生成一组点和文字，同一组数据既画在屏幕上，也栅格化成 PNG（2 倍），也序列化成 SVG，所以下载的文件永远和你看到的一致。</p>`,
  overlayOpts: '参数：<code>&amp;lang=zh</code> 或 <code>&amp;lang=en</code>，<code>&amp;size=320</code>（画作宽度，像素），<code>&amp;stats=0</code>（只显示画）。建议 OBS 源尺寸：360 × 470。',
  data: `<h2>数据与对 API 的尊重</h2>
  <p>GitHub Action 每天运行 <code>scripts/snapshot.mjs</code>，把压缩后的 JSON 提交到 <code>/data</code>，画廊直接读静态文件。浏览器只实时拉取最新的片段（一次一页，间隔至少 0.7 秒，只在页面可见时），<code>/v1/status</code> 大约每 10 秒查询一次。数据来自 Squeekchain 的 Sepolia 测试网部署，是设备证据而非核心认证的工作量，仅供展示。</p>`,
};

function viewNotFound() {
  shell(`<section class="page-head"><h1>404</h1><p class="lead"><a href="#/">← ${esc(t('navToday'))}</a></p></section>`, '');
}

// ---------- overlay ----------
async function overlay() {
  document.documentElement.classList.add('overlay');
  const size = Math.max(160, Math.min(1080, Number(params.get('size')) || 320));
  const showStats = params.get('stats') !== '0';
  app.innerHTML = `<div class="ov" style="width:${size}px"><canvas id="ovArt" style="width:${size}px;height:${size}px"></canvas>${showStats ? '<div class="ov-bar" id="ovBar"></div>' : ''}</div>`;
  const date = () => today();
  await loadDay(date());
  const render = () => {
    const d = date();
    const tt = getDay(d), a = analysis(d);
    const scene = dayScene(d, tt, a, { nowMs: Date.now(), running: wheelState().key === 'running', transparent: true, bare: true });
    drawScene($('#ovArt'), scene, size);
    if (showStats) {
      const b = stateBadge(), m = b.s.m;
      $('#ovBar').innerHTML = `${b.html}<span>${fmt(a.passages)} ${esc(t('passages'))}</span><span>${km(a.distanceM)}</span>${m && m.rpmMilli ? `<span>${fmt(m.rpmMilli / 1000, 0)} rpm</span>` : ''}<span class="ov-brand">${esc(t('brand'))}</span>`;
    }
  };
  render();
  onData(throttle(render, 1000));
  setInterval(render, 30_000);
  startLive();
}

// ---------- router ----------
function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...args) => {
    const now = Date.now();
    clearTimeout(timer);
    if (now - last >= ms) { last = now; fn(...args); } else timer = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last));
  };
}

async function route() {
  cleanup();
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('#')[0].split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) await viewHome();
    else if (parts[0] === 'gallery') await viewGallery();
    else if (parts[0] === 'how') await viewHow();
    else if (parts[0] === 'day' && parts[1]) await viewDay(parts[1]);
    else if (parts[0] === 'run' && parts[1] && parts[2]) await viewRun(parts[1], parts[2]);
    else viewNotFound();
  } catch (e) {
    console.error(e);
    $('#view') && ($('#view').innerHTML = `<p class="empty">Error: ${esc(e.message)}</p>`);
  }
  document.title = `${t('brand')} · ${t('brandSub')}`;
}

(async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* ignore */ }
  if (OVERLAY) return overlay();
  window.addEventListener('hashchange', route);
  await route();
  startLive();
})();
