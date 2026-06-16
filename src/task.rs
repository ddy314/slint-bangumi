use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::domain::{DanmakuMatch, MediaFile, MediaItem, ScanSummary, ScanUpsertStatus};
use crate::repository::Repository;

#[derive(Debug, Clone)]
pub enum AppEvent {
    Log(String),
    ScanStarted,
    ScanProgress {
        scanned: usize,
        indexed: usize,
    },
    ScanFinished {
        summary: ScanSummary,
        media: Vec<MediaItem>,
    },
    ScanFailed(String),
    DanmakuMatched(DanmakuMatch),
}

pub fn spawn_media_scan(
    repository: Repository,
    roots: Vec<PathBuf>,
    events: mpsc::Sender<AppEvent>,
) {
    thread::spawn(move || {
        let _ = events.send(AppEvent::ScanStarted);
        let _ = events.send(AppEvent::Log(format!(
            "scan started for {} folder(s)",
            roots.len()
        )));

        match scan_media(repository.clone(), &roots, &events) {
            Ok((summary, media)) => {
                let _ = events.send(AppEvent::ScanFinished { summary, media });
            }
            Err(error) => {
                let _ = events.send(AppEvent::ScanFailed(error));
            }
        }
    });
}

fn scan_media(
    repository: Repository,
    roots: &[PathBuf],
    events: &mpsc::Sender<AppEvent>,
) -> Result<(ScanSummary, Vec<MediaItem>), String> {
    let now = unix_timestamp_ms();
    let mut summary = ScanSummary::default();
    let mut seen_paths = Vec::new();

    for root in roots {
        if !root.is_dir() {
            let _ = events.send(AppEvent::Log(format!(
                "skip missing folder: {}",
                root.display()
            )));
            continue;
        }

        for entry in WalkDir::new(root).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    let _ = events.send(AppEvent::Log(format!("scan warning: {error}")));
                    continue;
                }
            };

            if !entry.file_type().is_file() || !is_video_file(entry.path()) {
                continue;
            }

            let media_file = match media_file_from_path(entry.path()) {
                Ok(file) => file,
                Err(error) => {
                    let _ = events.send(AppEvent::Log(error));
                    continue;
                }
            };

            seen_paths.push(media_file.path.clone());
            summary.scanned_files += 1;
            match repository.upsert_scanned_media(&media_file, now) {
                Ok(ScanUpsertStatus::Added) => summary.added += 1,
                Ok(ScanUpsertStatus::Modified) => summary.modified += 1,
                Ok(ScanUpsertStatus::Restored) => summary.restored += 1,
                Ok(ScanUpsertStatus::Unchanged) => summary.unchanged += 1,
                Err(error) => return Err(error.to_string()),
            }

            if summary.scanned_files % 10 == 0 {
                let indexed =
                    summary.added + summary.modified + summary.restored + summary.unchanged;
                let _ = events.send(AppEvent::ScanProgress {
                    scanned: summary.scanned_files,
                    indexed,
                });
            }
        }
    }

    summary.deleted = repository
        .mark_missing_under_roots(roots, &seen_paths, now)
        .map_err(|error| error.to_string())?;
    let media = repository
        .list_media(false)
        .map_err(|error| error.to_string())?;

    Ok((summary, media))
}

fn media_file_from_path(path: &Path) -> Result<MediaFile, String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("failed to read metadata for {}: {error}", path.display()))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();

    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(MediaFile {
        path: canonical,
        file_name,
        file_size: metadata.len(),
        modified_at,
        file_hash: None,
    })
}

fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mkv" | "mp4" | "avi" | "mov" | "webm"
            )
        })
        .unwrap_or(false)
}

pub fn unix_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
