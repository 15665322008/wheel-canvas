// 直播叠加工作室 / Overlay Studio: a visual configurator for the OBS overlay.
import { LAYOUTS, THEMES, STAT_KEYS, DEFAULTS, overlayURL, suggestSize, parseOverlay } from './overlay.js';
import { t, getLang } from './i18n.js';

const LS = 'wc-studio';
const SWATCHES = ['F2C230', 'F8DC7A', '9B45DE', 'F06BAE', '4FC6DD', '6CC26A', 'E85F3F', 'FFFFFF'];

export function viewStudio({ shell, $, esc, setCleanup }) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { /* ignore */ }
  const o = { ...DEFAULTS, ...parseOverlay(new URLSearchParams()), lang: getLang(), bg: 'checker', ...(saved || {}) };
  if (!Array.isArray(o.stats)) o.stats = ['status', 'turns', 'dist', 'rpm'];

  const radio = (name, vals, cur, label) => vals.map((v) => `<label class="seg${v === cur ? ' on' : ''}"><input type="radio" name="${name}" value="${v}" ${v === cur ? 'checked' : ''}/>${label(v)}</label>`).join('');
  shell(`
  <section class="page-head">
    <p class="kicker">${esc(t('stKicker'))}</p>
    <h1>${esc(t('stTitle'))}</h1>
    <p class="lead">${esc(t('stLead'))}</p>
  </section>
  <section class="studio">
    <form class="studio-form" id="stForm" onsubmit="return false">
      <fieldset><legend>${esc(t('stLayout'))}</legend>
        <div class="layouts">${LAYOUTS.map((l) => `<label class="lay${l === o.layout ? ' on' : ''}"><input type="radio" name="layout" value="${l}" ${l === o.layout ? 'checked' : ''}/>
          <span class="lay-ic lay-${l}" aria-hidden="true"></span><b>${esc(t('stL_' + l))}</b><small>${esc(t('stL_' + l + 'D'))}</small></label>`).join('')}</div></fieldset>
      <fieldset id="fsSize"><legend>${esc(t('stSize'))} <output id="sizeOut"></output></legend>
        <input type="range" name="size" min="160" max="720" step="8" value="${o.size}" id="inSize"/></fieldset>
      <fieldset id="fsW"><legend>${esc(t('stWidth'))} <output id="wOut"></output></legend>
        <input type="range" name="w" min="240" max="1280" step="10" value="${o.w}" id="inW"/></fieldset>
      <fieldset><legend>${esc(t('stTheme'))}</legend><div class="segs">${radio('theme', THEMES, o.theme, (v) => esc(t('stT_' + v)))}</div></fieldset>
      <fieldset><legend>${esc(t('stAccent'))}</legend><div class="swatches">${SWATCHES.map((c) => `<button type="button" class="sw${c === o.accent ? ' on' : ''}" data-c="${c}" style="background:#${c}" aria-label="#${c}"></button>`).join('')}
        <input type="color" id="inAccent" value="#${o.accent}" aria-label="custom colour"/></div></fieldset>
      <fieldset><legend>${esc(t('stLang'))}</legend><div class="segs">${radio('lang', ['zh', 'en'], o.lang, (v) => (v === 'zh' ? '中文' : 'English'))}</div></fieldset>
      <fieldset id="fsStats"><legend>${esc(t('stStats'))}</legend><div class="checks">${STAT_KEYS.map((k) => `<label class="chk"><input type="checkbox" name="stats" value="${k}" ${o.stats.includes(k) ? 'checked' : ''}/>${esc(t('stS_' + k))}</label>`).join('')}</div></fieldset>
    </form>
    <div class="studio-out">
      <div class="preview-head"><b>${esc(t('stPreview'))}</b><div class="segs small">${radio('bg', ['checker', 'game', 'light'], o.bg, (v) => esc(t('stBg_' + v)))}</div></div>
      <div class="preview bg-${o.bg}" id="pv"><div class="pv-scale" id="pvScale"><iframe id="pvFrame" title="Overlay preview" loading="lazy"></iframe></div></div>
      <div class="copyrow url-row"><code id="ovUrl"></code></div>
      <div class="actions"><button class="btn primary" id="copyUrl">${esc(t('stCopy'))}</button><a class="btn" id="openUrl" target="_blank" rel="noopener">${esc(t('stOpen'))}</a><button class="btn" id="reset">${esc(t('stReset'))}</button></div>
      <div class="stats stats-2"><div class="stat"><div class="stat-l">${esc(t('stObsSize'))}</div><div class="stat-v" id="obsSize">—</div><div class="stat-s">${esc(t('stObsSizeS'))}</div></div>
        <div class="stat"><div class="stat-l">${esc(t('stRefresh'))}</div><div class="stat-v">10 s</div><div class="stat-s">${esc(t('stRefreshS'))}</div></div></div>
      <h2 class="h3">${esc(t('stSteps'))}</h2>
      <ol class="steps">${[1, 2, 3, 4, 5].map((i) => `<li>${t('stStep' + i)}</li>`).join('')}</ol>
    </div>
  </section>`, 'studio');

  const form = $('#stForm');
  let frameTimer = null, lastSrc = '', measured = null;
  const update = () => {
    const fd = new FormData(form);
    o.layout = fd.get('layout');
    o.size = Number(fd.get('size'));
    o.w = Number(fd.get('w'));
    o.theme = fd.get('theme');
    o.lang = fd.get('lang');
    o.stats = fd.getAll('stats');
    o.bg = document.querySelector('input[name=bg]:checked')?.value || 'checker';
    localStorage.setItem(LS, JSON.stringify(o));
    const hasCanvas = o.layout === 'canvas' || o.layout === 'full';
    $('#fsSize').hidden = !hasCanvas;
    $('#fsW').hidden = hasCanvas;
    $('#fsStats').classList.toggle('dim', o.layout === 'canvas');
    $('#sizeOut').textContent = `${o.size}px`;
    $('#wOut').textContent = `${o.w}px`;
    document.querySelectorAll('.lay, .seg').forEach((el) => el.classList.toggle('on', el.querySelector('input').checked));
    document.querySelectorAll('.sw').forEach((el) => el.classList.toggle('on', el.dataset.c === o.accent));
    $('#inAccent').value = `#${o.accent}`;
    const url = overlayURL(location.origin, o, o.lang);
    $('#ovUrl').textContent = url;
    $('#openUrl').href = url;
    const sz = measured && measured.url === url ? measured : suggestSize(o);
    $('#obsSize').textContent = `${sz.w} × ${sz.h}`;
    const pv = $('#pv');
    pv.className = `preview bg-${o.bg}`;
    const fr = $('#pvFrame');
    fr.style.width = `${sz.w}px`; fr.style.height = `${sz.h}px`;
    const fit = () => {
      const avail = pv.clientWidth - 24;
      const k = Math.min(1, avail / sz.w);
      $('#pvScale').style.transform = `scale(${k})`;
      $('#pvScale').style.width = `${sz.w}px`;
      pv.style.height = `${Math.max(140, sz.h * k + 24)}px`;
    };
    fit();
    // debounce reloads while dragging sliders
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => { if (url !== lastSrc) { lastSrc = url; fr.src = url; } }, 250);
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  document.querySelectorAll('input[name=bg]').forEach((el) => el.addEventListener('change', update));
  document.querySelectorAll('.sw').forEach((el) => { el.onclick = () => { o.accent = el.dataset.c; update(); }; });
  $('#inAccent').addEventListener('input', (e) => { o.accent = e.target.value.slice(1).toUpperCase(); update(); });
  $('#copyUrl').onclick = async () => { try { await navigator.clipboard.writeText($('#ovUrl').textContent); $('#copyUrl').textContent = t('copied'); setTimeout(() => { const b = $('#copyUrl'); if (b) b.textContent = t('stCopy'); }, 1500); } catch { /* ignore */ } };
  $('#reset').onclick = () => { localStorage.removeItem(LS); location.reload(); };
  // Measure the real overlay box inside the (same-origin) preview so the suggested OBS size is exact.
  // The bar fills in after data loads and may wrap, so keep measuring while the page is open.
  const measure = () => {
    try {
      const fr = $('#pvFrame'), pv = $('#pv');
      const box = fr?.contentDocument?.querySelector('.ov');
      if (!box || !pv) return;
      const r = box.getBoundingClientRect();
      const w = Math.ceil(r.width), hgt = Math.ceil(r.height);
      if (!(w > 0 && hgt > 0)) return;
      measured = { url: lastSrc, w, h: hgt };
      $('#obsSize').textContent = `${w} × ${hgt}`;
      if (fr.style.height !== `${hgt}px`) fr.style.height = `${hgt}px`;
      const k = Math.min(1, (pv.clientWidth - 24) / w);
      pv.style.height = `${Math.max(140, Math.ceil(hgt * k) + 24)}px`;
    } catch { /* ignore */ }
  };
  const measureTimer = setInterval(measure, 700);
  const onResize = () => update();
  window.addEventListener('resize', onResize);
  setCleanup(() => { window.removeEventListener('resize', onResize); clearTimeout(frameTimer); clearInterval(measureTimer); });
  update();
}
