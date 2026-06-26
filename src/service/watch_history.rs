use std::sync::mpsc;

use crate::domain::WatchProgress;
use crate::error::AppResult;
use crate::repository::Repository;
use crate::task::{self, AppEvent};

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

    pub fn save(
        &self,
        media_id: i64,
        position_ms: i64,
        duration_ms: i64,
    ) -> AppResult<WatchProgress> {
        let now = task::unix_timestamp_ms();
        self.repository
            .save_progress(media_id, position_ms, duration_ms, now)?;
        Ok(WatchProgress {
            media_id,
            position_ms,
            duration_ms,
            updated_at: now,
        })
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
