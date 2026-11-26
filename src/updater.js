/* Zoro Player — in-app updates (Tauri updater plugin, signed releases on GitHub).
   Flow: silent check at start-up + every 6 h → badge in the title bar → dialog with release
   notes → download with progress → installer restarts the app. Nothing is ever installed
   without the user pressing the button, and every download is signature-verified in Rust. */
(() => {
'use strict';
const Z = window.ZP;
if (!Z || !Z.invoke || !(window.__TAURI__ && window.__TAURI__.core)) return;
const { $, invoke, listen, store, toast, esc } = Z;
const T = window.T;

const HOURS = 6;
let info = null, busy = false, checking = false;
const skipped = () => store.get('updSkip', '');

const hhmm = () => new Date().toLocaleTimeString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
function setStatus(txt, cls) {
  const el = $('#updStatus'); if (!el) return;
  el.textContent = txt; el.className = 'upd-status' + (cls ? ' ' + cls : '');
}
function friendly(err) {
  const m = String(err && err.message || err || '').toLowerCase();
  if (/signature|verif/.test(m)) return T('امضای فایل به‌روزرسانی معتبر نبود؛ نصب انجام نشد.');
  if (/request|connect|dns|network|timed? ?out|resolve|offline/.test(m)) return T('به اینترنت یا گیت‌هاب وصل نشدم. اتصال رو چک کن و دوباره امتحان کن.');
  if (/404|valid release json|not found|status/.test(m)) return T('هنوز اطلاعات نسخهٔ جدیدی منتشر نشده.');
  return T('بررسی به‌روزرسانی ناموفق بود.');
}
function paint() {
  const b = $('#btnUpdate');
  const show = !!info && skipped() !== info.version;
  if (b) { b.hidden = !show; if (show) { $('#updBadge').textContent = 'v' + info.version; b.title = T('نسخهٔ {v} آماده‌ست', { v: info.version }); } }
  if (info) setStatus(T('نسخهٔ {v} در دسترسه', { v: info.version }), 'new');
}

async function check(manual) {
  if (checking || busy) return;
  checking = true;
  const btn = $('#updCheck'); if (btn) btn.disabled = true;
  setStatus(T('در حال بررسی…'));
  try {
    const r = await invoke('check_update');
    info = r || null;
    if (info) {
      paint();
      if (manual) showDialog();
      else if (skipped() !== info.version && store.get('updToast', '') !== info.version) {
        store.set('updToast', info.version);
        toast(T('نسخهٔ {v} آماده‌ست — دکمهٔ ↑ بالای صفحه', { v: info.version }));
      }
    } else {
      paint();
      setStatus(T('آخرین نسخه رو داری ✓ (بررسی: {t})', { t: hhmm() }), 'ok');
      if (manual) toast(T('برنامه به‌روزه'));
    }
  } catch (e) {
    const msg = friendly(e);
    setStatus(manual ? msg : T('بررسی خودکار انجام نشد (احتمالاً آفلاین)'), 'err');
    if (manual) toast(msg);
  } finally {
    checking = false;
    if (btn) btn.disabled = false;
  }
}

function plainNotes(md) {
  return String(md || '').replace(/\r/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^[-*]\s+/gm, '• ').trim().slice(0, 1500);
}

function showDialog() {
  if (!info || busy) return;
  const v = info.version;
  const wrap = document.createElement('div');
  wrap.className = 'upd-dlg';
  const date = info.date ? new Date(info.date) : null;
  wrap.innerHTML = `<div class="upd-vers" dir="ltr"><span>v${esc(info.current)}</span><i>&rarr;</i><b>v${esc(v)}</b></div>
    ${date && !isNaN(date) ? `<div class="upd-date">${esc(date.toLocaleDateString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-GB'))}</div>` : ''}
    <div class="upd-notes" data-no-i18n></div>
    <p class="hint">${esc(T('پخش فعلی متوقف می‌شه و برنامه بعد از نصب خودش دوباره باز می‌شه. تنظیمات، پلی‌لیست‌ها و آمارت دست‌نخورده می‌مونن.'))}</p>
    <div class="upd-prog" hidden><div class="upd-bar"><i></i></div><div class="upd-pct" dir="ltr"></div></div>`;
  const notes = plainNotes(info.notes);
  const nEl = wrap.querySelector('.upd-notes');
  if (notes) nEl.textContent = notes; else nEl.hidden = true;
  const bar = wrap.querySelector('.upd-bar i'), pct = wrap.querySelector('.upd-pct'), prog = wrap.querySelector('.upd-prog');
  let unl = null;
  const lock = on => { document.querySelectorAll('#dlgFoot button').forEach(b => { b.disabled = on; }); };
  Z.openModal({
    title: T('نسخهٔ جدید Zoro Player'), body: wrap, dismiss: true,
    onClose: () => { if (unl) unl(); },
    buttons: [
      {
        label: T('به‌روزرسانی و راه‌اندازی مجدد'), primary: true, value: '__go',
        act: async () => {
          busy = true; lock(true); prog.hidden = false; bar.style.width = '4%'; pct.textContent = T('در حال دانلود…');
          const un = await listen('zp-update', e => {
            const p = e.payload || {};
            if (p.done) { bar.style.width = '100%'; pct.textContent = T('در حال نصب و راه‌اندازی مجدد…'); return; }
            if (p.pct >= 0) { bar.style.width = Math.max(4, p.pct) + '%'; pct.textContent = p.pct + '%'; }
            else pct.textContent = Math.round((p.got || 0) / 1048576 * 10) / 10 + ' MB';
          });
          unl = un;
          try { await invoke('install_update'); }
          catch (e) {
            busy = false; lock(false); prog.hidden = true;
            toast(friendly(e)); setStatus(friendly(e), 'err');
            return false;
          }
          return false;                                  // app restarts; keep the dialog until then
        },
      },
      { label: T('بعداً'), value: null },
      { label: T('این نسخه رو رد کن'), value: '__skip', act: () => { store.set('updSkip', v); paint(); setStatus(T('نسخهٔ {v} رد شد', { v }), ''); } },
    ],
  });
}

document.addEventListener('click', e => {
  if (e.target.closest('#btnUpdate')) showDialog();
  else if (e.target.closest('#updCheck')) { store.set('updSkip', ''); check(true); }
});
document.addEventListener('zp:lang', paint);

invoke('app_version').then(v => { const el = $('#updVer'); if (el) el.textContent = 'v' + v; }).catch(() => {});
setTimeout(() => { if (Z.S.autoUpdate) check(false); }, 8000);
setInterval(() => { if (Z.S.autoUpdate && !document.hidden) check(false); }, HOURS * 3600 * 1000);
})();
