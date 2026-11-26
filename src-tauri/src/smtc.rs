// Native Windows media session (SMTC) so the volume flyout, lock screen and
// desktop docks show "Zoro Player" with title / artist / cover instead of the
// WebView's generic "Unknown app" / "Playing from Edge".
// On other platforms this is a harmless no-op.

pub const AUMID: &str = "com.zoro.player";

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug)]
pub enum Msg {
    Meta { title: String, artist: String, album: String, cover: Option<String>, duration_ms: u64 },
    State { playing: bool, pos_ms: u64 },
    Stop,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
    use std::sync::mpsc::{channel, Sender};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};

    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    /// Must run before any window is created.
    pub fn set_app_id() {
        let w: Vec<u16> = AUMID.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            SetCurrentProcessExplicitAppUserModelID(w.as_ptr());
        }
        register_display_name();
    }

    /// Gives the AppUserModelID a friendly name + icon even when the exe runs
    /// without a Start-menu shortcut (portable build). Best effort.
    fn register_display_name() {
        use std::os::windows::process::CommandExt;
        let key = format!("HKCU\\Software\\Classes\\AppUserModelId\\{}", AUMID);
        let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
        let run = |args: &[&str]| {
            let _ = std::process::Command::new("reg")
                .args(args)
                .creation_flags(0x0800_0000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        };
        run(&["add", &key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "Zoro Player", "/f"]);
        if !exe.is_empty() {
            run(&["add", &key, "/v", "IconUri", "/t", "REG_SZ", "/d", &exe, "/f"]);
        }
    }

    pub fn start(app: AppHandle, hwnd: isize) -> Sender<Msg> {
        let (tx, rx) = channel::<Msg>();
        std::thread::spawn(move || {
            let cfg = PlatformConfig { dbus_name: "zoro_player", display_name: "Zoro Player", hwnd: Some(hwnd as *mut std::ffi::c_void) };
            let mut mc = match MediaControls::new(cfg) {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("smtc: {:?}", e);
                    return;
                }
            };
            let a = app.clone();
            let _ = mc.attach(move |ev| {
                let cmd = match ev {
                    MediaControlEvent::Play => "play",
                    MediaControlEvent::Pause => "pause",
                    MediaControlEvent::Toggle => "toggle",
                    MediaControlEvent::Next => "next",
                    MediaControlEvent::Previous => "prev",
                    MediaControlEvent::Stop => "pause",
                    _ => return,
                };
                let _ = a.emit("zp-cmd", serde_json::json!({ "cmd": cmd }));
            });
            while let Ok(m) = rx.recv() {
                match m {
                    Msg::Meta { title, artist, album, cover, duration_ms } => {
                        let dur = if duration_ms > 0 { Some(Duration::from_millis(duration_ms)) } else { None };
                        // a bad cover must not drop title / duration
                        let full = MediaMetadata { title: Some(&title), artist: Some(&artist), album: Some(&album), cover_url: cover.as_deref(), duration: dur };
                        if mc.set_metadata(full).is_err() {
                            let bare = MediaMetadata { title: Some(&title), artist: Some(&artist), album: Some(&album), cover_url: None, duration: dur };
                            let _ = mc.set_metadata(bare);
                        }
                    }
                    Msg::State { playing, pos_ms } => {
                        let p = Some(MediaPosition(Duration::from_millis(pos_ms)));
                        let _ = mc.set_playback(if playing { MediaPlayback::Playing { progress: p } } else { MediaPlayback::Paused { progress: p } });
                    }
                    Msg::Stop => {
                        let _ = mc.set_playback(MediaPlayback::Stopped);
                    }
                }
            }
        });
        tx
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    pub fn set_app_id() {}
    pub fn start(_app: tauri::AppHandle, _hwnd: isize) -> Sender<Msg> {
        let (tx, _rx) = channel::<Msg>();
        tx
    }
}

pub use imp::{set_app_id, start};

/// souvlaki (Windows) strips a leading "file://" and opens the rest as a plain
/// path, so no percent-encoding and no third slash here.
pub fn file_url(p: &std::path::Path) -> String {
    format!("file://{}", p.display())
}
