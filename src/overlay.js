// OBS overlay renderer (/?overlay=1) and its option parser, shared with the Overlay Studio.
//   layout = canvas | full | bar | ticker        (default: full; old `stats=0` => canvas)
//   size   = painting width in px, 160..1080      (canvas, full)
//   w      = bar / ticker width in px, 240..1920
//   theme  = transparent | dark | light           (default: transparent)
//   accent = hex colour without '#'               (default: F2C230)
//   stats  = comma list of status,rpm,turns,dist,round (old values 0 / 1 still work)
//   lang   = zh | en
import { dayScene, drawScene } from './art.js';
import { loadDay, getDay, onData, startLive, wheelState, live } from './data.js';
import { loadSchedule, roundAt, roundWindow, openRoundWork } from './rounds.js';
import { t } from './i18n.js';

export const LAYOUTS = ['canvas', 'full', 'bar', 'ticker'];
export const THEMES = ['transparent', 'dark', 'light'];
export const STAT_KEYS = ['status', 'rpm', 'turns', 'dist', 'round'];
const DEFAULT_STATS = { canvas: [], full: ['status', 'turns', 'dist', 'rpm'], bar: ['status', 'turns', 'dist', 'rpm', 'round'], ticker: ['round', 'status', 'turns'] };
export const DEFAULTS = { layout: 'full', size: 320, w: 560, theme: 'transparent', accent: 'F2C230' };

export function parseOverlay(params) {
  const st = params.get('stats');
  let layout = params.get('layout');
  if (!LAYOUTS.includes(layout)) layout = st === '0' ? 'canvas' : 'full';
  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
  let stats = DEFAULT_STATS[layout];
  if (st && st !== '0' && st !== '1') stats = st.split(',').map((s) => s.trim()).filter((s) => STAT_KEYS.includes(s));
  if (st === '0') stats = [];
  const theme = THEMES.includes(params.get('theme')) ? params.get('theme') : DEFAULTS.theme;
  const accent = /^[0-9a-fA-F]{6}$/.test(params.get('accent') || '') ? params.get('accent').toUpperCase() : DEFAULTS.accent;
  return {
    layout, theme, accent, stats,
    size: clamp(params.get('size'), 160, 1080, DEFAULTS.size),
    w: clamp(params.get('w'), 240, 1920, layout === 'ticker' ? 420 : DEFAULTS.w),
  };
}

export function overlayURL(origin, o, lang) {
  const q = new URLSearchParams({ overlay: '1', layout: o.layout });
  if (o.layout === 'canvas' || o.layout === 'full') q.set('size', o.size); else q.set('w', o.w);
  q.set('theme', o.theme);
  q.set('accent', o.accent);
  if (o.layout !== 'canvas') q.set('stats', o.stats.join(',') || '0');
  q.set('lang', lang);
  return `${origin}/?${q.toString().replace(/%2C/g, ',')}`;
}

/** Suggested OBS browser-source size (the overlay adds 8 px padding on each side). */
export function suggestSize(o) {
  if (o.layout === 'canvas') return { w: o.size + 16, h: o.size + 16 };
  if (o.layout === 'full') return { w: o.size + 16, h: o.size + 16 + (o.stats.length ? (o.size < 300 ? 86 : 52) : 0) };
  if (o.layout === 'bar') return { w: o.w + 16, h: 60 };
  return { w: o.w + 16, h: o.stats.filter((s) => s !== 'round').length ? 132 : 108 };
}

export async function overlay({ params, esc, fmt, km, stateBadge, analysis, today, throttle }) {
  document.documentElement.classList.add('overlay');
  const o = parseOverlay(params);
  const app = document.getElementById('app');
  const hasCanvas = o.layout === 'canvas' || o.layout === 'full';
  const width = hasCanvas ? o.size : o.w;
  app.innerHTML = `<div class="ov ov-${o.layout} ov-${o.theme}" style="--accent:#${o.accent};width:${width + 16}px">
    ${hasCanvas ? `<canvas id="ovArt" style="width:${o.size}px;height:${o.size}px"></canvas>` : ''}
    ${o.layout !== 'canvas' && (o.stats.length || o.layout === 'ticker') ? '<div class="ov-bar" id="ovBar"></div>' : ''}</div>`;
  const $ = (s) => document.querySelector(s);
  if (o.stats.includes('round') || o.layout === 'ticker') await loadSchedule();
  await loadDay(today());

  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const statHTML = (k, a) => {
    const b = stateBadge(), m = b.s.m;
    if (k === 'status') return b.html;
    if (k === 'rpm') return `<span><b>${m && m.rpmMilli ? fmt(m.rpmMilli / 1000, 0) : 0}</b> rpm</span>`;
    if (k === 'turns') return `<span><b>${fmt(a.passages)}</b> ${esc(t('ovTurnsToday'))}</span>`;
    if (k === 'dist') return `<span><b>${km(a.distanceM)}</b></span>`;
    if (k === 'round') { const w = roundWindow(roundAt(Date.now())); return `<span>${esc(t('ovRound'))} <b>#${w.round}</b> · <b class="mono">${mmss(w.end - Date.now())}</b></span>`; }
    return '';
  };
  const renderArt = () => {
    if (!hasCanvas) return;
    const d = today();
    const scene = dayScene(d, getDay(d), analysis(d), { nowMs: Date.now(), running: wheelState().key === 'running', transparent: true, bare: true });
    drawScene($('#ovArt'), scene, o.size);
  };
  const renderBar = () => {
    const bar = $('#ovBar');
    if (!bar) return;
    const a = analysis(today());
    if (o.layout === 'ticker') {
      const w = roundWindow(roundAt(Date.now()));
      const el = Math.floor((Date.now() - w.start) / 10_000);
      const so = openRoundWork();
      const dots = Array.from({ length: 60 }, (_, i) => `<i class="${i < el ? 'on' : ''}"></i>`).join('');
      const rest = o.stats.filter((k) => k !== 'round').map((k) => statHTML(k, a)).join('');
      bar.innerHTML = `<div class="tk-top"><span class="tk-r">${esc(t('ovRound'))} #${w.round}</span><span class="tk-cd">${mmss(w.end - Date.now())}</span>
        <span class="tk-so"><b>${so != null ? fmt(so) : '—'}</b> ${esc(t('ovThisRound'))}</span></div>
        <div class="tk-dots">${dots}</div>${rest ? `<div class="tk-rest">${rest}<span class="ov-brand">${esc(t('brand'))}</span></div>` : ''}`;
      return;
    }
    bar.innerHTML = o.stats.map((k) => statHTML(k, a)).join('') + `<span class="ov-brand">${esc(t('brand'))}</span>`;
  };
  renderArt(); renderBar();
  onData(throttle(() => { renderArt(); renderBar(); }, 1000));
  setInterval(renderArt, 30_000);
  setInterval(renderBar, 1000);
  startLive();
  void live;
}
