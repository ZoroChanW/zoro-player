# Zoro Player

A Windows desktop music player built with **Tauri 2, Rust, and vanilla JavaScript**. Zoro Player combines a Persian-first, RTL interface with an English LTR option, a customizable monochrome desktop aesthetic, and a feature-rich local music library.

## Features

- **Local music library** — Add individual files or multiple folders, including their subfolders. Drag and drop files or folders into the player.
- **Fast library loading** — Track metadata is cached in SQLite. The player can show cached tracks immediately and only re-read files that are new or have changed.
- **Automatic folder watching** — Optionally monitor music folders and refresh the library when audio files are added or removed.
- **Library browser** — Browse tracks with cover art in grid or list view, search by title, artist, or album, sort the collection, and select multiple tracks.
- **Playlists** — Create, rename, copy, customize with a cover image, reorder, and delete playlists.
- **Queue management** — Add tracks to the queue, play a track next, reorder upcoming tracks, shuffle the queue, and remove individual or all queued tracks.
- **Track details and editing** — View metadata and edit track titles, artist and album information, other tags, embedded artwork, and file names.
- **10-band equalizer** — Adjustable frequency bands, preamp, built-in presets, custom presets, a live response curve, and an optional limiter.
- **Audio visualizers** — Choose from block, bar, mirrored, wave, and circular visualizers. The cover artwork also reacts to bass.
- **Desktop widget** — A compact, transparent widget with cover art, playback controls, and a visualizer.
- **Customizable appearance** — Monochrome, Mono + Cover, Paper, Amber, and Phosphor themes; custom backgrounds, accent colors, blur, brightness, panel opacity, corner radius, cover styles, and font sizing.
- **Persian and English UI** — Switch between Persian (RTL) and English (LTR), including the desktop widget.
- **Playback controls** — Shuffle, repeat modes, playback speed, volume, mute, media keys, and resume-last-track behavior.
- **Windows system tray** — Keep playback running when the main window is closed, with playback controls available from the tray menu.

## Audio formats

The library recognizes:

`mp3`, `flac`, `wav`, `ogg`, `oga`, `opus`, `m4a`, `aac`, `weba`, `webm`, `wma`, `ape`, `wv`, `aif`, `aiff`, `aifc`, `caf`, `mka`, `mpc`, and `tta`.

Formats supported by the embedded WebView audio engine play directly. Formats that need additional decoding are converted to WAV by the Rust backend using Symphonia, with **FFmpeg as a fallback**.

If FFmpeg is needed, place `ffmpeg.exe` next to the application executable, in an `ffmpeg` subfolder beside it, or in the application's data directory. You can also make FFmpeg available through `PATH` or set the `ZORO_FFMPEG` environment variable to its executable path.

## Tech stack

| Part | Technology |
|---|---|
| Desktop runtime | [Tauri 2](https://tauri.app/) |
| Backend | [Rust](https://www.rust-lang.org/) |
| Frontend | HTML, CSS, vanilla JavaScript |
| Audio metadata and tags | [Lofty](https://github.com/Serial-ATA/lofty) |
| Audio decoding | [Symphonia](https://github.com/pdeljanov/Symphonia), optional FFmpeg fallback |
| Library cache | SQLite via `rusqlite` |
| File discovery | `walkdir` |
| Folder monitoring | `notify-debouncer-mini` |
| Audio processing and visualization | Web Audio API and Canvas |

## Requirements

To build Zoro Player on Windows, install:

1. [Node.js](https://nodejs.org/)
2. [Rust](https://www.rust-lang.org/tools/install) with the MSVC toolchain
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**
4. [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed on Windows 10 and 11)

## Development

Clone the repository and install the Tauri CLI dependencies:

```powershell
git clone https://github.com/ZoroChanW/zoro-player.git
cd zoro-player
npm install
```

Run the application in development mode:

```powershell
npm run dev
```

## Build

Create the Windows installer (NSIS):

```powershell
npm run build
```

The generated installer is placed under:

```
src-tauri/target/release/bundle/nsis/
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

Zoro Player is designed around a local music library. Track information is cached in a SQLite database in the application's data directory, while interface preferences and library-related state are persisted by the frontend. Your music files remain in their original locations; removing a track from the app does not delete the file from disk.

## Fonts

The project bundles [JetBrains Mono](https://www.jetbrains.com/lp/mono/) and [Vazirmatn](https://github.com/rastikerdar/vazirmatn). Their Open Font License files are included in `src/fonts/`.

---

Made with care by [ZoroChanW](https://github.com/ZoroChanW).
