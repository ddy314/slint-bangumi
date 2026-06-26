use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::{Config as TsConfig, TS};

use crate::app::AppContext;
use crate::config::{
    AppConfig, BangumiConfig, DandanplayConfig, DatabaseConfig, LoggingConfig, NyaaConfig,
    QbittorrentConfig,
};
use crate::domain::{
    BangumiEpisodeCollection, BangumiSubjectCollection, DanmakuMode, DanmakuTrack, ScanSummary,
    UiSeriesCardData,
};
use crate::error::AppResult;
use crate::service::{
    BangumiAuthStatusData, BangumiBatchUpdateEpisodesInput, BangumiCompleteOAuthInput,
    BangumiLoginStartData, BangumiSyncSummaryData, BangumiUpdateCollectionInput,
    BangumiUpdateEpisodeInput, CatalogSubjectData, DownloadTaskData, EpisodeResourceData,
    episode_collection_label, subject_collection_label, subject_json_to_summary,
};
use crate::task::AppEvent;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BackendSnapshot {
    pub subjects: Vec<FrontendSubject>,
    pub bangumi_collections: Vec<FrontendSubject>,
    pub bangumi_auth: BangumiAuthStatusData,
    pub stats: LibraryStats,
    pub settings: FrontendSettings,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub tentative: usize,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSettings {
    pub bangumi_enabled: bool,
    pub bangumi_auto_match: bool,
    pub bangumi_cache_images: bool,
    pub dandanplay_configured: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FrontendMatchStatus {
    Matched,
    Tentative,
    Unmatched,
    Failed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSubject {
    pub id: String,
    pub media_id: i64,
    pub subject_id: i64,
    pub source: String,
    pub provider: String,
    pub provider_subject_id: String,
    pub local: bool,
    pub aliases: Vec<String>,
    pub title: String,
    pub title_cn: String,
    pub year: i32,
    pub air_date: String,
    pub rating: f64,
    pub rank: i64,
    pub tags: Vec<String>,
    pub summary: String,
    pub poster: String,
    pub hero: String,
    pub status: FrontendMatchStatus,
    pub episodes: usize,
    pub watched_episodes: usize,
    #[ts(optional)]
    pub current_episode: Option<usize>,
    pub progress: f64,
    #[ts(optional)]
    pub bgm_collection_type: Option<i64>,
    pub bgm_collection_label: String,
    pub bgm_rate: i64,
    pub bgm_pending: bool,
    pub files: usize,
    pub total_size: String,
    #[ts(optional)]
    pub last_played: Option<String>,
    pub new_episode: bool,
    pub metadata_ready: bool,
    pub file_summary: String,
    pub local_files: Vec<FrontendLocalFile>,
    pub episodes_detail: Vec<FrontendEpisode>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLocalFile {
    pub media_id: i64,
    pub file_name: String,
    pub file_size: String,
    #[ts(optional)]
    pub episode: Option<usize>,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendEpisode {
    pub episode: usize,
    #[ts(optional)]
    pub bgm_episode_id: Option<i64>,
    pub title: String,
    pub title_cn: String,
    pub air_date: String,
    pub cached: bool,
    #[ts(optional)]
    pub bgm_collection_type: Option<i64>,
    pub bgm_collection_label: String,
    pub bgm_pending: bool,
    #[ts(optional)]
    pub media_id: Option<i64>,
    #[ts(optional)]
    pub file_name: Option<String>,
    #[ts(optional)]
    pub file_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendEditableSettings {
    pub media_libraries: Vec<String>,
    pub database_path: String,
    pub bangumi_enabled: bool,
    pub bangumi_base_url: String,
    pub bangumi_oauth_base_url: String,
    pub bangumi_client_id: String,
    pub bangumi_client_secret: String,
    pub bangumi_client_secret_configured: bool,
    pub bangumi_redirect_uri: String,
    pub bangumi_access_token: String,
    pub bangumi_access_token_configured: bool,
    pub bangumi_user_agent: String,
    pub bangumi_request_timeout_secs: u64,
    pub bangumi_auto_match: bool,
    pub bangumi_cache_images: bool,
    pub dandanplay_app_id: String,
    pub dandanplay_app_secret: String,
    pub dandanplay_api_key: String,
    pub nyaa_enabled: bool,
    pub nyaa_base_url: String,
    pub nyaa_category: String,
    pub qbittorrent_enabled: bool,
    pub qbittorrent_base_url: String,
    pub qbittorrent_username: String,
    pub qbittorrent_password: String,
    pub qbittorrent_save_path: String,
    pub qbittorrent_category: String,
    pub qbittorrent_tags: String,
    pub logging_level: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub summary: ScanSummary,
    pub scraped: usize,
    pub snapshot: BackendSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OpenMediaRequest {
    pub media_id: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OpenMediaResponse {
    pub opened: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaSourceRequest {
    pub media_id: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaSourceResponse {
    pub media_id: i64,
    pub file_name: String,
    pub file_size: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuTrackRequest {
    pub media_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchRequest {
    pub query: String,
    pub limit: usize,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResponse {
    pub subjects: Vec<FrontendSubject>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OnlineSubjectRequest {
    pub provider: String,
    pub provider_subject_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSubjectRequest {
    pub subject_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeResourcesRequest {
    pub subject_provider: String,
    pub provider_subject_id: String,
    pub title: String,
    pub title_cn: String,
    pub aliases: Vec<String>,
    #[ts(optional)]
    pub episode_number: Option<f64>,
    pub limit: usize,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeResourcesResponse {
    pub resources: Vec<EpisodeResourceData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StartResourceDownloadRequest {
    pub resource: EpisodeResourceData,
    pub subject_provider: String,
    pub provider_subject_id: String,
    #[ts(optional)]
    pub episode_number: Option<f64>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTasksResponse {
    pub tasks: Vec<DownloadTaskData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTaskActionRequest {
    pub task_id: i64,
    pub action: String,
    pub delete_files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProgressRequest {
    pub subject_id: i64,
    pub episode_id: i64,
    #[ts(optional)]
    pub media_id: Option<i64>,
    pub position: f64,
    pub duration: f64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FrontendDanmakuMode {
    Scroll,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FrontendDanmakuItem {
    pub id: String,
    pub time: f64,
    pub mode: FrontendDanmakuMode,
    pub color: i64,
    pub text: String,
    #[ts(optional)]
    pub user_hash: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuTrackResponse {
    pub media_id: i64,
    pub provider: String,
    pub episode_id: i64,
    pub title: String,
    pub fetched_at: i64,
    pub expires_at: i64,
    pub stale: bool,
    pub items: Vec<FrontendDanmakuItem>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum BackendEventType {
    Log,
    ScanStarted,
    ScanProgress,
    ScanFinished,
    ScanFailed,
    DanmakuMatched,
    MetadataStarted,
    MetadataProgress,
    MetadataFinished,
    SubjectUpdated,
    ImageCached,
    MetadataFailed,
    MetadataStatus,
    BangumiSyncStarted,
    BangumiSyncProgress,
    BangumiSyncFinished,
    BangumiSyncFailed,
    BangumiOAuthCompleted,
    BangumiOAuthFailed,
    DownloadCompleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BackendEvent {
    #[serde(rename = "type")]
    pub event_type: BackendEventType,
    #[ts(optional)]
    pub message: Option<String>,
    #[ts(optional)]
    pub scanned: Option<usize>,
    #[ts(optional)]
    pub indexed: Option<usize>,
    #[ts(optional)]
    pub processed: Option<usize>,
    #[ts(optional)]
    pub total: Option<usize>,
    #[ts(optional)]
    pub summary: Option<ScanSummary>,
    #[ts(optional)]
    pub media_id: Option<i64>,
    #[ts(optional)]
    pub subject_id: Option<i64>,
    #[ts(optional)]
    pub image_kind: Option<String>,
    #[ts(optional)]
    pub target_id: Option<i64>,
}

impl BackendEvent {
    fn new(event_type: BackendEventType) -> Self {
        Self {
            event_type,
            message: None,
            scanned: None,
            indexed: None,
            processed: None,
            total: None,
            summary: None,
            media_id: None,
            subject_id: None,
            image_kind: None,
            target_id: None,
        }
    }
}

pub fn settings_config(context: &AppContext) -> AppResult<FrontendEditableSettings> {
    Ok(frontend_settings_from_config(
        context.media.config_snapshot(),
    ))
}

pub fn save_settings_config(
    context: &AppContext,
    input: FrontendEditableSettings,
) -> AppResult<FrontendEditableSettings> {
    let current = context.media.config_snapshot();
    let saved = context
        .media
        .replace_config(config_from_frontend_settings(input, current))?;
    Ok(frontend_settings_from_config(saved))
}

pub fn snapshot(context: &AppContext) -> AppResult<BackendSnapshot> {
    let cards = context.media.list_series_cards()?;
    let series_count = cards.len();
    let (_, _, unmatched) = context.media.library_counts()?;
    let tentative = context.metadata.tentative_count()?;
    let flags = context.media.settings_flags();
    let bangumi_auth = context.bangumi.auth_status()?;
    let bangumi_collections = context.bangumi.cached_subject_collections()?;
    let bangumi_by_subject_id = bangumi_collections
        .iter()
        .map(|collection| (collection.subject_id, collection.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let bangumi_episodes_by_subject = context.bangumi.cached_episode_collections_by_subject()?;
    let local_subjects = cards
        .into_iter()
        .map(|card| {
            let bgm_subject_id = (card.provider == "bangumi")
                .then(|| card.provider_subject_id.parse::<i64>().ok())
                .flatten();
            let collection = bgm_subject_id
                .and_then(|subject_id| bangumi_by_subject_id.get(&subject_id).cloned());
            let episodes = bgm_subject_id
                .and_then(|subject_id| bangumi_episodes_by_subject.get(&subject_id))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            frontend_subject_from_series(card, collection.as_ref(), episodes)
        })
        .collect::<Vec<_>>();
    let local_bgm_ids = local_subjects
        .iter()
        .filter_map(|subject| subject.provider_subject_id.parse::<i64>().ok())
        .collect::<std::collections::HashSet<_>>();
    let collection_subjects = bangumi_collections
        .iter()
        .filter(|collection| !local_bgm_ids.contains(&collection.subject_id))
        .map(|collection| {
            let episodes = bangumi_episodes_by_subject
                .get(&collection.subject_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            frontend_subject_from_bangumi_collection(collection, episodes)
        })
        .collect::<Vec<_>>();

    Ok(BackendSnapshot {
        subjects: local_subjects,
        bangumi_collections: collection_subjects,
        bangumi_auth,
        stats: LibraryStats {
            total: series_count,
            matched: series_count,
            unmatched,
            tentative,
        },
        settings: FrontendSettings {
            bangumi_enabled: flags.bangumi_enabled,
            bangumi_auto_match: flags.bangumi_auto_match,
            bangumi_cache_images: flags.bangumi_cache_images,
            dandanplay_configured: flags.dandanplay_configured,
        },
    })
}

pub fn scan(context: &AppContext) -> AppResult<ScanResponse> {
    let summary = context.media.scan_now()?;
    let scraped = context.metadata.scrape_library_blocking()?;
    let snapshot = snapshot(context)?;
    Ok(ScanResponse {
        summary,
        scraped,
        snapshot,
    })
}

pub fn open_media(context: &AppContext, input: OpenMediaRequest) -> AppResult<OpenMediaResponse> {
    context.media.open_media_by_id(input.media_id)?;
    Ok(OpenMediaResponse { opened: true })
}

pub fn media_source(
    context: &AppContext,
    input: MediaSourceRequest,
) -> AppResult<MediaSourceResponse> {
    let media = context.media.playback_media_by_id(input.media_id)?;
    Ok(MediaSourceResponse {
        media_id: media.id,
        file_name: media.file_name,
        file_size: format_bytes(media.file_size),
        source_url: normalize_asset_path(&media.path.to_string_lossy()),
    })
}

pub fn danmaku_track(
    context: &AppContext,
    input: DanmakuTrackRequest,
) -> AppResult<DanmakuTrackResponse> {
    let media = context.media.playback_media_by_id(input.media_id)?;
    let track = context.danmaku.track_for_media(&media)?;
    Ok(frontend_danmaku_track_from_domain(track))
}

pub fn search_catalog(
    context: &AppContext,
    input: CatalogSearchRequest,
) -> AppResult<CatalogSearchResponse> {
    let subjects = context
        .catalog
        .search_catalog(&input.query, input.limit)?
        .into_iter()
        .map(frontend_subject_from_catalog)
        .collect();
    Ok(CatalogSearchResponse { subjects })
}

pub fn online_subject(
    context: &AppContext,
    input: OnlineSubjectRequest,
) -> AppResult<FrontendSubject> {
    context
        .catalog
        .online_subject(&input.provider, &input.provider_subject_id)
        .map(frontend_subject_from_catalog)
}

pub fn refresh_subject_metadata(
    context: &AppContext,
    input: RefreshSubjectRequest,
) -> AppResult<FrontendSubject> {
    context
        .metadata
        .refresh_subject_blocking(input.subject_id)?;
    let card = context
        .media
        .list_series_cards()?
        .into_iter()
        .find(|card| card.subject_id == input.subject_id)
        .ok_or_else(|| {
            crate::error::AppError::Api(format!(
                "refreshed subject #{} is not in the local library",
                input.subject_id
            ))
        })?;
    let bgm_subject_id = (card.provider == "bangumi")
        .then(|| card.provider_subject_id.parse::<i64>().ok())
        .flatten();
    let collection = bgm_subject_id
        .map(|subject_id| context.bangumi.cached_subject_collection(subject_id))
        .transpose()?
        .flatten();
    let episodes = bgm_subject_id
        .map(|subject_id| context.bangumi.cached_episode_collections(subject_id))
        .transpose()?
        .unwrap_or_default();
    Ok(frontend_subject_from_series(
        card,
        collection.as_ref(),
        &episodes,
    ))
}

pub fn episode_resources(
    context: &AppContext,
    input: EpisodeResourcesRequest,
) -> AppResult<EpisodeResourcesResponse> {
    Ok(EpisodeResourcesResponse {
        resources: context.catalog.search_episode_resources(
            &input.subject_provider,
            &input.provider_subject_id,
            &input.title,
            &input.title_cn,
            &input.aliases,
            input.episode_number,
            input.limit,
        )?,
    })
}

pub fn start_resource_download(
    context: &AppContext,
    input: StartResourceDownloadRequest,
) -> AppResult<DownloadTaskData> {
    context.catalog.start_resource_download(
        &input.resource,
        &input.subject_provider,
        &input.provider_subject_id,
        input.episode_number,
    )
}

pub fn download_tasks(context: &AppContext) -> AppResult<DownloadTasksResponse> {
    Ok(DownloadTasksResponse {
        tasks: context.catalog.list_download_tasks()?,
    })
}

pub fn control_download_task(
    context: &AppContext,
    input: DownloadTaskActionRequest,
) -> AppResult<DownloadTasksResponse> {
    context
        .catalog
        .control_download_task(input.task_id, &input.action, input.delete_files)?;
    download_tasks(context)
}

pub fn bangumi_auth_status(context: &AppContext) -> AppResult<BangumiAuthStatusData> {
    context.bangumi.auth_status()
}

pub fn start_bangumi_login(context: &AppContext) -> AppResult<BangumiLoginStartData> {
    context.bangumi.start_login()
}

pub fn complete_bangumi_oauth(
    context: &AppContext,
    input: BangumiCompleteOAuthInput,
) -> AppResult<BangumiAuthStatusData> {
    context.bangumi.complete_oauth(input)
}

pub fn logout_bangumi(context: &AppContext) -> AppResult<BangumiAuthStatusData> {
    context.bangumi.logout()
}

pub fn sync_bangumi_now(context: &AppContext) -> AppResult<BangumiSyncSummaryData> {
    context.bangumi.sync_all()
}

pub fn sync_bangumi_subject(
    context: &AppContext,
    input: RefreshSubjectRequest,
) -> AppResult<BangumiSyncSummaryData> {
    context.bangumi.sync_subject(input.subject_id)
}

pub fn update_bangumi_collection(
    context: &AppContext,
    input: BangumiUpdateCollectionInput,
) -> AppResult<BangumiSyncSummaryData> {
    context.bangumi.update_collection(input)
}

pub fn update_bangumi_episode(
    context: &AppContext,
    input: BangumiUpdateEpisodeInput,
) -> AppResult<BangumiSyncSummaryData> {
    context.bangumi.update_episode(input)
}

pub fn batch_update_bangumi_episodes(
    context: &AppContext,
    input: BangumiBatchUpdateEpisodesInput,
) -> AppResult<BangumiSyncSummaryData> {
    context.bangumi.batch_update_episodes(input)
}

pub fn report_playback_progress(
    context: &AppContext,
    input: PlaybackProgressRequest,
) -> AppResult<BangumiSyncSummaryData> {
    if let Some(media_id) = input.media_id {
        if input.duration.is_finite() && input.position.is_finite() && input.duration > 0.0 {
            context.watch_history.save(
                media_id,
                (input.position * 1000.0).round() as i64,
                (input.duration * 1000.0).round() as i64,
            )?;
        }
    }
    if input.subject_id > 0
        && input.episode_id > 0
        && crate::service::playback_completion_reached(input.position, input.duration)
    {
        context
            .bangumi
            .mark_playback_completed(input.subject_id, input.episode_id)
    } else {
        Ok(BangumiSyncSummaryData {
            subjects: 0,
            episodes: 0,
            queued: context.bangumi.auth_status()?.pending_sync_count,
            message: "播放进度尚未达到 Bangumi 完播阈值".to_string(),
        })
    }
}

pub fn test_qbittorrent_connection(context: &AppContext) -> ConnectionTestResponse {
    match context.catalog.test_qbittorrent_connection() {
        Ok(()) => ConnectionTestResponse {
            ok: true,
            message: "qBittorrent connection ok".to_string(),
        },
        Err(error) => ConnectionTestResponse {
            ok: false,
            message: error.to_string(),
        },
    }
}

fn frontend_subject_from_series(
    card: UiSeriesCardData,
    collection: Option<&BangumiSubjectCollection>,
    bangumi_episodes: &[BangumiEpisodeCollection],
) -> FrontendSubject {
    let display_title = if card.title_cn.trim().is_empty() {
        card.title.clone()
    } else {
        card.title_cn.clone()
    };
    let local_files = card
        .local_files
        .into_iter()
        .map(|file| FrontendLocalFile {
            media_id: file.media_id,
            file_name: file.file_name,
            file_size: format_bytes(file.file_size),
            episode: file.episode_number.map(|episode| episode.round() as usize),
            modified_at: file.modified_at,
        })
        .collect();
    let mut bgm_by_sort = std::collections::HashMap::<usize, &BangumiEpisodeCollection>::new();
    for episode in bangumi_episodes {
        if let Some(sort) = episode.sort_number {
            bgm_by_sort.insert(rounded_episode_number(sort), episode);
        }
    }
    let local_watched_episodes = card
        .episodes
        .iter()
        .filter(|episode| episode.media_id.is_some() && episode.watched)
        .count();
    let local_current_episode = card
        .episodes
        .iter()
        .filter(|episode| episode.media_id.is_some() && !episode.watched && episode.progress > 0.0)
        .map(|episode| rounded_episode_number(episode.episode_number))
        .min();
    let episodes_detail = card
        .episodes
        .into_iter()
        .map(|episode| {
            let episode_number = rounded_episode_number(episode.episode_number);
            let bgm = bgm_by_sort.get(&episode_number).copied();
            FrontendEpisode {
                episode: episode_number,
                bgm_episode_id: bgm.map(|episode| episode.episode_id),
                title: bgm
                    .and_then(|episode| episode.title.clone())
                    .unwrap_or(episode.title),
                title_cn: bgm
                    .and_then(|episode| episode.title_cn.clone())
                    .unwrap_or(episode.title_cn),
                air_date: bgm
                    .and_then(|episode| episode.air_date.clone())
                    .unwrap_or(episode.air_date),
                cached: episode.media_id.is_some(),
                bgm_collection_type: bgm.map(|episode| episode.collection_type),
                bgm_collection_label: bgm
                    .map(|episode| episode_collection_label(episode.collection_type).to_string())
                    .unwrap_or_else(|| episode_collection_label(0).to_string()),
                bgm_pending: bgm.map(|episode| episode.pending).unwrap_or(false),
                media_id: episode.media_id,
                file_name: episode.file_name,
                file_size: episode.file_size.map(format_bytes),
            }
        })
        .collect();
    let episode_total = card.episode_count.max(bangumi_episodes.len());
    let progress = if episode_total == 0 {
        0.0
    } else {
        (local_watched_episodes as f64 / episode_total as f64).clamp(0.0, 1.0)
    };
    let current_episode = local_current_episode
        .or_else(|| (local_watched_episodes < episode_total).then_some(local_watched_episodes + 1));

    FrontendSubject {
        id: format!("subject-{}", card.subject_id),
        media_id: 0,
        subject_id: card.subject_id,
        source: "local".to_string(),
        provider: card.provider,
        provider_subject_id: card.provider_subject_id,
        local: true,
        aliases: Vec::new(),
        title: display_title,
        title_cn: card.title,
        year: card
            .air_date
            .get(0..4)
            .and_then(|year| year.parse().ok())
            .unwrap_or_default(),
        air_date: card.air_date,
        rating: card.rating.unwrap_or_default(),
        rank: card.rank.unwrap_or_default(),
        tags: card.tags,
        summary: card.summary,
        poster: normalize_asset_path(&card.poster_path),
        hero: normalize_asset_path(&card.hero_path),
        status: FrontendMatchStatus::Matched,
        episodes: episode_total,
        watched_episodes: local_watched_episodes,
        current_episode,
        progress,
        bgm_collection_type: collection.map(|collection| collection.collection_type),
        bgm_collection_label: collection
            .map(|collection| subject_collection_label(collection.collection_type).to_string())
            .unwrap_or_else(|| "未标记".to_string()),
        bgm_rate: collection
            .map(|collection| collection.rate)
            .unwrap_or_default(),
        bgm_pending: collection
            .map(|collection| collection.pending)
            .unwrap_or(false),
        files: card.file_count,
        total_size: format_bytes(card.total_size),
        last_played: None,
        new_episode: false,
        metadata_ready: true,
        file_summary: card.latest_file_name,
        local_files,
        episodes_detail,
    }
}

fn frontend_subject_from_catalog(subject: CatalogSubjectData) -> FrontendSubject {
    let display_title = if subject.title_cn.trim().is_empty() {
        subject.title.clone()
    } else {
        subject.title_cn.clone()
    };
    let subject_id = subject
        .provider_subject_id
        .parse::<i64>()
        .unwrap_or_default();
    let episodes_detail: Vec<FrontendEpisode> = if subject.episode_list.is_empty() {
        (1..=subject.episodes)
            .map(|episode| FrontendEpisode {
                episode,
                bgm_episode_id: None,
                title: format!("Episode {episode}"),
                title_cn: String::new(),
                air_date: String::new(),
                cached: false,
                bgm_collection_type: None,
                bgm_collection_label: episode_collection_label(0).to_string(),
                bgm_pending: false,
                media_id: None,
                file_name: None,
                file_size: None,
            })
            .collect()
    } else {
        subject
            .episode_list
            .into_iter()
            .map(|ep| {
                let episode = rounded_episode_number(ep.sort_number);
                FrontendEpisode {
                    episode,
                    bgm_episode_id: ep.provider_episode_id.parse::<i64>().ok(),
                    title: ep.title,
                    title_cn: ep.title_cn.unwrap_or_default(),
                    air_date: ep.air_date.unwrap_or_default(),
                    cached: false,
                    bgm_collection_type: None,
                    bgm_collection_label: episode_collection_label(0).to_string(),
                    bgm_pending: false,
                    media_id: None,
                    file_name: None,
                    file_size: None,
                }
            })
            .collect()
    };
    FrontendSubject {
        id: subject.id,
        media_id: 0,
        subject_id,
        source: subject.source,
        provider: subject.provider,
        provider_subject_id: subject.provider_subject_id,
        local: subject.local,
        aliases: subject.aliases,
        title: display_title,
        title_cn: subject.title,
        year: subject
            .air_date
            .get(0..4)
            .and_then(|year| year.parse().ok())
            .unwrap_or_default(),
        air_date: subject.air_date,
        rating: subject.rating,
        rank: subject.rank,
        tags: subject.tags,
        summary: subject.summary,
        poster: normalize_asset_path(&subject.poster),
        hero: normalize_asset_path(&subject.hero),
        status: FrontendMatchStatus::Matched,
        episodes: subject.episodes,
        watched_episodes: 0,
        current_episode: None,
        progress: 0.0,
        bgm_collection_type: None,
        bgm_collection_label: "未标记".to_string(),
        bgm_rate: 0,
        bgm_pending: false,
        files: subject.files,
        total_size: String::new(),
        last_played: None,
        new_episode: false,
        metadata_ready: subject.metadata_ready,
        file_summary: if subject.local {
            "本地资料库".to_string()
        } else {
            "在线资料库".to_string()
        },
        local_files: Vec::new(),
        episodes_detail,
    }
}

fn frontend_subject_from_bangumi_collection(
    collection: &BangumiSubjectCollection,
    bangumi_episodes: &[BangumiEpisodeCollection],
) -> FrontendSubject {
    let summary = collection
        .subject_json
        .as_deref()
        .and_then(subject_json_to_summary);
    let title = summary
        .as_ref()
        .and_then(|summary| {
            summary
                .name_cn
                .clone()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| summary.as_ref().and_then(|summary| summary.name.clone()))
        .unwrap_or_else(|| format!("Bangumi #{}", collection.subject_id));
    let title_cn = summary
        .as_ref()
        .and_then(|summary| summary.name.clone())
        .unwrap_or_default();
    let poster = summary
        .as_ref()
        .and_then(|summary| summary.images.as_ref())
        .and_then(|images| {
            images
                .get("large")
                .or_else(|| images.get("common"))
                .or_else(|| images.get("medium"))
                .cloned()
        })
        .unwrap_or_default();
    let rating = summary
        .as_ref()
        .and_then(|summary| summary.rating.as_ref())
        .and_then(|rating| rating.score)
        .unwrap_or_default();
    let tags = summary
        .as_ref()
        .and_then(|summary| summary.tags.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.name)
        .collect::<Vec<_>>();
    let episode_total = summary
        .as_ref()
        .and_then(|summary| summary.total_episodes.or(summary.eps))
        .unwrap_or(bangumi_episodes.len());
    let watched_episodes = 0;
    let progress = 0.0;
    let current_episode = None;
    let episodes_detail = if bangumi_episodes.is_empty() {
        (1..=episode_total)
            .map(|episode| FrontendEpisode {
                episode,
                bgm_episode_id: None,
                title: format!("Episode {episode}"),
                title_cn: String::new(),
                air_date: String::new(),
                cached: false,
                bgm_collection_type: None,
                bgm_collection_label: episode_collection_label(0).to_string(),
                bgm_pending: false,
                media_id: None,
                file_name: None,
                file_size: None,
            })
            .collect()
    } else {
        bangumi_episodes
            .iter()
            .enumerate()
            .map(|(index, episode)| {
                let episode_number = episode
                    .sort_number
                    .map(rounded_episode_number)
                    .unwrap_or(index + 1);
                FrontendEpisode {
                    episode: episode_number,
                    bgm_episode_id: Some(episode.episode_id),
                    title: episode
                        .title
                        .clone()
                        .unwrap_or_else(|| format!("Episode {episode_number}")),
                    title_cn: episode.title_cn.clone().unwrap_or_default(),
                    air_date: episode.air_date.clone().unwrap_or_default(),
                    cached: false,
                    bgm_collection_type: Some(episode.collection_type),
                    bgm_collection_label: episode_collection_label(episode.collection_type)
                        .to_string(),
                    bgm_pending: episode.pending,
                    media_id: None,
                    file_name: None,
                    file_size: None,
                }
            })
            .collect()
    };

    FrontendSubject {
        id: format!("bangumi-collection-{}", collection.subject_id),
        media_id: 0,
        subject_id: collection.subject_id,
        source: "bangumiCollection".to_string(),
        provider: "bangumi".to_string(),
        provider_subject_id: collection.subject_id.to_string(),
        local: false,
        aliases: Vec::new(),
        title,
        title_cn,
        year: summary
            .as_ref()
            .and_then(|summary| summary.date.as_ref())
            .and_then(|date| date.get(0..4))
            .and_then(|year| year.parse().ok())
            .unwrap_or_default(),
        air_date: summary
            .as_ref()
            .and_then(|summary| summary.date.clone())
            .unwrap_or_default(),
        rating,
        rank: summary
            .as_ref()
            .and_then(|summary| summary.rank)
            .unwrap_or_default(),
        tags,
        summary: summary
            .as_ref()
            .and_then(|summary| summary.summary.clone())
            .unwrap_or_default(),
        poster: normalize_asset_path(&poster),
        hero: normalize_asset_path(&poster),
        status: FrontendMatchStatus::Matched,
        episodes: episode_total,
        watched_episodes,
        current_episode,
        progress,
        bgm_collection_type: Some(collection.collection_type),
        bgm_collection_label: subject_collection_label(collection.collection_type).to_string(),
        bgm_rate: collection.rate,
        bgm_pending: collection.pending,
        files: 0,
        total_size: String::new(),
        last_played: None,
        new_episode: false,
        metadata_ready: true,
        file_summary: "Bangumi 云端条目".to_string(),
        local_files: Vec::new(),
        episodes_detail,
    }
}

fn frontend_danmaku_track_from_domain(track: DanmakuTrack) -> DanmakuTrackResponse {
    DanmakuTrackResponse {
        media_id: track.media_id,
        provider: track.provider,
        episode_id: track.episode_id,
        title: track.title,
        fetched_at: track.fetched_at,
        expires_at: track.expires_at,
        stale: track.stale,
        items: track
            .items
            .into_iter()
            .map(|item| FrontendDanmakuItem {
                id: item.id,
                time: item.time,
                mode: match item.mode {
                    DanmakuMode::Scroll => FrontendDanmakuMode::Scroll,
                    DanmakuMode::Top => FrontendDanmakuMode::Top,
                    DanmakuMode::Bottom => FrontendDanmakuMode::Bottom,
                },
                color: item.color,
                text: item.text,
                user_hash: item.user_hash,
            })
            .collect(),
    }
}

pub fn frontend_event_from_app(event: AppEvent) -> BackendEvent {
    match event {
        AppEvent::Log(message) => BackendEvent {
            message: Some(message),
            ..BackendEvent::new(BackendEventType::Log)
        },
        AppEvent::ScanStarted => BackendEvent {
            message: Some("扫描已开始".to_string()),
            ..BackendEvent::new(BackendEventType::ScanStarted)
        },
        AppEvent::ScanProgress { scanned, indexed } => BackendEvent {
            scanned: Some(scanned),
            indexed: Some(indexed),
            message: Some(format!("已扫描 {scanned} 个文件")),
            ..BackendEvent::new(BackendEventType::ScanProgress)
        },
        AppEvent::ScanFinished { summary, .. } => BackendEvent {
            message: Some(format!("文件扫描完成：{} 个文件", summary.scanned_files)),
            summary: Some(summary),
            ..BackendEvent::new(BackendEventType::ScanFinished)
        },
        AppEvent::ScanFailed(error) => BackendEvent {
            message: Some(error),
            ..BackendEvent::new(BackendEventType::ScanFailed)
        },
        AppEvent::DanmakuMatched(match_result) => BackendEvent {
            message: Some(match_result.title),
            ..BackendEvent::new(BackendEventType::DanmakuMatched)
        },
        AppEvent::MetadataMatchStarted { media_id } => BackendEvent {
            media_id: Some(media_id),
            ..BackendEvent::new(BackendEventType::MetadataStarted)
        },
        AppEvent::MetadataMatchProgress { processed, total } => BackendEvent {
            processed: Some(processed),
            total: Some(total),
            message: Some(format!("元数据整理 {processed}/{total}")),
            ..BackendEvent::new(BackendEventType::MetadataProgress)
        },
        AppEvent::MetadataMatchFinished {
            media_id,
            subject_id,
            title,
        } => BackendEvent {
            media_id: Some(media_id),
            subject_id,
            message: Some(title.unwrap_or_else(|| format!("media #{media_id}"))),
            ..BackendEvent::new(BackendEventType::MetadataFinished)
        },
        AppEvent::SubjectUpdated { subject_id } => BackendEvent {
            subject_id: Some(subject_id),
            ..BackendEvent::new(BackendEventType::SubjectUpdated)
        },
        AppEvent::ImageCached {
            subject_id,
            image_kind,
        } => BackendEvent {
            subject_id: Some(subject_id),
            image_kind: Some(image_kind),
            ..BackendEvent::new(BackendEventType::ImageCached)
        },
        AppEvent::MetadataFailed { target_id, error } => BackendEvent {
            target_id: Some(target_id),
            message: Some(error),
            ..BackendEvent::new(BackendEventType::MetadataFailed)
        },
        AppEvent::MetadataStatus(message) => BackendEvent {
            message: Some(message),
            ..BackendEvent::new(BackendEventType::MetadataStatus)
        },
        AppEvent::BangumiSyncStarted { total, message } => BackendEvent {
            total: Some(total),
            message: Some(message),
            ..BackendEvent::new(BackendEventType::BangumiSyncStarted)
        },
        AppEvent::BangumiSyncProgress {
            processed,
            total,
            message,
        } => BackendEvent {
            processed: Some(processed),
            total: Some(total),
            message: Some(message),
            ..BackendEvent::new(BackendEventType::BangumiSyncProgress)
        },
        AppEvent::BangumiSyncFinished {
            subjects,
            episodes,
            message,
        } => BackendEvent {
            processed: Some(subjects),
            total: Some(episodes),
            message: Some(message),
            ..BackendEvent::new(BackendEventType::BangumiSyncFinished)
        },
        AppEvent::BangumiSyncFailed { error } => BackendEvent {
            message: Some(error),
            ..BackendEvent::new(BackendEventType::BangumiSyncFailed)
        },
        AppEvent::DownloadCompleted { task_id, title } => BackendEvent {
            target_id: Some(task_id),
            message: Some(format!("下载完成：{title}")),
            ..BackendEvent::new(BackendEventType::DownloadCompleted)
        },
    }
}

pub fn export_types(output_path: impl AsRef<Path>) -> AppResult<()> {
    let output_path = output_path.as_ref();
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| crate::error::io_error(parent, error))?;
    }

    let ts_config = TsConfig::default().with_large_int("number");
    let mut declarations = [
        ScanSummary::decl(&ts_config),
        LibraryStats::decl(&ts_config),
        FrontendSettings::decl(&ts_config),
        FrontendMatchStatus::decl(&ts_config),
        FrontendLocalFile::decl(&ts_config),
        FrontendEpisode::decl(&ts_config),
        FrontendSubject::decl(&ts_config),
        BackendSnapshot::decl(&ts_config),
        FrontendEditableSettings::decl(&ts_config),
        ScanResponse::decl(&ts_config),
        OpenMediaRequest::decl(&ts_config),
        OpenMediaResponse::decl(&ts_config),
        MediaSourceRequest::decl(&ts_config),
        MediaSourceResponse::decl(&ts_config),
        DanmakuTrackRequest::decl(&ts_config),
        FrontendDanmakuMode::decl(&ts_config),
        FrontendDanmakuItem::decl(&ts_config),
        DanmakuTrackResponse::decl(&ts_config),
        CatalogSubjectData::decl(&ts_config),
        EpisodeResourceData::decl(&ts_config),
        DownloadTaskData::decl(&ts_config),
        CatalogSearchRequest::decl(&ts_config),
        CatalogSearchResponse::decl(&ts_config),
        OnlineSubjectRequest::decl(&ts_config),
        RefreshSubjectRequest::decl(&ts_config),
        EpisodeResourcesRequest::decl(&ts_config),
        EpisodeResourcesResponse::decl(&ts_config),
        StartResourceDownloadRequest::decl(&ts_config),
        DownloadTasksResponse::decl(&ts_config),
        DownloadTaskActionRequest::decl(&ts_config),
        BangumiAuthStatusData::decl(&ts_config),
        BangumiLoginStartData::decl(&ts_config),
        BangumiSyncSummaryData::decl(&ts_config),
        BangumiCompleteOAuthInput::decl(&ts_config),
        BangumiUpdateCollectionInput::decl(&ts_config),
        BangumiUpdateEpisodeInput::decl(&ts_config),
        BangumiBatchUpdateEpisodesInput::decl(&ts_config),
        PlaybackProgressRequest::decl(&ts_config),
        ConnectionTestResponse::decl(&ts_config),
        BackendEventType::decl(&ts_config),
        BackendEvent::decl(&ts_config),
    ]
    .join("\n\n")
    .replace("\ntype ", "\nexport type ");
    if declarations.starts_with("type ") {
        declarations = format!("export {declarations}");
    }

    let content = format!(
        "/* eslint-disable */\n// This file is generated by `cargo run --quiet -- export-types`.\n\n{declarations}\n"
    );
    std::fs::write(output_path, content)
        .map_err(|error| crate::error::io_error(output_path, error))?;
    Ok(())
}

fn frontend_settings_from_config(config: AppConfig) -> FrontendEditableSettings {
    FrontendEditableSettings {
        media_libraries: config
            .media_libraries
            .into_iter()
            .map(|path| path.display().to_string())
            .collect(),
        database_path: config.database.path.display().to_string(),
        bangumi_enabled: config.bangumi.enabled,
        bangumi_base_url: config.bangumi.base_url,
        bangumi_oauth_base_url: config.bangumi.oauth_base_url,
        bangumi_client_id: config.bangumi.client_id,
        bangumi_client_secret: String::new(),
        bangumi_client_secret_configured: !config.bangumi.client_secret.trim().is_empty(),
        bangumi_redirect_uri: config.bangumi.redirect_uri,
        bangumi_access_token: String::new(),
        bangumi_access_token_configured: !config.bangumi.access_token.trim().is_empty(),
        bangumi_user_agent: config.bangumi.user_agent,
        bangumi_request_timeout_secs: config.bangumi.request_timeout_secs,
        bangumi_auto_match: config.bangumi.auto_match,
        bangumi_cache_images: config.bangumi.cache_images,
        dandanplay_app_id: config.dandanplay.app_id,
        dandanplay_app_secret: config.dandanplay.app_secret,
        dandanplay_api_key: config.dandanplay.api_key,
        nyaa_enabled: config.nyaa.enabled,
        nyaa_base_url: config.nyaa.base_url,
        nyaa_category: config.nyaa.category,
        qbittorrent_enabled: config.qbittorrent.enabled,
        qbittorrent_base_url: config.qbittorrent.base_url,
        qbittorrent_username: config.qbittorrent.username,
        qbittorrent_password: config.qbittorrent.password,
        qbittorrent_save_path: config.qbittorrent.save_path,
        qbittorrent_category: config.qbittorrent.category,
        qbittorrent_tags: config.qbittorrent.tags,
        logging_level: config.logging.level,
    }
}

fn config_from_frontend_settings(input: FrontendEditableSettings, current: AppConfig) -> AppConfig {
    AppConfig {
        database: DatabaseConfig {
            path: PathBuf::from(input.database_path.trim()),
        },
        media_libraries: input
            .media_libraries
            .into_iter()
            .map(|path| PathBuf::from(path.trim()))
            .filter(|path| !path.as_os_str().is_empty())
            .collect(),
        dandanplay: DandanplayConfig {
            app_id: input.dandanplay_app_id,
            app_secret: input.dandanplay_app_secret,
            api_key: input.dandanplay_api_key,
        },
        bangumi: BangumiConfig {
            enabled: input.bangumi_enabled,
            base_url: input.bangumi_base_url,
            oauth_base_url: input.bangumi_oauth_base_url,
            client_id: input.bangumi_client_id,
            client_secret: if input.bangumi_client_secret.trim().is_empty() {
                current.bangumi.client_secret
            } else {
                input.bangumi_client_secret
            },
            redirect_uri: input.bangumi_redirect_uri,
            access_token: if input.bangumi_access_token.trim().is_empty() {
                current.bangumi.access_token
            } else {
                input.bangumi_access_token
            },
            user_agent: input.bangumi_user_agent,
            request_timeout_secs: input.bangumi_request_timeout_secs.max(1),
            auto_match: input.bangumi_auto_match,
            cache_images: input.bangumi_cache_images,
        },
        nyaa: NyaaConfig {
            enabled: input.nyaa_enabled,
            base_url: input.nyaa_base_url,
            category: input.nyaa_category,
        },
        qbittorrent: QbittorrentConfig {
            enabled: input.qbittorrent_enabled,
            base_url: input.qbittorrent_base_url,
            username: input.qbittorrent_username,
            password: input.qbittorrent_password,
            save_path: input.qbittorrent_save_path,
            category: input.qbittorrent_category,
            tags: input.qbittorrent_tags,
        },
        logging: LoggingConfig {
            level: input.logging_level,
        },
    }
}

fn rounded_episode_number(value: f64) -> usize {
    value.round().max(0.0) as usize
}

fn format_bytes(value: u64) -> String {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    if value as f64 >= GIB {
        format!("{:.1} GB", value as f64 / GIB)
    } else if value as f64 >= MIB {
        format!("{:.1} MB", value as f64 / MIB)
    } else {
        format!("{value} B")
    }
}

fn normalize_asset_path(path: &str) -> String {
    if path.is_empty() {
        String::new()
    } else if path.starts_with("file://")
        || path.starts_with("http://")
        || path.starts_with("https://")
    {
        path.to_string()
    } else {
        let asset_path = Path::new(path);
        let absolute = if asset_path.is_absolute() {
            asset_path.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| Path::new(".").to_path_buf())
                .join(asset_path)
        };
        format!("file://{}", absolute.display())
    }
}
