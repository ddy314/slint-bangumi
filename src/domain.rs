use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone)]
pub struct MediaItem {
    pub id: i64,
    pub path: PathBuf,
    pub file_name: String,
    pub file_size: u64,
    pub modified_at: i64,
    pub file_hash: Option<String>,
    pub match_ignored: bool,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MediaFile {
    pub path: PathBuf,
    pub file_name: String,
    pub file_size: u64,
    pub modified_at: i64,
    pub file_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WatchProgress {
    pub media_id: i64,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct BangumiAccount {
    pub username: String,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct BangumiSubjectCollection {
    pub subject_id: i64,
    pub subject_type: i64,
    pub collection_type: i64,
    pub rate: i64,
    pub comment: Option<String>,
    pub tags: Vec<String>,
    pub ep_status: i64,
    pub vol_status: i64,
    pub private: bool,
    pub subject_json: Option<String>,
    pub updated_at: i64,
    pub synced_at: i64,
    pub pending: bool,
}

#[derive(Debug, Clone)]
pub struct BangumiEpisodeCollection {
    pub episode_id: i64,
    pub subject_id: i64,
    pub sort_number: Option<f64>,
    pub ep_number: Option<f64>,
    pub title: Option<String>,
    pub title_cn: Option<String>,
    pub air_date: Option<String>,
    pub collection_type: i64,
    pub updated_at: i64,
    pub synced_at: i64,
    pub pending: bool,
}

#[derive(Debug, Clone)]
pub struct BangumiSyncQueueItem {
    pub id: i64,
    pub action: String,
    pub subject_id: Option<i64>,
    pub episode_id: Option<i64>,
    pub payload_json: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanUpsertStatus {
    Added,
    Modified,
    Restored,
    Unchanged,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub scanned_files: usize,
    pub added: usize,
    pub modified: usize,
    pub restored: usize,
    pub unchanged: usize,
    pub deleted: usize,
}

#[derive(Debug, Clone)]
pub struct DanmakuMatch {
    pub provider: String,
    pub title: String,
    pub anime_id: Option<i64>,
    pub episode_id: Option<i64>,
    pub anime_title: Option<String>,
    pub episode: Option<String>,
    pub comment_count: usize,
    pub exact: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DanmakuMode {
    Scroll,
    Top,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuItem {
    pub id: String,
    pub time: f64,
    pub mode: DanmakuMode,
    pub color: i64,
    pub text: String,
    pub user_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DanmakuTrack {
    pub media_id: i64,
    pub provider: String,
    pub episode_id: i64,
    pub title: String,
    pub fetched_at: i64,
    pub expires_at: i64,
    pub stale: bool,
    pub items: Vec<DanmakuItem>,
}

#[derive(Debug, Clone)]
pub struct DanmakuCommentCache {
    pub provider: String,
    pub episode_id: i64,
    pub variant: String,
    pub payload_json: String,
    pub comment_count: usize,
    pub fetched_at: i64,
    pub expires_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SubjectEpisode {
    pub provider_episode_id: String,
    pub sort_number: f64,
    pub ep_number: Option<f64>,
    pub title: String,
    pub title_cn: Option<String>,
    pub air_date: Option<String>,
    #[allow(dead_code)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Subject {
    pub id: i64,
    pub provider: String,
    pub provider_subject_id: String,
    pub title: String,
    pub title_cn: Option<String>,
    pub summary: Option<String>,
    pub air_date: Option<String>,
    pub rating: Option<f64>,
    pub rank: Option<i64>,
    pub image_large: Option<String>,
    pub image_common: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SubjectImageCache {
    #[allow(dead_code)]
    pub subject_id: i64,
    #[allow(dead_code)]
    pub image_kind: String,
    #[allow(dead_code)]
    pub source_url: String,
    pub local_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct MetadataCandidate {
    pub id: i64,
    pub media_id: i64,
    pub provider: String,
    pub provider_subject_id: String,
    pub title: String,
    pub title_cn: Option<String>,
    pub summary: Option<String>,
    pub air_date: Option<String>,
    pub rating: Option<f64>,
    pub rank: Option<i64>,
    pub image_large: Option<String>,
    pub image_common: Option<String>,
    pub confidence: f64,
    pub source: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiMediaCardData {
    pub media_id: i64,
    pub subject_id: i64,
    pub title: String,
    pub subtitle: String,
    pub status_text: String,
    pub match_status: String,
    pub progress_percent: i32,
    pub episode_text: String,
    pub poster_path: String,
    pub has_cached_poster: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiSeriesCardData {
    pub subject_id: i64,
    pub provider: String,
    pub provider_subject_id: String,
    pub title: String,
    pub title_cn: String,
    pub summary: String,
    pub air_date: String,
    pub rating: Option<f64>,
    pub rank: Option<i64>,
    pub tags: Vec<String>,
    pub poster_path: String,
    pub hero_path: String,
    pub file_count: usize,
    pub episode_count: usize,
    pub linked_episode_count: usize,
    pub total_size: u64,
    pub latest_file_name: String,
    pub local_files: Vec<UiSeriesFileData>,
    pub episodes: Vec<UiSeriesEpisodeData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiSeriesFileData {
    pub media_id: i64,
    pub file_name: String,
    pub file_size: u64,
    pub episode_number: Option<f64>,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiSeriesEpisodeData {
    pub episode_number: f64,
    pub title: String,
    pub title_cn: String,
    pub air_date: String,
    pub media_id: Option<i64>,
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub progress: f64,
    pub watched: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiSubjectDetailData {
    pub media_id: i64,
    pub subject_id: i64,
    pub title: String,
    pub title_cn: String,
    pub summary: String,
    pub air_date: String,
    pub rating_text: String,
    pub rank_text: String,
    pub poster_path: String,
    pub hero_path: String,
    pub match_status: String,
    pub cache_status: String,
    pub files: Vec<String>,
    pub episodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UiCandidateData {
    pub candidate_id: i64,
    pub media_id: i64,
    pub title: String,
    pub subtitle: String,
    pub summary: String,
    pub score_text: String,
    pub selected: bool,
}

#[derive(Debug, Clone)]
pub struct ResourceCandidate {
    pub id: i64,
    pub subject_provider: String,
    pub provider_subject_id: String,
    pub episode_number: Option<f64>,
    pub provider: String,
    pub title: String,
    pub subtitle_group: Option<String>,
    pub resolution: Option<String>,
    pub torrent_url: String,
    pub page_url: Option<String>,
    pub info_hash: Option<String>,
    pub size_text: Option<String>,
    pub seeders: i64,
    pub leechers: i64,
    pub downloads: i64,
    pub trusted: bool,
    pub remake: bool,
    pub batch: bool,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub id: i64,
    pub resource_id: Option<i64>,
    pub subject_provider: String,
    pub provider_subject_id: String,
    pub episode_number: Option<f64>,
    pub title: String,
    pub torrent_url: String,
    pub info_hash: Option<String>,
    pub qbittorrent_hash: Option<String>,
    pub status: String,
    pub progress: f64,
    pub save_path: Option<String>,
    pub error: Option<String>,
    pub updated_at: i64,
}
