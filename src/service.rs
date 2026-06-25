use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, mpsc};

use crate::config::{AppConfig, ConfigStore};
use crate::domain::{
    DanmakuMatch, MediaItem, UiCandidateData, UiMediaCardData, UiSubjectDetailData,
};
use crate::error::{AppError, AppResult};
use crate::metadata::bangumi::BangumiProvider;
use crate::metadata::cache::ImageCache;
use crate::metadata::provider::{MetadataProvider, SubjectDetail};
use crate::repository::Repository;
use crate::task::{self, AppEvent};

mod catalog;
mod danmaku;
mod watch_history;

pub use catalog::{CatalogService, CatalogSubjectData, DownloadTaskData, EpisodeResourceData};
pub use danmaku::DanmakuService;
pub use watch_history::WatchHistoryService;

#[derive(Debug, Clone, Copy)]
struct SubjectResolution {
    subject_id: i64,
    episode_count: usize,
}

#[derive(Clone)]
pub struct MediaService {
    config: Arc<ConfigStore>,
    repository: Repository,
    events: mpsc::Sender<AppEvent>,
}

#[derive(Debug, Clone, Copy, Serialize)]
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

    pub fn list_series_cards(&self) -> AppResult<Vec<crate::domain::UiSeriesCardData>> {
        self.repository.list_series_cards()
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

    pub fn config_snapshot(&self) -> AppConfig {
        self.config.snapshot()
    }

    pub fn replace_config(&self, config: AppConfig) -> AppResult<AppConfig> {
        self.config.replace(config)
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

    pub fn open_media_by_id(&self, media_id: i64) -> AppResult<()> {
        let media = self
            .repository
            .get_media(media_id)?
            .ok_or(AppError::MediaNotFound)?;
        self.open_media(&media)
    }

    pub fn playback_media_by_id(&self, media_id: i64) -> AppResult<MediaItem> {
        let media = self
            .repository
            .get_media(media_id)?
            .ok_or(AppError::MediaNotFound)?;
        if media.deleted_at.is_some() || !media.path.is_file() {
            return Err(AppError::MediaNotFound);
        }
        Ok(media)
    }

    pub fn start_scan(&self) {
        let roots = self.config.snapshot().media_libraries;
        if roots.is_empty() {
            self.send_log("no media library paths configured".to_string());
            return;
        }

        task::spawn_media_scan(self.repository.clone(), roots, self.events.clone());
    }

    pub fn scan_now(&self) -> AppResult<crate::domain::ScanSummary> {
        let roots = self.config.snapshot().media_libraries;
        if roots.is_empty() {
            self.send_log("no media library paths configured".to_string());
            return Ok(crate::domain::ScanSummary::default());
        }

        let _ = self.events.send(AppEvent::ScanStarted);
        self.send_log(format!("scan started for {} folder(s)", roots.len()));
        let (summary, _) = task::scan_media_blocking(self.repository.clone(), &roots, &self.events)
            .map_err(AppError::Api)?;
        let media = self.repository.list_media(false)?;
        let _ = self.events.send(AppEvent::ScanFinished {
            summary: summary.clone(),
            media,
        });
        Ok(summary)
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

    pub fn refresh_subject_blocking(&self, subject_id: i64) -> AppResult<()> {
        let subject = self
            .repository
            .get_subject(subject_id)?
            .ok_or_else(|| AppError::Api(format!("subject #{subject_id} not found")))?;
        if subject.provider != "bangumi" {
            return Err(AppError::Api(format!(
                "metadata refresh is only supported for Bangumi subjects, got {}",
                subject.provider
            )));
        }
        let provider = self.provider()?;
        let detail = provider.get_subject(&subject.provider_subject_id)?;
        self.upsert_subject_detail_with_children(&provider, &detail)?;
        let _ = self.events.send(AppEvent::SubjectUpdated { subject_id });
        Ok(())
    }

    pub fn scrape_library_blocking(&self) -> AppResult<usize> {
        let media = self.repository.metadata_scrape_targets()?;
        if media.is_empty() {
            return Ok(0);
        }

        let provider = self.provider()?;
        let mut groups = std::collections::BTreeMap::<i64, Vec<(MediaItem, DanmakuMatch)>>::new();
        let mut scraped = 0;
        let total = media.len();

        for (index, item) in media.into_iter().enumerate() {
            let _ = self.events.send(AppEvent::MetadataMatchProgress {
                processed: index,
                total,
            });
            match self.danmaku.cached_or_match_dandanplay(&item) {
                Ok(Some(match_result)) if match_result.exact => {
                    if crate::metadata::matcher::is_supplemental_video(&item.file_name)
                        && !is_exact_dandanplay_feature(&match_result)
                    {
                        let _ = self.events.send(AppEvent::Log(format!(
                            "skip supplemental video for automatic episode binding: #{} {}",
                            item.id, item.file_name
                        )));
                        continue;
                    }
                    if let Some(anime_id) = match_result.anime_id {
                        groups
                            .entry(anime_id)
                            .or_default()
                            .push((item, match_result));
                    }
                }
                Ok(Some(_)) | Ok(None) => {
                    let _ = self.events.send(AppEvent::Log(format!(
                        "skip non-exact dandanplay match for media #{} ({})",
                        item.id, item.file_name
                    )));
                }
                Err(error) => {
                    let _ = self.events.send(AppEvent::Log(format!(
                        "skip dandanplay match failure for {}: {error}",
                        item.file_name
                    )));
                }
            }
        }

        for (anime_id, items) in groups {
            let group_resolution = match self
                .resolve_bangumi_subject_for_dandanplay_group(&provider, anime_id, &items)
            {
                Ok(resolution) => resolution,
                Err(error) => {
                    let _ = self.events.send(AppEvent::Log(format!(
                        "skip bangumi resolution for dandanplay anime #{anime_id}: {error}"
                    )));
                    continue;
                }
            };
            let resolve_items_individually =
                should_resolve_dandanplay_items_individually(&items, group_resolution);
            for (media, danmaku) in items {
                let subject_id = if resolve_items_individually {
                    self.resolve_bangumi_subject_for_dandanplay_item(
                        &provider, anime_id, &media, &danmaku,
                    )
                    .map(|resolution| resolution.subject_id)
                    .unwrap_or_else(|error| {
                        let _ = self.events.send(AppEvent::Log(format!(
                            "fallback to grouped subject for {}: {error}",
                            media.file_name
                        )));
                        group_resolution.subject_id
                    })
                } else {
                    group_resolution.subject_id
                };
                let now = task::unix_timestamp_ms();
                if let Err(error) = self.repository.replace_media_subject_link(
                    media.id,
                    subject_id,
                    if resolve_items_individually {
                        "dandanplay_episode_mapping"
                    } else {
                        "dandanplay_anime_mapping"
                    },
                    if danmaku.exact { 0.98 } else { 0.78 },
                    true,
                    now,
                ) {
                    let _ = self.events.send(AppEvent::Log(format!(
                        "failed to link subject for {}: {error}",
                        media.file_name
                    )));
                    continue;
                }
                if let Err(error) = self.repository.link_media_episode_by_number(
                    media.id,
                    subject_id,
                    episode_number_from_danmaku(&danmaku),
                    danmaku.episode.as_deref(),
                    if danmaku.exact { 0.98 } else { 0.78 },
                    now,
                ) {
                    let _ = self.events.send(AppEvent::Log(format!(
                        "failed to link episode for {}: {error}",
                        media.file_name
                    )));
                    continue;
                }
                scraped += 1;
            }
        }

        let _ = self.events.send(AppEvent::MetadataMatchProgress {
            processed: total,
            total,
        });
        let _ = self.events.send(AppEvent::Log(format!(
            "metadata scrape finished: {scraped}/{total} media linked"
        )));
        Ok(scraped)
    }

    fn resolve_bangumi_subject_for_dandanplay_group(
        &self,
        provider: &BangumiProvider,
        anime_id: i64,
        items: &[(MediaItem, DanmakuMatch)],
    ) -> AppResult<SubjectResolution> {
        let external_id = anime_id.to_string();
        if let Some(subject_id) = self
            .repository
            .external_subject_mapping("dandanplay", &external_id)?
        {
            return Ok(SubjectResolution {
                subject_id,
                episode_count: self.repository.subject_episode_count(subject_id)?,
            });
        }

        let keyword = items
            .iter()
            .find_map(|(_, danmaku)| danmaku.anime_title.as_deref())
            .or_else(|| items.first().map(|(_, danmaku)| danmaku.title.as_str()))
            .unwrap_or("");
        let mut selected = None;
        for variant in search_keyword_variants(keyword) {
            let candidates = provider.search_subjects(&variant)?;
            if let Some(candidate) = choose_bangumi_candidate(&variant, &candidates) {
                selected = Some(candidate.provider_subject_id.clone());
                break;
            }
        }
        let Some(provider_subject_id) = selected else {
            return Err(AppError::Api(format!(
                "bangumi subject not found for dandanplay anime #{anime_id}: {keyword}"
            )));
        };

        let detail = provider.get_subject(&provider_subject_id)?;
        let resolution = self.upsert_subject_detail_with_children(provider, &detail)?;
        self.repository.upsert_external_subject_mapping(
            "dandanplay",
            &external_id,
            resolution.subject_id,
            detail.title_cn.as_deref().or(Some(detail.title.as_str())),
            task::unix_timestamp_ms(),
        )?;
        Ok(resolution)
    }

    fn resolve_bangumi_subject_for_dandanplay_item(
        &self,
        provider: &BangumiProvider,
        anime_id: i64,
        media: &MediaItem,
        danmaku: &DanmakuMatch,
    ) -> AppResult<SubjectResolution> {
        let external_id = danmaku
            .episode_id
            .map(|episode_id| episode_id.to_string())
            .unwrap_or_else(|| format!("{anime_id}:{}", media.id));
        if let Some(subject_id) = self
            .repository
            .external_subject_mapping("dandanplay_episode_v2", &external_id)?
        {
            return Ok(SubjectResolution {
                subject_id,
                episode_count: self.repository.subject_episode_count(subject_id)?,
            });
        }

        let keywords = keyword_variants_for_dandanplay_item(danmaku).unwrap_or_else(|| {
            vec![crate::metadata::matcher::keyword_for_media(
                media,
                Some(danmaku),
            )]
        });
        let mut selected = None;
        for keyword in &keywords {
            let candidates = provider.search_subjects(keyword)?;
            if let Some(candidate) = choose_bangumi_candidate(keyword, &candidates) {
                selected = Some(candidate.provider_subject_id.clone());
                break;
            }
        }
        let Some(provider_subject_id) = selected else {
            return Err(AppError::Api(format!(
                "bangumi subject not found for dandanplay episode {external_id}: {}",
                keywords.join(" | ")
            )));
        };

        let detail = provider.get_subject(&provider_subject_id)?;
        let resolution = self.upsert_subject_detail_with_children(provider, &detail)?;
        self.repository.upsert_external_subject_mapping(
            "dandanplay_episode_v2",
            &external_id,
            resolution.subject_id,
            detail.title_cn.as_deref().or(Some(detail.title.as_str())),
            task::unix_timestamp_ms(),
        )?;
        Ok(resolution)
    }

    fn upsert_subject_detail_with_children(
        &self,
        provider: &BangumiProvider,
        detail: &SubjectDetail,
    ) -> AppResult<SubjectResolution> {
        let subject_id = self
            .repository
            .upsert_subject_detail(detail, task::unix_timestamp_ms())?;
        let mut episode_count = 0;
        if let Ok(episodes) = provider.get_episodes(&detail.provider_subject_id) {
            episode_count = episodes.len();
            self.repository
                .upsert_subject_episodes(subject_id, &episodes)?;
        }
        cache_subject_images_once(
            &self.repository,
            &self.image_cache,
            subject_id,
            &detail.provider,
            [
                ("poster", detail.images.common.clone()),
                ("thumb", detail.images.common.clone()),
                ("hero", detail.images.large.clone()),
            ],
        )?;
        Ok(SubjectResolution {
            subject_id,
            episode_count,
        })
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

fn should_resolve_dandanplay_items_individually(
    items: &[(MediaItem, DanmakuMatch)],
    group_resolution: SubjectResolution,
) -> bool {
    group_resolution.episode_count <= 1
        && items.len() > 1
        && items
            .iter()
            .filter_map(|(_, danmaku)| danmaku.episode.as_deref())
            .any(|episode| !strip_episode_prefix(episode).trim().is_empty())
}

fn is_exact_dandanplay_feature(danmaku: &DanmakuMatch) -> bool {
    if danmaku.anime_id.is_none() || danmaku.episode_id.is_none() {
        return false;
    }
    let text = format!(
        "{} {} {}",
        danmaku.anime_title.as_deref().unwrap_or_default(),
        danmaku.episode.as_deref().unwrap_or_default(),
        danmaku.title
    )
    .to_ascii_lowercase();
    !["menu", "pv", "cm", "ncop", "nced", "creditless", "textless"]
        .iter()
        .any(|marker| text.contains(marker))
}

fn keyword_variants_for_dandanplay_item(danmaku: &DanmakuMatch) -> Option<Vec<String>> {
    let anime_title = danmaku
        .anime_title
        .as_deref()
        .or_else(|| danmaku.title.split(" - ").next())
        .map(str::trim)
        .filter(|title| !title.is_empty())?;
    let episode_title = danmaku
        .episode
        .as_deref()
        .map(strip_episode_prefix)
        .map(|title| title.replace(['/', '_'], " "))
        .map(|title| title.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|title| !title.is_empty())?;
    let primary = format!("{anime_title} {episode_title}");
    let mut variants = search_keyword_variants(&primary);
    if primary.contains("空之境界") {
        variants.push(primary.replace("空之境界", "空の境界"));
    }
    if episode_title.contains('の') || episode_title.contains('藍') || episode_title.contains('終')
    {
        variants.push(format!("空の境界 {episode_title}"));
    }
    if episode_title.contains("伽蓝") || episode_title.contains("终章") {
        variants.push(format!("空之境界 {episode_title}"));
    }
    variants.dedup();
    Some(variants)
}

fn search_keyword_variants(keyword: &str) -> Vec<String> {
    let mut variants = vec![keyword.trim().to_string()];
    let plain = keyword
        .replace(['/', '／', '-', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if !plain.is_empty() {
        variants.push(plain);
    }
    variants.retain(|variant| !variant.trim().is_empty());
    variants.dedup();
    variants
}

fn strip_episode_prefix(value: &str) -> String {
    let mut rest = value.trim();
    if let Some(stripped) = rest.strip_prefix('第') {
        let digit_count = stripped
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .map(char::len_utf8)
            .sum::<usize>();
        if digit_count > 0 {
            let after_digits = &stripped[digit_count..];
            if let Some(after_marker) = after_digits
                .strip_prefix('话')
                .or_else(|| after_digits.strip_prefix('話'))
            {
                rest = after_marker;
            }
        }
    } else if let Some(stripped) = rest.strip_prefix('S') {
        let digit_count = stripped
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .map(char::len_utf8)
            .sum::<usize>();
        if digit_count > 0 {
            rest = &stripped[digit_count..];
        }
    }
    rest.trim_start_matches([' ', '\t', '-', ':', '：'])
        .trim()
        .to_string()
}

fn choose_bangumi_candidate<'a>(
    keyword: &str,
    candidates: &'a [crate::metadata::provider::SubjectSearchResult],
) -> Option<&'a crate::metadata::provider::SubjectSearchResult> {
    let normalized_keyword = normalize_title(keyword);
    let tokens = significant_title_tokens(keyword);
    let keyword_has_3d = normalized_keyword.contains("3d");

    candidates
        .iter()
        .filter_map(|candidate| {
            let title = normalize_title(&candidate.title);
            let title_cn = candidate
                .title_cn
                .as_deref()
                .map(normalize_title)
                .unwrap_or_default();
            let combined = format!("{title}{title_cn}");
            if title == normalized_keyword || title_cn == normalized_keyword {
                return Some((candidate, 10_000));
            }

            let matched = tokens
                .iter()
                .filter(|token| combined.contains(token.as_str()))
                .count();
            let required = tokens
                .last()
                .map(|token| combined.contains(token.as_str()))
                .unwrap_or(true);
            if !required || (tokens.len() > 1 && matched < 2) {
                return None;
            }

            let mut score = matched as i32 * 100;
            if combined.contains("3d") && !keyword_has_3d {
                score -= 250;
            }
            Some((candidate, score))
        })
        .max_by_key(|(_, score)| *score)
        .map(|(candidate, _)| candidate)
        .or_else(|| {
            if tokens.is_empty() {
                candidates.first()
            } else {
                None
            }
        })
}

fn normalize_title(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn significant_title_tokens(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(normalize_title)
        .filter(|token| {
            !token.is_empty()
                && !matches!(
                    token.as_str(),
                    "剧场版" | "劇場版" | "movie" | "the" | "a" | "an"
                )
        })
        .collect()
}

fn episode_number_from_danmaku(danmaku: &DanmakuMatch) -> Option<f64> {
    danmaku
        .episode
        .as_deref()
        .and_then(extract_episode_number)
        .or_else(|| {
            danmaku
                .episode_id
                .map(|id| (id % 1000) as f64)
                .filter(|v| *v > 0.0)
        })
}

fn extract_episode_number(value: &str) -> Option<f64> {
    let mut digits = String::new();
    let mut started = false;
    for ch in value.chars() {
        if ch.is_ascii_digit() || (started && ch == '.') {
            started = true;
            digits.push(ch);
        } else if started {
            break;
        }
    }
    digits.parse().ok()
}

fn cache_subject_images_once<'a>(
    repository: &Repository,
    image_cache: &ImageCache,
    subject_id: i64,
    provider: &str,
    images: impl IntoIterator<Item = (&'a str, Option<String>)>,
) -> AppResult<()> {
    for (kind, url) in images {
        let Some(url) = url.filter(|url| !url.trim().is_empty()) else {
            continue;
        };
        if repository.get_image_cache(subject_id, kind)?.is_some() {
            continue;
        }
        let path = image_cache.download_subject_image(provider, subject_id, kind, &url)?;
        repository.upsert_image_cache(subject_id, kind, &url, &path, task::unix_timestamp_ms())?;
    }
    Ok(())
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
