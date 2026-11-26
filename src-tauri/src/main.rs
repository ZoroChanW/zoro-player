// Zoro Player - Rust backend (Tauri v2)
// Responsibilities: folder scanning, tag + cover reading, raw audio bytes for the
// Web Audio graph, native folder/file pickers and the desktop widget window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod decode;
mod library;
mod oauth;
mod smtc;

use library::{
    edit_track as lib_edit_track, find_cover, is_audio, is_embed_image,
    track_info as lib_track_info, EditResult, TagEdit, Track, TrackInfo, EMBED_IMAGE_EXTS, EXTS,
};
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// When true, closing the main window hides it to the tray instead of quitting.
/// Must match "additionalBrowserArgs" of the main window in tauri.conf.json.
#[cfg(windows)]
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling,MediaSessionService";

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

const WIDGET_W: f64 = 390.0;
const WIDGET_H: f64 = 160.0;

// ───────────────────────── commands ─────────────────────────

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("انتخاب پوشهٔ آهنگ‌ها")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_files(app: AppHandle) -> Vec<String> {
    app.dialog()
        .file()
        .set_title("انتخاب آهنگ")
        .add_filter("Audio", EXTS)
        .blocking_pick_files()
        .map(|v| {
            v.into_iter()
                .filter_map(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Serialize)]
struct PathKind {
    path: String,
    is_dir: bool,
}

/// Tells the frontend which dropped paths are folders (used for drag & drop).
#[tauri::command]
fn path_kinds(paths: Vec<String>) -> Vec<PathKind> {
    paths
        .into_iter()
        .map(|p| {
            let is_dir = Path::new(&p).is_dir();
            PathKind { path: p, is_dir }
        })
        .collect()
}

/// Folder watcher (replaced whenever the folder list changes).
struct Watcher(Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

/// Scans folders / files; only new or changed files have their tags re-read (SQLite cache).
#[tauri::command]
async fn scan_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<Track>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<db::Db>().scan(&paths))
        .await
        .map_err(|e| e.to_string())
}

/// Instantly returns what the cache already knows (used to show the library at start-up).
#[tauri::command]
async fn cached_library(app: AppHandle, paths: Vec<String>) -> Result<Vec<Track>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<db::Db>().cached(&paths))
        .await
        .map_err(|e| e.to_string())
}

/// Watches the folders (recursively) and emits `zp-fs-changed` after file changes settle.
/// An empty list stops watching.
#[tauri::command]
fn watch_folders(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<Watcher>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    let dirs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
    if dirs.is_empty() {
        return Ok(());
    }
    let handle = app.clone();
    let mut deb = new_debouncer(Duration::from_millis(1500), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let relevant = events.iter().any(|e| is_audio(&e.path) || e.path.extension().is_none());
            if relevant {
                let _ = handle.emit("zp-fs-changed", ());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for d in &dirs {
        let _ = deb.watcher().watch(d, RecursiveMode::Recursive);
    }
    *slot = Some(deb);
    Ok(())
}

/// Returns the bytes of an audio file ready for the WebView. Formats the WebView can't play
/// (ALAC, AIFF, WMA, APE, WavPack ...) are decoded to WAV first. The frontend wraps the bytes in a Blob
/// so the Web Audio graph (equalizer / analyser) stays same-origin and never goes silent.
#[tauri::command]
async fn read_audio(path: String) -> Result<Response, String> {
    let p = PathBuf::from(path);
    if !is_audio(&p) {
        return Err("unsupported file type".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if decode::always_decode(&p) || decode::is_alac(&p) {
            decode::decode_to_wav(&p)
        } else {
            std::fs::read(&p).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Lets the WebView stream a plain audio file straight from disk (asset protocol, range
/// requests) instead of receiving the whole file in memory. Returns false for formats that
/// have to be decoded first; the caller then falls back to `read_audio`.
#[tauri::command]
async fn prepare_stream(app: AppHandle, path: String) -> Result<bool, String> {
    let p = PathBuf::from(path);
    if !is_audio(&p) {
        return Ok(false);
    }
    let p2 = p.clone();
    let direct = tauri::async_runtime::spawn_blocking(move || !(decode::always_decode(&p2) || decode::is_alac(&p2)))
        .await
        .map_err(|e| e.to_string())?;
    if !direct {
        return Ok(false);
    }
    app.asset_protocol_scope().allow_file(&p).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Fallback used when the WebView refuses a file it was expected to play: always decode in Rust / ffmpeg.
#[tauri::command]
async fn decode_audio(path: String) -> Result<Response, String> {
    let p = PathBuf::from(path);
    if !is_audio(&p) {
        return Err("unsupported file type".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || decode::decode_to_wav(&p))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Embedded cover art, falling back to cover.jpg / folder.jpg ... in the same folder.
/// Returns an empty buffer when there is none.
#[tauri::command]
async fn read_cover(path: String) -> Result<Response, String> {
    let p = PathBuf::from(path);
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        catch_unwind(AssertUnwindSafe(|| find_cover(&p)))
            .ok()
            .flatten()
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Detailed information for the "info" and "edit" dialogs.
#[tauri::command]
async fn track_info(path: String) -> Result<TrackInfo, String> {
    tauri::async_runtime::spawn_blocking(move || lib_track_info(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Writes tags (and optionally a new cover), then renames the file if asked to.
#[tauri::command]
async fn edit_track(path: String, edit: TagEdit) -> Result<EditResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        catch_unwind(AssertUnwindSafe(|| lib_edit_track(Path::new(&path), &edit)))
            .unwrap_or_else(|_| Err("خطای غیرمنتظره هنگام نوشتن تگ‌ها".to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens Explorer with the file selected (or opens the folder).
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    library::reveal(&path)
}

#[tauri::command]
async fn pick_image(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("انتخاب تصویر کاور")
        .add_filter("Image", EMBED_IMAGE_EXTS)
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// Bytes of a user-chosen cover image (preview in the edit dialog).
#[tauri::command]
async fn read_image(path: String) -> Result<Response, String> {
    let p = PathBuf::from(path);
    if !is_embed_image(&p) {
        return Err("unsupported image type".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        if len > 25 * 1024 * 1024 {
            return Err("image too large".to_string());
        }
        std::fs::read(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Spotify login: waits for the OAuth redirect on a loopback port and returns the code.
#[tauri::command]
async fn oauth_wait(port: u16, state: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || oauth::wait_for_code(port, &state, 240))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    oauth::open_url(&url)
}

#[tauri::command]
async fn widget_open(app: AppHandle) -> bool {
    app.get_webview_window("widget").is_some()
}

/// Opens the desktop widget window, or closes it if it is already open.
/// Returns the new state (true = open).
#[tauri::command]
async fn toggle_widget(
    app: AppHandle,
    x: Option<f64>,
    y: Option<f64>,
    on_top: bool,
) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("widget") {
        w.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }

    let (px, py) = match (x, y) {
        (Some(x), Some(y)) => (x, y),
        _ => {
            // default: top-right corner of the primary monitor
            let mut pos = (80.0, 80.0);
            if let Ok(Some(m)) = app.primary_monitor() {
                let scale = m.scale_factor();
                let w = m.size().width as f64 / scale;
                pos = ((w - WIDGET_W - 40.0).max(0.0), 60.0);
            }
            pos
        }
    };

    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut wb = WebviewWindowBuilder::new(&app, "widget", WebviewUrl::App("widget.html".into()))
        .title("Zoro Widget")
        .inner_size(WIDGET_W, WIDGET_H)
        .position(px, py)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(on_top)
        .always_on_bottom(!on_top);
    // WebView2 windows sharing one user-data folder MUST use identical browser
    // args, otherwise creation fails with HRESULT 0x8007139F.
    #[cfg(windows)]
    {
        wb = wb.additional_browser_args(BROWSER_ARGS);
    }
    let win = wb.build().map_err(|e| e.to_string())?;

    let handle = app.clone();
    win.on_window_event(move |ev| {
        if let WindowEvent::Destroyed = ev {
            let _ = handle.emit("zp-widget-closed", ());
        }
    });
    Ok(true)
}

#[tauri::command]
async fn set_widget_pin(app: AppHandle, on_top: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        if on_top {
            w.set_always_on_bottom(false).map_err(|e| e.to_string())?;
            w.set_always_on_top(true).map_err(|e| e.to_string())?;
        } else {
            w.set_always_on_top(false).map_err(|e| e.to_string())?;
            w.set_always_on_bottom(true).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn tray_menu(app: &AppHandle, l: &[String]) -> tauri::Result<Menu<tauri::Wry>> {
    let get = |i: usize, d: &str| l.get(i).cloned().unwrap_or_else(|| d.to_string());
    let show = MenuItem::with_id(app, "show", get(0, "Show Zoro Player"), true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", get(1, "Play / Pause"), true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", get(2, "Previous"), true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", get(3, "Next"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", get(4, "Quit"), true, None::<&str>)?;
    let s1 = PredefinedMenuItem::separator(app)?;
    let s2 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&show, &s1, &toggle, &prev, &next, &s2, &quit])
}

/// Frontend setting: closing the window hides it to the tray (true) or quits (false).
#[tauri::command]
fn set_close_to_tray(on: bool) {
    CLOSE_TO_TRAY.store(on, Ordering::Relaxed);
}

/// Translated tray menu labels: [show, play/pause, previous, next, quit].
#[tauri::command]
fn set_tray_labels(app: AppHandle, labels: Vec<String>) -> Result<(), String> {
    if let Some(t) = app.tray_by_id("main") {
        let m = tray_menu(&app, &labels).map_err(|e| e.to_string())?;
        t.set_menu(Some(m)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(text));
    }
}

struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Asks the release feed whether a newer signed build exists.
#[tauri::command]
async fn check_update(app: AppHandle, state: tauri::State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let up = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = up.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *state.0.lock().map_err(|e| e.to_string())? = up;
    Ok(info)
}

/// Downloads + verifies (signature) + installs the update found by `check_update`,
/// reporting progress to the UI as `zp-update` events.
#[tauri::command]
async fn install_update(app: AppHandle, state: tauri::State<'_, PendingUpdate>) -> Result<(), String> {
    let up = state.0.lock().map_err(|e| e.to_string())?.take().ok_or_else(|| "no pending update".to_string())?;
    let (a1, a2) = (app.clone(), app.clone());
    let mut got: u64 = 0;
    let mut last_pct: i64 = -1;
    up.download_and_install(
        move |chunk, total| {
            got += chunk as u64;
            let pct = total.filter(|t| *t > 0).map(|t| (got * 100 / t) as i64).unwrap_or(-1);
            if pct != last_pct || pct < 0 {
                last_pct = pct;
                let _ = a1.emit("zp-update", serde_json::json!({ "got": got, "total": total, "pct": pct }));
            }
        },
        move || {
            let _ = a2.emit("zp-update", serde_json::json!({ "done": true }));
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    // On Windows the installer takes over and restarts the app by itself.
    #[cfg(not(windows))]
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

struct SmtcTx(Mutex<Option<Sender<smtc::Msg>>>);
static COVER_N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Pushes now-playing info to the OS media session. `kind`: "meta" | "state" | "stop".
#[tauri::command]
async fn smtc_update(
    app: AppHandle,
    state: tauri::State<'_, SmtcTx>,
    kind: String,
    path: Option<String>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    position: Option<f64>,
    playing: Option<bool>,
) -> Result<(), String> {
    let msg = match kind.as_str() {
        "meta" => {
            let mut cover = None;
            if let Some(p) = path {
                let p2 = PathBuf::from(&p);
                let dir = app.path().app_cache_dir().ok();
                cover = tauri::async_runtime::spawn_blocking(move || {
                    let bytes = find_cover(&p2)?;
                    let dir = dir?;
                    std::fs::create_dir_all(&dir).ok()?;
                    // rotate names so Windows never serves a stale cached image
                    let n = COVER_N.fetch_add(1, Ordering::Relaxed) % 4;
                    let f = dir.join(format!("smtc-cover-{}.img", n));
                    std::fs::write(&f, bytes).ok()?;
                    Some(smtc::file_url(&f))
                })
                .await
                .ok()
                .flatten();
            }
            smtc::Msg::Meta {
                title: title.unwrap_or_default(),
                artist: artist.unwrap_or_default(),
                album: album.unwrap_or_default(),
                cover,
                duration_ms: (duration.unwrap_or(0.0).max(0.0) * 1000.0) as u64,
            }
        }
        "state" => smtc::Msg::State {
            playing: playing.unwrap_or(false),
            pos_ms: (position.unwrap_or(0.0).max(0.0) * 1000.0) as u64,
        },
        _ => smtc::Msg::Stop,
    };
    if let Some(tx) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        let _ = tx.send(msg);
    }
    Ok(())
}

fn main() {
    smtc::set_app_id();
    tauri::Builder::default()
        // must be the first plugin: a second launch just brings the running app forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(SmtcTx(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .manage(Watcher(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let dbp = app.path().app_data_dir().map(|d| d.join("library.db"));
            let database = dbp
                .ok()
                .and_then(|p| db::Db::open(&p).ok())
                .or_else(|| db::Db::memory().ok())
                .expect("cannot create library database");
            app.manage(database);
            if let Ok(d) = app.path().app_data_dir() {
                decode::set_extra_dir(d);
            }
            let menu = tray_menu(&handle, &[])?;
            let mut b = TrayIconBuilder::with_id("main")
                .tooltip("Zoro Player")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    id => {
                        let _ = app.emit("zp-cmd", serde_json::json!({ "cmd": id }));
                    }
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                b = b.icon(icon.clone());
            }
            b.build(app)?;
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(windows)]
                let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                #[cfg(not(windows))]
                let hwnd = {
                    let _ = &w;
                    0isize
                };
                let tx = smtc::start(app.handle().clone(), hwnd);
                *app.state::<SmtcTx>().0.lock().unwrap() = Some(tx);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            pick_files,
            path_kinds,
            scan_paths,
            cached_library,
            watch_folders,
            read_audio,
            prepare_stream,
            decode_audio,
            read_cover,
            track_info,
            edit_track,
            reveal_in_explorer,
            pick_image,
            read_image,
            oauth_wait,
            open_url,
            widget_open,
            toggle_widget,
            set_widget_pin,
            set_close_to_tray,
            set_tray_labels,
            set_tray_tooltip,
            smtc_update,
            app_version,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zoro Player");
}
