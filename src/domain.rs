use std::path::PathBuf;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanUpsertStatus {
    Added,
    Modified,
    Restored,
    Unchanged,
}

#[derive(Debug, Default, Clone)]
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

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub struct UiCandidateData {
    pub candidate_id: i64,
    pub media_id: i64,
    pub title: String,
    pub subtitle: String,
    pub summary: String,
    pub score_text: String,
    pub selected: bool,
}
