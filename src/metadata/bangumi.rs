use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};

use crate::config::BangumiConfig;
use crate::domain::SubjectEpisode;
use crate::error::{AppError, AppResult};

use super::provider::{MetadataProvider, SubjectDetail, SubjectImages, SubjectSearchResult};

#[derive(Clone)]
pub struct BangumiProvider {
    client: Client,
    config: BangumiConfig,
}

impl BangumiProvider {
    pub fn new(config: BangumiConfig) -> AppResult<Self> {
        let timeout = Duration::from_secs(config.request_timeout_secs.max(1));
        let client = Client::builder()
            .timeout(timeout)
            .user_agent(config.user_agent.clone())
            .default_headers(auth_headers(&config)?)
            .build()?;
        Ok(Self { client, config })
    }

    pub fn test_connection(&self) -> AppResult<()> {
        ensure_enabled(&self.config)?;
        let response = self
            .client
            .get(format!(
                "{}/v0/subjects/1",
                self.config.base_url.trim_end_matches('/')
            ))
            .send()?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(AppError::Api(format!(
                "bangumi connection test rejected: {status}"
            )))
        }
    }
}

impl MetadataProvider for BangumiProvider {
    fn search_subjects(&self, keyword: &str) -> AppResult<Vec<SubjectSearchResult>> {
        ensure_enabled(&self.config)?;
        let keyword = keyword.trim();
        if keyword.is_empty() {
            return Ok(Vec::new());
        }

        let response = self
            .client
            .post(format!(
                "{}/v0/search/subjects",
                self.config.base_url.trim_end_matches('/')
            ))
            .json(&SearchRequest {
                keyword,
                filter: SearchFilter {
                    subject_type: vec![2],
                },
            })
            .send()?;
        let status = response.status();
        if !status.is_success() {
            let message = if status.as_u16() == 401 {
                format!(
                    "bangumi returned 401: access token may have expired. You can clear it in Settings → Bangumi and try again."
                )
            } else {
                format!("bangumi search rejected: {status}")
            };
            return Err(AppError::Api(message));
        }

        let response = response.json::<SearchResponse>()?;
        Ok(response
            .data
            .into_iter()
            .map(|subject| subject.into_search_result())
            .collect())
    }

    fn get_subject(&self, provider_subject_id: &str) -> AppResult<SubjectDetail> {
        ensure_enabled(&self.config)?;
        let response = self
            .client
            .get(format!(
                "{}/v0/subjects/{provider_subject_id}",
                self.config.base_url.trim_end_matches('/')
            ))
            .send()?;
        let status = response.status();
        if !status.is_success() {
            let message = if status.as_u16() == 401 {
                format!(
                    "bangumi returned 401: access token may have expired. You can clear it in Settings → Bangumi and try again."
                )
            } else {
                format!("bangumi subject rejected: {status}")
            };
            return Err(AppError::Api(message));
        }

        Ok(response.json::<BangumiSubject>()?.into_detail())
    }

    fn get_subject_images(&self, provider_subject_id: &str) -> AppResult<SubjectImages> {
        Ok(self.get_subject(provider_subject_id)?.images)
    }

    fn get_episodes(&self, provider_subject_id: &str) -> AppResult<Vec<SubjectEpisode>> {
        ensure_enabled(&self.config)?;
        let mut offset = 0;
        let mut episodes = Vec::new();
        loop {
            let response = self
                .client
                .get(format!(
                    "{}/v0/episodes",
                    self.config.base_url.trim_end_matches('/')
                ))
                .query(&[
                    ("subject_id", provider_subject_id),
                    ("type", "0"),
                    ("limit", "200"),
                    ("offset", &offset.to_string()),
                ])
                .send()?;
            let status = response.status();
            if !status.is_success() {
                return Err(AppError::Api(format!(
                    "bangumi episodes rejected: {status}"
                )));
            }

            let page = response.json::<EpisodesResponse>()?;
            let count = page.data.len();
            episodes.extend(
                page.data
                    .into_iter()
                    .map(BangumiEpisode::into_subject_episode),
            );
            offset += count as i64;
            if count == 0 || offset >= page.total.unwrap_or(offset) {
                break;
            }
        }
        Ok(episodes)
    }
}

fn auth_headers(config: &BangumiConfig) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let token = config.access_token.trim();
    if !token.is_empty() {
        let value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| AppError::Config(format!("invalid bangumi access token: {error}")))?;
        headers.insert(AUTHORIZATION, value);
    }
    Ok(headers)
}

fn ensure_enabled(config: &BangumiConfig) -> AppResult<()> {
    if config.enabled {
        Ok(())
    } else {
        Err(AppError::Config(
            "bangumi metadata source is disabled".to_string(),
        ))
    }
}

#[derive(Debug, Serialize)]
struct SearchRequest<'a> {
    keyword: &'a str,
    filter: SearchFilter,
}

#[derive(Debug, Serialize)]
struct SearchFilter {
    #[serde(rename = "type")]
    subject_type: Vec<i32>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    data: Vec<BangumiSubject>,
}

#[derive(Debug, Deserialize)]
struct BangumiSubject {
    id: i64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    eps: Option<i64>,
    total_episodes: Option<i64>,
    rank: Option<i64>,
    rating: Option<BangumiRating>,
    images: Option<BangumiImages>,
    tags: Option<Vec<BangumiTag>>,
    infobox: Option<Vec<BangumiInfoboxItem>>,
}

impl BangumiSubject {
    fn into_search_result(self) -> SubjectSearchResult {
        let images = self.images.unwrap_or_default();
        SubjectSearchResult {
            provider: "bangumi".to_string(),
            provider_subject_id: self.id.to_string(),
            title: self.name,
            title_cn: non_empty(self.name_cn),
            summary: non_empty(self.summary),
            air_date: non_empty(self.date),
            rating: self.rating.and_then(|rating| rating.score),
            rank: self.rank,
            image_large: non_empty(images.large),
            image_common: non_empty(images.common),
            aliases: aliases_from_infobox(self.infobox.as_deref()),
            episode_count: subject_episode_count(self.eps, self.total_episodes),
        }
    }

    fn into_detail(self) -> SubjectDetail {
        let images = self.images.unwrap_or_default();
        SubjectDetail {
            provider: "bangumi".to_string(),
            provider_subject_id: self.id.to_string(),
            title: self.name,
            title_cn: non_empty(self.name_cn),
            summary: non_empty(self.summary),
            air_date: non_empty(self.date),
            rating: self.rating.and_then(|rating| rating.score),
            rank: self.rank,
            tags: self
                .tags
                .unwrap_or_default()
                .into_iter()
                .map(|tag| tag.name)
                .filter(|tag| !tag.trim().is_empty())
                .collect(),
            aliases: aliases_from_infobox(self.infobox.as_deref()),
            episode_count: subject_episode_count(self.eps, self.total_episodes),
            images: SubjectImages {
                large: non_empty(images.large),
                common: non_empty(images.common),
            },
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct BangumiImages {
    large: Option<String>,
    common: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BangumiRating {
    score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct BangumiTag {
    name: String,
}

#[derive(Debug, Deserialize)]
struct BangumiInfoboxItem {
    key: String,
    value: BangumiInfoboxValue,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BangumiInfoboxValue {
    String(String),
    List(Vec<BangumiInfoboxAlias>),
}

#[derive(Debug, Deserialize)]
struct BangumiInfoboxAlias {
    v: String,
}

#[derive(Debug, Deserialize)]
struct EpisodesResponse {
    total: Option<i64>,
    data: Vec<BangumiEpisode>,
}

#[derive(Debug, Deserialize)]
struct BangumiEpisode {
    id: i64,
    name: String,
    name_cn: Option<String>,
    sort: f64,
    ep: Option<f64>,
    airdate: Option<String>,
    desc: Option<String>,
}

impl BangumiEpisode {
    fn into_subject_episode(self) -> SubjectEpisode {
        SubjectEpisode {
            provider_episode_id: self.id.to_string(),
            sort_number: self.sort,
            ep_number: self.ep,
            title: self.name,
            title_cn: non_empty(self.name_cn),
            air_date: non_empty(self.airdate),
            summary: non_empty(self.desc),
        }
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn aliases_from_infobox(infobox: Option<&[BangumiInfoboxItem]>) -> Vec<String> {
    let mut aliases = Vec::new();
    for item in infobox.unwrap_or_default() {
        if item.key != "别名" {
            continue;
        }
        match &item.value {
            BangumiInfoboxValue::String(value) => push_non_empty(&mut aliases, value),
            BangumiInfoboxValue::List(values) => {
                for value in values {
                    push_non_empty(&mut aliases, &value.v);
                }
            }
        }
    }
    aliases
}

fn push_non_empty(values: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() && !values.iter().any(|item| item == trimmed) {
        values.push(trimmed.to_string());
    }
}

fn subject_episode_count(eps: Option<i64>, total_episodes: Option<i64>) -> Option<usize> {
    total_episodes
        .or(eps)
        .filter(|value| *value > 0)
        .map(|value| value as usize)
}

#[cfg(test)]
mod tests {
    use crate::config::ConfigStore;

    use super::*;

    #[test]
    #[ignore = "requires local config.toml and Bangumi network access"]
    fn connects_with_local_config() {
        let config = ConfigStore::load_or_create("config.toml")
            .expect("load config")
            .snapshot()
            .bangumi;
        let provider = BangumiProvider::new(config).expect("create provider");
        provider.test_connection().expect("connect to Bangumi");
    }
}
