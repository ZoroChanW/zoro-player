// Zoro Player - Rust backend (Tauri v2)
// Responsibilities: folder scanning, tag + cover reading, raw audio bytes for the
// Web Audio graph, native folder/file pickers and the desktop widget window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod decode;
mod library;
mod oauth;

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
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// When true, closing the main window hides it to the tray instead of quitting.
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

    let win = WebviewWindowBuilder::new(&app, "widget", WebviewUrl::App("widget.html".into()))
        .title("Zoro Widget")
        .inner_size(WIDGET_W, WIDGET_H)
        .position(px, py)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(on_top)
        .always_on_bottom(!on_top)
        .build()
        .map_err(|e| e.to_string())?;

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

fn main() {
    tauri::Builder::default()
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
            set_tray_tooltip
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zoro Player");
}
