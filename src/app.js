/* Zoro Player — main window logic (vanilla JS, Tauri v2 globals) */
(() => {
'use strict';

const TAURI = window.__TAURI__;
const { invoke } = TAURI.core;
const { listen, emitTo } = TAURI.event;
const appWindow = TAURI.window.getCurrentWindow();

/* ═════════════════════════ helpers ═════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const T = window.T;
const fa = n => Number(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const baseName = p => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
const normPath = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const inFolder = (path, folder) => normPath(path).startsWith(normPath(folder) + '/');
const dbToGain = db => Math.pow(10, db / 20);
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();

const store = {
  get(k, d) { try { const v = localStorage.getItem('zp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('zp.' + k, JSON.stringify(v)); return true; } catch (e) { console.warn('store', e); return false; } },
};

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* colour helpers */
const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
    h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}
function shiftHue(hex, deg) { const [r, g, b] = hex2rgb(hex); const [h, s, l] = rgb2hsl(r, g, b); return rgb2hex(...hsl2rgb((h + deg / 360 + 1) % 1, s, l)); }
function vivid(rgb) { const [h, s, l] = rgb2hsl(...rgb); return rgb2hex(...hsl2rgb(h, Math.max(s, .55), clamp(l, .52, .68))); }
function hashPalette(str) {
  let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 360;
  return { c1: rgb2hex(...hsl2rgb(hue, .72, .6)), c2: rgb2hex(...hsl2rgb((hue + .12) % 1, .72, .58)) };
}

/* ═════════════════════════ settings & themes ═════════════════════════ */
const DEF = {
  theme: 'mono', scheme: 'mono',
  bgMode: 'solid', bgBlur: 50, bgBright: 30, bgImage: '', grayscale: true,
  gradA: '#0a0a0a', gradB: '#262626', gradAngle: 160, solid: '#0a0a0a', vignette: 0,
  accentMode: 'custom', accent: '#e8e8e8',
  glass: 94, radius: 0, fontScale: 100,
  vizStyle: 'blocks', vizColor: 'accent', vizBars: 48, vizSens: 1,
  coverShape: 'square', coverSize: 300,
  widgetAuto: false, widgetTop: false, widgetOpacity: 96,
  resume: true, trayClose: true, watch: true, gapless: true, xfade: 0, autoUpdate: true,
};
const THEME_KEYS = ['scheme', 'bgMode', 'bgBlur', 'bgBright', 'gradA', 'gradB', 'gradAngle', 'solid', 'accentMode', 'accent', 'glass', 'radius', 'vignette', 'grayscale'];
const THEMES = {
  mono:      { label: 'Monochrome', sw: ['#e8e8e8', '#0a0a0a'], v: { scheme: 'mono', bgMode: 'solid', solid: '#0a0a0a', accentMode: 'custom', accent: '#e8e8e8', glass: 94, radius: 0, vignette: 0, grayscale: true } },
  wallpaper: { label: 'Mono + کاور', sw: ['#bdbdbd', '#3a3a3a'], v: { scheme: 'mono', bgMode: 'cover', bgBlur: 50, bgBright: 26, gradA: '#0a0a0a', gradB: '#262626', accentMode: 'custom', accent: '#e8e8e8', glass: 78, radius: 0, vignette: 30, grayscale: true } },
  paper:     { label: 'Paper', sw: ['#111111', '#ececec'], v: { scheme: 'paper', bgMode: 'solid', solid: '#ececec', accentMode: 'custom', accent: '#111111', glass: 100, radius: 0, vignette: 0, grayscale: true } },
  amber:     { label: 'Amber', sw: ['#ffb000', '#0b0800'], v: { scheme: 'amber', bgMode: 'solid', solid: '#0b0800', accentMode: 'custom', accent: '#ffb000', glass: 96, radius: 0, vignette: 0, grayscale: false } },
  phosphor:  { label: 'Phosphor', sw: ['#33ff66', '#020a04'], v: { scheme: 'phosphor', bgMode: 'solid', solid: '#020a04', accentMode: 'custom', accent: '#33ff66', glass: 96, radius: 0, vignette: 0, grayscale: false } },
};
let S = Object.assign({}, DEF, store.get('settings', {}));

const st = {
  lib: [], idx: new Map(), cur: -1, order: [], pos: -1, base: [], plFilter: null,
  shuffle: !!store.get('shuffle', false),
  repeat: store.get('repeat', 'off'),
  search: '', sort: 'path', folderFilter: null,
  coverUrl: null, thumb: null,
  pal: { c1: '#a855f7', c2: '#ec4899' }, c1: '#a855f7', c2: '#ec4899',
  loadToken: 0, blobUrl: null, failStreak: 0, seeking: false, widgetOpen: false,
  vol: store.get('vol', 80), muted: false,
};
let folders = store.get('folders', []);
let files = store.get('files', []);
const excluded = new Set(store.get('excluded', []));     // tracks the user removed from the app

function saveSettings() { store.set('settings', S); syncTray(); syncWatch(); }
let trayOn = null;
function syncTray() {
  if (trayOn !== !!S.trayClose) { trayOn = !!S.trayClose; invoke('set_close_to_tray', { on: trayOn }).catch(() => {}); }
}
function trayLabels() {
  invoke('set_tray_labels', { labels: [T('نمایش Zoro Player'), T('پخش / توقف'), T('قبلی'), T('بعدی'), T('خروج')] }).catch(() => {});
}
function trayTip(t) { invoke('set_tray_tooltip', { text: t ? ((t.artist ? t.artist + ' — ' : '') + t.title).slice(0, 120) : 'Zoro Player' }).catch(() => {}); }

let bgKey = '', bgFlip = false;
function setBgLayer(url) {
  const a = $('#bgA'), b = $('#bgB');
  const next = bgFlip ? a : b, prev = bgFlip ? b : a;
  bgFlip = !bgFlip;
  if (url) { next.style.backgroundImage = `url("${url}")`; next.classList.add('show'); } else next.classList.remove('show');
  prev.classList.remove('show');
}
function applyBackground() {
  document.body.dataset.bg = S.bgMode;
  const grad = `linear-gradient(${S.gradAngle}deg, ${S.gradA}, ${S.gradB})`;
  let url = null, base = grad;
  if (S.bgMode === 'cover') url = st.coverUrl;
  else if (S.bgMode === 'image') url = S.bgImage || null;
  else if (S.bgMode === 'solid') base = S.solid;
  else if (S.bgMode === 'aurora') base = '#07060d';
  const key = [S.bgMode, url, grad, S.solid].join('|');
  if (key === bgKey) return;
  bgKey = key;
  $('#bg').style.background = base;
  setBgLayer(url);
}
function applyTheme() {
  const root = document.documentElement.style;
  const c1 = S.accentMode === 'auto' ? st.pal.c1 : S.accent;
  const c2 = S.accentMode === 'auto' ? st.pal.c2 : shiftHue(S.accent, 48);
  st.c1 = c1; st.c2 = c2;
  root.setProperty('--accent', c1);
  root.setProperty('--accent2', c2);
  root.setProperty('--accent3', shiftHue(c1, -70));
  root.setProperty('--accent-rgb', hex2rgb(c1).join(','));
  root.setProperty('--glass', S.glass / 100);
  root.setProperty('--radius', S.radius + 'px');
  root.setProperty('--bgblur', S.bgBlur + 'px');
  root.setProperty('--bgbright', S.bgBright / 100);
  root.setProperty('--vignette', S.vignette / 100);
  root.setProperty('--cover-size', S.coverSize + 'px');
  root.fontSize = (15 * S.fontScale / 100) + 'px';
  root.setProperty('--sat', S.grayscale ? 0 : 1.35);
  root.setProperty('--gray', S.grayscale ? 1 : 0);
  document.body.dataset.scheme = S.scheme || 'mono';
  document.body.dataset.cover = S.coverShape;
  applyBackground();
  queueWidgetPush();
}

/* ═════════════════════════ audio graph + equalizer ═════════════════════════ */
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const PRESETS = {
  'فلت':          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'بیس قوی':      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'تربل':         [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  'ووکال':        [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  'راک':          [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  'پاپ':          [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'جاز':          [3, 2, 1, 2, -2, -2, 0, 1, 2, 3],
  'کلاسیک':       [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  'الکترونیک':    [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  'هیپ‌هاپ':      [5, 5, 2, 3, -1, -1, 2, -1, 2, 3],
  'کم‌کردن بیس':  [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0],
};
const EQ_DEFAULT = { on: true, gains: Array(10).fill(0), pre: 0, limiter: true };
let eq = Object.assign({}, EQ_DEFAULT, store.get('eq', {}));
if (!Array.isArray(eq.gains) || eq.gains.length !== 10) eq.gains = Array(10).fill(0);
let customPresets = store.get('eqCustom', {});

/* two players so the next track can be preloaded and overlapped (gapless / crossfade) */
const players = [0, 1].map(() => { const el = new Audio(); el.preload = 'auto'; return { el, gain: null, url: null }; });
let audio = players[0].el;                      // the active element
const activePlayer = () => players.find(p => p.el === audio);
const idlePlayer = () => players.find(p => p.el !== audio);
let ctx, preamp, filters = [], curveFilters = [], analyser, limiter, master, freq, wave;

function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  preamp = ctx.createGain();
  players.forEach(p => { p.gain = ctx.createGain(); ctx.createMediaElementSource(p.el).connect(p.gain); p.gain.connect(preamp); });
  filters = EQ_FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.1;
    b.gain.value = 0;
    return b;
  });
  curveFilters = EQ_FREQS.map((f, i) => {            // detached copies, only used to draw the response curve
    const b = ctx.createBiquadFilter();
    b.type = filters[i].type; b.frequency.value = f; b.Q.value = 1.1;
    return b;
  });
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -12;
  limiter = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  let node = preamp;
  [...filters, analyser, limiter, master].forEach(n => { node.connect(n); node = n; });
  master.connect(ctx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
  applyEQ();
  applyVolume();
}
async function ensureCtx() { if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch { /* ignore */ } } }

function applyEQ() {
  if (!ctx) return;
  const t = ctx.currentTime;
  filters.forEach((f, i) => f.gain.setTargetAtTime(eq.on ? eq.gains[i] : 0, t, 0.015));
  preamp.gain.setTargetAtTime(eq.on ? dbToGain(eq.pre) : 1, t, 0.015);
  if (eq.limiter) {
    limiter.threshold.value = -4; limiter.knee.value = 8; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
  } else {
    limiter.threshold.value = 0; limiter.knee.value = 0; limiter.ratio.value = 1;
  }
}
function applyVolume() {
  if (!ctx) return;
  master.gain.setTargetAtTime(st.muted ? 0 : Math.pow(st.vol / 100, 2), ctx.currentTime, 0.02);
  document.body.classList.toggle('muted', st.muted || st.vol === 0);
  $('#btnMute').textContent = (st.muted || st.vol === 0) ? 'mute' : 'vol';
  updateStatus();
}

let eqSaveTimer = 0;
function persistEQ() { clearTimeout(eqSaveTimer); eqSaveTimer = setTimeout(() => store.set('eq', eq), 250); }
function matchPreset() {
  const all = Object.assign({}, PRESETS, customPresets);
  for (const [name, g] of Object.entries(all)) if (g.every((v, i) => v === eq.gains[i])) return name;
  return '';
}
const bandEls = {};
function paintBand(key) {
  const el = bandEls[key]; if (!el) return;
  const v = key === 'pre' ? eq.pre : eq.gains[key];
  const pct = (v + 12) / 24 * 100;
  $('.vs-thumb', el).style.bottom = pct + '%';
  const fill = $('.vs-fill', el);
  if (v >= 0) { fill.style.bottom = '50%'; fill.style.height = (v / 24 * 100) + '%'; }
  else { fill.style.bottom = pct + '%'; fill.style.height = (-v / 24 * 100) + '%'; }
  $('.vs-val', el).textContent = (v > 0 ? '+' : '') + (Number.isInteger(v) ? v : v.toFixed(1));
}
function setBand(key, v) {
  v = clamp(v, -12, 12);
  if (key === 'pre') eq.pre = v; else eq.gains[key] = v;
  paintBand(key); applyEQ(); renderPresets(); drawEQCurve(); persistEQ();
}
function buildEQ() {
  const wrap = $('#eqBands');
  wrap.innerHTML = '';
  const defs = [{ key: 'pre', label: 'پری‌امپ' }, ...EQ_FREQS.map((f, i) => ({ key: i, label: EQ_LABELS[i] }))];
  defs.forEach(d => {
    const el = document.createElement('div');
    el.className = 'vs' + (d.key === 'pre' ? ' pre' : '');
    el.innerHTML = `<div class="vs-val">0</div><div class="vs-track"><div class="vs-rail"><div class="vs-zero"></div><div class="vs-fill"></div><div class="vs-thumb"></div></div></div><div class="vs-lab">${d.label}</div>`;
    wrap.appendChild(el);
    bandEls[d.key] = el;
    const track = $('.vs-track', el), rail = $('.vs-rail', el);
    const fromY = y => {
      const r = rail.getBoundingClientRect();
      const ratio = clamp(1 - (y - r.top) / r.height, 0, 1);
      let v = Math.round((ratio * 24 - 12) * 2) / 2;
      if (Math.abs(v) < 0.5) v = 0;
      setBand(d.key, v);
    };
    track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); fromY(e.clientY); });
    track.addEventListener('pointermove', e => { if (track.hasPointerCapture(e.pointerId)) fromY(e.clientY); });
    el.addEventListener('dblclick', () => setBand(d.key, 0));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const cur = d.key === 'pre' ? eq.pre : eq.gains[d.key];
      setBand(d.key, cur + (e.deltaY < 0 ? 0.5 : -0.5));
    }, { passive: false });
    paintBand(d.key);
  });
}
function renderPresets() {
  const box = $('#eqPresets');
  const active = matchPreset();
  let html = '';
  for (const name of Object.keys(PRESETS)) html += `<button class="chip${name === active ? ' on' : ''}" data-preset="${esc(name)}">${esc(name)}</button>`;
  for (const name of Object.keys(customPresets)) html += `<button class="chip${name === active ? ' on' : ''}" data-preset="${esc(name)}">★ ${esc(name)}<span class="x" data-del="${esc(name)}">×</span></button>`;
  box.innerHTML = html;
}
function drawEQCurve() {
  const cv = $('#eqCurve');
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height;
  g.clearRect(0, 0, w, h);
  // grid
  g.strokeStyle = cssVar('--line'); g.lineWidth = 1;
  for (const db of [-12, -6, 0, 6, 12]) { const y = h / 2 - db / 15 * (h / 2); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (const f of [100, 1000, 10000]) { const x = Math.log10(f / 20) / 3 * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  const N = 180, fr = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N), tot = new Float32Array(N).fill(1);
  for (let i = 0; i < N; i++) fr[i] = 20 * Math.pow(1000, i / (N - 1));
  if (curveFilters.length && eq.on) curveFilters.forEach((f, k) => { f.gain.value = eq.gains[k]; f.getFrequencyResponse(fr, mag, ph); for (let i = 0; i < N; i++) tot[i] *= mag[i]; });
  const pts = [];
  for (let i = 0; i < N; i++) {
    const db = clamp(20 * Math.log10(tot[i] || 1e-6), -15, 15);
    pts.push([i / (N - 1) * w, h / 2 - db / 15 * (h / 2)]);
  }
  g.beginPath(); g.moveTo(0, h / 2); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(w, h / 2); g.closePath();
  g.fillStyle = `rgba(${hex2rgb(st.c1).join(',')},.16)`; g.fill();
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
  g.strokeStyle = st.c1; g.lineWidth = 2; g.stroke();
}

/* ═════════════════════════ library ═════════════════════════ */
function sortIdx(idx, key) {
  const L = st.lib, loc = (a, b) => a.localeCompare(b, 'fa'), last = '\uffff';
  const cmp = {
    title: (a, b) => loc(L[a].title, L[b].title),
    artist: (a, b) => loc(L[a].artist || last, L[b].artist || last) || loc(L[a].title, L[b].title),
    album: (a, b) => loc(L[a].album || last, L[b].album || last) || loc(L[a].title, L[b].title),
    duration: (a, b) => L[a].duration - L[b].duration,
  }[key];
  if (cmp) idx.sort(cmp);
  else if (window.ZP && ZP.stats && ZP.stats.sortKeys.includes(key)) idx.sort((a, b) => (ZP.stats.value(b, key) - ZP.stats.value(a, key)) || loc(L[a].title, L[b].title));
  return idx;
}
function getVisible() {
  const q = st.search.trim().toLowerCase();
  let idx;
  if (st.plFilter && window.ZP && ZP.getPlaylistPaths) idx = ZP.getPlaylistPaths(st.plFilter.id).map(p => st.idx.get(p)).filter(i => i != null);
  else idx = st.lib.map((_, i) => i);
  if (st.folderFilter) idx = idx.filter(i => inFolder(st.lib[i].path, st.folderFilter));
  if (q) idx = idx.filter(i => { const t = st.lib[i]; return (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(q); });
  return sortIdx(idx, st.sort);
}
function renderList() {
  const list = $('#list');
  const vis = getVisible();
  let html = '';
  vis.forEach((i, n) => {
    const t = st.lib[i];
    html += `<div class="row${i === st.cur ? ' on' : ''}" data-i="${i}"><div class="idx"><span class="n">${String(n + 1).padStart(3, '0')}</span><span class="mk">&gt;</span></div><div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || baseName(t.path))}</div></div><div class="d">${t.duration ? fmt(t.duration) : ''}</div></div>`;
  });
  list.innerHTML = html;
  $('#empty').hidden = st.lib.length > 0 || scanning;
  $('#cntTracks').textContent = st.lib.length ? fa(st.lib.length) : '';
  $('#cntFolders').textContent = folders.length + files.length ? fa(folders.length + (files.length ? 1 : 0)) : '';
  const chip = $('#filterChip');
  if (st.plFilter) { chip.hidden = false; chip.innerHTML = `<span>${esc(T('پلی‌لیست «{name}» — {n} آهنگ', { name: st.plFilter.name, n: fa(vis.length) }))}</span><button data-clear>×</button>`; }
  else if (st.folderFilter) { chip.hidden = false; chip.innerHTML = `<svg class="i" style="width:16px;height:16px"><use href="#i-folder"/></svg><span>${esc(T('فقط «{name}» — {n} آهنگ', { name: baseName(st.folderFilter), n: fa(vis.length) }))}</span><button data-clear>×</button>`; }
  else chip.hidden = true;
}
function updateActiveRow(scroll) {
  $$('#list .row.on').forEach(r => r.classList.remove('on'));
  const row = $(`#list .row[data-i="${st.cur}"]`);
  if (row) { row.classList.add('on'); if (scroll) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function renderFolders() {
  const box = $('#folderList');
  let html = '';
  folders.forEach((f, k) => {
    const n = st.lib.filter(t => inFolder(t.path, f)).length;
    html += `<div class="folder-item${st.folderFilter === f ? ' on' : ''}" data-folder="${k}"><div class="fi"><svg class="i"><use href="#i-folder"/></svg></div><div class="fm"><div class="fn">${esc(baseName(f))}</div><div class="fp">${esc(f)}</div></div><div class="fc">${esc(T('{n} آهنگ', { n: fa(n) }))}</div><button class="rm" data-rm="${k}" title="حذف از برنامه"><svg class="i"><use href="#i-trash"/></svg></button></div>`;
  });
  if (files.length) html += `<div class="folder-item" data-files="1"><div class="fi"><svg class="i"><use href="#i-file-add"/></svg></div><div class="fm"><div class="fn">فایل‌های جداگانه</div><div class="fp">${esc(T('{n} فایل', { n: fa(files.length) }))}</div></div><button class="rm" data-rmfiles="1" title="حذف همه"><svg class="i"><use href="#i-trash"/></svg></button></div>`;
  if (!html) html = '<p class="hint">هنوز پوشه‌ای اضافه نکردی.</p>';
  box.innerHTML = html;
}

let scanning = false;
function setScanning(v) { scanning = v; $('#scanning').hidden = !v; $('#empty').hidden = st.lib.length > 0 || v; }
let scanBusy = false, scanAgain = false;
async function rescan(opt = {}) {
  const paths = [...folders, ...files];
  syncWatch();
  if (!paths.length) { swapLib([]); afterLibChange(); return; }
  if (scanBusy) { scanAgain = true; return; }
  scanBusy = true;
  if (!opt.quiet) setScanning(true);
  try {
    const before = new Set(st.lib.map(t => t.path));
    const tracks = (await invoke('scan_paths', { paths })).filter(t => !excluded.has(t.path));
    const added = tracks.filter(t => !before.has(t.path)).length;
    const gone = before.size - (tracks.length - added);
    const sig = l => l.map(t => `${t.path}|${t.title}|${t.artist}|${t.album}|${Math.round(t.duration)}`).join('\n');
    if (opt.quiet && sig(tracks) === sig(st.lib)) { /* nothing changed */ }
    else { swapLib(tracks); afterLibChange(); }
    if (opt.notify) {
      if (added) toast(T('{n} آهنگ جدید پیدا شد', { n: fa(added) }));
      else if (gone > 0) toast(T('{n} آهنگ از پوشه‌ها حذف شده بود', { n: fa(gone) }));
    }
  } catch (e) {
    console.error(e); toast(T('خطا در اسکن آهنگ‌ها: {e}', { e }));
  } finally {
    scanBusy = false; if (!opt.quiet) setScanning(false);
    if (scanAgain) { scanAgain = false; rescan({ quiet: true }); }
  }
}
let watchKey = null;
function syncWatch() {
  const list = S.watch ? [...folders] : [];
  const k = JSON.stringify(list);
  if (k === watchKey) return;
  watchKey = k;
  invoke('watch_folders', { paths: list }).catch(e => console.error(e));
}
let fsTimer = 0;
listen('zp-fs-changed', () => { clearTimeout(fsTimer); fsTimer = setTimeout(() => rescan({ quiet: true, notify: true }), 600); });
function swapLib(newLib) {
  const old = st.lib, pathOf = i => (old[i] ? old[i].path : null);
  const curPath = pathOf(st.cur), orderPaths = st.order.map(pathOf), basePaths = st.base.map(pathOf);
  st.lib = newLib;
  st.idx = new Map(newLib.map((t, i) => [t.path, i]));
  const m = p => (p == null ? null : st.idx.get(p));
  st.cur = m(curPath) != null ? m(curPath) : -1;
  st.order = orderPaths.map(m).filter(i => i != null);
  st.base = basePaths.map(m).filter(i => i != null);
  st.pos = st.cur >= 0 ? st.order.indexOf(st.cur) : -1;
}
function afterLibChange() {
  if (!st.order.length && st.cur >= 0) rebuildOrder(st.cur);
  renderList(); renderFolders(); updateStatus();
  document.dispatchEvent(new CustomEvent('zp:lib'));
}
async function addFolder() {
  const p = await invoke('pick_folder');
  if (!p) return;
  if (!folders.some(f => normPath(f) === normPath(p))) { folders.push(p); store.set('folders', folders); }
  await rescan();
  const n = st.lib.filter(t => inFolder(t.path, p)).length;
  toast(n ? T('{n} آهنگ از «{name}» اضافه شد', { n: fa(n), name: baseName(p) }) : T('توی این پوشه آهنگ قابل‌پخشی پیدا نشد'));
}
async function addFiles() {
  const arr = await invoke('pick_files');
  if (!arr || !arr.length) return;
  arr.forEach(f => { if (!files.includes(f)) files.push(f); });
  store.set('files', files);
  await rescan();
  toast(T('{n} فایل اضافه شد', { n: fa(arr.length) }));
}
const AUDIO_RE = /\.(mp3|flac|wav|ogg|oga|opus|m4a|aac|weba|webm|wma|ape|wv|aif|aiff|aifc|caf|mka|mpc|tta)$/i;
async function addPaths(paths) {
  if (!paths.length) return;
  const kinds = await invoke('path_kinds', { paths });
  let added = 0;
  kinds.forEach(k => {
    if (k.is_dir) { if (!folders.some(f => normPath(f) === normPath(k.path))) { folders.push(k.path); added++; } }
    else if (AUDIO_RE.test(k.path) && !files.includes(k.path)) { files.push(k.path); added++; }
  });
  store.set('folders', folders); store.set('files', files);
  if (!added) { toast(T('چیز جدیدی برای اضافه‌کردن پیدا نشد')); return; }
  await rescan();
  toast(T('اضافه شد ✓'));
}

/* ═════════════════════════ queue / playback ═════════════════════════ */
function rebuildOrder(startIdx, base) {
  if (base) st.base = base.slice();
  let list = st.base.length ? st.base.slice() : getVisible();
  if (startIdx >= 0 && !list.includes(startIdx)) { list = st.lib.map((_, i) => i); st.base = list.slice(); }
  if (st.shuffle) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    if (startIdx >= 0) { const k = list.indexOf(startIdx); if (k > 0) [list[0], list[k]] = [list[k], list[0]]; }
  }
  st.order = list;
  st.pos = startIdx >= 0 ? list.indexOf(startIdx) : -1;
}
function nextIndex(auto) {
  if (!st.order.length) return -1;
  let p = st.pos + 1;
  if (p >= st.order.length) {
    if (st.repeat === 'all' || !auto) { rebuildOrder(-1); p = 0; } else return -1;
  }
  return st.order[p];
}
function prevIndex() {
  if (!st.order.length) return -1;
  let p = st.pos - 1;
  if (p < 0) p = st.order.length - 1;
  return st.order[p];
}
const curDur = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (st.lib[st.cur] ? st.lib[st.cur].duration : 0));
const MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', webm: 'audio/webm' };
const isRiff = b => { const u = new Uint8Array(b, 0, Math.min(4, b.byteLength)); return u.length === 4 && u[0] === 82 && u[1] === 73 && u[2] === 70 && u[3] === 70; };
const mimeFor = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'audio/mpeg';

async function playIndex(i, o = {}) {
  const { autoplay = true, startAt = 0, rebuild = false, base = null } = o;
  if (i < 0 || i >= st.lib.length) return;
  if (rebuild || st.order.indexOf(i) < 0) rebuildOrder(i, base || undefined);
  st.cur = i; st.pos = st.order.indexOf(i);
  resetFade(); clearPre();
  const token = ++st.loadToken;
  const t = st.lib[i];
  setNowPlaying(t);
  updateActiveRow(true);
  loadCover(t, token);
  document.body.classList.add('loading');
  try {
    const buf = await invoke(o.decoded ? 'decode_audio' : 'read_audio', { path: t.path });
    if (token !== st.loadToken) return;
    const url = URL.createObjectURL(new Blob([buf], { type: isRiff(buf) ? 'audio/wav' : mimeFor(t.path) }));
    const old = st.blobUrl; st.blobUrl = url;
    activePlayer().url = url; pre.bad = -1;
    audio.src = url;
    if (old) URL.revokeObjectURL(old);
    audio.playbackRate = +$('#speed').value || 1;
    if (startAt > 0) audio.addEventListener('loadedmetadata', () => { audio.currentTime = startAt; }, { once: true });
    updateSeek(true);
    if (autoplay) { await ensureCtx(); await audio.play(); }
    st.failStreak = 0;
  } catch (e) {
    if (token !== st.loadToken || (e && e.name === 'AbortError')) return;
    console.error('play', e);
    if (!o.decoded && e && e.name === 'NotSupportedError') { o.decoded = true; document.body.classList.remove('loading'); return playIndex(i, o); }   // WebView refused it: decode in Rust
    if (String(e).includes('FFMPEG_MISSING')) { toast(T('برای پخش این فرمت (WMA / APE / WavPack…) فایل ffmpeg.exe لازمه؛ کنار برنامه بذارش.')); st.failStreak = 9; return; }
    toast(T('پخش این آهنگ ممکن نشد: {name}', { name: baseName(t.path) }));
    if (autoplay && ++st.failStreak < 5) { const n = nextIndex(true); if (n >= 0 && n !== i) setTimeout(() => playIndex(n), 500); }
  } finally {
    if (token === st.loadToken) document.body.classList.remove('loading');
  }
}
function next() { const n = nextIndex(false); if (n >= 0) playIndex(n); }
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const n = prevIndex(); if (n >= 0) playIndex(n);
}
async function togglePlay() {
  if (st.cur < 0) {
    if (!st.lib.length) { toast(T('اول یه پوشه آهنگ اضافه کن')); return; }
    const vis = getVisible();
    const start = st.shuffle ? vis[Math.floor(Math.random() * vis.length)] : vis[0];
    await playIndex(start, { rebuild: true, base: vis });
    return;
  }
  await ensureCtx();
  if (audio.paused) {
    if (!audio.src) await playIndex(st.cur);
    else { try { await audio.play(); } catch { /* ignore */ } }
  } else { finishFade(); audio.pause(); }
}
function seekRatio(r) { const d = curDur(); if (d) { audio.currentTime = clamp(r, 0, 1) * d; updateSeek(true); } }

function handleEnded() {
  if (st.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  const n = nextIndex(true);
  if (n >= 0) playIndex(n);
  else { setPlaying(false); audio.currentTime = 0; updateSeek(true); }
}

/* ═════════════ gapless / crossfade ═════════════
   The next track is read into the idle <audio> while the current one plays; when the
   current one is about to end (or `xfade` seconds before it) the idle one is started and
   the two are mixed with equal-power gain curves. */
const pre = { idx: -1, player: null, ready: false, token: 0, bad: -1 };
const xf = { active: false, timer: 0 };
function releasePlayer(pl) {
  if (!pl || pl.el === audio) return;
  try { pl.el.pause(); } catch { /* ignore */ }
  pl.el.removeAttribute('src'); pl.el.load();
  if (pl.url) { URL.revokeObjectURL(pl.url); pl.url = null; }
}
function clearPre() {
  pre.token++;
  if (pre.player) releasePlayer(pre.player);
  pre.idx = -1; pre.player = null; pre.ready = false;
}
function finishFade() {
  if (xf.active) { clearTimeout(xf.timer); xf.active = false; releasePlayer(idlePlayer()); }
  if (ctx) { const now = ctx.currentTime; players.forEach(p => { p.gain.gain.cancelScheduledValues(now); p.gain.gain.setValueAtTime(p === activePlayer() ? 1 : 0, now); }); }
}
const resetFade = finishFade;
function peekNext() {
  if (st.repeat === 'one' || st.cur < 0 || !st.order.length) return -1;
  const p = st.pos + 1;
  if (p < st.order.length) return st.order[p];
  return st.repeat === 'all' && !st.shuffle ? st.order[0] : -1;
}
async function preloadNext() {
  const i = peekNext();
  if (i < 0 || i === st.cur || xf.active || pre.idx === i || pre.bad === i) return;
  clearPre();
  const pl = idlePlayer(), my = pre.token;
  pre.idx = i; pre.player = pl; pre.ready = false;
  try {
    const t = st.lib[i];
    const buf = await invoke('read_audio', { path: t.path });
    if (my !== pre.token) return;
    const url = URL.createObjectURL(new Blob([buf], { type: isRiff(buf) ? 'audio/wav' : mimeFor(t.path) }));
    pl.url = url; pl.el.src = url; pl.el.playbackRate = audio.playbackRate;
    if (ctx) pl.gain.gain.setValueAtTime(0, ctx.currentTime);
    await new Promise((res, rej) => {
      const ok = () => { pl.el.removeEventListener('error', bad); res(); };
      const bad = () => { pl.el.removeEventListener('canplay', ok); rej(new Error('preload')); };
      pl.el.addEventListener('canplay', ok, { once: true });
      pl.el.addEventListener('error', bad, { once: true });
      pl.el.load();
    });
    if (my !== pre.token) return;
    pre.ready = true;
  } catch (e) {
    if (my !== pre.token) return;
    pre.bad = i; clearPre();                       // fall back to the normal load-on-end path
  }
}
function transition(xs) {
  const i = pre.idx, pl = pre.player, oldPl = activePlayer();
  if (nextIndex(true) !== i) { clearPre(); return; }          // queue changed meanwhile
  st.cur = i; st.pos = st.order.indexOf(i);
  const token = ++st.loadToken, t = st.lib[i];
  const now = ctx.currentTime;
  [pl, oldPl].forEach(p => p.gain.gain.cancelScheduledValues(now));
  if (xs > 0) {
    const N = 64, up = new Float32Array(N), down = new Float32Array(N);
    for (let k = 0; k < N; k++) { up[k] = Math.sin(k / (N - 1) * Math.PI / 2); down[k] = Math.cos(k / (N - 1) * Math.PI / 2); }
    pl.gain.gain.setValueCurveAtTime(up, now, xs);
    oldPl.gain.gain.setValueCurveAtTime(down, now, xs);
  } else pl.gain.gain.setValueAtTime(1, now);
  audio = pl.el; st.blobUrl = pl.url; pre.bad = -1;
  pre.idx = -1; pre.player = null; pre.ready = false;
  xf.active = true;
  xf.timer = setTimeout(() => { xf.active = false; releasePlayer(oldPl); if (ctx) { oldPl.gain.gain.cancelScheduledValues(0); oldPl.gain.gain.value = 0; pl.gain.gain.cancelScheduledValues(0); pl.gain.gain.value = 1; } }, (xs > 0 ? xs : 0.4) * 1000 + 250);
  pl.el.play().catch(() => {});
  st.failStreak = 0;
  setNowPlaying(t); updateActiveRow(true); loadCover(t, token); updateSeek(true);
}
function xfTick() {
  if (!ctx || audio.paused || st.cur < 0 || xf.active) return;
  const xs0 = +S.xfade || 0;
  if (!S.gapless && xs0 <= 0) { if (pre.idx >= 0) clearPre(); return; }
  const dur = curDur(); if (!(dur > 0)) return;
  if (audio.currentTime > 1.5) preloadNext();
  if (!pre.ready || pre.idx !== peekNext()) return;
  const xs = Math.min(xs0, dur / 3), rem = (dur - audio.currentTime) / (audio.playbackRate || 1);
  if (rem <= (xs > 0 ? xs : 0.05)) transition(xs);
}
setInterval(xfTick, 40);

const playFrom = (i, base) => playIndex(i, { rebuild: true, base });

/* "play next" / "add to queue": the queue (st.order) never holds the same track twice */
function queueInsert(i, mode, quiet) {
  if (i < 0 || i >= st.lib.length) return;
  if (st.cur < 0 || !st.order.length) { playFrom(i, [i]); return; }
  if (i === st.cur) { if (!quiet) toast(T('همین آهنگ در حال پخشه')); return; }
  const k = st.order.indexOf(i);
  if (k >= 0) { st.order.splice(k, 1); if (k < st.pos) st.pos--; }
  st.order.splice(mode === 'next' ? st.pos + 1 : st.order.length, 0, i);
  if (!quiet) toast(mode === 'next' ? 'بعد از آهنگ فعلی پخش می‌شه' : 'به انتهای صف اضافه شد');
}

function stopAndClear() {
  st.loadToken++;
  finishFade(); clearPre();
  audio.pause(); audio.removeAttribute('src'); audio.load();
  if (st.blobUrl) { URL.revokeObjectURL(st.blobUrl); st.blobUrl = null; }
  st.cur = -1; st.pos = -1;
  $('#npTitle').textContent = T('آمادهٔ پخش');
  $('#npArtist').textContent = T('یه پوشه اضافه کن و از آهنگ‌هات لذت ببر');
  $('#npAlbum').textContent = '';
  document.title = 'Zoro Player';
  trayTip(null);
  const im = $('#coverImg'); im.hidden = true; im.removeAttribute('src');
  if (st.coverUrl) { URL.revokeObjectURL(st.coverUrl); st.coverUrl = null; }
  st.thumb = null; $('#ascii').textContent = '';
  document.body.classList.remove('loading');
  applyTheme(); updateSeek(true); setPlaying(false); updateStatus(); queueWidgetPush();
}

/* "remove from app": remembered in `excluded`, so rescans do not bring the track back */
async function removeFromLibrary(paths) {
  const set = new Set(paths);
  if (!set.size) return;
  paths.forEach(p => excluded.add(p));
  store.set('excluded', [...excluded]);
  const curPath = st.lib[st.cur] && st.lib[st.cur].path, curGone = !!curPath && set.has(curPath);
  const wasPlaying = !audio.paused;
  let nextPath = null;
  if (curGone) for (let k = st.pos + 1; k < st.order.length; k++) { const p = st.lib[st.order[k]].path; if (!set.has(p)) { nextPath = p; break; } }
  swapLib(st.lib.filter(t => !set.has(t.path)));
  if (curGone) { if (nextPath && st.idx.has(nextPath)) await playIndex(st.idx.get(nextPath), { autoplay: wasPlaying }); else stopAndClear(); }
  afterLibChange();
}
async function restoreExcluded() {
  excluded.clear(); store.set('excluded', []);
  await rescan();
}

/* a track's file/tags changed on disk: patch it in place (the path may have changed too) */
function updateTrack(oldPath, t) {
  const i = st.idx.get(oldPath);
  if (i == null) return;
  st.lib[i] = t; st.idx.delete(oldPath); st.idx.set(t.path, i);
  if (oldPath !== t.path) {
    files = files.map(f => (f === oldPath ? t.path : f)); store.set('files', files);
    if (excluded.has(oldPath)) { excluded.delete(oldPath); excluded.add(t.path); store.set('excluded', [...excluded]); }
    const last = store.get('last', null);
    if (last && last.path === oldPath) store.set('last', Object.assign({}, last, { path: t.path }));
  }
  if (i === st.cur) { setNowPlaying(t); queueWidgetPush(); }
  renderList(); renderFolders(); updateStatus();
  document.dispatchEvent(new CustomEvent('zp:lib'));
}
function reloadCover() { const t = st.lib[st.cur]; if (t) loadCover(t, st.loadToken); }

/* tmux-style status line */
function updateStatus() {
  const mode = st.cur < 0 ? 'STOP' : (audio.paused ? 'PAUSE' : 'PLAY');
  const t = st.lib[st.cur];
  const clock = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  $('#stMode').textContent = mode;
  $('#stInfo').textContent = `shuf:${st.shuffle ? 'on' : 'off'}  rep:${st.repeat}  eq:${eq.on ? 'on' : 'off'}  vol:${st.muted ? 'mute' : Math.round(st.vol) + '%'}  x${$('#speed').value}`;
  $('#stTrack').textContent = t ? ((t.artist ? t.artist + ' - ' : '') + t.title) : '';
  $('#stRight').textContent = `${st.lib.length} tracks | ${folders.length + (files.length ? 1 : 0)} src | ${clock}`;
}

/* now-playing UI + cover */
function setNowPlaying(t) {
  $('#npTitle').textContent = t.title;
  $('#npArtist').textContent = t.artist || T('هنرمند نامشخص');
  $('#npAlbum').textContent = t.album || '';
  document.title = (t.artist ? t.artist + ' — ' : '') + t.title;
  trayTip(t);
  updateStatus();
  document.dispatchEvent(new CustomEvent('zp:track'));
}
function sniffImage(buf) {
  const b = new Uint8Array(buf.slice ? buf.slice(0, 12) : buf);
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return 'image/jpeg';
}
function extractPalette(img) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx, val = mx / 255;
    if (val < .2) continue;
    const w = .12 + sat * sat * 2.2 + val * .3;
    const key = ((r >> 5) << 6) | ((gg >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) || { w: 0, r: 0, g: 0, b: 0 };
    e.w += w; e.r += r * w; e.g += gg * w; e.b += b * w;
    buckets.set(key, e);
  }
  const arr = [...buckets.values()].sort((a, b) => b.w - a.w).map(e => [e.r / e.w, e.g / e.w, e.b / e.w]);
  if (!arr.length) return null;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const first = arr[0];
  const second = arr.find(c2 => dist(c2, first) > 80);
  const c1 = vivid(first);
  return { c1, c2: second ? vivid(second) : shiftHue(c1, 45) };
}
function makeThumb(img) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const s = Math.min(img.naturalWidth, img.naturalHeight) || 256;
  g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
  return c.toDataURL('image/jpeg', .82);
}
const ASCII_RAMP = ' .:-=+*#%@';
function asciiFrom(img) {
  const cols = 64, rows = 38;
  const c = document.createElement('canvas'); c.width = cols; c.height = rows;
  const g = c.getContext('2d', { willReadFrequently: true });
  const sq = Math.min(img.naturalWidth, img.naturalHeight) || 1;
  g.drawImage(img, (img.naturalWidth - sq) / 2, (img.naturalHeight - sq) / 2, sq, sq, 0, 0, cols, rows);
  const d = g.getImageData(0, 0, cols, rows).data;
  let out = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      out += ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(Math.pow(l, 0.9) * ASCII_RAMP.length))];
    }
    out += '\n';
  }
  return out;
}
function fitAscii() {
  const w = $('#cover').clientWidth;
  if (w) $('#ascii').style.fontSize = (w / (64 * 0.6)) + 'px';
}
async function loadCover(t, token) {
  let url = null, pal = null, thumb = null, ascii = '';
  try {
    const buf = await invoke('read_cover', { path: t.path });
    if (token !== st.loadToken) return;
    if (buf && buf.byteLength > 0) {
      url = URL.createObjectURL(new Blob([buf], { type: sniffImage(buf) }));
      const img = new Image(); img.src = url;
      await img.decode();
      pal = extractPalette(img); thumb = makeThumb(img); ascii = asciiFrom(img);
    }
  } catch (e) { console.warn('cover', e); url = url && (URL.revokeObjectURL(url), null); }
  if (token !== st.loadToken) { if (url) URL.revokeObjectURL(url); return; }
  const old = st.coverUrl;
  st.coverUrl = url; st.thumb = thumb;
  st.pal = pal || hashPalette(t.title + t.artist);
  $('#ascii').textContent = ascii; fitAscii();
  const im = $('#coverImg');
  if (url) { im.src = url; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; }
  applyTheme(); drawEQCurve();
  if (old) setTimeout(() => URL.revokeObjectURL(old), 1500);
  updateMediaSession(t);
  queueWidgetPush();
}
const NATIVE_SMTC = !!(window.__TAURI__ && window.__TAURI__.core);
function smtcState() {
  if (!NATIVE_SMTC) return;
  invoke('smtc_update', { kind: 'state', playing: !audio.paused, position: audio.currentTime || 0 }).catch(() => {});
}
function updateMediaSession(t) {
  if (NATIVE_SMTC) {
    invoke('smtc_update', { kind: 'meta', path: t.path, title: t.title, artist: t.artist || '', album: t.album || '', duration: curDur() || t.duration || 0 })
      .then(smtcState).catch(() => {});
    return;
  }
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '', album: t.album || '',
      artwork: st.thumb ? [{ src: st.thumb, sizes: '256x256', type: 'image/jpeg' }] : [],
    });
  } catch { /* ignore */ }
}

/* seek bar, volume etc. */
const seekEl = $('#seek'), tCur = $('#tCur'), tDur = $('#tDur');
function paintRange(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
function updateSeek(force) {
  if (st.seeking && !force) return;
  const dur = curDur(), c = audio.currentTime || 0;
  const v = dur ? Math.round(clamp(c / dur, 0, 1) * 1000) : 0;
  if (+seekEl.value !== v) { seekEl.value = v; paintRange(seekEl); }
  tCur.textContent = fmt(c);
  tDur.textContent = fmt(dur);
}
function setPlaying(p) {
  document.body.classList.toggle('playing', p);
  if (NATIVE_SMTC) smtcState();
  else if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
  updateStatus();
  queueWidgetPush();
}
function setShuffle(v) {
  st.shuffle = v; store.set('shuffle', v);
  $('#btnShuffle').classList.toggle('on', v);
  $('#btnShuffle').textContent = (v ? '[x]' : '[ ]') + ' shuf';
  rebuildOrder(st.cur); updateStatus();
}
function setRepeat(v) {
  st.repeat = v; store.set('repeat', v);
  document.body.dataset.repeat = v;
  $('#btnRepeat').classList.toggle('on', v !== 'off');
  $('#btnRepeat').textContent = (v === 'off' ? '[ ] rep' : '[x] rep:' + v);
  updateStatus();
}
function setVolume(v) {
  st.vol = clamp(v, 0, 100); if (st.vol > 0) st.muted = false;
  $('#vol').value = st.vol; paintRange($('#vol')); $('#volOut').textContent = Math.round(st.vol);
  store.set('vol', st.vol); applyVolume();
}

/* ═════════════════════════ visualizer ═════════════════════════ */
const vc = $('#viz'), vx = vc.getContext('2d');
let vw = 0, vh = 0, raf = 0, frameNo = 0, hueShift = 0, energy = 0, beat = 0;
const bars = new Float32Array(128), peaks = new Float32Array(128);
function sizeViz() {
  const r = vc.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  vw = r.width; vh = r.height;
  vc.width = Math.round(vw * dpr); vc.height = Math.round(vh * dpr);
  vx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(() => { sizeViz(); kick(); }).observe(vc);

function sample(playing) {
  const n = S.vizBars;
  if (playing) {
    analyser.getByteFrequencyData(freq);
    if (S.vizStyle === 'wave') analyser.getByteTimeDomainData(wave);
  } else if (S.vizStyle === 'wave') wave.fill(128);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const f0 = 40, f1 = Math.min(16000, ctx.sampleRate / 2 - 100), ratio = f1 / f0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (playing) {
      const a = Math.floor(f0 * Math.pow(ratio, i / n) / binHz);
      const b = Math.max(a + 1, Math.floor(f0 * Math.pow(ratio, (i + 1) / n) / binHz));
      let m = 0;
      for (let k = a; k < b && k < freq.length; k++) if (freq[k] > m) m = freq[k];
      v = Math.pow(m / 255, 1.35) * (0.8 + 0.7 * i / n) * S.vizSens;
    }
    v = Math.min(1.15, v);
    bars[i] += (v - bars[i]) * (v > bars[i] ? .62 : .14);
    peaks[i] = Math.max(peaks[i] - .007, bars[i]);
    sum += bars[i];
  }
  energy = sum / n;
  const bn = Math.max(2, Math.round(n * .08));
  let bass = 0; for (let i = 0; i < bn; i++) bass += bars[i];
  bass /= bn;
  beat += (bass - beat) * (bass > beat ? .5 : .12);
}
function rr(x, y, w, h) { vx.fillRect(x, y, w, h); }
const mix = (hex, a) => { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const barColor = (i, n, grad) => S.vizColor === 'rainbow' ? `hsl(${(i / n) * 300 + hueShift},80%,60%)` : grad;

function drawBlocks() {            // cava-style segmented bars
  const n = S.vizBars, areaH = Math.min(vh * .27, 200), base = vh - 14, x0 = 18, step = (vw - 36) / n, bw = Math.max(3, step - 3);
  const ch = 6, gap = 2, rows = Math.max(3, Math.floor(areaH / (ch + gap)));
  for (let i = 0; i < n; i++) {
    const lit = Math.round(Math.min(1, bars[i]) * rows), x = x0 + i * step + (step - bw) / 2;
    for (let r = 0; r < lit; r++) {
      const t = r / rows;
      vx.fillStyle = S.vizColor === 'rainbow' ? `hsl(${(i / n) * 300 + hueShift},80%,${42 + t * 22}%)` : mix(st.c1, .3 + .7 * t);
      vx.fillRect(x, base - (r + 1) * (ch + gap) + gap, bw, ch);
    }
    const pr = Math.round(Math.min(1, peaks[i]) * rows);
    if (pr > lit && peaks[i] > .03) { vx.fillStyle = mix(st.c1, .95); vx.fillRect(x, base - pr * (ch + gap) + gap, bw, ch); }
  }
}
function drawBars() {
  const n = S.vizBars, areaH = Math.min(vh * .28, 210), base = vh - 16, x0 = 18, step = (vw - 36) / n, bw = Math.max(2, step * .7);
  const g = vx.createLinearGradient(0, base - areaH, 0, base); g.addColorStop(0, st.c1); g.addColorStop(1, mix(st.c1, .25));
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, bars[i] * areaH), x = x0 + i * step + (step - bw) / 2;
    vx.fillStyle = barColor(i, n, g); vx.fillRect(x, base - h, bw, h);
  }
  vx.fillStyle = mix(st.c1, .9);
  for (let i = 0; i < n; i++) if (peaks[i] > .03) vx.fillRect(x0 + i * step + (step - bw) / 2, base - peaks[i] * areaH - 6, bw, 2);
}
function drawMirror() {
  const n = S.vizBars, areaH = Math.min(vh * .26, 190), mid = vh - 16 - areaH / 2, x0 = 18, step = (vw - 36) / n, bw = Math.max(2, step * .7);
  const g = vx.createLinearGradient(0, mid - areaH / 2, 0, mid + areaH / 2);
  g.addColorStop(0, mix(st.c1, .3)); g.addColorStop(.5, st.c1); g.addColorStop(1, mix(st.c1, .3));
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, bars[i] * areaH), x = x0 + i * step + (step - bw) / 2;
    vx.fillStyle = barColor(i, n, g); vx.fillRect(x, mid - h / 2, bw, h);
  }
}
function drawWave() {
  const amp = Math.min(vh * .13, 90), mid = vh - 16 - amp, pts = 180, N = wave.length;
  const path = () => {
    vx.beginPath();
    for (let p = 0; p <= pts; p++) {
      const idx = Math.floor(p / pts * (N - 1));
      const v = ((wave[idx] - 128) / 128) * S.vizSens * 1.6;
      const x = 18 + p / pts * (vw - 36), y = mid + clamp(v, -1, 1) * amp;
      p ? vx.lineTo(x, y) : vx.moveTo(x, y);
    }
  };
  vx.lineJoin = 'miter';
  vx.strokeStyle = S.vizColor === 'rainbow' ? `hsl(${hueShift},80%,60%)` : st.c1; vx.lineWidth = 2; path(); vx.stroke();
}
function drawCircle() {
  const cr = $('#cover').getBoundingClientRect(), vr = vc.getBoundingClientRect();
  const cx = cr.left - vr.left + cr.width / 2, cy = cr.top - vr.top + cr.height / 2;
  const R = cr.width * (S.coverShape === 'vinyl' ? .54 : .62) + 4;
  const N = Math.max(48, S.vizBars), half = N / 2, maxLen = Math.min(vw, vh) * .17;
  vx.lineCap = 'butt'; vx.lineWidth = Math.max(2, (2 * Math.PI * R / N) * .5);
  for (let i = 0; i < N; i++) {
    const k = i < half ? i : N - 1 - i;
    const v = bars[Math.min(127, Math.floor(k / half * S.vizBars * .9))] || 0;
    const a = (i / N) * Math.PI * 2 - Math.PI / 2, len = 4 + v * maxLen;
    vx.strokeStyle = S.vizColor === 'rainbow' ? `hsl(${(i / N) * 360 + hueShift},80%,60%)` : mix(st.c1, .45 + .55 * v);
    vx.beginPath();
    vx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    vx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
    vx.stroke();
  }
}
function loop() {
  raf = 0;
  const playing = !audio.paused && !audio.ended;
  frameNo++;
  sample(playing);
  if (playing && S.vizColor === 'rainbow') hueShift = (hueShift + .4) % 360;
  vx.clearRect(0, 0, vw, vh);
  switch (S.vizStyle) {
    case 'blocks': drawBlocks(); break;
    case 'bars': drawBars(); break;
    case 'mirror': drawMirror(); break;
    case 'wave': drawWave(); break;
    case 'circle': drawCircle(); break;
    default: break;
  }
  $('#coverBeat').style.transform = `scale(${(1 + beat * .05).toFixed(4)})`;
  if (playing) updateSeek();
  if (st.widgetOpen && frameNo % 3 === 0) {
    const n = S.vizBars, mini = [];
    for (let k = 0; k < 24; k++) mini.push(Math.round(clamp(bars[Math.floor(k * n / 24)], 0, 1) * 255));
    emitTo('widget', 'zp-viz', mini).catch(() => {});
  }
  if (playing || energy > .004 || beat > .004) raf = requestAnimationFrame(loop);
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }

/* ═════════════════════════ desktop widget ═════════════════════════ */
let wTimer = 0;
function widgetState() {
  const t = st.lib[st.cur];
  return {
    title: t ? t.title : 'Zoro Player', artist: t ? (t.artist || '') : '',
    playing: !audio.paused, dur: curDur(), pos: audio.currentTime || 0,
    thumb: st.thumb, c1: st.c1, c2: st.c2, opacity: S.widgetOpacity, onTop: !!S.widgetTop,
    scheme: S.scheme, gray: !!S.grayscale,
  };
}
function queueWidgetPush() {
  if (!st.widgetOpen) return;
  clearTimeout(wTimer);
  wTimer = setTimeout(() => emitTo('widget', 'zp-state', widgetState()).catch(() => {}), 40);
}
function updateWidgetBtn() { $('#btnWidget').classList.toggle('on', st.widgetOpen); }
async function toggleWidget() {
  try {
    const p = store.get('widgetPos', null);
    st.widgetOpen = await invoke('toggle_widget', { x: p ? p.x : null, y: p ? p.y : null, onTop: !!S.widgetTop });
  } catch (e) { console.error(e); toast(T('باز کردن ویجت ممکن نشد: {e}', { e })); }
  updateWidgetBtn();
}

/* ═════════════════════════ UI wiring ═════════════════════════ */
function openSheet(name) {
  const map = { eq: $('#eqSheet'), theme: $('#themeSheet'), lib: $('#libSheet'), queue: $('#queueSheet'), spotify: $('#spSheet') };
  const btn = { eq: $('#btnEq'), theme: $('#btnTheme'), lib: $('#btnLib'), queue: $('#btnQueue'), spotify: $('#btnSpotify') };
  Object.keys(map).forEach(k => {
    const open = k === name && !map[k].classList.contains('open');
    map[k].classList.toggle('open', open);
    btn[k].classList.toggle('on', open);
    if (open && k === 'eq') requestAnimationFrame(drawEQCurve);
    if (open) document.dispatchEvent(new CustomEvent('zp:sheet', { detail: { name: k } }));
  });
}
function closeSheets() { openSheet(null); }

const fmtOut = (k, v) => ({
  vizSens: (+v).toFixed(1) + '×', gradAngle: v + '°', xfade: v + ' s', radius: v + 'px', coverSize: v + 'px',
}[k] || (v + '%'));
function syncSettingsUI() {
  $$('[data-set]').forEach(el => {
    const k = el.dataset.set, v = S[k];
    if (el.classList.contains('seg')) $$('button', el).forEach(b => b.classList.toggle('on', String(v) === b.dataset.v));
    else if (el.type === 'checkbox') el.checked = !!v;
    else {
      el.value = v;
      if (el.type === 'range') {
        paintRange(el);
        const o = el.closest('.field') && $('output', el.closest('.field'));
        if (o) o.textContent = fmtOut(k, v);
      }
    }
  });
  $$('[data-modes]').forEach(el => { el.hidden = !el.dataset.modes.split(' ').includes(S.bgMode); });
  $$('[data-need-accent]').forEach(el => { el.hidden = S.accentMode !== 'custom'; });
  renderThemeChips();
  $('#btnViz').textContent = '[viz:' + S.vizStyle + ']';
}
function renderThemeChips() {
  $('#themeChips').innerHTML = Object.entries(THEMES).map(([k, t]) =>
    `<button class="chip${S.theme === k ? ' on' : ''}" data-theme="${k}"><span class="sw" style="background:linear-gradient(135deg,${t.sw[0]},${t.sw[1]})"></span>${t.label}</button>`).join('');
}
function setSetting(k, v) {
  S[k] = v;
  if (THEME_KEYS.includes(k)) S.theme = 'custom';
  saveSettings();
  applyTheme(); syncSettingsUI(); kick();
  if (k === 'widgetTop') invoke('set_widget_pin', { onTop: !!v }).catch(() => {});
  if (k === 'widgetOpacity') queueWidgetPush();
}
const parseVal = v => (/^-?\d+(\.\d+)?$/.test(v) ? +v : v);
function bindSettings() {
  $$('[data-set]').forEach(el => {
    const key = el.dataset.set;
    if (el.classList.contains('seg')) el.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setSetting(key, parseVal(b.dataset.v)); });
    else if (el.type === 'checkbox') el.addEventListener('change', () => setSetting(key, el.checked));
    else el.addEventListener('input', () => setSetting(key, el.type === 'range' ? +el.value : el.value));
  });
  $('#themeChips').addEventListener('click', e => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    S = Object.assign(S, THEMES[b.dataset.theme].v, { theme: b.dataset.theme });
    saveSettings(); applyTheme(); syncSettingsUI(); kick();
  });
  $('#pickBg').addEventListener('click', () => $('#bgFile').click());
  $('#clearBg').addEventListener('click', () => setSetting('bgImage', ''));
  $('#bgFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const sc = Math.min(1, 1920 / bmp.width);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', .85);
      S.bgImage = data; S.bgMode = 'image'; S.theme = 'custom';
      if (!store.set('settings', S)) toast(T('تصویر برای ذخیره‌شدن زیادی بزرگه'));
      applyTheme(); syncSettingsUI();
    } catch (err) { toast(T('این تصویر قابل‌باز شدن نبود')); console.error(err); }
  });
  $('#resetAll').addEventListener('click', () => {
    S = Object.assign({}, DEF); saveSettings(); bgKey = ''; applyTheme(); syncSettingsUI(); kick();
    toast(T('تنظیمات ظاهر بازنشانی شد'));
  });
}

function bindUI() {
  // window controls
  $('#wcMin').onclick = () => appWindow.minimize();
  $('#wcMax').onclick = () => appWindow.toggleMaximize();
  $('#wcClose').onclick = () => appWindow.close();
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input[type="text"], input:not([type])')) e.preventDefault(); });

  // title actions
  $('#btnLib').onclick = () => openSheet('lib');
  $('#btnQueue').onclick = () => openSheet('queue');
  $('#btnSpotify').onclick = () => openSheet('spotify');
  $('#btnEq').onclick = () => openSheet('eq');
  $('#btnTheme').onclick = () => openSheet('theme');
  $('#btnWidget').onclick = toggleWidget;
  $$('[data-close]').forEach(b => b.addEventListener('click', closeSheets));

  // transport
  $('#btnPlay').onclick = togglePlay;
  $('#btnNext').onclick = next;
  $('#btnPrev').onclick = prev;
  $('#btnShuffle').onclick = () => setShuffle(!st.shuffle);
  $('#btnRepeat').onclick = () => setRepeat({ off: 'all', all: 'one', one: 'off' }[st.repeat]);
  $('#btnMute').onclick = () => { st.muted = !st.muted; applyVolume(); };
  const volEl = $('#vol');
  volEl.addEventListener('input', () => setVolume(+volEl.value));
  volEl.addEventListener('wheel', e => { e.preventDefault(); setVolume(st.vol + (e.deltaY < 0 ? 4 : -4)); }, { passive: false });
  $('#speed').addEventListener('change', e => { audio.playbackRate = +e.target.value; updateStatus(); });
  $('#btnViz').onclick = () => {
    const order = ['blocks', 'bars', 'mirror', 'wave', 'circle', 'off'];
    setSetting('vizStyle', order[(order.indexOf(S.vizStyle) + 1) % order.length]);
  };

  // seek
  seekEl.addEventListener('input', () => { st.seeking = true; paintRange(seekEl); tCur.textContent = fmt(seekEl.value / 1000 * curDur()); });
  seekEl.addEventListener('change', () => { audio.currentTime = seekEl.value / 1000 * curDur(); st.seeking = false; });

  // library
  $$('.lib-tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.lib-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.lib-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  let searchT = 0;
  $('#search').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => { st.search = e.target.value; renderList(); }, 120); });
  $('#sort').addEventListener('change', e => { st.sort = e.target.value; renderList(); });
  $('#list').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) playFrom(+r.dataset.i, getVisible()); });
  $('#filterChip').addEventListener('click', e => {
    if (e.target.closest('[data-clear]')) { st.folderFilter = null; st.plFilter = null; renderList(); renderFolders(); document.dispatchEvent(new CustomEvent('zp:filter')); }
  });
  $('#btnAddFolder').onclick = addFolder;
  $('#btnEmptyAdd').onclick = addFolder;
  $('#btnAddFiles').onclick = addFiles;
  $('#btnRescan').onclick = async () => { await rescan(); toast(T('{n} آهنگ در کتابخانه است', { n: fa(st.lib.length) })); };
  $('#folderList').addEventListener('click', async e => {
    const rm = e.target.closest('[data-rm]'), rmf = e.target.closest('[data-rmfiles]'), item = e.target.closest('[data-folder]');
    if (rm) {
      const f = folders[+rm.dataset.rm];
      folders.splice(+rm.dataset.rm, 1); store.set('folders', folders);
      if (st.folderFilter === f) st.folderFilter = null;
      await rescan(); return;
    }
    if (rmf) { files = []; store.set('files', files); await rescan(); return; }
    if (item) {
      const f = folders[+item.dataset.folder];
      st.folderFilter = st.folderFilter === f ? null : f; st.plFilter = null;
      renderList(); renderFolders(); document.dispatchEvent(new CustomEvent('zp:filter'));
      if (st.folderFilter) { $$('.lib-tabs button')[0].click(); toast(T('فقط آهنگ‌های این پوشه نمایش داده می‌شن')); }
    }
  });

  // equalizer panel
  const eqOn = $('#eqOn'), eqLim = $('#eqLimiter');
  eqOn.checked = eq.on; eqLim.checked = eq.limiter;
  eqOn.addEventListener('change', () => { eq.on = eqOn.checked; applyEQ(); drawEQCurve(); persistEQ(); updateStatus(); });
  eqLim.addEventListener('change', () => { eq.limiter = eqLim.checked; applyEQ(); persistEQ(); });
  $('#eqPresets').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { delete customPresets[del.dataset.del]; store.set('eqCustom', customPresets); renderPresets(); e.stopPropagation(); return; }
    const c = e.target.closest('[data-preset]'); if (!c) return;
    const g = PRESETS[c.dataset.preset] || customPresets[c.dataset.preset];
    if (!g) return;
    eq.gains = g.slice(); eq.on = true; eqOn.checked = true;
    EQ_FREQS.forEach((_, i) => paintBand(i));
    applyEQ(); renderPresets(); drawEQCurve(); persistEQ();
  });
  $('#eqSave').addEventListener('click', () => {
    const name = $('#eqName').value.trim();
    if (!name) { toast(T('یه اسم برای پیش‌تنظیم بنویس')); return; }
    customPresets[name] = eq.gains.slice(); store.set('eqCustom', customPresets);
    $('#eqName').value = ''; renderPresets(); toast(T('«{name}» ذخیره شد', { name }));
  });
  $('#eqName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#eqSave').click(); e.stopPropagation(); });
  $('#eqReset').addEventListener('click', () => {
    eq.gains = Array(10).fill(0); eq.pre = 0;
    ['pre', ...EQ_FREQS.keys()].forEach(paintBand);
    applyEQ(); renderPresets(); drawEQCurve(); persistEQ();
  });
  window.addEventListener('resize', () => { if ($('#eqSheet').classList.contains('open')) drawEQCurve(); });

  // audio element events (both players; only the active one counts)
  players.forEach(({ el }) => {
    const live = fn => e => { if (el === audio) fn(e); };
    el.addEventListener('play', live(() => { setPlaying(true); kick(); }));
    el.addEventListener('pause', live(() => { setPlaying(false); updateSeek(true); }));
    el.addEventListener('ended', live(handleEnded));
    el.addEventListener('seeked', live(smtcState));
    el.addEventListener('timeupdate', live(() => {
      if (audio.paused) updateSeek();
      if (st.widgetOpen) emitTo('widget', 'zp-tick', { pos: audio.currentTime, dur: curDur() }).catch(() => {});
    }));
    el.addEventListener('loadedmetadata', live(() => {          // formats without a readable duration (e.g. WMA)
      const t = st.lib[st.cur];
      if (t && !(t.duration > 0) && isFinite(audio.duration)) { t.duration = audio.duration; renderList(); }
    }));
    ['loadedmetadata', 'durationchange', 'seeked'].forEach(ev => el.addEventListener(ev, live(() => updateSeek(true))));
    el.addEventListener('error', live(() => {
      if (!audio.src) return;
      toast(T('این فایل قابل‌پخش نیست'));
    }));
  });

  // first user gesture unlocks the AudioContext
  const unlock = () => ensureCtx();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  // media keys / OS media overlay
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* ignore */ } };
    h('play', togglePlay); h('pause', togglePlay); h('previoustrack', prev); h('nexttrack', next);
  }

  // keyboard shortcuts
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (document.body.classList.contains('modal-open') || document.body.classList.contains('menu-open')) return;
    if (e.key === 'Escape') { closeSheets(); return; }
    if (tag === 'input' && e.target.type !== 'range') return;
    if (tag === 'select') return;
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' && e.ctrlKey) next();
    else if (e.key === 'ArrowLeft' && e.ctrlKey) prev();
    else if (e.key === 'ArrowRight' && tag !== 'input') { audio.currentTime = Math.min(curDur(), audio.currentTime + 5); }
    else if (e.key === 'ArrowLeft' && tag !== 'input') { audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (e.key === 'ArrowUp' && tag !== 'input') { e.preventDefault(); setVolume(st.vol + 5); }
    else if (e.key === 'ArrowDown' && tag !== 'input') { e.preventDefault(); setVolume(st.vol - 5); }
    else if (k === 'm') { st.muted = !st.muted; applyVolume(); }
    else if (k === 's') setShuffle(!st.shuffle);
    else if (k === 'r') $('#btnRepeat').click();
    else if (k === 'e') openSheet('eq');
    else if (k === 'l') openSheet('lib');
    else if (k === 'q') openSheet('queue');
    else if (k === 'v') $('#btnViz').click();
  });

  // drag & drop of folders / files from Explorer
  listen('tauri://drag-enter', () => document.body.classList.add('dragging'));
  listen('tauri://drag-leave', () => document.body.classList.remove('dragging'));
  listen('tauri://drag-drop', e => { document.body.classList.remove('dragging'); addPaths((e.payload && e.payload.paths) || []).catch(err => toast(T('خطا: {e}', { e: err }))); });

  // widget → main
  listen('zp-widget-ready', () => { st.widgetOpen = true; updateWidgetBtn(); queueWidgetPush(); });
  listen('zp-widget-closed', () => { st.widgetOpen = false; updateWidgetBtn(); });
  listen('zp-widget-moved', e => store.set('widgetPos', e.payload));
  listen('zp-widget-pin', e => { S.widgetTop = !!(e.payload && e.payload.onTop); saveSettings(); syncSettingsUI(); });
  listen('zp-cmd', e => {
    const { cmd, value } = e.payload || {};
    if (cmd === 'toggle') togglePlay(); else if (cmd === 'play') { if (audio.paused) togglePlay(); } else if (cmd === 'pause') { if (!audio.paused) togglePlay(); } else if (cmd === 'next') next(); else if (cmd === 'prev') prev(); else if (cmd === 'seek') seekRatio(+value);
  });

  // remember position
  setInterval(() => {
    const t = st.lib[st.cur];
    if (t && audio.src) store.set('last', { path: t.path, t: audio.currentTime || 0 });
  }, 3000);
  window.addEventListener('beforeunload', () => {
    const t = st.lib[st.cur];
    if (t) store.set('last', { path: t.path, t: audio.currentTime || 0 });
  });
}

/* ═════════════════════════ start ═════════════════════════ */
async function init() {
  syncTray(); trayLabels();
  initAudio();
  buildEQ(); renderPresets();
  bindSettings(); bindUI();
  setVolume(st.vol); setShuffle(st.shuffle); setRepeat(st.repeat);
  applyTheme(); syncSettingsUI(); sizeViz(); drawEQCurve();
  $('#btnShuffle').classList.toggle('on', st.shuffle);
  updateStatus(); setInterval(updateStatus, 20000);
  new ResizeObserver(fitAscii).observe($('#cover'));
  document.addEventListener('pointerdown', e => {          // Hyprland-style focused tile
    const tile = e.target.closest('.tile');
    if (tile) $$('.tile').forEach(x => x.classList.toggle('active', x === tile));
  });

  // show the cached library instantly, then refresh from disk in the background
  const startPaths = [...folders, ...files];
  if (startPaths.length) {
    try {
      const cached = (await invoke('cached_library', { paths: startPaths })).filter(t => !excluded.has(t.path));
      if (cached.length) { swapLib(cached); afterLibChange(); }
    } catch (e) { console.error(e); }
  }
  await rescan({ quiet: st.lib.length > 0, notify: st.lib.length > 0 });

  const last = store.get('last', null);
  if (S.resume && last && st.lib.length) {
    const i = st.lib.findIndex(t => t.path === last.path);
    if (i >= 0) await playIndex(i, { autoplay: false, startAt: last.t || 0, rebuild: true });
  }
  if (S.widgetAuto) toggleWidget();
}
const nTracks = n => T('{n} آهنگ', { n: fa(n) });
window.ZP = {
  st, store, toast, esc, fa, fmt, baseName, normPath, inFolder, invoke, listen, $, $$, clamp, appWindow,
  get S() { return S; }, get folders() { return folders; }, get files() { return files; }, get excluded() { return excluded; },
  getVisible, sortIdx, playFrom, playIndex, queueInsert, togglePlay, removeFromLibrary, restoreExcluded,
  get audio() { return audio; }, nTracks, updateTrack, reloadCover, renderList, renderFolders, rescan, openSheet, closeSheets,
};

document.addEventListener('zp:lang', () => {
  trayLabels();
  if (st.cur < 0) { $('#npTitle').textContent = T('آمادهٔ پخش'); $('#npArtist').textContent = T('یه پوشه اضافه کن و از آهنگ‌هات لذت ببر'); }
  else if (!st.lib[st.cur].artist) $('#npArtist').textContent = T('هنرمند نامشخص');
  renderList(); renderFolders(); document.dispatchEvent(new CustomEvent('zp:lib'));
});
if (st.cur < 0) { $('#npTitle').textContent = T('آمادهٔ پخش'); $('#npArtist').textContent = T('یه پوشه اضافه کن و از آهنگ‌هات لذت ببر'); }
init().catch(e => { console.error(e); toast(T('خطا در راه‌اندازی: {e}', { e })); });
})();
