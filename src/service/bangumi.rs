use std::collections::HashMap;
use std::sync::{Arc, mpsc};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Method;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::{BangumiConfig, ConfigStore};
use crate::domain::{
    BangumiAccount, BangumiEpisodeCollection, BangumiSubjectCollection, BangumiSyncQueueItem,
};
use crate::error::{AppError, AppResult};
use crate::repository::Repository;
use crate::task::AppEvent;

pub const BANGUMI_SUBJECT_WISH: i64 = 1;
pub const BANGUMI_SUBJECT_COLLECT: i64 = 2;
pub const BANGUMI_SUBJECT_DOING: i64 = 3;
pub const BANGUMI_SUBJECT_ON_HOLD: i64 = 4;
pub const BANGUMI_SUBJECT_DROPPED: i64 = 5;

pub const BANGUMI_EPISODE_NONE: i64 = 0;
pub const BANGUMI_EPISODE_WISH: i64 = 1;
pub const BANGUMI_EPISODE_DONE: i64 = 2;
pub const BANGUMI_EPISODE_DROPPED: i64 = 3;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiAuthStatusData {
    pub configured: bool,
    pub authenticated: bool,
    pub username: Option<String>,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub client_configured: bool,
    pub redirect_uri: String,
    pub pending_sync_count: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiLoginStartData {
    pub authorize_url: String,
    pub state: String,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiSyncSummaryData {
    pub subjects: usize,
    pub episodes: usize,
    pub queued: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiCompleteOAuthInput {
    pub code: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiUpdateCollectionInput {
    pub subject_id: i64,
    pub collection_type: i64,
    pub rate: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiUpdateEpisodeInput {
    pub subject_id: i64,
    pub episode_id: i64,
    pub collection_type: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BangumiBatchUpdateEpisodesInput {
    pub subject_id: i64,
    pub episode_ids: Vec<i64>,
    pub collection_type: i64,
}

#[derive(Clone)]
pub struct BangumiService {
    config: Arc<ConfigStore>,
    repository: Repository,
    events: mpsc::Sender<AppEvent>,
}

impl BangumiService {
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

    pub fn auth_status(&self) -> AppResult<BangumiAuthStatusData> {
        let config = self.config.snapshot().bangumi;
        let account = self.repository.bangumi_account()?;
        let queued = self.repository.list_bangumi_sync_queue(1000)?;
        Ok(BangumiAuthStatusData {
            configured: config.enabled,
            authenticated: account.is_some(),
            username: account.as_ref().map(|account| account.username.clone()),
            nickname: account
                .as_ref()
                .and_then(|account| account.nickname.clone()),
            avatar_url: account
                .as_ref()
                .and_then(|account| account.avatar_url.clone()),
            client_configured: !config.client_id.trim().is_empty()
                && !config.client_secret.trim().is_empty(),
            redirect_uri: config.redirect_uri,
            pending_sync_count: queued.len(),
            last_error: queued.first().and_then(|item| item.last_error.clone()),
        })
    }

    pub fn cached_subject_collections(&self) -> AppResult<Vec<BangumiSubjectCollection>> {
        self.repository.list_bangumi_subject_collections()
    }

    pub fn cached_subject_collection(
        &self,
        subject_id: i64,
    ) -> AppResult<Option<BangumiSubjectCollection>> {
        self.repository.bangumi_subject_collection(subject_id)
    }

    pub fn cached_episode_collections(
        &self,
        subject_id: i64,
    ) -> AppResult<Vec<BangumiEpisodeCollection>> {
        self.repository.list_bangumi_episode_collections(subject_id)
    }

    pub fn cached_episode_collections_by_subject(
        &self,
    ) -> AppResult<HashMap<i64, Vec<BangumiEpisodeCollection>>> {
        let mut grouped = HashMap::<i64, Vec<BangumiEpisodeCollection>>::new();
        for episode in self.repository.list_all_bangumi_episode_collections()? {
            grouped.entry(episode.subject_id).or_default().push(episode);
        }
        Ok(grouped)
    }

    pub fn start_login(&self) -> AppResult<BangumiLoginStartData> {
        let config = self.config.snapshot().bangumi;
        ensure_oauth_configured(&config)?;
        let state = format!("nexplay-{}-{}", now_seconds(), std::process::id());
        let mut url = reqwest::Url::parse(&format!(
            "{}/oauth/authorize",
            trim_slash(&config.oauth_base_url)
        ))
        .map_err(|error| AppError::Config(format!("invalid Bangumi OAuth URL: {error}")))?;
        url.query_pairs_mut()
            .append_pair("client_id", &config.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &config.redirect_uri)
            .append_pair("state", &state);
        Ok(BangumiLoginStartData {
            authorize_url: url.to_string(),
            state,
            redirect_uri: config.redirect_uri,
        })
    }

    pub fn complete_oauth(
        &self,
        input: BangumiCompleteOAuthInput,
    ) -> AppResult<BangumiAuthStatusData> {
        if input.code.trim().is_empty() {
            return Err(AppError::Api(
                "Bangumi OAuth callback did not include code".to_string(),
            ));
        }
        if input.state.trim().is_empty() {
            return Err(AppError::Api(
                "Bangumi OAuth callback did not include state".to_string(),
            ));
        }

        let config = self.config.snapshot().bangumi;
        ensure_oauth_configured(&config)?;
        let client = client(&config)?;
        let token: OAuthTokenResponse = client
            .post(format!(
                "{}/oauth/access_token",
                trim_slash(&config.oauth_base_url)
            ))
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("code", input.code.trim()),
                ("redirect_uri", config.redirect_uri.as_str()),
            ])
            .send()?
            .error_for_status()?
            .json()?;
        let me: BangumiMeResponse = client
            .get(format!("{}/v0/me", trim_slash(&config.base_url)))
            .bearer_auth(&token.access_token)
            .send()?
            .error_for_status()?
            .json()?;
        let now = now_seconds();
        let account = BangumiAccount {
            username: me.username.clone().unwrap_or_else(|| me.id.to_string()),
            nickname: me.nickname.or(me.name),
            avatar_url: me
                .avatar
                .and_then(|avatar| avatar.large.or(avatar.medium).or(avatar.small)),
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            token_type: token.token_type,
            scope: token.scope,
            expires_at: token.expires_in.map(|expires_in| now + expires_in),
            updated_at: now,
        };
        self.repository.upsert_bangumi_account(&account)?;
        self.repository.insert_bangumi_sync_log(
            "info",
            "Bangumi OAuth login completed",
            None,
            None,
            now,
        )?;
        let _ = self.events.send(AppEvent::Log(format!(
            "Bangumi account logged in: {}",
            account.username
        )));
        match self.sync_all_inner() {
            Ok(summary) => {
                let _ = self.events.send(AppEvent::BangumiSyncFinished {
                    subjects: summary.subjects,
                    episodes: summary.episodes,
                    message: summary.message,
                });
            }
            Err(error) => {
                let message = format!("Bangumi 登录成功，但同步云端条目失败：{error}");
                let _ = self.events.send(AppEvent::BangumiSyncFailed {
                    error: message.clone(),
                });
                let _ = self
                    .repository
                    .insert_bangumi_sync_log("error", &message, None, None, now);
            }
        }
        self.auth_status()
    }

    pub fn logout(&self) -> AppResult<BangumiAuthStatusData> {
        self.repository.clear_bangumi_account()?;
        let _ = self
            .events
            .send(AppEvent::Log("Bangumi account logged out".to_string()));
        self.auth_status()
    }

    pub fn sync_all(&self) -> AppResult<BangumiSyncSummaryData> {
        let result = self.sync_all_inner();
        match &result {
            Ok(summary) => {
                let _ = self.events.send(AppEvent::BangumiSyncFinished {
                    subjects: summary.subjects,
                    episodes: summary.episodes,
                    message: summary.message.clone(),
                });
            }
            Err(error) => {
                let _ = self.events.send(AppEvent::BangumiSyncFailed {
                    error: error.to_string(),
                });
            }
        }
        result
    }

    fn sync_all_inner(&self) -> AppResult<BangumiSyncSummaryData> {
        self.retry_queue_best_effort();
        let account = self.require_account()?;
        let config = self.config.snapshot().bangumi;
        let client = client(&config)?;
        let mut offset = 0usize;
        let limit = 50usize;
        let mut count = 0usize;
        let mut total = 0usize;
        let _ = self.events.send(AppEvent::BangumiSyncStarted {
            total,
            message: "正在同步 Bangumi 动画条目".to_string(),
        });
        loop {
            let page: PagedCollections = self
                .request(
                    &client,
                    &account,
                    Method::GET,
                    &format!(
                        "/v0/users/{}/collections?subject_type=2&limit={limit}&offset={offset}",
                        url_path(&account.username)
                    ),
                    Option::<&()>::None,
                )?
                .json()?;
            if total == 0 {
                total = page.total;
            }
            let page_len = page.data.len();
            for item in page.data {
                let collection = subject_collection_from_api(item, now_seconds())?;
                self.repository
                    .upsert_bangumi_subject_collection(&collection)?;
                count += 1;
            }
            let _ = self.events.send(AppEvent::BangumiSyncProgress {
                processed: count,
                total,
                message: format!("已拉取 Bangumi 条目 {count}/{total}"),
            });
            if offset + page_len >= page.total || page_len == 0 {
                break;
            }
            offset += page_len;
        }
        self.repository.insert_bangumi_sync_log(
            "info",
            &format!("Synced {count} Bangumi subject collections"),
            None,
            None,
            now_seconds(),
        )?;
        Ok(BangumiSyncSummaryData {
            subjects: count,
            episodes: 0,
            queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
            message: format!("已同步 {count} 个 Bangumi 条目"),
        })
    }

    pub fn sync_subject(&self, subject_id: i64) -> AppResult<BangumiSyncSummaryData> {
        let result = self.sync_subject_inner(subject_id);
        match &result {
            Ok(summary) => {
                let _ = self.events.send(AppEvent::BangumiSyncFinished {
                    subjects: summary.subjects,
                    episodes: summary.episodes,
                    message: summary.message.clone(),
                });
            }
            Err(error) => {
                let _ = self.events.send(AppEvent::BangumiSyncFailed {
                    error: error.to_string(),
                });
            }
        }
        result
    }

    fn sync_subject_inner(&self, subject_id: i64) -> AppResult<BangumiSyncSummaryData> {
        self.retry_queue_best_effort();
        let account = self.require_account()?;
        let config = self.config.snapshot().bangumi;
        let client = client(&config)?;
        let _ = self.events.send(AppEvent::BangumiSyncStarted {
            total: 1,
            message: format!("正在同步 Bangumi 条目 #{subject_id}"),
        });
        let collection: ApiSubjectCollection = self
            .request(
                &client,
                &account,
                Method::GET,
                &format!(
                    "/v0/users/{}/collections/{subject_id}",
                    url_path(&account.username)
                ),
                Option::<&()>::None,
            )?
            .json()?;
        let collection = subject_collection_from_api(collection, now_seconds())?;
        self.repository
            .upsert_bangumi_subject_collection(&collection)?;

        let mut offset = 0usize;
        let limit = 100usize;
        let mut episodes = Vec::new();
        let mut total = 0usize;
        loop {
            let page: PagedEpisodeCollections = self
                .request(
                    &client,
                    &account,
                    Method::GET,
                    &format!(
                        "/v0/users/-/collections/{subject_id}/episodes?limit={limit}&offset={offset}"
                    ),
                    Option::<&()>::None,
                )?
                .json()?;
            if total == 0 {
                total = page.total;
            }
            let page_len = page.data.len();
            episodes.extend(
                page.data
                    .into_iter()
                    .map(|item| episode_collection_from_api(subject_id, item, now_seconds()))
                    .collect::<AppResult<Vec<_>>>()?,
            );
            let _ = self.events.send(AppEvent::BangumiSyncProgress {
                processed: episodes.len(),
                total,
                message: format!("已拉取 Bangumi 单集状态 {}/{}", episodes.len(), total),
            });
            if offset + page_len >= page.total || page_len == 0 {
                break;
            }
            offset += page_len;
        }
        self.repository
            .replace_bangumi_episode_collections(subject_id, &episodes)?;
        Ok(BangumiSyncSummaryData {
            subjects: 1,
            episodes: episodes.len(),
            queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
            message: format!(
                "已同步 Bangumi 条目 #{subject_id} 与 {} 集状态",
                episodes.len()
            ),
        })
    }

    pub fn update_collection(
        &self,
        input: BangumiUpdateCollectionInput,
    ) -> AppResult<BangumiSyncSummaryData> {
        validate_subject_collection_type(input.collection_type)?;
        if let Some(rate) = input.rate {
            if !(0..=10).contains(&rate) {
                return Err(AppError::Api(
                    "Bangumi rating must be between 0 and 10".to_string(),
                ));
            }
        }
        let payload = SubjectCollectionPayload {
            collection_type: input.collection_type,
            rate: input.rate,
        };
        let payload_json = serde_json::to_string(&payload)?;
        let now = now_seconds();
        match self.send_collection_update(input.subject_id, &payload) {
            Ok(()) => {
                self.repository
                    .mark_bangumi_subject_pending(input.subject_id, false, now)?;
                self.sync_subject(input.subject_id)
            }
            Err(error) => {
                self.repository.queue_bangumi_sync(
                    "update_collection",
                    Some(input.subject_id),
                    None,
                    &payload_json,
                    now,
                )?;
                self.upsert_pending_subject_collection(
                    input.subject_id,
                    input.collection_type,
                    input.rate,
                    true,
                    now,
                )?;
                Ok(BangumiSyncSummaryData {
                    subjects: 0,
                    episodes: 0,
                    queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
                    message: format!("网络失败，Bangumi 状态修改已加入待同步：{error}"),
                })
            }
        }
    }

    pub fn update_episode(
        &self,
        input: BangumiUpdateEpisodeInput,
    ) -> AppResult<BangumiSyncSummaryData> {
        validate_episode_collection_type(input.collection_type)?;
        let payload = EpisodeCollectionPayload {
            collection_type: input.collection_type,
        };
        let payload_json = serde_json::to_string(&payload)?;
        let now = now_seconds();
        match self.send_episode_update(input.episode_id, &payload) {
            Ok(()) => {
                self.repository
                    .mark_bangumi_episode_pending(input.episode_id, false, now)?;
                self.sync_subject(input.subject_id)
            }
            Err(error) => {
                self.repository.queue_bangumi_sync(
                    "update_episode",
                    Some(input.subject_id),
                    Some(input.episode_id),
                    &payload_json,
                    now,
                )?;
                self.upsert_pending_episode_collection(
                    input.subject_id,
                    input.episode_id,
                    input.collection_type,
                    true,
                    now,
                )?;
                Ok(BangumiSyncSummaryData {
                    subjects: 0,
                    episodes: 0,
                    queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
                    message: format!("网络失败，Bangumi 单集修改已加入待同步：{error}"),
                })
            }
        }
    }

    pub fn batch_update_episodes(
        &self,
        input: BangumiBatchUpdateEpisodesInput,
    ) -> AppResult<BangumiSyncSummaryData> {
        validate_episode_collection_type(input.collection_type)?;
        if input.episode_ids.is_empty() {
            return Ok(BangumiSyncSummaryData {
                subjects: 0,
                episodes: 0,
                queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
                message: "没有需要修改的 Bangumi 单集".to_string(),
            });
        }
        let payload = BatchEpisodeCollectionPayload {
            episode_ids: input.episode_ids.clone(),
            collection_type: input.collection_type,
        };
        let payload_json = serde_json::to_string(&payload)?;
        let now = now_seconds();
        match self.send_batch_episode_update(input.subject_id, &payload) {
            Ok(()) => self.sync_subject(input.subject_id),
            Err(error) => {
                self.repository.queue_bangumi_sync(
                    "batch_update_episodes",
                    Some(input.subject_id),
                    None,
                    &payload_json,
                    now,
                )?;
                for episode_id in &input.episode_ids {
                    self.upsert_pending_episode_collection(
                        input.subject_id,
                        *episode_id,
                        input.collection_type,
                        true,
                        now,
                    )?;
                }
                Ok(BangumiSyncSummaryData {
                    subjects: 0,
                    episodes: 0,
                    queued: self.repository.list_bangumi_sync_queue(1000)?.len(),
                    message: format!("网络失败，Bangumi 批量单集修改已加入待同步：{error}"),
                })
            }
        }
    }

    pub fn mark_playback_completed(
        &self,
        subject_id: i64,
        episode_id: i64,
    ) -> AppResult<BangumiSyncSummaryData> {
        self.update_episode(BangumiUpdateEpisodeInput {
            subject_id,
            episode_id,
            collection_type: BANGUMI_EPISODE_DONE,
        })
    }

    pub fn mark_playback_started(
        &self,
        subject_id: i64,
    ) -> AppResult<Option<BangumiSyncSummaryData>> {
        if subject_id <= 0 {
            return Ok(None);
        }
        let existing = self.repository.bangumi_subject_collection(subject_id)?;
        if let Some(collection) = existing.as_ref() {
            if collection.collection_type != BANGUMI_SUBJECT_WISH {
                return Ok(None);
            }
        }
        self.update_collection(BangumiUpdateCollectionInput {
            subject_id,
            collection_type: BANGUMI_SUBJECT_DOING,
            rate: existing
                .as_ref()
                .and_then(|collection| (collection.rate > 0).then_some(collection.rate)),
        })
        .map(Some)
    }

    fn retry_queue_best_effort(&self) {
        let Ok(items) = self.repository.list_bangumi_sync_queue(20) else {
            return;
        };
        for item in items {
            if let Err(error) = self.retry_queue_item(&item) {
                let _ = self.repository.mark_bangumi_sync_queue_error(
                    item.id,
                    &error.to_string(),
                    now_seconds(),
                );
                break;
            }
            let _ = self.repository.delete_bangumi_sync_queue_item(item.id);
        }
    }

    fn retry_queue_item(&self, item: &BangumiSyncQueueItem) -> AppResult<()> {
        match item.action.as_str() {
            "update_collection" => {
                let Some(subject_id) = item.subject_id else {
                    return Err(AppError::Api(
                        "queued collection update missing subject id".to_string(),
                    ));
                };
                let payload: SubjectCollectionPayload = serde_json::from_str(&item.payload_json)?;
                self.send_collection_update(subject_id, &payload)?;
                self.repository
                    .mark_bangumi_subject_pending(subject_id, false, now_seconds())?;
            }
            "update_episode" => {
                let Some(episode_id) = item.episode_id else {
                    return Err(AppError::Api(
                        "queued episode update missing episode id".to_string(),
                    ));
                };
                let payload: EpisodeCollectionPayload = serde_json::from_str(&item.payload_json)?;
                self.send_episode_update(episode_id, &payload)?;
                self.repository
                    .mark_bangumi_episode_pending(episode_id, false, now_seconds())?;
            }
            "batch_update_episodes" => {
                let Some(subject_id) = item.subject_id else {
                    return Err(AppError::Api(
                        "queued batch update missing subject id".to_string(),
                    ));
                };
                let payload: BatchEpisodeCollectionPayload =
                    serde_json::from_str(&item.payload_json)?;
                self.send_batch_episode_update(subject_id, &payload)?;
                let now = now_seconds();
                for episode_id in &payload.episode_ids {
                    self.upsert_pending_episode_collection(
                        subject_id,
                        *episode_id,
                        payload.collection_type,
                        false,
                        now,
                    )?;
                }
            }
            other => {
                return Err(AppError::Api(format!(
                    "unknown Bangumi queued action: {other}"
                )));
            }
        }
        Ok(())
    }

    fn upsert_pending_subject_collection(
        &self,
        subject_id: i64,
        collection_type: i64,
        rate: Option<i64>,
        pending: bool,
        now: i64,
    ) -> AppResult<()> {
        let mut collection = self
            .repository
            .bangumi_subject_collection(subject_id)?
            .unwrap_or(BangumiSubjectCollection {
                subject_id,
                subject_type: 2,
                collection_type,
                rate: rate.unwrap_or_default(),
                comment: None,
                tags: Vec::new(),
                ep_status: 0,
                vol_status: 0,
                private: false,
                subject_json: None,
                updated_at: now,
                synced_at: 0,
                pending,
            });
        collection.collection_type = collection_type;
        if let Some(rate) = rate {
            collection.rate = rate;
        }
        collection.updated_at = now;
        collection.pending = pending;
        if !pending {
            collection.synced_at = now;
        }
        self.repository
            .upsert_bangumi_subject_collection(&collection)
    }

    fn upsert_pending_episode_collection(
        &self,
        subject_id: i64,
        episode_id: i64,
        collection_type: i64,
        pending: bool,
        now: i64,
    ) -> AppResult<()> {
        let mut episode = self
            .repository
            .bangumi_episode_collection(episode_id)?
            .unwrap_or(BangumiEpisodeCollection {
                episode_id,
                subject_id,
                sort_number: None,
                ep_number: None,
                title: None,
                title_cn: None,
                air_date: None,
                collection_type,
                updated_at: now,
                synced_at: 0,
                pending,
            });
        episode.subject_id = subject_id;
        episode.collection_type = collection_type;
        episode.updated_at = now;
        episode.pending = pending;
        if !pending {
            episode.synced_at = now;
        }
        self.repository.upsert_bangumi_episode_collection(&episode)
    }

    fn send_collection_update(
        &self,
        subject_id: i64,
        payload: &SubjectCollectionPayload,
    ) -> AppResult<()> {
        let account = self.require_account()?;
        let config = self.config.snapshot().bangumi;
        let client = client(&config)?;
        let path = format!("/v0/users/-/collections/{subject_id}");
        let method = if self
            .repository
            .bangumi_subject_collection(subject_id)?
            .is_some()
        {
            Method::PATCH
        } else {
            Method::POST
        };
        self.request(&client, &account, method, &path, Some(payload))?;
        Ok(())
    }

    fn send_episode_update(
        &self,
        episode_id: i64,
        payload: &EpisodeCollectionPayload,
    ) -> AppResult<()> {
        let account = self.require_account()?;
        let config = self.config.snapshot().bangumi;
        let client = client(&config)?;
        self.request(
            &client,
            &account,
            Method::PUT,
            &format!("/v0/users/-/collections/-/episodes/{episode_id}"),
            Some(payload),
        )?;
        Ok(())
    }

    fn send_batch_episode_update(
        &self,
        subject_id: i64,
        payload: &BatchEpisodeCollectionPayload,
    ) -> AppResult<()> {
        let account = self.require_account()?;
        let config = self.config.snapshot().bangumi;
        let client = client(&config)?;
        self.request(
            &client,
            &account,
            Method::PATCH,
            &format!("/v0/users/-/collections/{subject_id}/episodes"),
            Some(payload),
        )?;
        Ok(())
    }

    fn request<T: Serialize + ?Sized>(
        &self,
        client: &Client,
        account: &BangumiAccount,
        method: Method,
        path: &str,
        body: Option<&T>,
    ) -> AppResult<reqwest::blocking::Response> {
        let config = self.config.snapshot().bangumi;
        let url = if path.starts_with("http://") || path.starts_with("https://") {
            path.to_string()
        } else {
            format!("{}{}", trim_slash(&config.base_url), path)
        };
        let mut request = client
            .request(method, url)
            .bearer_auth(&account.access_token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send()?;
        if response.status().as_u16() == 404 {
            return Err(AppError::Api(
                "Bangumi collection was not found".to_string(),
            ));
        }
        Ok(response.error_for_status()?)
    }

    fn require_account(&self) -> AppResult<BangumiAccount> {
        let account = self
            .repository
            .bangumi_account()?
            .ok_or_else(|| AppError::Api("Bangumi account is not logged in".to_string()))?;
        Ok(self.refresh_account_if_needed(account))
    }

    /// Refresh the OAuth access token when it is close to expiry. Best-effort: any
    /// failure falls back to the existing token (which yields a 401 prompting re-login),
    /// so this never makes authentication worse than before.
    fn refresh_account_if_needed(&self, account: BangumiAccount) -> BangumiAccount {
        let now = now_seconds();
        let expiring = account
            .expires_at
            .map(|expires_at| expires_at - now < 300)
            .unwrap_or(false);
        if !expiring {
            return account;
        }
        let Some(refresh_token) = account.refresh_token.clone() else {
            return account;
        };
        match self.try_refresh_token(&refresh_token, account.clone()) {
            Ok(refreshed) => refreshed,
            Err(error) => {
                let _ = self.repository.insert_bangumi_sync_log(
                    "warn",
                    &format!("Bangumi token 刷新失败，沿用现有令牌：{error}"),
                    None,
                    None,
                    now,
                );
                account
            }
        }
    }

    fn try_refresh_token(
        &self,
        refresh_token: &str,
        existing: BangumiAccount,
    ) -> AppResult<BangumiAccount> {
        let config = self.config.snapshot().bangumi;
        ensure_oauth_configured(&config)?;
        let client = client(&config)?;
        let token: OAuthTokenResponse = client
            .post(format!(
                "{}/oauth/access_token",
                trim_slash(&config.oauth_base_url)
            ))
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", config.client_id.as_str()),
                ("client_secret", config.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("redirect_uri", config.redirect_uri.as_str()),
            ])
            .send()?
            .error_for_status()?
            .json()?;
        let now = now_seconds();
        let account = BangumiAccount {
            access_token: token.access_token,
            refresh_token: token.refresh_token.or(existing.refresh_token),
            token_type: token.token_type.or(existing.token_type),
            scope: token.scope.or(existing.scope),
            expires_at: token.expires_in.map(|expires_in| now + expires_in),
            updated_at: now,
            ..existing
        };
        self.repository.upsert_bangumi_account(&account)?;
        let _ = self.repository.insert_bangumi_sync_log(
            "info",
            "Bangumi token 已自动刷新",
            None,
            None,
            now,
        );
        Ok(account)
    }
}

pub fn validate_subject_collection_type(value: i64) -> AppResult<()> {
    match value {
        BANGUMI_SUBJECT_WISH
        | BANGUMI_SUBJECT_COLLECT
        | BANGUMI_SUBJECT_DOING
        | BANGUMI_SUBJECT_ON_HOLD
        | BANGUMI_SUBJECT_DROPPED => Ok(()),
        _ => Err(AppError::Api(format!(
            "invalid Bangumi subject collection type: {value}"
        ))),
    }
}

pub fn validate_episode_collection_type(value: i64) -> AppResult<()> {
    match value {
        BANGUMI_EPISODE_NONE
        | BANGUMI_EPISODE_WISH
        | BANGUMI_EPISODE_DONE
        | BANGUMI_EPISODE_DROPPED => Ok(()),
        _ => Err(AppError::Api(format!(
            "invalid Bangumi episode collection type: {value}"
        ))),
    }
}

pub fn subject_collection_label(value: i64) -> &'static str {
    match value {
        BANGUMI_SUBJECT_WISH => "想看",
        BANGUMI_SUBJECT_COLLECT => "看过",
        BANGUMI_SUBJECT_DOING => "在看",
        BANGUMI_SUBJECT_ON_HOLD => "搁置",
        BANGUMI_SUBJECT_DROPPED => "抛弃",
        _ => "未标记",
    }
}

pub fn episode_collection_label(value: i64) -> &'static str {
    match value {
        BANGUMI_EPISODE_NONE => "未标记",
        BANGUMI_EPISODE_WISH => "想看",
        BANGUMI_EPISODE_DONE => "看过",
        BANGUMI_EPISODE_DROPPED => "抛弃",
        _ => "未知",
    }
}

pub fn playback_completion_reached(position: f64, duration: f64) -> bool {
    duration.is_finite()
        && position.is_finite()
        && duration > 0.0
        && position >= (duration * 0.9).max(duration - 90.0).max(0.0)
}

fn subject_collection_from_api(
    item: ApiSubjectCollection,
    synced_at: i64,
) -> AppResult<BangumiSubjectCollection> {
    validate_subject_collection_type(item.collection_type)?;
    Ok(BangumiSubjectCollection {
        subject_id: item.subject_id,
        subject_type: item.subject_type.unwrap_or(2),
        collection_type: item.collection_type,
        rate: item.rate.unwrap_or_default(),
        comment: item.comment,
        tags: item.tags.unwrap_or_default(),
        ep_status: item.ep_status.unwrap_or_default(),
        vol_status: item.vol_status.unwrap_or_default(),
        private: item.private.unwrap_or(false),
        subject_json: item
            .subject
            .map(|subject| serde_json::to_string(&subject))
            .transpose()?,
        updated_at: api_timestamp(item.updated_at.as_ref()),
        synced_at,
        pending: false,
    })
}

fn episode_collection_from_api(
    subject_id: i64,
    item: ApiEpisodeCollection,
    synced_at: i64,
) -> AppResult<BangumiEpisodeCollection> {
    validate_episode_collection_type(item.collection_type)?;
    Ok(BangumiEpisodeCollection {
        episode_id: item.episode.id,
        subject_id,
        sort_number: item.episode.sort,
        ep_number: item.episode.ep,
        title: item.episode.name,
        title_cn: item.episode.name_cn,
        air_date: item.episode.airdate,
        collection_type: item.collection_type,
        updated_at: api_timestamp(item.updated_at.as_ref()),
        synced_at,
        pending: false,
    })
}

fn client(config: &BangumiConfig) -> AppResult<Client> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(
            config.request_timeout_secs.max(1),
        ))
        .user_agent(config.user_agent.clone())
        .build()
        .map_err(Into::into)
}

fn ensure_oauth_configured(config: &BangumiConfig) -> AppResult<()> {
    if config.client_id.trim().is_empty() || config.client_secret.trim().is_empty() {
        return Err(AppError::Config(
            "Bangumi OAuth client id/secret are not configured".to_string(),
        ));
    }
    Ok(())
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn trim_slash(value: &str) -> &str {
    value.trim_end_matches('/')
}

fn url_path(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn api_timestamp(value: Option<&serde_json::Value>) -> i64 {
    match value {
        Some(serde_json::Value::Number(number)) => number.as_i64().unwrap_or_default(),
        Some(serde_json::Value::String(_)) => 0,
        _ => 0,
    }
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct BangumiMeResponse {
    id: i64,
    username: Option<String>,
    nickname: Option<String>,
    name: Option<String>,
    avatar: Option<BangumiAvatar>,
}

#[derive(Debug, Deserialize)]
struct BangumiAvatar {
    large: Option<String>,
    medium: Option<String>,
    small: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PagedCollections {
    #[serde(default)]
    total: usize,
    #[serde(default)]
    data: Vec<ApiSubjectCollection>,
}

#[derive(Debug, Deserialize)]
struct PagedEpisodeCollections {
    #[serde(default)]
    total: usize,
    #[serde(default)]
    data: Vec<ApiEpisodeCollection>,
}

#[derive(Debug, Deserialize)]
struct ApiSubjectCollection {
    subject_id: i64,
    subject_type: Option<i64>,
    #[serde(rename = "type")]
    collection_type: i64,
    rate: Option<i64>,
    comment: Option<String>,
    tags: Option<Vec<String>>,
    ep_status: Option<i64>,
    vol_status: Option<i64>,
    private: Option<bool>,
    updated_at: Option<serde_json::Value>,
    subject: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiEpisodeCollection {
    episode: ApiEpisode,
    #[serde(rename = "type")]
    collection_type: i64,
    updated_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiEpisode {
    id: i64,
    sort: Option<f64>,
    ep: Option<f64>,
    name: Option<String>,
    name_cn: Option<String>,
    airdate: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SubjectCollectionPayload {
    #[serde(rename = "type")]
    collection_type: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    rate: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct EpisodeCollectionPayload {
    #[serde(rename = "type")]
    collection_type: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct BatchEpisodeCollectionPayload {
    #[serde(rename = "episode_id")]
    episode_ids: Vec<i64>,
    #[serde(rename = "type")]
    collection_type: i64,
}

pub fn subject_json_to_summary(value: &str) -> Option<CachedSubjectSummary> {
    serde_json::from_str::<CachedSubjectSummary>(value).ok()
}

#[derive(Debug, Clone, Deserialize)]
pub struct CachedSubjectSummary {
    pub id: i64,
    pub name: Option<String>,
    pub name_cn: Option<String>,
    pub summary: Option<String>,
    pub date: Option<String>,
    pub images: Option<HashMap<String, String>>,
    pub rating: Option<CachedSubjectRating>,
    pub rank: Option<i64>,
    pub tags: Option<Vec<CachedSubjectTag>>,
    pub total_episodes: Option<usize>,
    pub eps: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CachedSubjectRating {
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CachedSubjectTag {
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bangumi_collection_enums() {
        for value in 1..=5 {
            validate_subject_collection_type(value).expect("valid subject type");
        }
        assert!(validate_subject_collection_type(0).is_err());
        for value in 0..=3 {
            validate_episode_collection_type(value).expect("valid episode type");
        }
        assert!(validate_episode_collection_type(4).is_err());
    }

    #[test]
    fn playback_completion_threshold_uses_ninety_percent_or_last_ninety_seconds() {
        assert!(!playback_completion_reached(500.0, 1000.0));
        assert!(!playback_completion_reached(909.0, 1000.0));
        assert!(playback_completion_reached(910.0, 1000.0));
        assert!(playback_completion_reached(3510.0, 3600.0));
        assert!(!playback_completion_reached(3509.0, 3600.0));
    }
}
