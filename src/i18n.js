const dict = {
  en: {
    brand: 'Wheel Canvas', brandSub: '仓鼠画布',
    navToday: 'Today', navGallery: 'Gallery', navHow: "How it's drawn", navOverlay: 'OBS overlay',
    heroKicker: 'Live generative art from a hamster-powered blockchain',
    heroTitle: "Every turn of Squeektoshi's wheel paints a dot.",
    heroBody: "Squeekchain's hamster runs on a real wheel; each magnet passage is one unit of proof-of-work. Wheel Canvas reads those exact passage times from the public API and paints one deterministic dot-grid picture per UTC day. Same data, same painting — forever.",
    todayTitle: "Today's painting", liveGrowing: 'Growing live', finished: 'Finished',
    stRunning: 'Running', stResting: 'Resting', stAsleep: 'Asleep', stOffline: 'Device offline', stUnknown: 'Connecting…',
    stRunningD: 'Squeektoshi is on the wheel right now.', stRestingD: 'Short break — last turn {ago}.', stAsleepD: 'Napping. Last turn {ago}.', stOfflineD: 'The wheel sensor has not reported for over 2 minutes.', stUnknownD: 'Reading the wheel…',
    rpm: 'RPM', speed: 'Speed', todayDist: 'Device distance today', block: 'Projected block',
    passages: 'Wheel turns', distance: 'Distance', runs: 'Runs', activeTime: 'Running time', avgSpeed: 'Avg speed', peakSpeed: 'Peak speed',
    longestRun: 'Longest run', longestRest: 'Longest rest', firstTurn: 'First turn', lastTurn: 'Last turn', fingerprint: 'Fingerprint', palette: 'Palette',
    maxGap: 'Longest gap', stumbles: 'Stumbles (5–60 s)', duration: 'Duration', start: 'Start', end: 'End', officialDist: 'Device-reported distance',
    downloadPng: 'PNG', downloadSvg: 'SVG', shareX: 'Share on X', openDay: 'Open day', viewRuns: 'Runs this day', allDays: 'All days',
    galleryTitle: 'Gallery', gallerySub: 'One painting per UTC day since the wheel went live on 2026-10-26. Thumbnails are rendered in your browser from the raw data.',
    hourly: 'Turns per hour (UTC)', runsList: 'Runs', run: 'Run', prev: '← Previous', next: 'Next →', back: '← Back to day',
    noData: 'No wheel turns recorded yet for this day.', loading: 'Loading wheel data…', catching: 'Catching up with the wheel…',
    shareDayText: 'Squeektoshi painted {date} with {n} wheel turns ({km} km) 🐹🎨 #Squeekchain #WheelCanvas',
    shareRunText: 'Run #{i} on {date}: {n} turns at up to {peak} m/s 🐹💨 #Squeekchain #WheelCanvas',
    footer: 'Independent community project by mstr, not affiliated with Squeekchain.',
    footerData: 'Data: public Squeekchain API (Sepolia testnet, device evidence, display only). No wallet, no sign-in, no tracking.',
    source: 'Source code', utcNote: 'All days and times are UTC, matching the Squeekchain API.',
    overlayTitle: 'OBS overlay', overlayBody: 'Add a Browser Source in OBS with this URL. It has a transparent background and updates itself.',
    copy: 'Copy', copied: 'Copied',
    ago_s: '{n}s ago', ago_m: '{n} min ago', ago_h: '{n} h ago',
    legendSlow: 'slow', legendFast: 'fast', legendTitle: 'Speed → colour & distance from the centre',
    snapshotNote: 'Snapshot {t} + live API',
  },
  zh: {
    brand: '仓鼠画布', brandSub: 'Wheel Canvas',
    navToday: '今日', navGallery: '画廊', navHow: '画法说明', navOverlay: 'OBS 叠加层',
    heroKicker: '来自仓鼠驱动区块链的实时生成艺术',
    heroTitle: 'Squeektoshi 跑轮每转一圈，画布上就多一个点。',
    heroBody: 'Squeekchain 的仓鼠在真实的跑轮上奔跑，每一次磁铁经过就是一份工作量证明。仓鼠画布从公开 API 读取每一次经过的精确时间，按 UTC 日绘制一幅确定性的点阵画。同样的数据，永远是同一幅画。',
    todayTitle: '今日画作', liveGrowing: '实时生长中', finished: '已完成',
    stRunning: '正在跑', stResting: '休息中', stAsleep: '睡觉中', stOffline: '设备离线', stUnknown: '连接中…',
    stRunningD: 'Squeektoshi 此刻正在跑轮上。', stRestingD: '小憩一下 —— 最后一圈在 {ago}。', stAsleepD: '在打盹。最后一圈在 {ago}。', stOfflineD: '跑轮传感器已超过 2 分钟没有上报。', stUnknownD: '正在读取跑轮…',
    rpm: '转速 RPM', speed: '速度', todayDist: '设备今日距离', block: '预计区块',
    passages: '跑轮圈数', distance: '距离', runs: '跑步次数', activeTime: '奔跑时长', avgSpeed: '平均速度', peakSpeed: '最高速度',
    longestRun: '最长一次', longestRest: '最长休息', firstTurn: '第一圈', lastTurn: '最后一圈', fingerprint: '数据指纹', palette: '配色',
    maxGap: '最长间隔', stumbles: '停顿（5–60 秒）', duration: '时长', start: '开始', end: '结束', officialDist: '设备上报距离',
    downloadPng: 'PNG', downloadSvg: 'SVG', shareX: '分享到 X', openDay: '查看当天', viewRuns: '当天的跑步', allDays: '全部日期',
    galleryTitle: '画廊', gallerySub: '从 2026-10-26 跑轮上线起，每个 UTC 日一幅画。缩略图由你的浏览器根据原始数据实时绘制。',
    hourly: '每小时圈数（UTC）', runsList: '跑步记录', run: '跑步', prev: '← 上一个', next: '下一个 →', back: '← 返回当天',
    noData: '这一天还没有跑轮记录。', loading: '正在加载跑轮数据…', catching: '正在追上最新的跑轮数据…',
    shareDayText: 'Squeektoshi 在 {date} 跑了 {n} 圈（{km} 公里），画出了这幅画 🐹🎨 #Squeekchain #WheelCanvas',
    shareRunText: '{date} 第 {i} 次跑步：{n} 圈，最高 {peak} 米/秒 🐹💨 #Squeekchain #WheelCanvas',
    footer: 'mstr 制作的独立社区项目，与 Squeekchain 官方无关。',
    footerData: '数据：Squeekchain 公开 API（Sepolia 测试网，设备证据，仅供展示）。不连接钱包、不需要登录、不追踪。',
    source: '源代码', utcNote: '所有日期和时间均为 UTC，与 Squeekchain API 一致。',
    overlayTitle: 'OBS 叠加层', overlayBody: '在 OBS 里添加“浏览器源”，填入这个网址。背景透明，会自动更新。',
    copy: '复制', copied: '已复制',
    ago_s: '{n} 秒前', ago_m: '{n} 分钟前', ago_h: '{n} 小时前',
    legendSlow: '慢', legendFast: '快', legendTitle: '速度 → 颜色和离圆心的距离',
    snapshotNote: '快照 {t} + 实时 API',
  },
};

const params = new URLSearchParams(location.search);
let lang = params.get('lang') || localStorage.getItem('wc-lang') || (navigator.language?.startsWith('zh') ? 'zh' : 'en');
if (!dict[lang]) lang = 'en';

export const getLang = () => lang;
export function setLang(l) { lang = dict[l] ? l : 'en'; localStorage.setItem('wc-lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }
export function t(key, vars = {}) {
  const s = dict[lang][key] ?? dict.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
export function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return t('ago_s', { n: s });
  if (s < 5400) return t('ago_m', { n: Math.round(s / 60) });
  return t('ago_h', { n: Math.round(s / 3600) });
}
setLang(lang);
