use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::{ConfigStore, DandanplayConfig};
use crate::domain::{
    DanmakuMatch, MediaItem, UiCandidateData, UiMediaCardData, UiSubjectDetailData, WatchProgress,
};
use crate::error::{AppError, AppResult};
use crate::metadata::bangumi::BangumiProvider;
use crate::metadata::cache::ImageCache;
use crate::repository::Repository;
use crate::task::{self, AppEvent};

#[derive(Clone)]
pub struct MediaService {
    config: Arc<ConfigStore>,
    repository: Repository,
    events: mpsc::Sender<AppEvent>,
}

#[derive(Debug, Clone, Copy)]
pub struct SettingsFlags {
    pub bangumi_enabled: bool,
    pub bangumi_auto_match: bool,
    pub bangumi_cache_images: bool,
    pub dandanplay_configured: bool,
}

impl MediaService {
    pub fn new(
        config: Arc<ConfigStore>,
        repository: Repository,
        events: mpsc::Sender<AppEvent>,
    ) -> Self {
        Self {
            config,
            repository,
            events,
        }
    }

    pub fn add_library_path(&self, path: PathBuf) -> AppResult<Vec<PathBuf>> {
        let paths = self.config.add_media_library(path)?;
        self.send_log(format!("media library paths: {}", paths.len()));
        Ok(paths)
    }

    pub fn list_media(&self) -> AppResult<Vec<MediaItem>> {
        self.repository.list_media(false)
    }

    pub fn list_media_cards(&self) -> AppResult<Vec<UiMediaCardData>> {
        self.repository.list_media_cards()
    }

    pub fn library_counts(&self) -> AppResult<(usize, usize, usize)> {
        self.repository.library_counts()
    }

    pub fn settings_summary(&self, indexed_media_count: usize) -> String {
        let config = self.config.snapshot();
        let dandanplay_status =
            if config.dandanplay.app_id.is_empty() || config.dandanplay.app_secret.is_empty() {
                "not configured"
            } else {
                "configured"
            };
        let media_libraries = if config.media_libraries.is_empty() {
            "(none)".to_string()
        } else {
            config
                .media_libraries
                .iter()
                .map(|path| format!("- {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let bangumi_auth = if config.bangumi.access_token.trim().is_empty() {
            "anonymous"
        } else {
            "token configured"
        };
        let bangumi_enabled = if config.bangumi.enabled {
            "enabled"
        } else {
            "disabled"
        };

        format!(
            "database: {}\ncache: {}\nindexed media: {}\ndandanplay: {}\nbangumi: {}\nbangumi base_url: {}\nbangumi auth: {}\nbangumi auto_match: {}\nbangumi cache_images: {}\nmedia libraries:\n{}",
            config.database.path.display(),
            image_cache_root(&config.database.path).display(),
            indexed_media_count,
            dandanplay_status,
            bangumi_enabled,
            config.bangumi.base_url,
            bangumi_auth,
            config.bangumi.auto_match,
            config.bangumi.cache_images,
            media_libraries
        )
    }

    pub fn settings_flags(&self) -> SettingsFlags {
        let config = self.config.snapshot();
        SettingsFlags {
            bangumi_enabled: config.bangumi.enabled,
            bangumi_auto_match: config.bangumi.auto_match,
            bangumi_cache_images: config.bangumi.cache_images,
            dandanplay_configured: !config.dandanplay.app_id.trim().is_empty()
                && !config.dandanplay.app_secret.trim().is_empty(),
        }
    }

    pub fn open_media(&self, media: &MediaItem) -> AppResult<()> {
        if media.deleted_at.is_some() || !media.path.is_file() {
            return Err(AppError::MediaNotFound);
        }
        if media.match_ignored {
            self.send_log(format!(
                "opening media with ignored metadata match: {}",
                media.file_name
            ));
        }

        open_with_default_player(&media.path)?;
        self.send_log(format!(
            "opened media with default player: {}",
            media.file_name
        ));
        Ok(())
    }

    pub fn start_scan(&self) {
        let roots = self.config.snapshot().media_libraries;
        if roots.is_empty() {
            self.send_log("no media library paths configured".to_string());
            return;
        }

        task::spawn_media_scan(self.repository.clone(), roots, self.events.clone());
    }

    fn send_log(&self, message: String) {
        let _ = self.events.send(AppEvent::Log(message));
    }
}

#[derive(Clone)]
pub struct MetadataService {
    config: Arc<ConfigStore>,
    repository: Repository,
    danmaku: DanmakuService,
    image_cache: ImageCache,
    events: mpsc::Sender<AppEvent>,
    running: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl MetadataService {
    pub fn new(
        config: Arc<ConfigStore>,
        repository: Repository,
        danmaku: DanmakuService,
        database_path: PathBuf,
        events: mpsc::Sender<AppEvent>,
    ) -> AppResult<Self> {
        Ok(Self {
            config,
            repository,
            danmaku,
            image_cache: ImageCache::new(image_cache_root(&database_path))?,
            events,
            running: Arc::new(Mutex::new(std::collections::HashSet::new())),
        })
    }

    pub fn subject_detail_for_media(&self, media_id: i64) -> AppResult<UiSubjectDetailData> {
        self.repository.subject_detail_for_media(media_id)
    }

    pub fn start_match_media(&self, media_id: i64) {
        let key = format!("match:{media_id}");
        if !self.try_start(&key) {
            let _ = self.events.send(AppEvent::Log(format!(
                "metadata match already running for #{media_id}"
            )));
            return;
        }

        match self.repository.get_media(media_id) {
            Ok(Some(media)) => {
                let _ = self
                    .repository
                    .clear_media_match_ignore(media_id, task::unix_timestamp_ms());
                let Some(provider) = self.provider_or_log() else {
                    self.finish(&key);
                    return;
                };
                let repository = self.repository.clone();
                let events = self.events.clone();
                let danmaku = self.danmaku.clone();
                let image_cache = self.image_cache.clone();
                let use_dandanplay = self.dandanplay_configured();
                std::thread::spawn(move || {
                    let danmaku_hint = if use_dandanplay {
                        match danmaku.cached_or_match_dandanplay(&media) {
                            Ok(result) => result,
                            Err(error) => {
                                let _ = events.send(AppEvent::Log(format!(
                                    "dandanplay hint unavailable for {}: {error}",
                                    media.file_name
                                )));
                                None
                            }
                        }
                    } else {
                        match danmaku.cached_dandanplay(&media) {
                            Ok(Some(result)) => Some(result),
                            Ok(None) => {
                                let _ = events.send(AppEvent::Log(
                                    "dandanplay hint skipped; app_id/app_secret are not configured"
                                        .to_string(),
                                ));
                                None
                            }
                            Err(error) => {
                                let _ = events.send(AppEvent::Log(format!(
                                    "dandanplay cache unavailable for {}: {error}",
                                    media.file_name
                                )));
                                None
                            }
                        }
                    };
                    task::spawn_match_metadata(
                        repository,
                        provider,
                        image_cache,
                        media,
                        danmaku_hint,
                        events,
                    );
                });
            }
            Ok(None) => {
                self.finish(&key);
                let _ = self.events.send(AppEvent::MetadataFailed {
                    target_id: media_id,
                    error: "media not found".to_string(),
                });
            }
            Err(error) => {
                self.finish(&key);
                let _ = self.events.send(AppEvent::MetadataFailed {
                    target_id: media_id,
                    error: error.to_string(),
                });
            }
        }
    }

    pub fn start_match_all_unmatched(&self) {
        let key = "match-all".to_string();
        if !self.try_start(&key) {
            let _ = self.events.send(AppEvent::Log(
                "metadata match-all already running".to_string(),
            ));
            return;
        }

        let Some(provider) = self.provider_or_log() else {
            self.finish(&key);
            return;
        };

        let danmaku = self.danmaku.clone();
        let use_dandanplay = self.dandanplay_configured();
        if !use_dandanplay {
            let _ = self.events.send(AppEvent::Log(
                "dandanplay hints skipped for match-all; app_id/app_secret are not configured"
                    .to_string(),
            ));
        }
        task::spawn_match_all_unmatched(
            self.repository.clone(),
            provider,
            self.image_cache.clone(),
            move |media| {
                if use_dandanplay {
                    danmaku
                        .cached_or_match_dandanplay(media)
                        .map_err(|error| error.to_string())
                } else {
                    danmaku
                        .cached_dandanplay(media)
                        .map_err(|error| error.to_string())
                }
            },
            self.events.clone(),
        );
    }

    pub fn start_auto_match_after_scan(&self) {
        let config = self.config.snapshot().bangumi;
        if !config.enabled || !config.auto_match {
            let _ = self.events.send(AppEvent::Log(
                "auto metadata match skipped by Bangumi config".to_string(),
            ));
            return;
        }

        let _ = self.events.send(AppEvent::MetadataStatus(
            "Auto metadata match queued".to_string(),
        ));
        self.start_match_all_unmatched();
    }

    pub fn start_download_subject_images(&self, subject_id: i64) {
        let key = format!("images:{subject_id}");
        if !self.try_start(&key) {
            return;
        }
        let Some(provider) = self.provider_or_log() else {
            self.finish(&key);
            return;
        };
        task::spawn_download_subject_images(
            self.repository.clone(),
            provider,
            self.image_cache.clone(),
            subject_id,
            self.events.clone(),
        );
    }

    pub fn confirm_media_candidate(&self, media_id: i64, candidate_id: i64) -> AppResult<()> {
        let provider = self.provider()?;
        let subject_id = task::confirm_candidate_and_fetch(
            self.repository.clone(),
            provider,
            self.image_cache.clone(),
            media_id,
            candidate_id,
        )?;
        let _ = self.events.send(AppEvent::SubjectUpdated { subject_id });
        Ok(())
    }

    pub fn ui_candidates(&self, media_id: i64) -> AppResult<Vec<UiCandidateData>> {
        self.repository.ui_candidates_for_media(media_id)
    }

    pub fn select_candidate(&self, media_id: i64, candidate_id: i64) -> AppResult<()> {
        self.repository
            .select_candidate(media_id, candidate_id, task::unix_timestamp_ms())
    }

    pub fn ignore_media_match(&self, media_id: i64) -> AppResult<()> {
        self.repository
            .ignore_media_match(media_id, task::unix_timestamp_ms())?;
        let _ = self.events.send(AppEvent::MetadataStatus(format!(
            "media #{media_id} ignored for metadata matching"
        )));
        Ok(())
    }

    pub fn tentative_count(&self) -> AppResult<usize> {
        self.repository.tentative_count()
    }

    pub fn test_bangumi_connection(&self) {
        match self
            .provider()
            .and_then(|provider| provider.test_connection())
        {
            Ok(()) => {
                let _ = self.events.send(AppEvent::Log(
                    "bangumi connection ok; public API is reachable".to_string(),
                ));
                let _ = self.events.send(AppEvent::MetadataStatus(
                    "Bangumi connection ok".to_string(),
                ));
            }
            Err(error) => {
                let _ = self.events.send(AppEvent::MetadataFailed {
                    target_id: 0,
                    error: error.to_string(),
                });
            }
        }
    }

    pub fn finish_for_event(&self, event: &AppEvent) {
        match event {
            AppEvent::MetadataMatchFinished { media_id, .. } => {
                self.finish(&format!("match:{media_id}"))
            }
            AppEvent::MetadataFailed { target_id: 0, .. } => self.finish("match-all"),
            AppEvent::MetadataFailed {
                target_id: media_id,
                ..
            } => self.finish(&format!("match:{media_id}")),
            AppEvent::MetadataMatchProgress { processed, total } if processed == total => {
                self.finish("match-all")
            }
            AppEvent::SubjectUpdated { subject_id } | AppEvent::ImageCached { subject_id, .. } => {
                self.finish(&format!("images:{subject_id}"))
            }
            _ => {}
        }
    }

    fn try_start(&self, key: &str) -> bool {
        self.running
            .lock()
            .expect("metadata running mutex poisoned")
            .insert(key.to_string())
    }

    fn finish(&self, key: &str) {
        self.running
            .lock()
            .expect("metadata running mutex poisoned")
            .remove(key);
    }

    fn provider(&self) -> AppResult<BangumiProvider> {
        let config = self.config.snapshot().bangumi;
        BangumiProvider::new(config)
    }

    fn provider_or_log(&self) -> Option<BangumiProvider> {
        match self.provider() {
            Ok(provider) => Some(provider),
            Err(error) => {
                let _ = self.events.send(AppEvent::MetadataFailed {
                    target_id: 0,
                    error: error.to_string(),
                });
                None
            }
        }
    }

    fn dandanplay_configured(&self) -> bool {
        let config = self.config.snapshot().dandanplay;
        !config.app_id.trim().is_empty() && !config.app_secret.trim().is_empty()
    }
}

fn image_cache_root(database_path: &std::path::Path) -> PathBuf {
    database_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("data"))
        .join("cache")
        .join("images")
}

fn open_with_default_player(path: &PathBuf) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::OpenMedia(error.to_string()))
}

#[derive(Clone)]
pub struct WatchHistoryService {
    repository: Repository,
    events: mpsc::Sender<AppEvent>,
}

impl WatchHistoryService {
    pub fn new(repository: Repository, events: mpsc::Sender<AppEvent>) -> Self {
        Self { repository, events }
    }

    pub fn load(&self, media_id: i64) -> AppResult<Option<WatchProgress>> {
        self.repository.get_progress(media_id)
    }

    pub fn save_test_progress(&self, media_id: i64) -> AppResult<WatchProgress> {
        let now = task::unix_timestamp_ms();
        let position_ms = 15 * 60 * 1000;
        let duration_ms = 24 * 60 * 1000;
        self.repository
            .save_progress(media_id, position_ms, duration_ms, now)?;

        let progress = WatchProgress {
            media_id,
            position_ms,
            duration_ms,
            updated_at: now,
        };
        let _ = self.events.send(AppEvent::Log(format!(
            "saved test progress for media #{media_id}: {position_ms}/{duration_ms} ms"
        )));
        Ok(progress)
    }

    pub fn clear(&self, media_id: i64) -> AppResult<()> {
        self.repository.clear_progress(media_id)?;
        let _ = self.events.send(AppEvent::Log(format!(
            "cleared progress for media #{media_id}"
        )));
        Ok(())
    }
}

#[derive(Clone)]
pub struct DanmakuService {
    config: Arc<ConfigStore>,
    repository: Repository,
    client: Client,
    events: mpsc::Sender<AppEvent>,
}

impl DanmakuService {
    pub fn new(
        config: Arc<ConfigStore>,
        repository: Repository,
        events: mpsc::Sender<AppEvent>,
    ) -> AppResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("slint-bangumi/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            config,
            repository,
            client,
            events,
        })
    }

    pub fn load_for_media(&self, media: &MediaItem) {
        let _ = self.events.send(AppEvent::Log(format!(
            "loading danmaku for {}",
            media.file_name
        )));

        match self.match_dandanplay(media) {
            Ok(result) => {
                if let Err(error) = self.repository.upsert_danmaku_match(
                    media.id,
                    &result,
                    task::unix_timestamp_ms(),
                ) {
                    let _ = self
                        .events
                        .send(AppEvent::Log(format!("danmaku cache failed: {error}")));
                }
                let _ = self.events.send(AppEvent::DanmakuMatched(result));
            }
            Err(error) => {
                let _ = self
                    .events
                    .send(AppEvent::Log(format!("danmaku load failed: {error}")));
            }
        }
    }

    pub fn cached_or_match_dandanplay(&self, media: &MediaItem) -> AppResult<Option<DanmakuMatch>> {
        if let Some(result) = self.repository.danmaku_match_for_media(media.id)? {
            return Ok(Some(result));
        }

        let result = self.match_dandanplay(media)?;
        self.repository
            .upsert_danmaku_match(media.id, &result, task::unix_timestamp_ms())?;
        Ok(Some(result))
    }

    pub fn cached_dandanplay(&self, media: &MediaItem) -> AppResult<Option<DanmakuMatch>> {
        self.repository.danmaku_match_for_media(media.id)
    }

    pub fn match_dandanplay(&self, media: &MediaItem) -> AppResult<DanmakuMatch> {
        if media.deleted_at.is_some() {
            return Err(AppError::MediaNotFound);
        }
        let config = self.config.snapshot().dandanplay;
        validate_dandanplay_config(&config)?;

        let match_result = self.match_episode(media, &config)?;
        let comment_count = self.fetch_comment_count(match_result.episode_id, &config)?;

        Ok(DanmakuMatch {
            provider: "dandanplay".to_string(),
            title: match_title(&match_result).unwrap_or_else(|| media.file_name.clone()),
            anime_id: Some(match_result.anime_id),
            episode_id: Some(match_result.episode_id),
            anime_title: match_result.anime_title.clone(),
            episode: match_result.episode_title,
            comment_count,
            exact: match_result.is_matched,
        })
    }

    fn match_episode(
        &self,
        media: &MediaItem,
        config: &DandanplayConfig,
    ) -> AppResult<MatchResult> {
        let path = "/api/v2/match";
        let url = format!("{DANDANPLAY_BASE_URL}{path}");
        let file_name = media
            .path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(&media.file_name)
            .to_string();

        let request = MatchRequest {
            file_name: Some(file_name),
            file_hash: media.file_hash.clone(),
            file_size: media.file_size as i64,
            video_duration: 0,
            match_mode: if media.file_hash.is_some() {
                "hashAndFileName"
            } else {
                "fileNameOnly"
            },
        };

        let response = self
            .signed_headers(self.client.post(url).json(&request), path, config)
            .send()?;
        let status = response.status();
        if !status.is_success() {
            let error = response
                .headers()
                .get("X-Error-Message")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(status.as_str())
                .to_string();
            return Err(AppError::Api(format!("dandanplay match rejected: {error}")));
        }

        let response = response.json::<MatchResponse>()?;
        ensure_api_success(
            response.success,
            response.error_code,
            response.error_message,
        )?;

        let exact = response.is_matched.unwrap_or(false);
        let mut matches = response.matches.unwrap_or_default();
        if matches.is_empty() {
            return Err(AppError::Api("dandanplay returned no matches".to_string()));
        }

        let mut best = matches.remove(0);
        best.is_matched = exact;
        Ok(best)
    }

    fn fetch_comment_count(&self, episode_id: i64, config: &DandanplayConfig) -> AppResult<usize> {
        let path = format!("/api/v2/comment/{episode_id}");
        let url = format!("{DANDANPLAY_BASE_URL}{path}");
        let response = self
            .signed_headers(
                self.client.get(url).query(&[
                    ("from", "0"),
                    ("withRelated", "true"),
                    ("chConvert", "1"),
                ]),
                &path,
                config,
            )
            .send()?;
        let status = response.status();
        if !status.is_success() {
            let error = response
                .headers()
                .get("X-Error-Message")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(status.as_str())
                .to_string();
            return Err(AppError::Api(format!(
                "dandanplay comment request rejected: {error}"
            )));
        }

        let response = response.json::<CommentResponse>()?;
        Ok(response
            .comments
            .map(|comments| comments.len())
            .unwrap_or(response.count.max(0) as usize))
    }

    fn signed_headers(
        &self,
        request: RequestBuilder,
        path: &str,
        config: &DandanplayConfig,
    ) -> RequestBuilder {
        let timestamp = unix_timestamp_secs();
        request
            .header("X-AppId", config.app_id.as_str())
            .header("X-Timestamp", timestamp.to_string())
            .header(
                "X-Signature",
                dandanplay_signature(&config.app_id, timestamp, path, &config.app_secret),
            )
    }
}

const DANDANPLAY_BASE_URL: &str = "https://api.dandanplay.net";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchRequest<'a> {
    file_name: Option<String>,
    file_hash: Option<String>,
    file_size: i64,
    video_duration: i32,
    match_mode: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchResponse {
    success: bool,
    error_code: i32,
    error_message: Option<String>,
    is_matched: Option<bool>,
    matches: Option<Vec<MatchResult>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchResult {
    episode_id: i64,
    anime_id: i64,
    anime_title: Option<String>,
    episode_title: Option<String>,
    #[serde(default)]
    is_matched: bool,
}

#[derive(Debug, Deserialize)]
struct CommentResponse {
    count: i32,
    comments: Option<Vec<CommentData>>,
}

#[derive(Debug, Deserialize)]
struct CommentData {
    #[allow(dead_code)]
    cid: i64,
}

fn validate_dandanplay_config(config: &DandanplayConfig) -> AppResult<()> {
    if config.app_id.trim().is_empty() || config.app_secret.trim().is_empty() {
        return Err(AppError::Config(
            "dandanplay app_id and app_secret are required".to_string(),
        ));
    }
    Ok(())
}

fn ensure_api_success(
    success: bool,
    error_code: i32,
    error_message: Option<String>,
) -> AppResult<()> {
    if success && error_code == 0 {
        return Ok(());
    }

    Err(AppError::Api(format!(
        "dandanplay error {error_code}: {}",
        error_message.unwrap_or_else(|| "unknown error".to_string())
    )))
}

fn match_title(result: &MatchResult) -> Option<String> {
    match (&result.anime_title, &result.episode_title) {
        (Some(anime), Some(episode)) if !anime.is_empty() && !episode.is_empty() => {
            Some(format!("{anime} - {episode}"))
        }
        (Some(anime), _) if !anime.is_empty() => Some(anime.clone()),
        (_, Some(episode)) if !episode.is_empty() => Some(episode.clone()),
        _ => None,
    }
}

fn dandanplay_signature(app_id: &str, timestamp: i64, path: &str, app_secret: &str) -> String {
    let data = format!("{app_id}{timestamp}{path}{app_secret}");
    BASE64_STANDARD.encode(Sha256::digest(data.as_bytes()))
}

fn unix_timestamp_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod dandanplay_tests {
    use super::*;

    #[test]
    fn signs_request_like_official_algorithm() {
        assert_eq!(
            dandanplay_signature("app", 1, "/api/v2/match", "secret"),
            "bhmxR4cp1CqSfgXiWkbRGGR1QtkhNnR7qvyB1CBFbRA="
        );
    }
}
