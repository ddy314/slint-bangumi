use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::domain::{
    DanmakuMatch, MediaFile, MediaItem, MetadataCandidate, ScanSummary, ScanUpsertStatus,
};
use crate::metadata::cache::ImageCache;
use crate::metadata::provider::MetadataProvider;
use crate::repository::Repository;

const AUTO_CONFIRM_CONFIDENCE: f64 = 0.90;

#[derive(Debug, Clone)]
struct MatchOutcome {
    title: Option<String>,
    subject_id: Option<i64>,
}

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
    MetadataMatchStarted {
        media_id: i64,
    },
    MetadataMatchProgress {
        processed: usize,
        total: usize,
    },
    MetadataMatchFinished {
        media_id: i64,
        subject_id: Option<i64>,
        title: Option<String>,
    },
    SubjectUpdated {
        subject_id: i64,
    },
    ImageCached {
        subject_id: i64,
        image_kind: String,
    },
    MetadataFailed {
        target_id: i64,
        error: String,
    },
    MetadataStatus(String),
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

            let media_file = match media_file_from_path(entry.path(), &repository) {
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

fn media_file_from_path(path: &Path, repository: &Repository) -> Result<MediaFile, String> {
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
    let needs_hash = repository
        .needs_hash_update(&canonical, metadata.len(), modified_at)
        .map_err(|error| {
            format!(
                "failed to inspect media cache for {}: {error}",
                path.display()
            )
        })?;
    let file_hash = if needs_hash {
        Some(
            hash_first_16mb(path)
                .map_err(|error| format!("failed to hash {}: {error}", path.display()))?,
        )
    } else {
        None
    };
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
        file_hash,
    })
}

fn hash_first_16mb(path: &Path) -> std::io::Result<String> {
    const HASH_BYTES: u64 = 16 * 1024 * 1024;

    let mut file = File::open(path)?;
    let mut context = md5::Context::new();
    let mut remaining = HASH_BYTES;
    let mut buffer = [0_u8; 64 * 1024];

    while remaining > 0 {
        let limit = buffer.len().min(remaining as usize);
        let read = file.read(&mut buffer[..limit])?;
        if read == 0 {
            break;
        }
        context.consume(&buffer[..read]);
        remaining -= read as u64;
    }

    Ok(format!("{:x}", context.compute()))
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc;

    use crate::repository::Repository;

    use super::*;

    #[test]
    #[ignore = "requires the local /mnt/media bangumi library"]
    fn scans_real_bangumi_sample_when_available() {
        let root = PathBuf::from("/mnt/media/entertainment/bangumi/apocalpse");
        if !root.is_dir() {
            return;
        }

        let db_path = std::env::temp_dir().join(format!(
            "slint-bangumi-real-scan-{}.sqlite3",
            std::process::id()
        ));
        let _ = fs::remove_file(&db_path);
        let repository = Repository::new(db_path.clone());
        repository.init().expect("init database");
        let (events, _receiver) = mpsc::channel();

        let (summary, media) =
            scan_media(repository, &[root], &events).expect("scan real media sample");
        assert!(summary.scanned_files > 0);
        assert_eq!(summary.scanned_files, media.len());

        let _ = fs::remove_file(db_path);
    }
}

pub fn spawn_match_metadata<P>(
    repository: Repository,
    provider: P,
    image_cache: ImageCache,
    media: MediaItem,
    danmaku_hint: Option<DanmakuMatch>,
    events: mpsc::Sender<AppEvent>,
) where
    P: MetadataProvider + Send + 'static,
{
    thread::spawn(move || {
        let _ = events.send(AppEvent::MetadataMatchStarted { media_id: media.id });
        match match_one_media(&repository, &provider, &image_cache, &media, danmaku_hint) {
            Ok(outcome) => {
                let _ = events.send(AppEvent::MetadataMatchFinished {
                    media_id: media.id,
                    subject_id: outcome.subject_id,
                    title: outcome.title,
                });
            }
            Err(error) => {
                let _ = events.send(AppEvent::MetadataFailed {
                    target_id: media.id,
                    error: error.to_string(),
                });
            }
        }
    });
}

pub fn spawn_match_all_unmatched<P>(
    repository: Repository,
    provider: P,
    image_cache: ImageCache,
    hint_loader: impl Fn(&MediaItem) -> Result<Option<DanmakuMatch>, String> + Send + 'static,
    events: mpsc::Sender<AppEvent>,
) where
    P: MetadataProvider + Clone + Send + 'static,
{
    thread::spawn(move || {
        let media = match repository.unmatched_media() {
            Ok(media) => media,
            Err(error) => {
                let _ = events.send(AppEvent::MetadataFailed {
                    target_id: 0,
                    error: error.to_string(),
                });
                return;
            }
        };

        let total = media.len();
        for (index, item) in media.into_iter().enumerate() {
            let _ = events.send(AppEvent::MetadataMatchProgress {
                processed: index,
                total,
            });
            let danmaku_hint = match hint_loader(&item) {
                Ok(result) => result,
                Err(error) => {
                    let _ = events.send(AppEvent::Log(format!(
                        "dandanplay hint unavailable for {}: {error}",
                        item.file_name
                    )));
                    None
                }
            };
            match match_one_media(&repository, &provider, &image_cache, &item, danmaku_hint) {
                Ok(outcome) => {
                    let _ = events.send(AppEvent::MetadataMatchFinished {
                        media_id: item.id,
                        subject_id: outcome.subject_id,
                        title: outcome.title,
                    });
                }
                Err(error) => {
                    let _ = events.send(AppEvent::MetadataFailed {
                        target_id: item.id,
                        error: error.to_string(),
                    });
                }
            }
        }
        let _ = events.send(AppEvent::MetadataMatchProgress {
            processed: total,
            total,
        });
    });
}

pub fn spawn_download_subject_images<P>(
    repository: Repository,
    provider: P,
    image_cache: ImageCache,
    subject_id: i64,
    events: mpsc::Sender<AppEvent>,
) where
    P: MetadataProvider + Send + 'static,
{
    thread::spawn(move || {
        let result = (|| {
            let subject = repository
                .get_subject(subject_id)?
                .ok_or_else(|| crate::error::AppError::Api("subject not found".to_string()))?;
            let images = provider.get_subject_images(&subject.provider_subject_id)?;
            let cached = cache_subject_images(
                &repository,
                &image_cache,
                subject_id,
                &subject.provider,
                [
                    ("poster", images.common.or(subject.image_common)),
                    ("hero", images.large.or(subject.image_large)),
                ],
            )?;
            for image_kind in cached {
                let _ = events.send(AppEvent::ImageCached {
                    subject_id,
                    image_kind,
                });
            }
            Ok::<_, crate::error::AppError>(())
        })();

        match result {
            Ok(()) => {
                let _ = events.send(AppEvent::SubjectUpdated { subject_id });
            }
            Err(error) => {
                let _ = events.send(AppEvent::MetadataFailed {
                    target_id: subject_id,
                    error: error.to_string(),
                });
            }
        }
    });
}

fn match_one_media<P>(
    repository: &Repository,
    provider: &P,
    image_cache: &ImageCache,
    media: &MediaItem,
    danmaku_hint: Option<DanmakuMatch>,
) -> crate::error::AppResult<MatchOutcome>
where
    P: MetadataProvider,
{
    let keyword = crate::metadata::matcher::keyword_for_media(media, danmaku_hint.as_ref());
    let dandanplay_exact = danmaku_hint
        .as_ref()
        .map(|hint| hint.exact)
        .unwrap_or(false);
    let candidates = provider.search_subjects(&keyword)?;
    let Some(candidate) = candidates.first() else {
        return Ok(MatchOutcome {
            title: None,
            subject_id: None,
        });
    };
    let title = display_title(candidate);

    let source = if dandanplay_exact {
        "dandanplay_exact"
    } else {
        "bangumi_search"
    };
    let saved_candidates = repository.upsert_metadata_candidates(
        media.id,
        &candidates.into_iter().take(8).collect::<Vec<_>>(),
        source,
        unix_timestamp_ms(),
    )?;

    let Some(selected) = saved_candidates.first() else {
        return Ok(MatchOutcome {
            title: Some(title),
            subject_id: None,
        });
    };
    if dandanplay_exact && selected.confidence >= AUTO_CONFIRM_CONFIDENCE {
        let subject_id = confirm_candidate_record(
            repository,
            provider,
            image_cache,
            media.id,
            selected,
            true,
            unix_timestamp_ms(),
        )?;
        return Ok(MatchOutcome {
            title: Some(title),
            subject_id: Some(subject_id),
        });
    }

    Ok(MatchOutcome {
        title: Some(title),
        subject_id: None,
    })
}

pub fn confirm_candidate_and_fetch<P>(
    repository: Repository,
    provider: P,
    image_cache: ImageCache,
    media_id: i64,
    candidate_id: i64,
) -> crate::error::AppResult<i64>
where
    P: MetadataProvider,
{
    let now = unix_timestamp_ms();
    repository.select_candidate(media_id, candidate_id, now)?;
    let candidate = repository
        .get_candidate(candidate_id)?
        .ok_or_else(|| crate::error::AppError::Api("metadata candidate not found".to_string()))?;
    confirm_candidate_record(
        &repository,
        &provider,
        &image_cache,
        media_id,
        &candidate,
        true,
        now,
    )
}

fn confirm_candidate_record<P>(
    repository: &Repository,
    provider: &P,
    image_cache: &ImageCache,
    media_id: i64,
    candidate: &MetadataCandidate,
    confirmed: bool,
    now: i64,
) -> crate::error::AppResult<i64>
where
    P: MetadataProvider,
{
    let mut subject_id = repository.upsert_subject_from_candidate(candidate, now)?;
    repository.link_media_subject(
        media_id,
        subject_id,
        &candidate.source,
        candidate.confidence,
        confirmed,
        now,
    )?;

    if let Ok(detail) = provider.get_subject(&candidate.provider_subject_id) {
        subject_id = repository.upsert_subject_detail(&detail, unix_timestamp_ms())?;
        if let Ok(episodes) = provider.get_episodes(&candidate.provider_subject_id) {
            repository.upsert_subject_episodes(subject_id, &episodes)?;
            repository.link_media_episode_by_number(
                media_id,
                subject_id,
                None,
                None,
                candidate.confidence,
                unix_timestamp_ms(),
            )?;
        }
        cache_subject_images(
            repository,
            image_cache,
            subject_id,
            &detail.provider,
            [
                ("poster", detail.images.common.clone()),
                ("thumb", detail.images.common.clone()),
                ("hero", detail.images.large.clone()),
            ],
        )?;
    } else {
        cache_subject_images(
            repository,
            image_cache,
            subject_id,
            &candidate.provider,
            [
                ("poster", candidate.image_common.clone()),
                ("thumb", candidate.image_common.clone()),
                ("hero", candidate.image_large.clone()),
            ],
        )?;
    }
    Ok(subject_id)
}

fn cache_subject_images<'a>(
    repository: &Repository,
    image_cache: &ImageCache,
    subject_id: i64,
    provider: &str,
    images: impl IntoIterator<Item = (&'a str, Option<String>)>,
) -> crate::error::AppResult<Vec<String>> {
    let mut cached = Vec::new();
    for (kind, url) in images {
        let Some(url) = url.filter(|url| !url.trim().is_empty()) else {
            continue;
        };
        if repository.get_image_cache(subject_id, kind)?.is_some() {
            continue;
        }
        let path = image_cache.download_subject_image(provider, subject_id, kind, &url)?;
        repository.upsert_image_cache(subject_id, kind, &url, &path, unix_timestamp_ms())?;
        cached.push(kind.to_string());
    }
    Ok(cached)
}

fn display_title(candidate: &crate::metadata::provider::SubjectSearchResult) -> String {
    candidate
        .title_cn
        .as_ref()
        .filter(|title| !title.is_empty())
        .unwrap_or(&candidate.title)
        .to_string()
}
