use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::provider::{MetadataProvider, SubjectDetail, SubjectImages, SubjectSearchResult};

const BANGUMI_BASE_URL: &str = "https://api.bgm.tv";

#[derive(Clone)]
pub struct BangumiProvider {
    client: Client,
}

impl BangumiProvider {
    pub fn new() -> AppResult<Self> {
        let user_agent = format!(
            "slint-bangumi/{} (https://github.com/ddy314/slint-bangumi)",
            env!("CARGO_PKG_VERSION")
        );
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(user_agent)
            .build()?;
        Ok(Self { client })
    }
}

impl MetadataProvider for BangumiProvider {
    fn search_subjects(&self, keyword: &str) -> AppResult<Vec<SubjectSearchResult>> {
        let keyword = keyword.trim();
        if keyword.is_empty() {
            return Ok(Vec::new());
        }

        let response = self
            .client
            .post(format!("{BANGUMI_BASE_URL}/v0/search/subjects"))
            .json(&SearchRequest {
                keyword,
                filter: SearchFilter {
                    subject_type: vec![2],
                },
            })
            .send()?;
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Api(format!("bangumi search rejected: {status}")));
        }

        let response = response.json::<SearchResponse>()?;
        Ok(response
            .data
            .into_iter()
            .map(|subject| subject.into_search_result())
            .collect())
    }

    fn get_subject(&self, provider_subject_id: &str) -> AppResult<SubjectDetail> {
        let response = self
            .client
            .get(format!(
                "{BANGUMI_BASE_URL}/v0/subjects/{provider_subject_id}"
            ))
            .send()?;
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Api(format!("bangumi subject rejected: {status}")));
        }

        Ok(response.json::<BangumiSubject>()?.into_detail())
    }

    fn get_subject_images(&self, provider_subject_id: &str) -> AppResult<SubjectImages> {
        Ok(self.get_subject(provider_subject_id)?.images)
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
    rank: Option<i64>,
    rating: Option<BangumiRating>,
    images: Option<BangumiImages>,
    tags: Option<Vec<BangumiTag>>,
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
