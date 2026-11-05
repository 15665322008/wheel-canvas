// 个人预测画 / Prediction Painting.
// Guess how many wheel passages the open 10-minute round will end with. The guess is
// stored in this browser only (localStorage). When the round is covered by the passage
// evidence, the real count is read from the passage timestamps and a deterministic
// painting is made from those timestamps combined with the guess.
import { speeds, fingerprint, DEFAULT_MM_PER_PASSAGE } from './analyze.js';
import { predictionScene, drawScene } from './art.js';
import { live, onData, catchUp, getIndex, loadIndex } from './data.js';
import { loadSchedule, roundAt, roundWindow, openRoundWork, passagesIn, coverageFor, roundHint } from './rounds.js';
import { t, getLang } from './i18n.js';

const LS = 'wc-predictions';
const LOCK_MS = 30_000; // no new guesses in the last 30 s of a round
const MAX_GUESS = 1500;
const KEEP = 200;

// ---------- store ----------
export function loadStore() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && Array.isArray(j.items)) return j; } catch { /* ignore */ }
  return { v: 1, items: [] };
}
function saveStore(s) {
  s.items.sort((a, b) => b.start - a.start);
  s.items = s.items.slice(0, KEEP);
  try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { console.warn('localStorage full', e); }
}
const keyOf = (w) => `${w.installationId || '?'}:${w.round}`;

export function score(guess, actual) {
  const err = Math.abs(guess - actual);
  return Math.max(0, Math.round((1 - err / Math.max(actual, 30)) * 1000) / 10);
}
/** Seed for the painting: data fingerprint mixed with the guess (FNV-1a step). */
function seedOf(times, guess) {
  let h = parseInt(fingerprint(Float64Array.from(times)), 16) >>> 0;
  for (let b = 0, x = guess; b < 4; b++) { h ^= x & 0xff; x >>>= 8; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
export function sceneFor(item, opts = {}) {
  const times = (item.offs || []).map((o) => item.start + o);
  const mm = getIndex()?.mmPerPassage || DEFAULT_MM_PER_PASSAGE;
  const v = speeds(times, mm);
  return predictionScene({ ...item, seed: seedOf(times, item.guess) }, times, v, opts);
}

export function stats(items) {
  const done = items.filter((x) => x.status === 'resolved').sort((a, b) => b.start - a.start);
  let streak = 0;
  for (const x of done) { if (x.acc >= 80) streak++; else break; }
  let best = 0, run = 0;
  for (const x of [...done].reverse()) { run = x.acc >= 80 ? run + 1 : 0; best = Math.max(best, run); }
  return {
    n: done.length,
    avg: done.length ? done.reduce((s, x) => s + x.acc, 0) / done.length : null,
    top: done.length ? Math.max(...done.map((x) => x.acc)) : null,
    streak, best,
    bull: done.filter((x) => x.acc >= 95).length,
    pending: items.filter((x) => x.status === 'pending').length,
  };
}

/** Try to resolve every pending guess whose round has ended. Returns true if anything changed. */
export async function resolvePending() {
  const s = loadStore();
  await loadIndex();
  let changed = false;
  for (const it of s.items) {
    if (it.status !== 'pending' || Date.now() < it.end + 10_000) continue;
    const cov = coverageFor(it, getIndex());
    if (!cov) {
      // The API was re-deployed after the guess and the old round never reached our data.
      const inst = live.status?.installationId;
      if (inst && it.installationId && inst !== it.installationId && Date.now() - it.end > 3600_000) { it.status = 'void'; changed = true; }
      continue;
    }
    const times = await passagesIn(it.start, it.end);
    it.actual = times.length;
    it.offs = times.map((x) => Math.round(x - it.start));
    it.acc = score(it.guess, it.actual);
    it.status = 'resolved';
    it.resolvedAt = Date.now();
    it.source = cov;
    changed = true;
  }
  if (changed) saveStore(s);
  return changed;
}

// ---------- view ----------
export async function viewPredict(ctx, args = []) {
  const { shell, $, esc, fmt, stat, stateBadge, exportPNG, xIntent, siteUrl, setCleanup, throttle } = ctx;
  if (args[0]) return viewShared(ctx, args);
  const zh = getLang() === 'zh';
  shell(`
  <section class="page-head">
    <p class="kicker">${esc(t('predKicker'))}</p>
    <h1>${esc(t('predTitle'))}</h1>
    <p class="lead">${esc(t('predLead'))}</p>
  </section>
  <section class="pred">
    <div class="pred-left">
      <div class="status-card round-card" id="roundCard"><p class="muted">${esc(t('loading'))}</p></div>
      <div class="status-card" id="guessCard"></div>
    </div>
    <figure class="art-frame" id="resultFrame">
      <canvas id="predArt" class="art" aria-label="Prediction painting"></canvas>
      <figcaption id="predCap"></figcaption>
      <div id="resultBox"></div>
    </figure>
  </section>
  <section class="band">
    <div class="band-head"><h2>${esc(t('predHistory'))}</h2><span class="muted">${esc(t('predLocal'))}</span></div>
    <div class="stats" id="predStats"></div>
    <div class="cards" id="predList"></div>
  </section>`, 'predict');

  await Promise.all([loadSchedule(), loadIndex()]);
  let hint = null;
  roundHint().then((x) => { hint = x; renderGuess(true); }).catch(() => {});
  let selected = null; // id of the history item shown in the result card
  let draftGuess = null;

  const target = () => {
    const now = Date.now();
    let w = roundWindow(roundAt(now));
    if (w.end - now < LOCK_MS) w = roundWindow(w.round + 1);
    return w;
  };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  function renderRound() {
    const now = Date.now();
    const cur = roundWindow(roundAt(now));
    const left = cur.end - now;
    const so = openRoundWork();
    const elapsed = (now - cur.start) / 1000;
    const pace = so != null && elapsed > 45 ? Math.round((so * 600) / elapsed) : null;
    const b = stateBadge();
    const dots = Array.from({ length: 60 }, (_, i) => `<i class="${i < Math.floor(elapsed / 10) ? 'on' : ''}"></i>`).join('');
    $('#roundCard').innerHTML = `
      <div class="status-row">${b.html}<span class="muted">${esc(b.desc)}</span></div>
      <div class="round-head"><div><div class="stat-l">${esc(t('predRound'))}</div><div class="round-no">#${cur.round}</div></div>
        <div class="round-cd"><div class="stat-l">${esc(t('predEndsIn'))}</div><div class="cd">${mmss(left)}</div></div></div>
      <div class="round-dots" aria-hidden="true">${dots}</div>
      <div class="status-nums">
        ${stat(t('predSoFar'), so != null ? fmt(so) : '—', esc(t('predSoFarS')))}
        ${stat(t('predPace'), pace != null ? '≈ ' + fmt(pace) : '—', esc(t('predPaceS')))}
        ${stat(t('predWindow'), `<span class="small-v">${new Date(cur.start).toISOString().slice(11, 16)}–${new Date(cur.end).toISOString().slice(11, 16)}</span>`, 'UTC')}
      </div>
      ${live.error ? `<p class="warn">${esc(t('predApiErr'))}</p>` : ''}`;
  }

  function renderGuess(force) {
    const box = $('#guessCard');
    if (!box) return;
    const w = target();
    const s = loadStore();
    const mine = s.items.find((x) => x.id === keyOf(w));
    const sig = `${w.round}:${mine ? mine.guess : ''}:${hint ? hint.median : ''}`;
    if (!force && box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const isNext = w.round !== roundAt(Date.now());
    if (mine) {
      box.innerHTML = `<div class="locked"><span class="lock">🔒</span><div><b>${esc(t('predLocked', { round: w.round, guess: fmt(mine.guess) }))}</b>
        <p class="muted">${esc(t('predLockedS'))}</p></div></div>`;
      return;
    }
    const sug = hint ? Math.round(hint.median) : 300;
    const val = draftGuess ?? sug;
    const hintTxt = hint
      ? t(hint.source === 'api' ? 'predHintApi' : 'predHintLocal', { med: fmt(hint.median), p90: fmt(hint.p90), rate: hint.activeRate != null ? fmt(hint.activeRate, 0) : '—', max: fmt(hint.max) })
      : t('predHintNone');
    box.innerHTML = `
      <h2 class="h3">${esc(t(isNext ? 'predAskNext' : 'predAsk', { round: w.round }))}</h2>
      <div class="guess-row">
        <input type="range" id="gRange" min="0" max="${MAX_GUESS}" step="1" value="${val}" aria-label="guess" />
        <input type="number" id="gNum" min="0" max="${MAX_GUESS}" step="1" value="${val}" inputmode="numeric" aria-label="guess number" />
      </div>
      <p class="muted hint">💡 ${esc(hintTxt)}</p>
      <div class="actions"><button class="btn primary" id="gGo">${esc(t('predSubmit'))}</button>
        ${hint ? `<button class="btn" id="gMed">${esc(t('predUseMed'))}</button>` : ''}
        <button class="btn" id="gZero">${esc(t('predSleep'))}</button></div>
      <p class="muted small">${esc(t('predRules'))}</p>`;
    const sync = (v) => { const n = Math.max(0, Math.min(MAX_GUESS, Math.round(Number(v) || 0))); draftGuess = n; $('#gRange').value = n; $('#gNum').value = n; };
    $('#gRange').oninput = (e) => sync(e.target.value);
    $('#gNum').oninput = (e) => { draftGuess = Number(e.target.value); $('#gRange').value = e.target.value; };
    $('#gNum').onchange = (e) => sync(e.target.value);
    if ($('#gMed')) $('#gMed').onclick = () => sync(hint.median);
    $('#gZero').onclick = () => sync(0);
    $('#gGo').onclick = () => {
      const g = Math.max(0, Math.min(MAX_GUESS, Math.round(Number($('#gNum').value) || 0)));
      const tw = target(); // re-check: the round may have rolled over while the visitor typed
      const st = loadStore();
      if (st.items.some((x) => x.id === keyOf(tw))) return renderGuess(true);
      st.items.push({ id: keyOf(tw), round: tw.round, installationId: tw.installationId, start: tw.start, end: tw.end, guess: g, at: Date.now(), status: 'pending' });
      saveStore(st);
      draftGuess = null;
      renderGuess(true); renderHistory(); renderResult();
    };
  }

  function renderResult() {
    const s = loadStore();
    const items = s.items;
    let it = selected && items.find((x) => x.id === selected);
    if (!it) it = items.find((x) => x.status === 'resolved') || items.find((x) => x.status === 'pending') || null;
    const canvas = $('#predArt');
    if (!canvas) return;
    if (!it) {
      drawScene(canvas, sceneFor({ round: roundAt(Date.now()), start: Date.now(), end: Date.now() + 600_000, guess: 0, actual: 0, acc: 0, offs: [] }, { bare: true }), canvas.clientWidth || 520);
      $('#predCap').textContent = t('predNoneYet');
      $('#resultBox').innerHTML = '';
      return;
    }
    if (it.status !== 'resolved') {
      drawScene(canvas, sceneFor({ ...it, actual: 0, acc: 0, offs: [] }, { bare: true }), canvas.clientWidth || 520);
      const ended = Date.now() > it.end;
      $('#predCap').textContent = it.status === 'void' ? t('predVoid') : ended ? t('predWaitData') : t('predWaitRound', { round: it.round });
      $('#resultBox').innerHTML = `<div class="stats stats-2">${stat(t('predYour'), fmt(it.guess))}${stat(t('predActual'), '…')}</div>`;
      return;
    }
    const scene = sceneFor(it);
    drawScene(canvas, scene, canvas.clientWidth || 520);
    const bull = it.acc >= 95;
    const diff = it.guess - it.actual;
    $('#predCap').innerHTML = `<span>${esc(t('predResultCap', { round: it.round }))}${bull ? ' · 🎯 ' + esc(t('predBull')) : ''}</span><span class="muted">${esc(scene.palette.name)}</span>`;
    const link = siteUrl(`#/predict/${Math.round(it.start / 1000)}/${it.guess}/${it.round}`);
    $('#resultBox').innerHTML = `
      <div class="stats">${stat(t('predYour'), fmt(it.guess))}${stat(t('predActual'), fmt(it.actual))}${stat(t('predAcc'), fmt(it.acc, 1) + '%')}${stat(t('predOff'), (diff > 0 ? '+' : '') + fmt(diff))}</div>
      <div class="actions"><button class="btn" id="pPng">${esc(t('downloadPng'))}</button>
        <a class="btn primary" target="_blank" rel="noopener" href="${xIntent(t('predShareText', { round: it.round, guess: fmt(it.guess), actual: fmt(it.actual), acc: fmt(it.acc, 1) }), link)}">${esc(t('shareX'))}</a>
        <a class="btn" href="${esc(link.replace(location.origin + '/', ''))}">${esc(t('predPermalink'))}</a></div>`;
    $('#pPng').onclick = () => exportPNG(scene, `wheel-canvas-round-${it.round}-guess-${it.guess}.png`);
  }

  function renderHistory() {
    const s = loadStore();
    const st = stats(s.items);
    $('#predStats').innerHTML = stat(t('predCount'), fmt(st.n), st.pending ? esc(t('predPendingN', { n: st.pending })) : '')
      + stat(t('predAvg'), st.avg != null ? fmt(st.avg, 1) + '%' : '—', st.top != null ? esc(t('predBest', { v: fmt(st.top, 1) })) : '')
      + stat(t('predStreak'), fmt(st.streak), esc(t('predStreakS', { best: st.best })))
      + stat(t('predBulls'), fmt(st.bull), '≥ 95%');
    const list = $('#predList');
    if (!s.items.length) { list.innerHTML = `<p class="empty">${esc(t('predEmpty'))}</p>`; return; }
    list.innerHTML = s.items.map((x) => `<button class="card pcard${x.id === selected ? ' sel' : ''}" data-id="${esc(x.id)}">
      <canvas class="thumb"></canvas>
      <div class="card-meta"><b>#${x.round}</b><span class="muted">${new Date(x.start).toISOString().slice(5, 16).replace('T', ' ')}</span></div>
      <div class="card-meta"><span>${esc(t('predGuessShort'))} ${fmt(x.guess)} · ${x.status === 'resolved' ? `${esc(t('predActualShort'))} ${fmt(x.actual)}` : esc(t(x.status === 'void' ? 'predVoidShort' : 'predPendingShort'))}</span>
        <b class="${x.status === 'resolved' && x.acc >= 95 ? 'gold' : ''}">${x.status === 'resolved' ? fmt(x.acc, 1) + '%' : '…'}</b></div></button>`).join('');
    list.querySelectorAll('.pcard').forEach((el) => {
      const it = s.items.find((x) => x.id === el.dataset.id);
      const c = $('canvas', el);
      const sc = it.status === 'resolved' ? sceneFor(it, { bare: true }) : sceneFor({ ...it, actual: 0, acc: 0, offs: [] }, { bare: true });
      drawScene(c, sc, c.clientWidth || 200);
      el.onclick = () => { selected = it.id; renderResult(); renderHistory(); $('#resultFrame').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    });
  }

  let resolving = false, lastNudge = 0;
  async function tryResolve() {
    if (resolving) return;
    resolving = true;
    try {
      const pend = loadStore().items.filter((x) => x.status === 'pending' && Date.now() > x.end + 10_000);
      if (pend.length && !live.catchingUp && Date.now() - lastNudge > 20_000 && live.crawledAt < Math.max(...pend.map((x) => x.end)) + 10_000) {
        lastNudge = Date.now();
        await catchUp(); // pull the segments that close the round
      }
      if (await resolvePending()) { selected = null; renderResult(); renderHistory(); }
    } catch (e) { console.warn('resolve failed', e); }
    finally { resolving = false; }
  }

  renderRound(); renderGuess(true); renderResult(); renderHistory();
  tryResolve();
  const tick = setInterval(() => { if (!$('#roundCard')) return; renderRound(); renderGuess(false); }, 1000);
  const slow = setInterval(() => { tryResolve(); if (loadStore().items.some((x) => x.status === 'pending')) renderResult(); }, 7000);
  const off = onData(throttle(() => { if ($('#roundCard')) { renderRound(); tryResolve(); } }, 1500));
  const onResize = throttle(() => { if ($('#predArt')) renderResult(); }, 300);
  window.addEventListener('resize', onResize);
  setCleanup(() => { clearInterval(tick); clearInterval(slow); off(); window.removeEventListener('resize', onResize); });
  void zh;
}

/** Public permalink: #/predict/<roundStartUnix>/<guess>/<round> — anyone sees the same painting. */
async function viewShared(ctx, args) {
  const { shell, $, esc, fmt, stat, exportPNG } = ctx;
  const startSec = Number(args[0]), guess = Math.max(0, Math.min(MAX_GUESS, Math.round(Number(args[1]))));
  const round = Number(args[2]) || '?';
  shell(`<section class="page-head"><p class="kicker">${esc(t('predKicker'))}</p><h1>${esc(t('predSharedTitle', { round }))}</h1>
    <p class="lead">${esc(t('predSharedLead'))}</p></section>
    <section class="detail"><figure class="art-frame"><canvas id="shArt" class="art"></canvas><figcaption id="shCap">${esc(t('loading'))}</figcaption></figure>
    <div class="side" id="shSide"></div></section>`, 'predict');
  if (!Number.isFinite(startSec) || !Number.isFinite(guess)) { $('#shCap').textContent = '404'; return; }
  await Promise.all([loadSchedule(), loadIndex()]);
  const win = { round, start: startSec * 1000, end: startSec * 1000 + 600_000 };
  const cov = coverageFor(win, getIndex());
  if (!cov && Date.now() - win.end < 6 * 3600_000) { try { await catchUp(); } catch { /* ignore */ } }
  const times = await passagesIn(win.start, win.end);
  if (Date.now() < win.end || (!coverageFor(win, getIndex()) && !times.length)) {
    $('#shCap').textContent = t('predWaitData');
    $('#shSide').innerHTML = `<a class="btn primary" href="#/predict">${esc(t('predTryOwn'))}</a>`;
    return;
  }
  const item = { ...win, guess, actual: times.length, acc: score(guess, times.length), offs: times.map((x) => Math.round(x - win.start)) };
  const scene = sceneFor(item);
  drawScene($('#shArt'), scene, $('#shArt').clientWidth);
  $('#shCap').textContent = `${new Date(win.start).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${scene.palette.name}`;
  $('#shSide').innerHTML = `<div class="stats stats-2">${stat(t('predTheirs'), fmt(guess))}${stat(t('predActual'), fmt(item.actual))}${stat(t('predAcc'), fmt(item.acc, 1) + '%')}${stat(t('predOff'), (guess - item.actual > 0 ? '+' : '') + fmt(guess - item.actual), item.acc >= 95 ? '🎯 ' + esc(t('predBull')) : '')}</div>
    <div class="actions"><button class="btn" id="shPng">${esc(t('downloadPng'))}</button><a class="btn primary" href="#/predict">${esc(t('predTryOwn'))}</a></div>`;
  $('#shPng').onclick = () => exportPNG(scene, `wheel-canvas-round-${round}-guess-${guess}.png`);
}
