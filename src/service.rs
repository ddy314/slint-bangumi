use std::path::PathBuf;
use std::sync::{Arc, mpsc};

use crate::config::ConfigStore;
use crate::domain::{DanmakuMatch, MediaItem, WatchProgress};
use crate::error::{AppError, AppResult};
use crate::repository::Repository;
use crate::task::{self, AppEvent};

#[derive(Clone)]
pub struct MediaService {
    config: Arc<ConfigStore>,
    repository: Repository,
    events: mpsc::Sender<AppEvent>,
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
    events: mpsc::Sender<AppEvent>,
}

impl DanmakuService {
    pub fn new(events: mpsc::Sender<AppEvent>) -> Self {
        Self { events }
    }

    pub fn match_mock(&self, media: &MediaItem) -> AppResult<DanmakuMatch> {
        if media.deleted_at.is_some() {
            return Err(AppError::MediaNotFound);
        }

        let result = DanmakuMatch {
            provider: "mock-dandanplay".to_string(),
            title: media.file_name.clone(),
            episode: None,
            comment_count: 120,
        };
        let _ = self.events.send(AppEvent::DanmakuMatched(result.clone()));
        Ok(result)
    }
}
