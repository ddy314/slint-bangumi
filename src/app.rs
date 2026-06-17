use std::sync::{Arc, mpsc};

use crate::config::ConfigStore;
use crate::error::AppResult;
use crate::repository::Repository;
use crate::service::{DanmakuService, MediaService, MetadataService, WatchHistoryService};
use crate::task::AppEvent;

#[derive(Clone)]
pub struct AppContext {
    pub media: MediaService,
    pub watch_history: WatchHistoryService,
    pub danmaku: DanmakuService,
    pub metadata: MetadataService,
    pub event_receiver: Arc<std::sync::Mutex<Option<mpsc::Receiver<AppEvent>>>>,
}

impl AppContext {
    pub fn new(config: ConfigStore) -> AppResult<Self> {
        let (events, receiver) = mpsc::channel();
        let config = Arc::new(config);
        let repository = Repository::new(config.snapshot().database.path);
        repository.init()?;

        let danmaku = DanmakuService::new(config.clone(), repository.clone(), events.clone())?;
        let database_path = config.snapshot().database.path;

        Ok(Self {
            media: MediaService::new(config.clone(), repository.clone(), events.clone()),
            watch_history: WatchHistoryService::new(repository.clone(), events.clone()),
            metadata: MetadataService::new(
                config.clone(),
                repository.clone(),
                danmaku.clone(),
                database_path,
                events.clone(),
            )?,
            danmaku,
            event_receiver: Arc::new(std::sync::Mutex::new(Some(receiver))),
        })
    }
}
