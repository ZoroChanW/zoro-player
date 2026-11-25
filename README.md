# Zoro Player

A Windows desktop music player built with **Tauri 2, Rust, and vanilla JavaScript**. Zoro Player pairs a Persian-first, right-to-left interface with an English left-to-right option and a customizable, monochrome desktop aesthetic inspired by Omarchy.

## Features

### Music library
- Add individual audio files or one or more folders, including nested subfolders.
- Drag and drop files or folders into the player.
- Browse your collection in grid or list view, with cover art, search, sorting, and multi-selection.
- Cache track metadata in SQLite so the library can load quickly; unchanged files do not need to be re-read.
- Optionally watch music folders and detect added or removed files.

### Playback and organization
- Create, rename, duplicate, customize, reorder, and delete playlists.
- Manage the play queue: add tracks, play a track next, reorder upcoming tracks, shuffle the queue, and remove tracks.
- Use shuffle, repeat modes, playback speed, volume, mute, and media-key controls.
- Resume the last played track when the app starts.
- Remove tracks from the app without deleting the original files from disk.

### Track information and audio
- View track metadata and edit titles, artist and album information, tags, embedded artwork, and file names.
- Display embedded cover art or discover common folder artwork files.
- Use the 10-band equalizer with preamp, built-in and custom presets, a live frequency-response curve, and an optional limiter.
- Choose from block, bar, mirrored, wave, and circular visualizers. Cover artwork reacts to bass.

### Appearance and desktop integration
- Choose from Monochrome, Mono + Cover, Paper, Amber, and Phosphor themes.
- Customize backgrounds, accent colors, blur, brightness, panel opacity, corner radius, cover style, and font size.
- Open a compact, transparent desktop widget with cover art, playback controls, and a visualizer.
- Keep playback running in the Windows system tray when the main window is closed.

### Languages
- Switch between Persian (RTL) and English (LTR).
- The language selection also applies to the desktop widget.

## Audio formats

The library recognizes these file extensions:

`mp3`, `flac`, `wav`, `ogg`, `oga`, `opus`, `m4a`, `aac`, `weba`, `webm`, `wma`, `ape`, `wv`, `aif`, `aiff`, `aifc`, `caf`, `mka`, `mpc`, `tta`, `dsf`, and `dff`.

Playback depends on the format and the Windows WebView audio engine. Formats that the WebView cannot play natively are decoded to WAV by the Rust backend using **Symphonia**, with **FFmpeg** as a fallback for formats Symphonia cannot decode.

If FFmpeg is required, make `ffmpeg.exe` available in one of these locations:
- Next to the Zoro Player executable.
- In an `ffmpeg` subfolder next to the executable.
- In the application's data directory.
- On your system `PATH`.

You can also set the `ZORO_FFMPEG` environment variable to the FFmpeg executable path.

## Tech stack

| Component | Technology |
|---|---|
| Desktop framework | [Tauri 2](https://tauri.app/) |
| Backend | [Rust](https://www.rust-lang.org/) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Audio metadata and tag editing | [Lofty](https://github.com/Serial-ATA/lofty) |
| Audio decoding | [Symphonia](https://github.com/pdeljanov/Symphonia), with FFmpeg fallback |
| Library metadata cache | SQLite via `rusqlite` |
| File discovery | `walkdir` |
| Folder monitoring | `notify-debouncer-mini` |
| Audio processing | Web Audio API |
| Visualizers | Canvas |

## Requirements

To develop and build Zoro Player on Windows, install:

1. [Node.js](https://nodejs.org/)
2. [Rust](https://www.rust-lang.org/tools/install) with the MSVC toolchain
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload
4. [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed on Windows 10 and 11)

## Development

Clone the repository and install the dependencies:

```powershell
git clone https://github.com/ZoroChanW/zoro-player.git
cd zoro-player
npm install
```

Start the desktop app in development mode:

```powershell
npm run dev
```

## Build

Build the Windows NSIS installer:

```powershell
npm run build
```

The installer is generated under:

```
src-tauri/target/release/bundle/nsis/
```

The project uses the Tauri CLI through the npm scripts. You can also install the Rust CLI and run the equivalent Cargo commands:

```powershell
cargo install tauri-cli --version "^2"
cargo tauri dev
cargo tauri build
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek backward / forward by 5 seconds |
| `Ctrl + ←` / `Ctrl + →` | Previous / next track |
| `↑` / `↓` | Increase / decrease volume |
| `M` | Mute / unmute |
| `S` | Toggle shuffle |
| `R` | Cycle repeat mode |
| `E` | Open / close the equalizer |
| `V` | Change visualizer |
| `L` | Open the library |
| `Q` | Open the play queue |

## Data and privacy

Zoro Player is designed for a local music collection. Track metadata is cached in a SQLite database in the application's data directory, while interface preferences and other frontend state are persisted locally by the app.

Your music files remain in their original locations. Removing a track from Zoro Player removes it from the app's library; it does **not** delete the file from your disk.

## Fonts and licenses

The project bundles [JetBrains Mono](https://www.jetbrains.com/lp/mono/) and [Vazirmatn](https://github.com/rastikerdar/vazirmatn). Their Open Font License texts are included in `src/fonts/`.

---

Made with care by [ZoroChanW](https://github.com/ZoroChanW).
