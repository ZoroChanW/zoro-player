/* Zoro Player — library features: playlists, cover library, context menu, info & tag editor.
   Loaded after app.js; talks to it through window.ZP. UI strings are Persian source strings
   (translated by i18n.js); anything with a variable goes through T('... {x}', { x }). */
(() => {
'use strict';
const Z = window.ZP;
const { st, store, toast, esc, fa, fmt, baseName, normPath, invoke, $, $$, clamp } = Z;
const on = (el, ev, fn, o) => el.addEventListener(ev, fn, o);
const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
const dirOf = p => p.replace(/[\\/][^\\/]*$/, '');
const fmtLong = s => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
const totalDur = idxs => idxs.reduce((a, i) => a + ((st.lib[i] && st.lib[i].duration) || 0), 0);
const errText = e => String((e && e.message) || e);

/* ═════════════════════════ state ═════════════════════════ */
let playlists = store.get('playlists', []);
if (!Array.isArray(playlists)) playlists = [];
const lv = { tab: 'tracks', q: '', sort: store.get('lvSort', 'title'), view: store.get('lvView', 'grid'), detail: null, cur: null };
const sel = new Set();           // selected track paths (library sheet only)
let lastSel = null;

/* ═════════════════════════ playlists ═════════════════════════ */
const savePL = () => store.set('playlists', playlists);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const plById = id => playlists.find(p => p.id === id) || null;
Z.getPlaylistPaths = id => (plById(id) || { paths: [] }).paths;

function plIdx(id) {                        // tracks of a playlist that exist in the library + count of missing ones
  const p = plById(id), idx = []; let missing = 0;
  if (p) p.paths.forEach(path => { const i = st.idx.get(path); if (i == null) missing++; else idx.push(i); });
  return { idx, missing };
}
function plChanged() {
  savePL();
  if (st.plFilter) { const p = plById(st.plFilter.id); if (p) st.plFilter.name = p.name; else st.plFilter = null; Z.renderList(); }
  renderPlPane();
  if (libOpen() && (lv.detail || lv.tab === 'playlists')) renderLib(); else updateLibCounts();
}
function createPlaylist(name, paths = []) {
  const p = { id: uid(), name: name.trim().slice(0, 60), paths: [...new Set(paths)], created: Date.now() };
  playlists.push(p); plChanged(); return p;
}
function renamePlaylist(id, name) { const p = plById(id); if (p) { p.name = name.trim().slice(0, 60); plChanged(); } }
function deletePlaylist(id) {
  playlists = playlists.filter(p => p.id !== id);
  if (st.plFilter && st.plFilter.id === id) st.plFilter = null;
  if (lv.detail && lv.detail.id === id) lv.detail = null;
  plChanged(); Z.renderList();
}
function addToPlaylist(id, paths) {
  const p = plById(id); if (!p) return 0;
  const have = new Set(p.paths); let n = 0;
  paths.forEach(x => { if (!have.has(x)) { have.add(x); p.paths.push(x); n++; } });
  if (n) plChanged();
  return n;
}
function removeFromPlaylist(id, paths) {
  const p = plById(id); if (!p) return;
  const rm = new Set(paths); p.paths = p.paths.filter(x => !rm.has(x)); plChanged();
}
function movePl(id, path, dir) {
  const p = plById(id); if (!p) return;
  const k = p.paths.indexOf(path); if (k < 0) return;
  let j = k + dir;
  while (j >= 0 && j < p.paths.length && !st.idx.has(p.paths[j])) j += dir;      // skip unavailable entries
  if (j < 0 || j >= p.paths.length) return;
  const [x] = p.paths.splice(k, 1); p.paths.splice(j, 0, x); plChanged();
}
function pruneMissing(id) { const p = plById(id); if (p) { p.paths = p.paths.filter(x => st.idx.has(x)); plChanged(); } }
function playPlaylist(id, shuffle) {
  const { idx } = plIdx(id);
  if (!idx.length) { toast(T('این پلی‌لیست آهنگ قابل‌پخشی نداره')); return; }
  let start = idx[0];
  if (shuffle) { if (!st.shuffle) $('#btnShuffle').click(); start = idx[Math.floor(Math.random() * idx.length)]; }
  Z.playFrom(start, idx);
}
async function newPlaylistDialog(paths = []) {
  const name = await askText({ title: T('پلی‌لیست جدید'), label: T('نام پلی‌لیست'), value: '', ok: T('ساختن') });
  if (!name) return null;
  const p = createPlaylist(name, paths);
  toast(paths.length ? T('«{name}» ساخته شد و {n} آهنگ اضافه شد', { name, n: paths.length }) : T('«{name}» ساخته شد', { name }));
  return p;
}
async function renamePlaylistDialog(id) {
  const p = plById(id); if (!p) return;
  const name = await askText({ title: T('تغییر نام پلی‌لیست'), label: T('نام پلی‌لیست'), value: p.name, ok: T('ذخیره') });
  if (name) renamePlaylist(id, name);
}
async function deletePlaylistDialog(id) {
  const p = plById(id); if (!p) return;
  const ok = await confirmBox({ title: T('حذف پلی‌لیست'), text: T('پلی‌لیست «{name}» حذف بشه؟ آهنگ‌ها و فایل‌ها دست‌نخورده می‌مونن.', { name: p.name }), ok: T('حذف'), danger: true });
  if (ok) { deletePlaylist(id); toast(T('پلی‌لیست حذف شد')); }
}

/* playlist image (custom cover, stored as a small JPEG data URL) */
async function setPlaylistImage(id) {
  const p = plById(id); if (!p) return;
  try {
    const path = await invoke('pick_image'); if (!path) return;
    const buf = await invoke('read_image', { path });
    const bmp = await createImageBitmap(new Blob([buf]));
    const s = Math.min(bmp.width, bmp.height) || 1, N = 320;
    const c = document.createElement('canvas'); c.width = c.height = N;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
    if (bmp.close) bmp.close();
    p.cover = c.toDataURL('image/jpeg', 0.85);
    plChanged();
  } catch (e) { toast(T('خواندن تصویر ممکن نشد: {e}', { e: errText(e) })); }
}
function clearPlaylistImage(id) { const p = plById(id); if (p) { delete p.cover; plChanged(); } }

/* ═════════════════════════ cover thumbnails (lazy, cached per album) ═════════════════════════ */
const thumbs = new Map();       // key -> blob url | null | Promise
const tq = []; let tActive = 0;
const thumbKey = t => (t.album ? normPath(dirOf(t.path)) + '|' + t.album.toLowerCase() : t.path);
async function makeThumb(buf) {
  const bmp = await createImageBitmap(new Blob([buf]));
  const s = Math.min(bmp.width, bmp.height) || 1, N = 176;
  const c = document.createElement('canvas'); c.width = c.height = N;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  if (bmp.close) bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  return blob ? URL.createObjectURL(blob) : null;
}
function pumpThumbs() {
  while (tActive < 3 && tq.length) {
    const job = tq.shift(); tActive++;
    (async () => {
      let url = null;
      try { const buf = await invoke('read_cover', { path: job.t.path }); if (buf && buf.byteLength > 0) url = await makeThumb(buf); } catch { url = null; }
      tActive--; job.res(url); pumpThumbs();
    })();
  }
}
function requestThumb(t, cb) {
  const k = thumbKey(t), v = thumbs.get(k);
  if (v !== undefined) { if (v instanceof Promise) v.then(cb); else cb(v); return; }
  const p = new Promise(res => { tq.push({ t, res }); });
  thumbs.set(k, p);
  p.then(url => { thumbs.set(k, url); cb(url); });
  pumpThumbs();
}

/* ═════════════════════════ context menu ═════════════════════════ */
const ctx = $('#ctx');
let ctxOpen = false;
function closeMenu() {
  if (!ctxOpen) return;
  ctx.hidden = true; ctx.innerHTML = ''; ctxOpen = false;
  document.body.classList.remove('menu-open');
}
function placeSub(item, sub) {
  const r = item.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
  const left = r.left >= w + 4 || r.left >= innerWidth - r.right;         // prefer the left side, like RTL menus
  sub.style.left = left ? 'auto' : '100%'; sub.style.right = left ? '100%' : 'auto';
  const down = r.top - 5 + h <= innerHeight - 6;
  sub.style.top = down ? '-5px' : 'auto'; sub.style.bottom = down ? 'auto' : '-5px';
}
function buildMenu(items, root) {
  items.forEach(it => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'cm-sep'; root.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'cm-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '') + (it.sub ? ' sub' : '');
    const lab = document.createElement('span'); lab.className = 'cm-l'; lab.textContent = it.label; el.appendChild(lab);
    if (it.hint) { const h = document.createElement('span'); h.className = 'cm-k'; h.textContent = it.hint; el.appendChild(h); }
    if (it.sub) {
      const sub = document.createElement('div'); sub.className = 'cm-sub'; buildMenu(it.sub, sub); el.appendChild(sub);
      on(el, 'mouseenter', () => placeSub(el, sub));
    } else if (!it.disabled) {
      on(el, 'click', e => { e.stopPropagation(); closeMenu(); if (it.act) it.act(); });
    }
    root.appendChild(el);
  });
}
function showMenu(x, y, items) {
  closeMenu();
  buildMenu(items, ctx);
  ctx.hidden = false; ctx.style.left = '0px'; ctx.style.top = '0px';
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  const left = clamp(document.documentElement.dir === 'rtl' && x - w >= 6 ? x - w : x, 6, Math.max(6, innerWidth - w - 6));
  const top = y + h > innerHeight - 6 ? Math.max(6, y - h > 6 ? y - h : innerHeight - h - 6) : y;
  ctx.style.left = left + 'px'; ctx.style.top = top + 'px';
  ctxOpen = true; document.body.classList.add('menu-open');
}
on(window, 'pointerdown', e => { if (ctxOpen && !ctx.contains(e.target)) closeMenu(); }, true);
on(window, 'blur', closeMenu);
on(window, 'resize', closeMenu);
on(window, 'wheel', e => { if (ctxOpen && !ctx.contains(e.target)) closeMenu(); }, { capture: true, passive: true });

/* ═════════════════════════ modal dialogs ═════════════════════════ */
const modal = $('#modal'), dlgTitle = $('#dlgTitle'), dlgBody = $('#dlgBody'), dlgFoot = $('#dlgFoot');
let modalState = null, downOnBackdrop = false;
function closeModal(result) {
  if (!modalState) return;
  const s = modalState; modalState = null;
  modal.hidden = true; dlgBody.innerHTML = ''; dlgFoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (s.onClose) s.onClose();
  s.resolve(result);
}
function openModal({ title, body, buttons = [], wide = false, dismiss = true, onClose }) {
  closeMenu();
  if (modalState) closeModal(null);
  return new Promise(resolve => {
    modalState = { resolve, dismiss, onClose };
    dlgTitle.textContent = title;
    dlgBody.innerHTML = '';
    if (typeof body === 'string') dlgBody.innerHTML = body; else dlgBody.appendChild(body);
    dlgFoot.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      on(el, 'click', async () => {
        if (b.act) { let r; try { r = await b.act(); } catch (e) { toast(errText(e)); return; } if (r === false) return; }
        closeModal(b.value !== undefined ? b.value : true);
      });
      dlgFoot.appendChild(el);
    });
    modal.classList.toggle('wide', wide);
    modal.hidden = false; document.body.classList.add('modal-open');
    const f = dlgBody.querySelector('[autofocus], input, textarea') || dlgFoot.querySelector('.primary, .danger');
    if (f) { f.focus(); if (f.select && f.tagName === 'INPUT') f.select(); }
  });
}
on(modal, 'mousedown', e => { downOnBackdrop = e.target === modal; });
on(modal, 'mouseup', e => { if (downOnBackdrop && e.target === modal && modalState && modalState.dismiss) closeModal(null); downOnBackdrop = false; });
on($('#dlgX'), 'click', () => { if (modalState && modalState.dismiss) closeModal(null); });

function askText({ title, label, value = '', ok }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="dlg-field"><span></span><input type="text" maxlength="60" spellcheck="false"></label>`;
    $('span', wrap).textContent = label;
    const inp = $('input', wrap); inp.value = value;
    openModal({
      title, body: wrap,
      buttons: [
        { label: ok || T('تأیید'), primary: true, value: '__ok', act: () => { if (!inp.value.trim()) { inp.focus(); return false; } } },
        { label: T('انصراف'), value: null },
      ],
    }).then(r => resolve(r === '__ok' ? inp.value.trim() : null));
  });
}
function confirmBox({ title, text, ok, danger = false }) {
  const body = document.createElement('p'); body.className = 'dlg-text'; body.textContent = text;
  return openModal({
    title, body,
    buttons: [{ label: ok || T('تأیید'), primary: !danger, danger, value: true }, { label: T('انصراف'), value: false }],
  }).then(r => r === true);
}

/* ═════════════════════════ info + tag editor ═════════════════════════ */
const fmtSize = b => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const fmtDate = s => { const d = new Date(s * 1000), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

async function coverUrlOf(path) {
  try { const buf = await invoke('read_cover', { path }); return buf && buf.byteLength > 0 ? URL.createObjectURL(new Blob([buf])) : null; } catch { return null; }
}
async function openInfo(i) {
  const t = st.lib[i]; if (!t) return;
  let info;
  try { info = await invoke('track_info', { path: t.path }); } catch (e) { toast(T('خواندن اطلاعات ممکن نشد: {e}', { e: errText(e) })); return; }
  const dash = '—', v = x => (x === null || x === undefined || x === '' ? dash : x);
  const ch = info.channels === 1 ? T('مونو') : info.channels === 2 ? T('استریو') : v(info.channels);
  const rows = [
    ['عنوان', v(info.title)], ['هنرمند', v(info.artist)], ['آلبوم', v(info.album)], ['هنرمند آلبوم', v(info.albumArtist)],
    ['ژانر', v(info.genre)], ['سال', v(info.year)], ['شمارهٔ ترک', v(info.track)], ['توضیح', v(info.comment)], null,
    ['مدت', fmt(info.duration)], ['فرمت', info.format],
    ['بیت‌ریت', info.bitrate ? info.bitrate + ' kbps' : dash], ['نرخ نمونه', info.sampleRate ? info.sampleRate + ' Hz' : dash],
    ['کانال', ch], ['حجم', fmtSize(info.size)], ['آخرین تغییر', info.modified ? fmtDate(info.modified) : dash], null,
    ['نام فایل', info.fileStem + (info.ext ? '.' + info.ext : ''), true], ['مسیر', info.path, true],
  ];
  const body = document.createElement('div'); body.className = 'info-wrap';
  const cv = document.createElement('div'); cv.className = 'info-cover'; cv.innerHTML = '<span>no cover</span>';
  const dl = document.createElement('dl'); dl.className = 'info-grid';
  rows.forEach(r => {
    if (!r) { const s = document.createElement('div'); s.className = 'sep'; dl.appendChild(s); return; }
    const dt = document.createElement('dt'); dt.textContent = r[0];
    const dd = document.createElement('dd'); dd.textContent = r[1]; dd.setAttribute('data-no-i18n', ''); if (r[2]) dd.className = 'ltr';
    dl.append(dt, dd);
  });
  body.append(cv, dl);
  let url = null;
  coverUrlOf(t.path).then(u => { url = u; if (u && modalState) { cv.style.backgroundImage = `url("${u}")`; cv.classList.add('has'); } else if (u) URL.revokeObjectURL(u); });
  const r = await openModal({
    title: T('اطلاعات آهنگ'), body, wide: true,
    onClose: () => { if (url) URL.revokeObjectURL(url); },
    buttons: [
      { label: T('ویرایش نام و تگ‌ها…'), primary: true, value: 'edit' },
      { label: T('باز کردن محل فایل'), value: 'reveal' },
      { label: T('بستن'), value: null },
    ],
  });
  if (r === 'edit') openEdit(st.idx.get(t.path)); else if (r === 'reveal') reveal(t.path);
}

async function openEdit(i) {
  const t = st.lib[i]; if (i == null || !t) return;
  let info;
  try { info = await invoke('track_info', { path: t.path }); } catch (e) { toast(T('خواندن اطلاعات ممکن نشد: {e}', { e: errText(e) })); return; }
  let coverPath = null, removeCover = false, urlA = null, urlB = null;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="ed-grid">
      <div class="ed-cover">
        <div class="info-cover" id="edCv"><span>no cover</span></div>
        <div class="ed-cbtns"><button class="tbtn" id="edPick" type="button">تغییر کاور…</button><button class="tbtn" id="edDelCover" type="button">حذف کاور</button></div>
      </div>
      <div class="ed-fields">
        <label class="full"><span>نام فایل</span><div class="ed-file"><input id="ef-file" type="text" spellcheck="false"><em></em></div></label>
        <label class="full"><span>عنوان</span><input id="ef-title" type="text" spellcheck="false"></label>
        <label><span>هنرمند</span><input id="ef-artist" type="text" spellcheck="false"></label>
        <label><span>آلبوم</span><input id="ef-album" type="text" spellcheck="false"></label>
        <label><span>هنرمند آلبوم</span><input id="ef-albumArtist" type="text" spellcheck="false"></label>
        <label><span>ژانر</span><input id="ef-genre" type="text" spellcheck="false"></label>
        <label><span>سال</span><input id="ef-year" type="text" inputmode="numeric" maxlength="4"></label>
        <label><span>شمارهٔ ترک</span><input id="ef-track" type="text" inputmode="numeric" maxlength="5"></label>
        <label class="full"><span>توضیح</span><input id="ef-comment" type="text" spellcheck="false"></label>
      </div>
    </div>
    <div class="ed-note" id="edNote" hidden></div>
    <div class="ed-err" id="edErr" hidden></div>`;
  const f = id => $('#ef-' + id, body), cv = $('#edCv', body), errEl = $('#edErr', body), note = $('#edNote', body);
  f('file').value = info.fileStem; $('.ed-file em', body).textContent = info.ext ? '.' + info.ext : '';
  f('title').value = info.title; f('artist').value = info.artist; f('album').value = info.album;
  f('albumArtist').value = info.albumArtist; f('genre').value = info.genre; f('comment').value = info.comment;
  f('year').value = info.year == null ? '' : info.year; f('track').value = info.track == null ? '' : info.track;
  $$('input', body).forEach(el => el.setAttribute('data-no-i18n', ''));
  const setCv = u => { cv.style.backgroundImage = u ? `url("${u}")` : ''; cv.classList.toggle('has', !!u); };
  const showErr = m => { errEl.textContent = m; errEl.hidden = !m; };
  if (!info.writable) { note.textContent = T('این فایل فقط‌خواندنیه؛ احتمالاً ذخیرهٔ تگ‌ها ممکن نیست.'); note.hidden = false; }
  else if (info.format === 'WAV') { note.textContent = T('فرمت WAV از کاور و هنرمند آلبوم داخل فایل پشتیبانی نمی‌کنه.'); note.hidden = false; }
  coverUrlOf(t.path).then(u => { urlA = u; if (modalState) setCv(u); else if (u) URL.revokeObjectURL(u); });
  on($('#edPick', body), 'click', async () => {
    try {
      const p = await invoke('pick_image'); if (!p) return;
      const buf = await invoke('read_image', { path: p });
      if (urlB) URL.revokeObjectURL(urlB);
      urlB = URL.createObjectURL(new Blob([buf])); setCv(urlB); coverPath = p; removeCover = false; showErr('');
    } catch (e) { showErr(T('خواندن تصویر ممکن نشد: {e}', { e: errText(e) })); }
  });
  on($('#edDelCover', body), 'click', () => { coverPath = null; removeCover = true; setCv(null); });

  const save = async () => {
    const num = (s, max) => { s = s.trim(); if (!s) return null; const n = parseInt(s, 10); return /^\d+$/.test(s) && n >= 0 && n <= max ? n : NaN; };
    const year = num(f('year').value, 9999), track = num(f('track').value, 99999);
    if (Number.isNaN(year) || Number.isNaN(track)) { showErr(T('سال یا شمارهٔ ترک معتبر نیست')); return false; }
    if (!f('file').value.trim()) { showErr(T('نام فایل نباید خالی باشد')); return false; }
    showErr('');
    const btns = $$('button', dlgFoot); btns.forEach(b => { b.disabled = true; });
    try {
      const res = await invoke('edit_track', {
        path: t.path,
        edit: {
          fileStem: f('file').value, title: f('title').value, artist: f('artist').value, album: f('album').value,
          albumArtist: f('albumArtist').value, genre: f('genre').value, comment: f('comment').value,
          year, track, coverPath, removeCover,
        },
      });
      applyEdit(t.path, res, !!coverPath || removeCover);
      return true;
    } catch (e) { showErr(errText(e)); return false; } finally { btns.forEach(b => { b.disabled = false; }); }
  };
  await openModal({
    title: T('ویرایش نام و تگ‌ها'), body, wide: true, dismiss: false,
    onClose: () => { if (urlA) URL.revokeObjectURL(urlA); if (urlB) URL.revokeObjectURL(urlB); },
    buttons: [{ label: T('ذخیره'), primary: true, act: save, value: true }, { label: T('انصراف'), value: false }],
  });
}
function applyEdit(oldPath, res, coverChanged) {
  const nt = res.track;
  if (nt.path !== oldPath) {
    playlists.forEach(p => { const k = p.paths.indexOf(oldPath); if (k >= 0) p.paths[k] = nt.path; });
    savePL(); sel.delete(oldPath);
    if (lastSel === oldPath) lastSel = nt.path;
  }
  const wasCurrent = st.lib[st.cur] && st.lib[st.cur].path === oldPath;
  Z.updateTrack(oldPath, nt);
  thumbs.clear();
  if (wasCurrent && coverChanged) Z.reloadCover();
  renderPlPane(); renderLibIfOpen();
  toast(res.warning ? res.warning : T('تغییرات ذخیره شد'));
}

/* ═════════════════════════ track actions + menus ═════════════════════════ */
const reveal = path => invoke('reveal_in_explorer', { path }).catch(e => toast(errText(e)));
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-999px';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
async function removeTracks(paths) {
  if (paths.length > 1) {
    const ok = await confirmBox({ title: T('حذف از برنامه'), text: T('{n} آهنگ از برنامه حذف بشن؟ فایل‌ها روی دیسک دست‌نخورده می‌مونن و از تب «پوشه‌ها» می‌تونی برشون گردونی.', { n: paths.length }), ok: T('حذف'), danger: true });
    if (!ok) return;
  }
  clearSel(true);
  await Z.removeFromLibrary(paths);
  toast(paths.length > 1 ? T('{n} آهنگ از برنامه حذف شد', { n: paths.length }) : T('آهنگ از برنامه حذف شد (فایل روی دیسک می‌مونه)'));
}
function queueMany(idxs, mode) {
  if (st.cur < 0 || !st.order.length) { Z.playFrom(idxs[0], idxs); return; }
  (mode === 'next' ? idxs.slice().reverse() : idxs).forEach(i => Z.queueInsert(i, mode, true));
  toast(mode === 'next' ? T('بعد از آهنگ فعلی پخش می‌شه') : T('به انتهای صف اضافه شد'));
  if (queueOpen()) renderQueue();
}
function playlistSub(paths) {
  const items = playlists.map(p => ({
    label: `${p.name}  (${p.paths.length})`,
    act: () => { const n = addToPlaylist(p.id, paths); toast(n ? T('{n} آهنگ به «{name}» اضافه شد', { n, name: p.name }) : T('همه از قبل توی این پلی‌لیست بودن')); },
  }));
  if (items.length) items.push({ sep: true });
  items.push({ label: T('+ پلی‌لیست جدید…'), act: () => { newPlaylistDialog(paths); } });
  return items;
}
function trackMenu(idxs, opts = {}) {
  const many = idxs.length > 1, paths = idxs.map(i => st.lib[i].path), i0 = idxs[0], t = st.lib[i0];
  const items = [
    { label: many ? T('پخش انتخاب‌شده‌ها ({n})', { n: idxs.length }) : T('پخش'), act: () => Z.playFrom(i0, many ? idxs : (opts.base && opts.base.length ? opts.base : [i0])) },
    { label: T('پخش بعدی'), act: () => queueMany(idxs, 'next') },
    { label: T('افزودن به صف'), act: () => queueMany(idxs, 'end') },
    { sep: true },
    { label: T('افزودن به پلی‌لیست'), sub: playlistSub(paths) },
  ];
  if (opts.playlistId) {
    items.push({ label: many ? T('حذف از این پلی‌لیست ({n})', { n: idxs.length }) : T('حذف از این پلی‌لیست'), act: () => { clearSel(true); removeFromPlaylist(opts.playlistId, paths); } });
    if (!many) {
      items.push({ label: T('انتقال به بالا'), act: () => movePl(opts.playlistId, t.path, -1) });
      items.push({ label: T('انتقال به پایین'), act: () => movePl(opts.playlistId, t.path, 1) });
    }
  }
  items.push({ sep: true });
  if (!many) {
    items.push({ label: T('باز کردن محل فایل'), act: () => reveal(t.path) });
    items.push({ label: T('کپی مسیر فایل'), act: async () => toast((await copyText(t.path)) ? T('مسیر کپی شد') : T('کپی ممکن نشد')) });
    items.push({ sep: true });
    items.push({ label: T('اطلاعات آهنگ'), act: () => openInfo(i0) });
    items.push({ label: T('ویرایش نام و تگ‌ها…'), act: () => openEdit(i0) });
    items.push({ sep: true });
  }
  items.push({ label: many ? T('حذف از برنامه ({n})', { n: idxs.length }) : T('حذف از برنامه'), danger: true, act: () => removeTracks(paths) });
  return items;
}
function plMenu(id) {
  const p = plById(id); if (!p) return [];
  const { idx, missing } = plIdx(id);
  const items = [
    { label: T('پخش'), act: () => playPlaylist(id, false), disabled: !idx.length },
    { label: T('پخش تصادفی'), act: () => playPlaylist(id, true), disabled: !idx.length },
    { label: T('باز کردن در کتابخانه'), act: () => openPlaylistInLib(id) },
    { sep: true },
    { label: T('تغییر نام…'), act: () => renamePlaylistDialog(id) },
    { label: T('تغییر عکس…'), act: () => setPlaylistImage(id) },
    ...(p.cover ? [{ label: T('حذف عکس'), act: () => clearPlaylistImage(id) }] : []),
    { label: T('ساخت کپی'), act: () => { createPlaylist(T('{name} (کپی)', { name: p.name }), p.paths); } },
  ];
  if (missing) items.push({ label: T('پاک‌کردن موارد در دسترس‌نبوده ({n})', { n: missing }), act: () => pruneMissing(id) });
  items.push({ sep: true }, { label: T('حذف پلی‌لیست'), danger: true, act: () => deletePlaylistDialog(id) });
  return items;
}

/* ═════════════════════════ left panel: playlists tab, folders menu, restore ═════════════════════════ */
function renderPlPane() {
  let html = '';
  playlists.forEach(p => {
    const { idx, missing } = plIdx(p.id), on_ = st.plFilter && st.plFilter.id === p.id;
    html += `<div class="folder-item${on_ ? ' on' : ''}" data-pl="${p.id}"><div class="fi${p.cover ? ' img' : ''}"${p.cover ? ` style="background-image:url('${p.cover}')"` : ''}>${p.cover ? '' : '&equiv;'}</div><div class="fm"><div class="fn" data-no-i18n>${esc(p.name)}</div><div class="fp">${fmtLong(totalDur(idx))}${missing ? ' · ' + esc(T('{n} در دسترس نیست', { n: missing })) : ''}</div></div><div class="fc">${esc(Z.nTracks(idx.length))}</div></div>`;
  });
  $('#plList').innerHTML = html;
  $('#plHint').hidden = playlists.length > 0;
  $('#cntPl').textContent = playlists.length || '';
}
function updateRestore() {
  const n = Z.excluded.size, b = $('#btnRestore');
  b.hidden = !n;
  if (n) b.textContent = T('بازگرداندن آهنگ‌های حذف‌شده ({n})', { n });
}
on($('#btnNewPl'), 'click', () => newPlaylistDialog());
on($('#plList'), 'click', e => {
  const it = e.target.closest('[data-pl]'); if (!it) return;
  const p = plById(it.dataset.pl); if (!p) return;
  if (st.plFilter && st.plFilter.id === p.id) st.plFilter = null; else { st.plFilter = { id: p.id, name: p.name }; st.folderFilter = null; }
  Z.renderList(); Z.renderFolders(); renderPlPane();
  if (st.plFilter) $$('.lib-tabs button')[0].click();
});
on($('#plList'), 'contextmenu', e => {
  const it = e.target.closest('[data-pl]'); if (!it) return;
  e.preventDefault(); showMenu(e.clientX, e.clientY, plMenu(it.dataset.pl));
});
on($('#list'), 'contextmenu', e => {
  const r = e.target.closest('.row'); if (!r) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, trackMenu([+r.dataset.i], { base: Z.getVisible(), playlistId: st.plFilter && st.plFilter.id }));
});
on($('.now'), 'contextmenu', e => {
  if (st.cur < 0) return;
  e.preventDefault(); showMenu(e.clientX, e.clientY, trackMenu([st.cur], { base: st.order }));
});
on($('#folderList'), 'contextmenu', e => {
  const it = e.target.closest('[data-folder]'); if (!it) return;
  e.preventDefault();
  const k = +it.dataset.folder, f = Z.folders[k]; if (f == null) return;
  showMenu(e.clientX, e.clientY, [
    { label: T('نمایش آهنگ‌های این پوشه'), act: () => it.click() },
    { label: T('باز کردن پوشه در اکسپلورر'), act: () => reveal(f) },
    { label: T('اسکن دوبارهٔ همه'), act: async () => { await Z.rescan(); toast(T('{n} آهنگ در کتابخانه است', { n: st.lib.length })); } },
    { sep: true },
    { label: T('حذف پوشه از برنامه'), danger: true, act: async () => { Z.folders.splice(k, 1); store.set('folders', Z.folders); if (st.folderFilter === f) st.folderFilter = null; await Z.rescan(); } },
  ]);
});
on($('#btnRestore'), 'click', async () => { const n = Z.excluded.size; await Z.restoreExcluded(); toast(T('{n} آهنگ برگردونده شد', { n })); });

/* ═════════════════════════ library sheet ═════════════════════════ */
const CH = 240;                                             // items rendered per chunk
const libOpen = () => $('#libSheet').classList.contains('open');
const updateLibCounts = () => { $('#lvCntT').textContent = st.lib.length || ''; $('#lvCntP').textContent = playlists.length || ''; };
function renderLibIfOpen() { if (libOpen()) renderLib(); }

function lvVisible() {
  const q = lv.q.trim().toLowerCase();
  let idx = st.lib.map((_, i) => i);
  if (q) idx = idx.filter(i => { const t = st.lib[i]; return (t.title + ' ' + t.artist + ' ' + t.album + ' ' + baseName(t.path)).toLowerCase().includes(q); });
  return Z.sortIdx(idx, lv.sort);
}
const initial = t => ([...(t.title || '?')][0] || '?').toUpperCase();
function cardHTML(i) {
  const t = st.lib[i], s = sel.has(t.path);
  return `<div class="lc${i === st.cur ? ' on' : ''}${s ? ' sel' : ''}" data-i="${i}"><div class="lc-cover"><div class="lz" data-i="${i}"></div><b class="lc-ph">${esc(initial(t))}</b><span class="lc-ck" data-ck>${s ? '[x]' : '[ ]'}</span><span class="lc-pl">&gt;</span></div><div class="lc-t">${esc(t.title)}</div><div class="lc-a">${esc(t.artist || baseName(t.path))}</div></div>`;
}
function rowHTML(i, n) {
  const t = st.lib[i], s = sel.has(t.path);
  return `<div class="lr${i === st.cur ? ' on' : ''}${s ? ' sel' : ''}" data-i="${i}"><span class="lr-ck" data-ck>${s ? '[x]' : '[ ]'}</span><span class="lr-n">${String(n + 1).padStart(3, '0')}</span><div class="lr-c"><div class="lz" data-i="${i}"></div><b class="lc-ph">${esc(initial(t))}</b></div><div class="lr-m"><div class="lr-t">${esc(t.title)}</div><div class="lr-a">${esc(t.artist || baseName(t.path))}</div></div><div class="lr-al">${esc(t.album)}</div><div class="lr-d">${t.duration ? fmt(t.duration) : ''}</div></div>`;
}
function plCardHTML(p) {
  const { idx, missing } = plIdx(p.id), cov = idx.slice(0, 4);
  if (p.cover) return `<div class="lc pc" data-pl="${p.id}"><div class="lc-cover"><div class="lz has" style="background-image:url('${p.cover}')"></div></div><div class="lc-t">${esc(p.name)}</div><div class="lc-a">${esc(Z.nTracks(idx.length))} • ${fmtLong(totalDur(idx))}${missing ? ' • ' + esc(T('{n} در دسترس نیست', { n: missing })) : ''}</div></div>`;
  const mosaic = cov.length >= 4 ? cov.map(i => `<div class="lz" data-i="${i}"></div>`).join('') : cov.length ? `<div class="lz one" data-i="${cov[0]}"></div>` : '<b class="lc-ph">&equiv;</b>';
  return `<div class="lc pc" data-pl="${p.id}"><div class="lc-cover mosaic${cov.length >= 4 ? ' four' : ''}">${mosaic}</div><div class="lc-t">${esc(p.name)}</div><div class="lc-a">${esc(Z.nTracks(idx.length))} • ${fmtLong(totalDur(idx))}${missing ? ' • ' + esc(T('{n} در دسترس نیست', { n: missing })) : ''}</div></div>`;
}

function setCtx(sc, list, mode, opts) {
  if (lv.cur && lv.cur.io) lv.cur.io.disconnect();
  const c = { sc, list, mode, opts: opts || {}, shown: 0, io: null };
  c.io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target; c.io.unobserve(el);
      const t = st.lib[+el.dataset.i]; if (!t) return;
      requestThumb(t, url => { if (!el.isConnected) return; if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has'); } else el.classList.add('none'); });
    });
  }, { root: sc, rootMargin: '400px' });
  lv.cur = c;
  sc.innerHTML = ''; sc.scrollTop = 0;
  sc.classList.toggle('selecting', sel.size > 0);
  return c;
}
function observeNew(c) { $$('.lz:not([data-o])', c.sc).forEach(el => { el.setAttribute('data-o', ''); c.io.observe(el); }); }
function appendChunk() {
  const c = lv.cur; if (!c || c.shown >= c.list.length) return;
  const to = Math.min(c.list.length, c.shown + CH);
  let html = '';
  for (let n = c.shown; n < to; n++) html += c.mode === 'grid' ? cardHTML(c.list[n]) : rowHTML(c.list[n], n);
  c.shown = to;
  c.sc.insertAdjacentHTML('beforeend', html);
  observeNew(c);
}
function emptyMsg(sc, text) { sc.innerHTML = `<div class="lv-empty">${esc(text)}</div>`; }

function renderTracksView() {
  lv.list = lvVisible();
  const sc = $('#lvScroll');
  sc.className = 'lv-scroll ' + (lv.view === 'grid' ? 'grid' : 'list');
  $('#lvInfo').textContent = `${lv.q ? lv.list.length + ' / ' : ''}${Z.nTracks(lv.q ? st.lib.length : lv.list.length)} • ${fmtLong(totalDur(lv.list))}`;
  $$('#lvViewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === lv.view));
  $('#lvSort').value = lv.sort;
  const c = setCtx(sc, lv.list, lv.view, {});
  if (!lv.list.length) { emptyMsg(sc, st.lib.length ? T('نتیجه‌ای پیدا نشد.') : T('کتابخانه خالیه. از تب «پوشه‌ها» یه پوشه اضافه کن.')); return; }
  appendChunk(c);
}
function renderPlaylistsView() {
  const sc = $('#lvPlScroll');
  $('#lvPlInfo').textContent = T('{n} پلی‌لیست', { n: playlists.length });
  const c = setCtx(sc, [], 'pl', {});
  if (!playlists.length) { emptyMsg(sc, T('هنوز پلی‌لیستی نساختی.')); return; }
  sc.innerHTML = playlists.map(plCardHTML).join('');
  observeNew(c);
}
function renderDetail() {
  const p = plById(lv.detail.id);
  if (!p) { lv.detail = null; renderLib(); return; }
  const { idx, missing } = plIdx(p.id);
  $('#lvDName').textContent = p.name;
  $('#lvDMeta').textContent = `${Z.nTracks(idx.length)} • ${fmtLong(totalDur(idx))}${missing ? ' • ' + T('{n} در دسترس نیست', { n: missing }) : ''}`;
  const sc = $('#lvDScroll'); sc.className = 'lv-scroll list';
  const c = setCtx(sc, idx, 'list', { playlistId: p.id });
  if (!idx.length) { emptyMsg(sc, T('این پلی‌لیست خالیه. از بخش «آهنگ‌ها» چند آهنگ رو انتخاب کن و «افزودن به پلی‌لیست» رو بزن.')); return; }
  appendChunk(c);
}
function renderLib() {
  const showTracks = lv.tab === 'tracks' && !lv.detail, showPl = lv.tab === 'playlists' && !lv.detail;
  $('#lvTracks').hidden = !showTracks; $('#lvPlaylists').hidden = !showPl; $('#lvDetail').hidden = !lv.detail;
  $$('#lvTabs button').forEach(b => b.classList.toggle('on', b.dataset.lt === lv.tab));
  updateLibCounts();
  [...sel].forEach(p => { if (!st.idx.has(p)) sel.delete(p); });
  if (lv.detail) renderDetail(); else if (showTracks) renderTracksView(); else renderPlaylistsView();
  updateSelBar();
}
function openPlaylistInLib(id) {
  lv.tab = 'playlists'; lv.detail = { id };
  if (libOpen()) renderLib(); else Z.openSheet('lib');
}

/* selection */
const curList = () => (lv.cur ? lv.cur.list : []);
function refreshSelUI() {
  const c = lv.cur; if (!c) return;
  c.sc.classList.toggle('selecting', sel.size > 0);
  $$('.lc[data-i], .lr[data-i]', c.sc).forEach(el => {
    const t = st.lib[+el.dataset.i]; if (!t) return;
    const s = sel.has(t.path);
    el.classList.toggle('sel', s);
    const ck = $('[data-ck]', el); if (ck) ck.textContent = s ? '[x]' : '[ ]';
  });
  updateSelBar();
}
function updateSelBar() {
  const n = sel.size, bar = $('#lvSelBar');
  bar.hidden = n === 0;
  $('#lvSelN').textContent = T('{n} انتخاب شد', { n });
  $('#lvSelRmPl').hidden = !(lv.detail && lv.cur && lv.cur.opts.playlistId);
}
function clearSel(silent) { sel.clear(); lastSel = null; if (!silent) refreshSelUI(); else { const c = lv.cur; if (c) c.sc.classList.remove('selecting'); updateSelBar(); } }
function toggleSel(path) { if (sel.has(path)) sel.delete(path); else sel.add(path); lastSel = path; refreshSelUI(); }
function rangeSel(list, path) {
  const a = list.findIndex(i => st.lib[i].path === lastSel), b = list.findIndex(i => st.lib[i].path === path);
  if (a < 0 || b < 0) { toggleSel(path); return; }
  for (let k = Math.min(a, b); k <= Math.max(a, b); k++) sel.add(st.lib[list[k]].path);
  lastSel = path; refreshSelUI();
}
function selectAll() { curList().forEach(i => sel.add(st.lib[i].path)); refreshSelUI(); }
const selIdxs = () => [...sel].map(p => st.idx.get(p)).filter(i => i != null);

function bindScroll(sc) {
  on(sc, 'click', e => {
    const it = e.target.closest('.lc[data-i], .lr[data-i]'); if (!it) return;
    const i = +it.dataset.i, t = st.lib[i]; if (!t) return;
    if (e.target.closest('[data-ck]') || e.ctrlKey || e.metaKey) { toggleSel(t.path); return; }
    if (e.shiftKey && lastSel) { rangeSel(curList(), t.path); return; }
    if (sel.size) { toggleSel(t.path); return; }
    Z.playFrom(i, curList());
  });
  on(sc, 'contextmenu', e => {
    const it = e.target.closest('.lc[data-i], .lr[data-i]'); if (!it) return;
    e.preventDefault();
    const i = +it.dataset.i, t = st.lib[i]; if (!t) return;
    let idxs;
    if (sel.has(t.path) && sel.size > 1) idxs = selIdxs(); else { if (sel.size) clearSel(); idxs = [i]; }
    showMenu(e.clientX, e.clientY, trackMenu(idxs, { base: curList(), playlistId: lv.cur && lv.cur.opts.playlistId }));
  });
  on(sc, 'scroll', () => { if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 700) appendChunk(); });
}
bindScroll($('#lvScroll')); bindScroll($('#lvDScroll'));
on($('#lvPlScroll'), 'click', e => {
  const it = e.target.closest('[data-pl]'); if (!it) return;
  lv.detail = { id: it.dataset.pl }; clearSel(true); renderLib();
});
on($('#lvPlScroll'), 'contextmenu', e => {
  const it = e.target.closest('[data-pl]'); if (!it) return;
  e.preventDefault(); showMenu(e.clientX, e.clientY, plMenu(it.dataset.pl));
});
on($('#lvScroll'), 'scroll', () => {});

on($('#lvTabs'), 'click', e => {
  const b = e.target.closest('button[data-lt]'); if (!b) return;
  lv.tab = b.dataset.lt; lv.detail = null; clearSel(true); renderLib();
});
let lvQT = 0;
on($('#lvSearch'), 'input', e => { clearTimeout(lvQT); lvQT = setTimeout(() => { lv.q = e.target.value; renderTracksView(); updateSelBar(); }, 150); });
on($('#lvSort'), 'change', e => { lv.sort = e.target.value; store.set('lvSort', lv.sort); renderTracksView(); });
on($('#lvViewSeg'), 'click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; lv.view = b.dataset.v; store.set('lvView', lv.view); renderTracksView(); });
on($('#lvNewPl'), 'click', () => newPlaylistDialog());
on($('#lvBack'), 'click', () => { lv.detail = null; clearSel(true); renderLib(); });
on($('#lvDPlay'), 'click', () => lv.detail && playPlaylist(lv.detail.id, false));
on($('#lvDShuf'), 'click', () => lv.detail && playPlaylist(lv.detail.id, true));
on($('#lvDImg'), 'click', () => lv.detail && setPlaylistImage(lv.detail.id));
on($('#lvDRen'), 'click', () => lv.detail && renamePlaylistDialog(lv.detail.id));
on($('#lvDDel'), 'click', () => lv.detail && deletePlaylistDialog(lv.detail.id));
on($('#lvSelPlay'), 'click', () => { const idxs = selIdxs(); if (idxs.length) Z.playFrom(idxs[0], idxs); });
on($('#lvSelAdd'), 'click', e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, playlistSub([...sel])); });
on($('#lvSelRmPl'), 'click', () => { if (lv.detail) { const paths = [...sel]; clearSel(true); removeFromPlaylist(lv.detail.id, paths); } });
on($('#lvSelDel'), 'click', () => removeTracks([...sel]));
on($('#lvSelClear'), 'click', () => clearSel());

/* ═════════════════════════ play queue ═════════════════════════ */
const QMAX = 300;                                           // upcoming items rendered
const queueOpen = () => $('#queueSheet').classList.contains('open');
let qDrag = null;
function curPos() { return st.cur >= 0 ? st.order.indexOf(st.cur) : -1; }
function qRow(k, kind) {
  const i = st.order[k], t = st.lib[i]; if (!t) return '';
  const cur = kind === 'cur';
  return `<div class="qr ${kind}" data-k="${k}"${cur ? '' : ' draggable="true"'}><span class="qr-n">${cur ? '&gt;' : String(k + 1).padStart(3, '0')}</span><div class="qr-m"><div class="qr-t">${esc(t.title)}</div><div class="qr-a">${esc(t.artist || baseName(t.path))}</div></div><span class="qr-d">${t.duration ? fmt(t.duration) : ''}</span>${cur ? '' : `<span class="qr-b"><button data-qa="up" title="${esc(T('انتقال به بالا'))}">&#9650;</button><button data-qa="down" title="${esc(T('انتقال به پایین'))}">&#9660;</button><button data-qa="rm" title="${esc(T('حذف'))}">&times;</button></span>`}</div>`;
}
function renderQueue() {
  const box = $('#qList'), pos = curPos(), n = st.order.length;
  if (!n || pos < 0) {
    box.innerHTML = `<div class="lv-empty">${esc(T('صف خالیه. یه آهنگ پخش کن یا با راست‌کلیک «افزودن به صف» رو بزن.'))}</div>`;
    $('#qCount').textContent = ''; $('#qClear').disabled = $('#qShuffle').disabled = true; return;
  }
  const up = n - pos - 1;
  $('#qCount').textContent = up ? T('{n} آهنگ بعدی', { n: Z.fa(up) }) : '';
  $('#qClear').disabled = $('#qShuffle').disabled = !up;
  let html = '';
  const h0 = Math.max(0, pos - 3);
  if (h0 > 0) html += `<div class="q-sep">${esc(T('{n} آهنگ قبلی…', { n: Z.fa(h0) }))}</div>`;
  for (let k = h0; k < pos; k++) html += qRow(k, 'past');
  html += qRow(pos, 'cur');
  const end = Math.min(n, pos + 1 + QMAX);
  for (let k = pos + 1; k < end; k++) html += qRow(k, 'next');
  if (end < n) html += `<div class="q-sep">${esc(T('+ {n} آهنگ دیگه…', { n: Z.fa(n - end) }))}</div>`;
  const y = box.scrollTop; box.innerHTML = html; box.scrollTop = y;
  if (!y) { const c = $('.qr.cur', box); if (c) c.scrollIntoView({ block: 'center' }); }
}
function qMove(from, to) {
  if (from === to || to < 0 || to >= st.order.length) return;
  const cur = st.cur, [x] = st.order.splice(from, 1);
  st.order.splice(to, 0, x);
  st.pos = cur >= 0 ? st.order.indexOf(cur) : -1;
  renderQueue();
}
on($('#qList'), 'click', e => {
  const row = e.target.closest('.qr'); if (!row) return;
  const k = +row.dataset.k, b = e.target.closest('[data-qa]');
  if (b) {
    e.stopPropagation();
    if (b.dataset.qa === 'rm') { const cur = st.cur; st.order.splice(k, 1); st.pos = st.order.indexOf(cur); renderQueue(); }
    else qMove(k, k + (b.dataset.qa === 'up' ? -1 : 1));
    return;
  }
  if (row.classList.contains('cur')) { Z.togglePlay(); return; }
  Z.playIndex(st.order[k]);
});
on($('#qList'), 'contextmenu', e => {
  const row = e.target.closest('.qr'); if (!row) return;
  e.preventDefault();
  const k = +row.dataset.k, i = st.order[k], cur = row.classList.contains('cur');
  const items = [{ label: T('پخش'), act: () => Z.playIndex(i) }];
  if (!cur) {
    items.push({ label: T('پخش بعدی'), act: () => { const c = st.cur; const [x] = st.order.splice(k, 1); st.pos = st.order.indexOf(c); st.order.splice(st.pos + 1, 0, x); renderQueue(); } });
    items.push({ label: T('حذف از صف'), act: () => { const c = st.cur; st.order.splice(k, 1); st.pos = st.order.indexOf(c); renderQueue(); } });
    items.push({ sep: true });
  }
  items.push({ label: T('افزودن به پلی‌لیست'), sub: playlistSub([st.lib[i].path]) });
  items.push({ label: T('باز کردن محل فایل'), act: () => reveal(st.lib[i].path) });
  items.push({ label: T('اطلاعات آهنگ'), act: () => openInfo(i) });
  showMenu(e.clientX, e.clientY, items);
});
on($('#qList'), 'dragstart', e => {
  const row = e.target.closest('.qr[draggable]'); if (!row) return;
  qDrag = +row.dataset.k; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(qDrag));
});
on($('#qList'), 'dragover', e => {
  if (qDrag == null) return;
  const row = e.target.closest('.qr'); if (!row) return;
  e.preventDefault(); $$('.qr.over', $('#qList')).forEach(r => r.classList.remove('over')); if (!row.classList.contains('cur') || +row.dataset.k > qDrag) row.classList.add('over');
});
on($('#qList'), 'drop', e => {
  if (qDrag == null) return;
  const row = e.target.closest('.qr'); e.preventDefault();
  const from = qDrag; qDrag = null;
  if (row) { let to = +row.dataset.k; const p = curPos(); if (to <= p) to = p + 1; qMove(from, to); } else renderQueue();
});
on($('#qList'), 'dragend', () => { qDrag = null; $$('.qr.drag, .qr.over', $('#qList')).forEach(r => r.classList.remove('drag', 'over')); });
on($('#qClear'), 'click', () => { const p = curPos(); if (p >= 0) { st.order.length = p + 1; renderQueue(); } });
on($('#qShuffle'), 'click', () => {
  const p = curPos(); if (p < 0) return;
  const tail = st.order.splice(p + 1);
  for (let i = tail.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tail[i], tail[j]] = [tail[j], tail[i]]; }
  st.order.push(...tail); renderQueue();
});

/* ═════════════════════════ global wiring ═════════════════════════ */
on(window, 'keydown', e => {
  if (e.key === 'Escape') {
    if (ctxOpen) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return; }
    if (modalState) { e.preventDefault(); e.stopImmediatePropagation(); if (modalState.dismiss) closeModal(null); return; }
    if (libOpen() && sel.size) { e.preventDefault(); e.stopImmediatePropagation(); clearSel(); return; }
  }
  if (modalState && e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
    e.preventDefault(); const pb = dlgFoot.querySelector('.primary, .danger'); if (pb) pb.click(); return;
  }
  if (libOpen() && !modalState && !ctxOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/^(input|textarea|select)$/i.test((e.target.tagName || ''))) {
    e.preventDefault(); selectAll();
  }
}, true);

on(document, 'zp:lib', () => { renderPlPane(); updateRestore(); renderLibIfOpen(); if (queueOpen()) renderQueue(); });
on(document, 'zp:filter', renderPlPane);
on(document, 'zp:sheet', e => { const n = e.detail && e.detail.name; if (n === 'lib') { clearSel(true); renderLib(); } else if (n === 'queue') renderQueue(); });
on(document, 'zp:track', () => {
  if (queueOpen()) renderQueue();
  if (!libOpen()) return;
  $$('#libSheet .lc.on, #libSheet .lr.on').forEach(el => el.classList.remove('on'));
  if (st.cur >= 0) $$(`#libSheet .lc[data-i="${st.cur}"], #libSheet .lr[data-i="${st.cur}"]`).forEach(el => el.classList.add('on'));
});
on(document, 'zp:lang', () => { if (queueOpen()) renderQueue(); renderPlPane(); updateRestore(); updateSelBar(); renderLibIfOpen(); });

renderPlPane(); updateRestore(); updateLibCounts();
})();
