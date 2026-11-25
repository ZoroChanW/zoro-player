//! Library logic that does not depend on Tauri: scanning folders, reading and
//! writing tags, cover lookup, renaming files, opening Explorer.
//! Keeping it separate lets it be compiled and tested without a WebView.

use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::FileType;
use lofty::picture::{Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// Formats the embedded WebView2 (Chromium) can decode.
pub const EXTS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac", "weba", "webm",
    // decoded in Rust (Symphonia) or through ffmpeg
    "wma", "ape", "wv", "aif", "aiff", "aifc", "caf", "mka", "mpc", "tta",
];
const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album", "albumart", "artwork"];
const COVER_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp"];
/// Cover images the user may embed (lofty detects the type from the bytes).
pub const EMBED_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png"];

#[derive(Serialize, Clone)]
pub struct Track {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
}

pub fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn is_embed_image(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EMBED_IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn basic_track(path: &Path) -> Track {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    Track {
        path: path.to_string_lossy().to_string(),
        title: stem,
        artist: String::new(),
        album: String::new(),
        duration: 0.0,
    }
}

pub fn read_meta(path: &Path) -> Track {
    let mut t = basic_track(path);
    let opts = ParseOptions::new().read_cover_art(false);
    if let Ok(probe) = Probe::open(path) {
        if let Ok(tagged) = probe.options(opts).read() {
            t.duration = tagged.properties().duration().as_secs_f64();
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(v) = tag.title() {
                    if !v.trim().is_empty() {
                        t.title = v.trim().to_string();
                    }
                }
                if let Some(v) = tag.artist() {
                    t.artist = v.trim().to_string();
                }
                if let Some(v) = tag.album() {
                    t.album = v.trim().to_string();
                }
            }
        }
    }
    t
}

fn safe_meta(path: &Path) -> Track {
    catch_unwind(AssertUnwindSafe(|| read_meta(path))).unwrap_or_else(|_| basic_track(path))
}

/// Every audio file under the given folders / explicit files, sorted by path.
pub fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut files: Vec<PathBuf> = Vec::new();
    for raw in paths {
        let p = PathBuf::from(raw);
        if p.is_dir() {
            for entry in WalkDir::new(&p).follow_links(true).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() && is_audio(entry.path()) {
                    let pb = entry.into_path();
                    if seen.insert(pb.clone()) {
                        files.push(pb);
                    }
                }
            }
        } else if p.is_file() && is_audio(&p) && seen.insert(p.clone()) {
            files.push(p);
        }
    }
    files.sort_by_key(|p| p.to_string_lossy().to_lowercase());
    files
}

/// Reads tags of many files in parallel (order preserved).
pub fn read_many(files: &[PathBuf]) -> Vec<Track> {
    if files.is_empty() {
        return Vec::new();
    }
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
    let chunk = files.len().div_ceil(threads).max(1);
    let mut out: Vec<Track> = Vec::with_capacity(files.len());
    std::thread::scope(|s| {
        let handles: Vec<_> = files
            .chunks(chunk)
            .map(|c| s.spawn(move || c.iter().map(|p| safe_meta(p)).collect::<Vec<Track>>()))
            .collect();
        for h in handles {
            if let Ok(v) = h.join() {
                out.extend(v);
            }
        }
    });
    out
}

#[allow(dead_code)]
pub fn scan_blocking(paths: Vec<String>) -> Vec<Track> {
    read_many(&collect_files(&paths))
}

fn embedded_cover(path: &Path) -> Option<Vec<u8>> {
    let tagged = lofty::read_from_path(path).ok()?;
    let mut first: Option<Vec<u8>> = None;
    for tag in tagged.tags() {
        for pic in tag.pictures() {
            if pic.pic_type() == PictureType::CoverFront {
                return Some(pic.data().to_vec());
            }
            if first.is_none() {
                first = Some(pic.data().to_vec());
            }
        }
    }
    first
}

pub fn find_cover(path: &Path) -> Option<Vec<u8>> {
    if let Some(b) = embedded_cover(path) {
        if !b.is_empty() {
            return Some(b);
        }
    }
    let dir = path.parent()?;
    for name in COVER_NAMES {
        for ext in COVER_EXTS {
            let f = dir.join(format!("{name}.{ext}"));
            if f.is_file() {
                if let Ok(b) = std::fs::read(&f) {
                    return Some(b);
                }
            }
        }
    }
    None
}

// ───────────────────────── info ─────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub path: String,
    pub file_stem: String,
    pub ext: String,
    pub format: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub writable: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub comment: String,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub duration: f64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub bit_depth: Option<u8>,
    pub has_embedded_cover: bool,
}

fn format_name(ft: FileType) -> String {
    match ft {
        FileType::Mpeg => "MP3".into(),
        FileType::Flac => "FLAC".into(),
        FileType::Opus => "Opus".into(),
        FileType::Vorbis => "Ogg Vorbis".into(),
        FileType::Mp4 => "M4A / AAC".into(),
        FileType::Wav => "WAV".into(),
        FileType::Aac => "AAC".into(),
        other => format!("{other:?}"),
    }
}

pub fn track_info(path: &Path) -> Result<TrackInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let tagged = lofty::read_from_path(path).map_err(|e| e.to_string())?;
    let props = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let txt = |v: Option<std::borrow::Cow<'_, str>>| v.map(|c| c.trim().to_string()).unwrap_or_default();
    let (title, artist, album, genre, comment, year, track, album_artist) = match tag {
        Some(t) => (
            txt(t.title()),
            txt(t.artist()),
            txt(t.album()),
            txt(t.genre()),
            txt(t.comment()),
            t.year(),
            t.track(),
            t.get_string(&ItemKey::AlbumArtist)
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
        ),
        None => Default::default(),
    };

    let bitrate = props.audio_bitrate().or_else(|| props.overall_bitrate());
    Ok(TrackInfo {
        path: path.to_string_lossy().to_string(),
        file_stem: path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        ext: path
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        format: format_name(tagged.file_type()),
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs()),
        writable: !meta.permissions().readonly(),
        title,
        artist,
        album,
        album_artist,
        genre,
        comment,
        year,
        track,
        duration: props.duration().as_secs_f64(),
        bitrate,
        sample_rate: props.sample_rate(),
        channels: props.channels(),
        bit_depth: props.bit_depth(),
        has_embedded_cover: tagged.tags().iter().any(|t| !t.pictures().is_empty()),
    })
}

// ───────────────────────── editing ─────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEdit {
    pub file_stem: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub comment: String,
    pub year: Option<u32>,
    pub track: Option<u32>,
    pub cover_path: Option<String>,
    pub remove_cover: bool,
}

#[derive(Serialize)]
pub struct EditResult {
    pub track: Track,
    pub warning: Option<String>,
}

fn sanitize_stem(s: &str) -> Result<String, String> {
    let t = s.trim().trim_end_matches(['.', ' ']).to_string();
    if t.is_empty() {
        return Err("نام فایل نباید خالی باشد".into());
    }
    if t.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) {
        return Err("نام فایل نباید شامل این نویسه‌ها باشد:  \\ / : * ? \" < > |".into());
    }
    if t.chars().count() > 180 {
        return Err("نام فایل خیلی طولانی است".into());
    }
    let head = t.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(head.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((head.starts_with("COM") || head.starts_with("LPT"))
            && head.len() == 4
            && head.as_bytes()[3].is_ascii_digit()
            && head.as_bytes()[3] != b'0');
    if reserved {
        return Err("این نام در ویندوز رزرو شده است".into());
    }
    Ok(t)
}

fn apply_edit(tag: &mut Tag, e: &TagEdit) -> Result<(), String> {
    // Accessor setters need a unique borrow each, so keep them sequential.
    let v = e.title.trim();
    if v.is_empty() { tag.remove_title(); } else { tag.set_title(v.to_string()); }
    let v = e.artist.trim();
    if v.is_empty() { tag.remove_artist(); } else { tag.set_artist(v.to_string()); }
    let v = e.album.trim();
    if v.is_empty() { tag.remove_album(); } else { tag.set_album(v.to_string()); }
    let v = e.genre.trim();
    if v.is_empty() { tag.remove_genre(); } else { tag.set_genre(v.to_string()); }
    let v = e.comment.trim();
    if v.is_empty() { tag.remove_comment(); } else { tag.set_comment(v.to_string()); }
    let v = e.album_artist.trim();
    if v.is_empty() {
        tag.remove_key(&ItemKey::AlbumArtist);
    } else {
        tag.insert_text(ItemKey::AlbumArtist, v.to_string());
    }
    match e.year {
        Some(y) => tag.set_year(y),
        None => tag.remove_year(),
    }
    match e.track {
        Some(n) => tag.set_track(n),
        None => tag.remove_track(),
    }

    if e.remove_cover {
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
    }
    if let Some(cp) = &e.cover_path {
        let cp = Path::new(cp);
        if !is_embed_image(cp) {
            return Err("فقط تصویر JPG یا PNG برای کاور پشتیبانی می‌شود".into());
        }
        let mut f = std::fs::File::open(cp).map_err(|er| format!("باز کردن تصویر ممکن نشد: {er}"))?;
        let mut pic =
            Picture::from_reader(&mut f).map_err(|er| format!("تصویر کاور معتبر نیست: {er}"))?;
        pic.set_pic_type(PictureType::CoverFront);
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(pic);
    }
    Ok(())
}

fn write_tags(path: &Path, e: &TagEdit) -> Result<(), String> {
    let mut tagged =
        lofty::read_from_path(path).map_err(|er| format!("خواندن تگ‌های فایل ممکن نشد: {er}"))?;

    // Edit the tag the file already uses (primary, else whatever exists) so we never
    // leave a stale second tag behind; only create one for files that have none.
    let has_primary = tagged.primary_tag().is_some();
    let has_any = tagged.first_tag().is_some();
    if !has_primary && !has_any {
        let tt = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tt));
    }
    let tag = if has_primary || !has_any {
        tagged.primary_tag_mut()
    } else {
        tagged.first_tag_mut()
    }
    .ok_or_else(|| "ساخت تگ برای این فرمت ممکن نیست".to_string())?;
    apply_edit(tag, e)?;

    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|er| format!("ذخیرهٔ تگ‌ها ممکن نشد (فایل فقط‌خواندنی یا در حال استفاده است؟): {er}"))
}

/// Writes the tags, then renames the file if the name changed.
/// Tag errors abort before anything is touched; a failed rename only produces a warning.
pub fn edit_track(path: &Path, e: &TagEdit) -> Result<EditResult, String> {
    if !path.is_file() {
        return Err("فایل پیدا نشد (شاید جابه‌جا یا حذف شده)".into());
    }
    if !is_audio(path) {
        return Err("نوع فایل پشتیبانی نمی‌شود".into());
    }
    let stem = sanitize_stem(&e.file_stem)?;
    if e.year.map_or(false, |y| y > 9999) {
        return Err("سال معتبر نیست".into());
    }

    write_tags(path, e)?;

    let mut final_path = path.to_path_buf();
    let mut warning = None;
    let old_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if stem != old_stem {
        let mut name = stem.clone();
        if let Some(ext) = path.extension() {
            name.push('.');
            name.push_str(&ext.to_string_lossy());
        }
        let target = path.with_file_name(&name);
        let same_file = target.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
        if target.exists() && !same_file {
            warning = Some(format!("فایلی با نام «{name}» از قبل وجود دارد؛ نام فایل تغییر نکرد"));
        } else if let Err(er) = std::fs::rename(path, &target) {
            warning = Some(format!("تغییر نام فایل ممکن نشد: {er}"));
        } else {
            final_path = target;
        }
    }
    Ok(EditResult {
        track: safe_meta(&final_path),
        warning,
    })
}

// ───────────────────────── Explorer ─────────────────────────

/// Opens Explorer with the file selected (or opens the folder itself).
#[cfg(windows)]
pub fn reveal(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let p = PathBuf::from(path.replace('/', "\\"));
    if !p.exists() {
        return Err("مسیر پیدا نشد (شاید جابه‌جا یا حذف شده)".into());
    }
    let shown = p.to_string_lossy().to_string();
    let arg = if p.is_dir() {
        format!("\"{shown}\"")
    } else {
        format!("/select,\"{shown}\"")
    };
    std::process::Command::new("explorer.exe")
        .raw_arg(arg)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn reveal(_path: &str) -> Result<(), String> {
    Err("این قابلیت فقط روی ویندوز کار می‌کند".into())
}
