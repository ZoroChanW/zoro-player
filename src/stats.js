/* Zoro Player — listening stats, favorites, ratings and the smart-playlist rule engine.
   Loaded after app.js and before features.js; exposes window.ZP.stats / window.ZP.smart.
   Per-track data lives in localStorage `zp.stats`: { [path]: { p: plays, l: lastPlayedMs, f: 1, r: 0-5 } } */
(() => {
'use strict';
const Z = window.ZP;
const { st, store, $ } = Z;
const T = window.T;
const DAY = 864e5;

let data = store.get('stats', {});
if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
let saveT = 0;
const flush = () => { clearTimeout(saveT); store.set('stats', data); };
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 500); };
window.addEventListener('beforeunload', flush);
let evT = 0;
const changed = () => { clearTimeout(evT); evT = setTimeout(() => document.dispatchEvent(new CustomEvent('zp:stats')), 60); };
const rec = p => data[p] || (data[p] = {});
const EMPTY = Object.freeze({});
const get = p => data[p] || EMPTY;

const stats = {
  get,
  plays: p => get(p).p || 0,
  last: p => get(p).l || 0,
  fav: p => !!get(p).f,
  rating: p => get(p).r || 0,
  toggleFav(paths) {
    const all = paths.every(p => get(p).f), v = all ? 0 : 1;
    paths.forEach(p => { const r = rec(p); if (v) r.f = 1; else delete r.f; });
    save(); changed(); return !!v;
  },
  setRating(paths, n) {
    n = Math.max(0, Math.min(5, n | 0));
    paths.forEach(p => { const r = rec(p); if (n) r.r = n; else delete r.r; });
    save(); changed();
  },
  moveKey(from, to) { if (data[from] && from !== to) { data[to] = data[from]; delete data[from]; save(); } },
  value(i, key) {
    const t = st.lib[i]; if (!t) return 0;
    const s = get(t.path);
    switch (key) {
      case 'plays': return s.p || 0;
      case 'last': return s.l || 0;
      case 'added': return t.added || 0;
      case 'rating': return s.r || 0;
      case 'year': return t.year || 0;
      case 'fav': return s.f ? 1 : 0;
      default: return 0;
    }
  },
  sortKeys: ['plays', 'last', 'added', 'rating', 'year'],
  overview() {
    let plays = 0, secs = 0, played = 0, favs = 0, rated = 0;
    const artists = new Map(), tracks = [];
    st.lib.forEach((t, i) => {
      const s = get(t.path);
      if (s.f) favs++;
      if (s.r) rated++;
      if (s.p) {
        plays += s.p; secs += s.p * (t.duration || 0); played++;
        tracks.push({ i, n: s.p });
        const a = t.artist || '';
        if (a) artists.set(a, (artists.get(a) || 0) + s.p);
      }
    });
    tracks.sort((a, b) => b.n - a.n);
    const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { plays, secs, played, favs, rated, total: st.lib.length, topTracks: tracks.slice(0, 10), topArtists };
  },
  reset() { data = {}; flush(); changed(); },
};

/* ───────── counting plays: 30 s (or half of a short track) of real listening ───────── */
let cnt = { path: null, sec: 0, done: false };
document.addEventListener('zp:track', () => {
  const t = st.lib[st.cur], p = t ? t.path : null;
  if (p !== cnt.path) cnt = { path: p, sec: 0, done: false };
});
setInterval(() => {
  const a = Z.audio;
  if (!cnt.path || !a || a.paused) return;
  if (cnt.done) { if (a.currentTime < 2) cnt = { path: cnt.path, sec: 0, done: false }; return; }   // looped / restarted
  cnt.sec += 1;
  const t = st.lib[st.cur], dur = (t && t.duration) || a.duration || 0;
  if (cnt.sec >= Math.min(30, dur ? dur * 0.5 : 30)) {
    cnt.done = true;
    const r = rec(cnt.path); r.p = (r.p || 0) + 1; r.l = Date.now();
    save(); changed();
  }
}, 1000);

/* ───────── smart-playlist rules ───────── */
const FIELDS = {
  title: 'text', artist: 'text', album: 'text', genre: 'text', path: 'text',
  year: 'num', rating: 'num', plays: 'num', minutes: 'num', addedDays: 'num', playedDays: 'num', fav: 'bool',
};
const FIELD_LABEL = {
  title: 'عنوان', artist: 'هنرمند', album: 'آلبوم', genre: 'ژانر', path: 'مسیر فایل',
  year: 'سال انتشار', rating: 'امتیاز (۰ تا ۵)', plays: 'تعداد پخش', minutes: 'مدت (دقیقه)',
  addedDays: 'چند روز پیش اضافه شده', playedDays: 'چند روز پیش پخش شده', fav: 'علاقه‌مندی',
};
const OPS = {
  text: [['has', 'شامل'], ['!has', 'شامل نیست'], ['is', 'دقیقاً برابر']],
  num: [['>=', 'حداقل'], ['<=', 'حداکثر'], ['=', 'دقیقاً']],
  bool: [['is', 'هست']],
};
const SORTS = [
  ['title', 'عنوان'], ['artist', 'هنرمند'], ['plays', 'تعداد پخش'], ['last', 'آخرین پخش'],
  ['added', 'تاریخ اضافه‌شدن'], ['rating', 'امتیاز'], ['year', 'سال انتشار'], ['random', 'تصادفی'],
];
const norm = s => String(s || '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[ً-ٟـ]/g, '');
const digits = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

function fieldValue(i, f, now) {
  const t = st.lib[i], s = get(t.path);
  switch (f) {
    case 'title': return t.title; case 'artist': return t.artist; case 'album': return t.album;
    case 'genre': return t.genre || ''; case 'path': return t.path;
    case 'year': return t.year || 0;
    case 'rating': return s.r || 0;
    case 'plays': return s.p || 0;
    case 'minutes': return (t.duration || 0) / 60;
    case 'addedDays': return t.added ? (now - t.added) / DAY : 99999;
    case 'playedDays': return s.l ? (now - s.l) / DAY : 99999;          // never played = very long ago
    case 'fav': return s.f ? 1 : 0;
    default: return 0;
  }
}
function test(i, c, now) {
  const kind = FIELDS[c.f]; if (!kind) return true;
  const v = fieldValue(i, c.f, now);
  if (kind === 'text') {
    const a = norm(v), b = norm(digits(c.v));
    if (!b) return true;
    return c.op === 'is' ? a === b : c.op === '!has' ? !a.includes(b) : a.includes(b);
  }
  if (kind === 'bool') return (v ? 1 : 0) === (+c.v ? 1 : 0);
  const n = parseFloat(digits(c.v)); if (!isFinite(n)) return true;
  if (c.f === 'year' && !v) return false;                                // unknown year never matches
  return c.op === '<=' ? v <= n : c.op === '=' ? Math.round(v * 100) / 100 === n : v >= n;
}
function evaluate(def) {
  const now = Date.now(), conds = (def && def.conds) || [];
  let idx = [];
  for (let i = 0; i < st.lib.length; i++) {
    const ok = !conds.length || (def.match === 'any' ? conds.some(c => test(i, c, now)) : conds.every(c => test(i, c, now)));
    if (ok) idx.push(i);
  }
  const L = st.lib, loc = (a, b) => String(a).localeCompare(String(b), 'fa'), key = def.sort || 'title';
  if (key === 'random') { for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; } }
  else if (stats.sortKeys.includes(key)) idx.sort((a, b) => (stats.value(b, key) - stats.value(a, key)) || loc(L[a].title, L[b].title));
  else idx.sort((a, b) => loc(L[a][key] || '￿', L[b][key] || '￿') || loc(L[a].title, L[b].title));
  const lim = parseInt(def.limit, 10);
  if (lim > 0) idx = idx.slice(0, lim);
  return idx;
}
const SYS = [
  { id: 'sys:fav', name: 'علاقه‌مندی‌ها', icon: '♥', rules: { match: 'all', conds: [{ f: 'fav', op: 'is', v: 1 }], sort: 'last' } },
  { id: 'sys:top', name: 'پرتکرارترین‌ها', icon: '▲', rules: { match: 'all', conds: [{ f: 'plays', op: '>=', v: 1 }], sort: 'plays', limit: 50 } },
  { id: 'sys:recent', name: 'اخیراً پخش‌شده', icon: '◷', rules: { match: 'all', conds: [{ f: 'plays', op: '>=', v: 1 }], sort: 'last', limit: 50 } },
  { id: 'sys:new', name: 'اخیراً اضافه‌شده', icon: '+', rules: { match: 'all', conds: [{ f: 'addedDays', op: '<=', v: 30 }], sort: 'added', limit: 100 } },
  { id: 'sys:best', name: 'امتیاز بالا (۴ و ۵ ستاره)', icon: '★', rules: { match: 'all', conds: [{ f: 'rating', op: '>=', v: 4 }], sort: 'rating' } },
].map(p => Object.assign(p, { sys: true, smart: true }));

Z.stats = stats;
Z.smart = { FIELDS, FIELD_LABEL, OPS, SORTS, SYS, evaluate, test };

/* ───────── now-playing: heart + stars ───────── */
const box = document.createElement('div');
box.id = 'npRate'; box.className = 'np-rate'; box.hidden = true;
box.innerHTML = '<button id="npFav" class="np-fav" title="F">♡</button><span id="npStars" class="np-stars">' +
  [1, 2, 3, 4, 5].map(n => `<button data-r="${n}">☆</button>`).join('') + '</span>';
const anchor = $('#npAlbum');
if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
const curPath = () => (st.cur >= 0 && st.lib[st.cur] ? st.lib[st.cur].path : null);
function paintRate() {
  const p = curPath();
  box.hidden = !p;
  if (!p) return;
  const f = stats.fav(p), r = stats.rating(p);
  const fb = $('#npFav'); fb.textContent = f ? '♥' : '♡'; fb.classList.toggle('on', f);
  box.querySelectorAll('[data-r]').forEach(b => { const on = +b.dataset.r <= r; b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); });
}
box.addEventListener('click', e => {
  const p = curPath(); if (!p) return;
  if (e.target.closest('#npFav')) { stats.toggleFav([p]); return; }
  const b = e.target.closest('[data-r]');
  if (b) { const n = +b.dataset.r; stats.setRating([p], stats.rating(p) === n ? 0 : n); }
});
document.addEventListener('zp:track', paintRate);
document.addEventListener('zp:stats', paintRate);
document.addEventListener('zp:lib', paintRate);
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.body.classList.contains('modal-open') || document.body.classList.contains('menu-open')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const p = curPath(); if (!p) return;
  const k = e.key.toLowerCase();
  if (k === 'f') { stats.toggleFav([p]); Z.toast(stats.fav(p) ? T('به علاقه‌مندی‌ها اضافه شد') : T('از علاقه‌مندی‌ها برداشته شد')); }
  else if (/^[0-5]$/.test(e.key)) stats.setRating([p], +e.key);
});
paintRate();
})();
