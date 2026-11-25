/* Zoro Player — desktop widget window (Monochrome terminal style) */
(() => {
'use strict';
const T = window.__TAURI__;
const { invoke } = T.core;
const { listen, emit } = T.event;
const win = T.window.getCurrentWindow();
const $ = s => document.querySelector(s);

let pos = 0, dur = 0, playing = false, onTop = false;
let target = new Array(24).fill(0), cur = new Array(24).fill(0), lastViz = 0;
let c1 = '#e8e8e8';

const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function apply(s) {
  $('#title').textContent = s.title || 'Zoro Player';
  $('#artist').textContent = s.artist || '';
  playing = !!s.playing; pos = s.pos || 0; dur = s.dur || 0; onTop = !!s.onTop;
  document.body.classList.toggle('playing', playing);
  $('#mode').textContent = playing ? 'PLAY' : 'PAUSE';
  if (s.scheme) document.body.dataset.scheme = s.scheme;
  const r = document.documentElement.style;
  if (s.c1) { c1 = s.c1; r.setProperty('--accent', s.c1); const n = parseInt(s.c1.slice(1), 16); r.setProperty('--accent-rgb', [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',')); }
  if (s.opacity != null) r.setProperty('--op', s.opacity / 100);
  r.setProperty('--gray', s.gray ? 1 : 0);
  const cover = $('#cover');
  if (s.thumb) { cover.style.backgroundImage = `url("${s.thumb}")`; cover.classList.add('has'); }
  else { cover.style.backgroundImage = ''; cover.classList.remove('has'); }
  $('#pin').classList.toggle('on', onTop);
  progress();
}
function progress() {
  $('#bar').style.width = (dur ? Math.min(100, pos / dur * 100) : 0) + '%';
  $('#tc').textContent = fmt(pos); $('#td').textContent = fmt(dur);
}

listen('zp-state', e => apply(e.payload));
listen('zp-tick', e => { pos = e.payload.pos; dur = e.payload.dur; progress(); });
listen('zp-viz', e => { target = e.payload; lastViz = performance.now(); });
listen('zp-lang', e => window.I18N && window.I18N.setLang(e.payload, true));

const cmd = (c, v) => emit('zp-cmd', { cmd: c, value: v });
$('#play').onclick = () => cmd('toggle');
$('#next').onclick = () => cmd('next');
$('#prev').onclick = () => cmd('prev');
$('#prog').addEventListener('click', e => { const r = $('#prog i').getBoundingClientRect(); cmd('seek', (e.clientX - r.left) / r.width); });
$('#close').onclick = () => win.close();
$('#pin').onclick = async () => {
  onTop = !onTop;
  $('#pin').classList.toggle('on', onTop);
  try { await invoke('set_widget_pin', { onTop }); } catch (e) { console.warn(e); }
  emit('zp-widget-pin', { onTop });
};
document.addEventListener('contextmenu', e => e.preventDefault());

// remember where the user dropped the widget
let moveT = 0;
win.onMoved(({ payload }) => {
  clearTimeout(moveT);
  moveT = setTimeout(() => {
    const d = window.devicePixelRatio || 1;
    emit('zp-widget-moved', { x: Math.round(payload.x / d), y: Math.round(payload.y / d) });
  }, 300);
});

// cava-style block spectrum
const cv = $('#viz'), g = cv.getContext('2d');
function draw() {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const stale = performance.now() - lastViz > 400;
  const n = cur.length, step = w / n, bw = Math.max(2, step - 2), ch = 3, gap = 1, rows = Math.floor(h / (ch + gap));
  const rgb = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
  for (let i = 0; i < n; i++) {
    const t = stale ? 0 : (target[i] || 0) / 255;
    cur[i] += (t - cur[i]) * (t > cur[i] ? .5 : .15);
    const lit = Math.round(cur[i] * rows), x = i * step + (step - bw) / 2;
    for (let r = 0; r < lit; r++) {
      g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${.3 + .7 * r / rows})`;
      g.fillRect(x, h - (r + 1) * (ch + gap) + gap, bw, ch);
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// tell the main window we are ready so it sends the current state
emit('zp-widget-ready', {});
})();
