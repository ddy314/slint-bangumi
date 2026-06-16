use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct MediaItem {
    pub id: i64,
    pub path: PathBuf,
    pub file_name: String,
    pub file_size: u64,
    pub modified_at: i64,
    pub file_hash: Option<String>,
    pub deleted_at: Option<i64>,
}

impl MediaItem {
    pub fn display_label(&self) -> String {
        let deleted = if self.deleted_at.is_some() {
            " [missing]"
        } else {
            ""
        };
        format!(
            "{}{}  ({} MB)",
            self.file_name,
            deleted,
            self.file_size / 1024 / 1024
        )
    }
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
    pub episode: Option<String>,
    pub comment_count: usize,
}
