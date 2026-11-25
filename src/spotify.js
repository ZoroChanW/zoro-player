/* Zoro Player — Spotify remote (Web API, OAuth PKCE over a loopback redirect).
   Playback happens in the Spotify app / device; this panel shows what's playing, controls it,
   searches and browses the user's own playlists. Loaded after features.js. */
(() => {
'use strict';
const Z = window.ZP;
const { store, toast, esc, fmt, invoke, $, $$ } = Z;
const on = (el, ev, fn, o) => el.addEventListener(ev, fn, o);
const PORT = 43819, REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-read-private';
const AUTH = 'https://accounts.spotify.com', API = 'https://api.spotify.com/v1';

const sp = { id: store.get('spId', ''), tok: store.get('spTok', null), me: null, pb: null, pbAt: 0, devices: [], tab: 'search', q: '', list: null, detail: null, busy: false };
const connected = () => !!(sp.tok && sp.tok.refresh);
const isOpen = () => $('#spSheet').classList.contains('open');
const errMsg = e => String((e && e.message) || e);

/* ───── auth ───── */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function tokenReq(params) {
  const r = await fetch(AUTH + '/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || ('HTTP ' + r.status)); e.status = r.status; e.code = j.error; throw e; }
  sp.tok = { access: j.access_token, refresh: j.refresh_token || (sp.tok && sp.tok.refresh), exp: Date.now() + (j.expires_in || 3600) * 1000 };
  store.set('spTok', sp.tok);
}
async function accessToken() {
  if (!connected()) throw Object.assign(new Error('not connected'), { status: 401 });
  if (Date.now() > sp.tok.exp - 30000) {
    try { await tokenReq({ grant_type: 'refresh_token', refresh_token: sp.tok.refresh, client_id: sp.id }); }
    catch (e) { if (e.code === 'invalid_grant') disconnect(true); throw e; }
  }
  return sp.tok.access;
}
async function connect() {
  const id = $('#spClient').value.trim();
  const msg = $('#spSetupMsg');
  const say = t => { msg.textContent = t; msg.hidden = !t; };
  if (!/^[0-9a-f]{32}$/i.test(id)) { say(T('Client ID باید یه رشتهٔ ۳۲ کاراکتری باشه (از داشبورد Spotify کپی کن).')); return; }
  say(''); sp.id = id; store.set('spId', id);
  const verifier = rand(64), state = rand(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = AUTH + '/authorize?' + new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES });
  const btn = $('#spConnect'); btn.disabled = true; say(T('مرورگر باز شد؛ ورود رو تأیید کن…'));
  try {
    const wait = invoke('oauth_wait', { port: PORT, state });
    wait.catch(() => {});
    await invoke('open_url', { url });
    const code = await wait;
    await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: id, code_verifier: verifier });
    say('');
    await afterConnect();
  } catch (e) {
    say(T('اتصال انجام نشد: {e}', { e: errMsg(e) }));
  } finally { btn.disabled = false; }
}
function disconnect(silent) {
  sp.tok = null; sp.me = null; sp.pb = null; store.set('spTok', null);
  render(); if (!silent) toast(T('اتصال Spotify قطع شد'));
}

/* ───── api ───── */
async function api(method, path, body, retry = true) {
  const tok = await accessToken();
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && retry) { sp.tok.exp = 0; return api(method, path, body, false); }
  if (r.status === 429 && retry) { await new Promise(res => setTimeout(res, Math.min(5, +r.headers.get('Retry-After') || 1) * 1000)); return api(method, path, body, false); }
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status));
    e.status = r.status; e.reason = j && j.error && j.error.reason; throw e;
  }
  return j;
}
function explain(e) {
  if (e.status === 404 || e.reason === 'NO_ACTIVE_DEVICE') return T('دستگاه فعالی پیدا نشد. اپ Spotify رو باز کن (یا یه دستگاه از لیست انتخاب کن).');
  if (e.status === 403) return T('این کار به حساب Premium نیاز داره (یا مجاز نیست).');
  return errMsg(e);
}
const msg = t => { const m = $('#spMsg'); m.textContent = t || ''; m.hidden = !t; };
async function act(fn) {
  try { msg(''); await fn(); }
  catch (e) { msg(explain(e)); if (e.status === 404) loadDevices(); }
}

/* ───── now playing ───── */
const small = imgs => (imgs && imgs.length ? (imgs.find(i => i.width && i.width <= 160) || imgs[imgs.length - 1]).url : '');
const big = imgs => (imgs && imgs.length ? imgs[0].url : '');
const artists = t => (t.artists || []).map(a => a.name).join(', ');
function renderNP() {
  const pb = sp.pb, it = pb && pb.item;
  $('#spTitle').textContent = it ? it.name : T('چیزی در حال پخش نیست');
  $('#spArtist').textContent = it ? artists(it) : '';
  const cv = $('#spCover'), u = it && it.album ? big(it.album.images) : '';
  cv.style.backgroundImage = u ? `url("${u}")` : ''; cv.classList.toggle('has', !!u);
  const playing = !!(pb && pb.is_playing);
  $('#spPlay').textContent = playing ? '||' : '>';
  $('#spShuf').classList.toggle('on', !!(pb && pb.shuffle_state));
  const rep = pb ? pb.repeat_state : 'off';
  $('#spRep').classList.toggle('on', rep !== 'off'); $('#spRep').textContent = rep === 'track' ? 'rep1' : 'rep';
  if (pb && pb.device && pb.device.volume_percent != null && !volDrag) $('#spVol').value = pb.device.volume_percent;
  $('#btnSpotify').classList.toggle('live', playing);
  tickBar();
}
let volDrag = false, seekDrag = false;
function posNow() {
  const pb = sp.pb; if (!pb || !pb.item) return 0;
  return Math.min(pb.item.duration_ms, (pb.progress_ms || 0) + (pb.is_playing ? Date.now() - sp.pbAt : 0));
}
function tickBar() {
  const it = sp.pb && sp.pb.item, dur = it ? it.duration_ms : 0, pos = posNow();
  $('#spT0').textContent = fmt(pos / 1000); $('#spT1').textContent = fmt(dur / 1000);
  if (!seekDrag) $('#spSeek').value = dur ? Math.round(pos / dur * 1000) : 0;
}
async function poll() {
  if (!connected()) return;
  try {
    const pb = await api('GET', '/me/player');
    sp.pb = pb; sp.pbAt = Date.now();
    if (pb && pb.is_playing && !Z.audio.paused) Z.audio.pause();      // only one source at a time
    if (isOpen()) { renderNP(); if (pb && pb.device) syncDevSelect(pb.device); }
    else $('#btnSpotify').classList.toggle('live', !!(pb && pb.is_playing));
  } catch (e) { if (e.status === 401 || e.status === 403) return; }
}
let pollT = 0;
function schedule() {
  clearTimeout(pollT);
  pollT = setTimeout(async () => { await poll(); schedule(); }, isOpen() ? 2500 : (sp.pb && sp.pb.is_playing ? 6000 : 20000));
}
setInterval(() => { if (isOpen() && sp.pb && sp.pb.is_playing) tickBar(); }, 500);

/* ───── devices ───── */
async function loadDevices() {
  try {
    const j = await api('GET', '/me/player/devices');
    sp.devices = (j && j.devices) || [];
    const sel = $('#spDev');
    sel.innerHTML = sp.devices.length ? sp.devices.map(d => `<option value="${esc(d.id)}"${d.is_active ? ' selected' : ''}>${esc(d.name)} · ${esc(d.type)}</option>`).join('') : `<option value="">${esc(T('هیچ دستگاهی پیدا نشد'))}</option>`;
  } catch (e) { msg(explain(e)); }
}
function syncDevSelect(d) { const sel = $('#spDev'); if (d && d.id && [...sel.options].some(o => o.value === d.id)) sel.value = d.id; }
on($('#spDev'), 'change', e => { const id = e.target.value; if (id) act(async () => { await api('PUT', '/me/player', { device_ids: [id], play: !!(sp.pb && sp.pb.is_playing) }); setTimeout(poll, 600); }); });
on($('#spDevR'), 'click', loadDevices);
const devParam = () => { const v = $('#spDev').value; return v ? '&device_id=' + encodeURIComponent(v) : ''; };

/* ───── controls ───── */
function pauseLocal() { if (!Z.audio.paused) Z.audio.pause(); }
on($('#spPlay'), 'click', () => act(async () => {
  const playing = !!(sp.pb && sp.pb.is_playing);
  if (playing) { await api('PUT', '/me/player/pause'); } else { pauseLocal(); await api('PUT', '/me/player/play' + (devParam() ? '?' + devParam().slice(1) : '')); }
  if (sp.pb) { sp.pb.is_playing = !playing; sp.pb.progress_ms = posNow(); sp.pbAt = Date.now(); renderNP(); }
  setTimeout(poll, 700);
}));
on($('#spNext'), 'click', () => act(async () => { pauseLocal(); await api('POST', '/me/player/next'); setTimeout(poll, 700); }));
on($('#spPrev'), 'click', () => act(async () => { pauseLocal(); await api('POST', '/me/player/previous'); setTimeout(poll, 700); }));
on($('#spShuf'), 'click', () => act(async () => { const s = !(sp.pb && sp.pb.shuffle_state); await api('PUT', '/me/player/shuffle?state=' + s); if (sp.pb) sp.pb.shuffle_state = s; renderNP(); }));
on($('#spRep'), 'click', () => act(async () => {
  const cur = sp.pb ? sp.pb.repeat_state : 'off', next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
  await api('PUT', '/me/player/repeat?state=' + next); if (sp.pb) sp.pb.repeat_state = next; renderNP();
}));
on($('#spSeek'), 'input', () => { seekDrag = true; const it = sp.pb && sp.pb.item; if (it) $('#spT0').textContent = fmt($('#spSeek').value / 1000 * it.duration_ms / 1000); });
on($('#spSeek'), 'change', () => act(async () => {
  const it = sp.pb && sp.pb.item; seekDrag = false; if (!it) return;
  const ms = Math.round($('#spSeek').value / 1000 * it.duration_ms);
  await api('PUT', '/me/player/seek?position_ms=' + ms); sp.pb.progress_ms = ms; sp.pbAt = Date.now();
}));
let volT = 0;
on($('#spVol'), 'input', () => { volDrag = true; clearTimeout(volT); volT = setTimeout(() => act(async () => { await api('PUT', '/me/player/volume?volume_percent=' + $('#spVol').value); setTimeout(() => { volDrag = false; }, 1200); }), 200); });

/* local playback starts -> pause Spotify */
on(Z.audio, 'play', () => { if (connected() && sp.pb && sp.pb.is_playing) { api('PUT', '/me/player/pause').then(() => { sp.pb.is_playing = false; renderNP(); }).catch(() => {}); } });

/* ───── search / playlists ───── */
const rowHTML = (t, k) => {
  const im = small(t.album && t.album.images);
  return `<div class="sr" data-k="${k}"><div class="sr-c"${im ? ` style="background-image:url('${esc(im)}')"` : ''}></div><div class="sr-m"><div class="sr-t">${esc(t.name)}</div><div class="sr-a">${esc(artists(t))}${t.album ? ' · ' + esc(t.album.name) : ''}</div></div><span class="sr-d">${fmt((t.duration_ms || 0) / 1000)}</span><span class="sr-b"><button data-sa="queue" title="${esc(T('افزودن به صف'))}">+</button></span></div>`;
};
function plRowHTML(p, k) {
  const im = small(p.images);
  const n = p.items && p.items.total != null ? p.items.total : (p.tracks && p.tracks.total != null ? p.tracks.total : null);
  return `<div class="sr pl" data-k="${k}"><div class="sr-c"${im ? ` style="background-image:url('${esc(im)}')"` : ''}></div><div class="sr-m"><div class="sr-t">${esc(p.name)}</div><div class="sr-a">${n != null ? esc(T('{n} آهنگ', { n })) : ''}</div></div></div>`;
}
function renderList() {
  const box = $('#spList'), L = sp.list;
  $('#spBack').hidden = !sp.detail;
  $('#spQ').hidden = sp.tab !== 'search' || !!sp.detail;
  if (!L) { box.innerHTML = ''; return; }
  if (!L.rows.length) { box.innerHTML = `<div class="lv-empty">${esc(L.empty || '')}</div>`; return; }
  box.innerHTML = L.rows.map((r, k) => (L.kind === 'pl' ? plRowHTML(r, k) : rowHTML(r, k))).join('') + (L.more ? `<button class="tbtn sp-more" id="spMore">${esc(T('بیشتر…'))}</button>` : '');
}
async function doSearch(more) {
  const q = sp.q.trim();
  if (!q) { sp.list = { kind: 'tr', rows: [], empty: T('اسم آهنگ یا هنرمند رو بنویس…') }; renderList(); return; }
  const off = more && sp.list ? sp.list.rows.length : 0;
  try {
    const j = await api('GET', `/search?type=track&limit=10&offset=${off}&q=${encodeURIComponent(q)}`);
    const items = ((j && j.tracks && j.tracks.items) || []).filter(Boolean);
    const rows = (more && sp.list ? sp.list.rows : []).concat(items);
    sp.list = { kind: 'tr', rows, ctx: null, empty: T('نتیجه‌ای پیدا نشد.'), more: items.length === 10 && rows.length < 50 };
    renderList();
  } catch (e) { msg(explain(e)); }
}
async function loadPlaylists() {
  try {
    const j = await api('GET', '/me/playlists?limit=50');
    sp.list = { kind: 'pl', rows: ((j && j.items) || []).filter(Boolean), empty: T('پلی‌لیستی پیدا نشد.') }; renderList();
  } catch (e) { msg(explain(e)); }
}
async function openPlaylist(p) {
  sp.detail = p;
  try {
    const j = await api('GET', `/playlists/${p.id}/items?limit=50`);
    const rows = ((j && j.items) || []).map(x => x && (x.item || x.track)).filter(t => t && t.uri && t.type !== 'episode');
    sp.list = { kind: 'tr', rows, ctx: p.uri, empty: T('این پلی‌لیست آهنگی نداره (یا فقط برای صاحبش قابل‌مشاهده‌ست).') };
  } catch (e) { sp.list = { kind: 'tr', rows: [], empty: explain(e) }; }
  renderList();
}
let qT = 0;
on($('#spQ'), 'input', e => { sp.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => doSearch(false), 400); });
on($('#spTabs'), 'click', e => {
  const b = e.target.closest('button[data-t]'); if (!b) return;
  sp.tab = b.dataset.t; sp.detail = null; sp.list = null;
  $$('#spTabs button').forEach(x => x.classList.toggle('on', x === b));
  if (sp.tab === 'search') doSearch(false); else loadPlaylists();
  renderList();
});
on($('#spBack'), 'click', () => { sp.detail = null; loadPlaylists(); });
on($('#spList'), 'click', e => {
  if (e.target.id === 'spMore') { doSearch(true); return; }
  const row = e.target.closest('.sr'); if (!row || !sp.list) return;
  const it = sp.list.rows[+row.dataset.k]; if (!it) return;
  if (row.classList.contains('pl')) { openPlaylist(it); return; }
  if (e.target.closest('[data-sa=queue]')) { act(async () => { await api('POST', '/me/player/queue?uri=' + encodeURIComponent(it.uri) + devParam()); toast(T('به صف Spotify اضافه شد')); }); return; }
  act(async () => {
    pauseLocal();
    const body = sp.list.ctx ? { context_uri: sp.list.ctx, offset: { uri: it.uri } } : { uris: [it.uri] };
    await api('PUT', '/me/player/play' + (devParam() ? '?' + devParam().slice(1) : ''), body);
    setTimeout(poll, 800);
  });
});

/* ───── view ───── */
function render() {
  const c = connected();
  $('#spSetup').hidden = c; $('#spMain').hidden = !c; $('#spOut').hidden = !c;
  $('#spUser').textContent = c && sp.me ? `${sp.me.display_name || sp.me.id}${sp.me.product ? ' · ' + sp.me.product : ''}` : '';
  if (!c) { $('#spClient').value = sp.id; $('#btnSpotify').classList.remove('live'); return; }
  renderNP(); renderList();
}
async function afterConnect() {
  try { sp.me = await api('GET', '/me'); } catch (e) { sp.me = null; if (e.status === 403) msg(T('این حساب اجازهٔ استفاده از اپ رو نداره؛ صاحب اپ باید Premium داشته باشه و حساب رو به اپ اضافه کرده باشه.')); }
  render(); await Promise.all([poll(), loadDevices()]);
  if (sp.tab === 'search') doSearch(false);
  schedule();
}
on($('#spConnect'), 'click', connect);
on($('#spClient'), 'keydown', e => { if (e.key === 'Enter') connect(); e.stopPropagation(); });
on($('#spQ'), 'keydown', e => e.stopPropagation());
on($('#spOut'), 'click', () => disconnect(false));
on($('#spDash'), 'click', () => invoke('open_url', { url: 'https://developer.spotify.com/dashboard' }).catch(e => toast(errMsg(e))));
on($('#spCopy'), 'click', async () => { try { await navigator.clipboard.writeText(REDIRECT); toast(T('کپی شد')); } catch { toast(REDIRECT); } });
$('#spRedirect').textContent = REDIRECT;
on(document, 'zp:sheet', e => { if (e.detail && e.detail.name === 'spotify') { render(); if (connected()) { poll(); loadDevices(); if (!sp.me) afterConnect(); } schedule(); } });
on(document, 'zp:lang', () => { if (connected()) { renderNP(); renderList(); } });
render();
if (connected()) afterConnect();
})();
