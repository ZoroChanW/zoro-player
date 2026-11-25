//! SQLite cache of the track library. Scanning only re-reads tags of files whose
//! size / modification time changed, so start-up and re-scans of big libraries are fast.
use crate::library::{collect_files, read_many, Track};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// Bump when the tag-reading logic changes so old cache rows are discarded.
const SCHEMA_VERSION: i64 = 2;

pub struct Db(Mutex<Connection>);

type Stamp = (i64, i64); // (size, mtime in ms)

fn stamp(p: &Path) -> Option<Stamp> {
    let m = std::fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64;
    Some((m.len() as i64, t))
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Db> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    pub fn memory() -> rusqlite::Result<Db> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(c: Connection) -> rusqlite::Result<Db> {
        let _ = c.pragma_update(None, "journal_mode", "WAL");
        let _ = c.pragma_update(None, "synchronous", "NORMAL");
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0);
        if v != SCHEMA_VERSION {
            c.execute_batch("DROP TABLE IF EXISTS tracks;")?;
        }
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS tracks (
                path TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                duration REAL NOT NULL,
                year INTEGER NOT NULL DEFAULT 0,
                genre TEXT NOT NULL DEFAULT '',
                added INTEGER NOT NULL DEFAULT 0
            );",
        )?;
        c.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Db(Mutex::new(c)))
    }

    fn load_all(&self) -> HashMap<String, (Stamp, Track)> {
        let c = match self.0.lock() {
            Ok(c) => c,
            Err(_) => return HashMap::new(),
        };
        let mut out = HashMap::new();
        if let Ok(mut st) = c.prepare("SELECT path,size,mtime,title,artist,album,duration,year,genre,added FROM tracks") {
            if let Ok(rows) = st.query_map([], |r| {
                let path: String = r.get(0)?;
                Ok((
                    path.clone(),
                    ((r.get::<_, i64>(1)?, r.get::<_, i64>(2)?),
                     Track { path, title: r.get(3)?, artist: r.get(4)?, album: r.get(5)?, duration: r.get(6)?, year: r.get(7)?, genre: r.get(8)?, added: r.get(9)? }),
                ))
            }) {
                for row in rows.flatten() {
                    out.insert(row.0, row.1);
                }
            }
        }
        out
    }

    fn save(&self, upserts: &[(Stamp, Track)], deletes: &[String]) {
        let mut c = match self.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        let Ok(tx) = c.transaction() else { return };
        for (s, t) in upserts {
            let _ = tx.execute(
                "INSERT INTO tracks(path,size,mtime,title,artist,album,duration,year,genre,added) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(path) DO UPDATE SET size=?2,mtime=?3,title=?4,artist=?5,album=?6,duration=?7,year=?8,genre=?9,added=?10",
                params![t.path, s.0, s.1, t.title, t.artist, t.album, t.duration, t.year, t.genre, t.added],
            );
        }
        for p in deletes {
            let _ = tx.execute("DELETE FROM tracks WHERE path=?1", params![p]);
        }
        let _ = tx.commit();
    }

    /// Tracks already known for these folders / files, without touching the disk.
    pub fn cached(&self, paths: &[String]) -> Vec<Track> {
        let roots: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let mut v: Vec<Track> = self
            .load_all()
            .into_values()
            .map(|(_, t)| t)
            .filter(|t| roots.iter().any(|r| Path::new(&t.path).starts_with(r)))
            .collect();
        v.sort_by_key(|t| t.path.to_lowercase());
        v
    }

    /// Walks the folders, re-reads only new / changed files, drops vanished ones.
    pub fn scan(&self, paths: &[String]) -> Vec<Track> {
        let files = collect_files(paths);
        let known = self.load_all();
        let mut result: Vec<Option<Track>> = vec![None; files.len()];
        let mut stale: Vec<(usize, Stamp)> = Vec::new();
        for (i, f) in files.iter().enumerate() {
            let key = f.to_string_lossy().to_string();
            match (stamp(f), known.get(&key)) {
                (Some(s), Some((cs, t))) if *cs == s => result[i] = Some(t.clone()),
                (Some(s), _) => stale.push((i, s)),
                (None, _) => {}
            }
        }
        let stale_files: Vec<PathBuf> = stale.iter().map(|(i, _)| files[*i].clone()).collect();
        let fresh = read_many(&stale_files);
        let mut upserts: Vec<(Stamp, Track)> = Vec::with_capacity(fresh.len());
        for ((i, s), t) in stale.iter().zip(fresh) {
            result[*i] = Some(t.clone());
            upserts.push((*s, t));
        }

        // rows that no longer exist: under a scanned folder but not found, or an explicit file that is gone
        let found: HashSet<String> = files.iter().map(|f| f.to_string_lossy().to_string()).collect();
        let roots: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let deletes: Vec<String> = known
            .keys()
            .filter(|k| !found.contains(*k))
            .filter(|k| {
                let kp = Path::new(k);
                roots.iter().any(|r| if r.is_file() { r == kp } else { kp.starts_with(r) })
            })
            .cloned()
            .collect();
        if !upserts.is_empty() || !deletes.is_empty() {
            self.save(&upserts, &deletes);
        }
        result.into_iter().flatten().collect()
    }
}
