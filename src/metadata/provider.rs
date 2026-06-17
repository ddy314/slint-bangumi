use crate::domain::SubjectEpisode;
use crate::error::AppResult;

#[derive(Debug, Clone)]
pub struct SubjectSearchResult {
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
pub struct SubjectDetail {
    pub provider: String,
    pub provider_subject_id: String,
    pub title: String,
    pub title_cn: Option<String>,
    pub summary: Option<String>,
    pub air_date: Option<String>,
    pub rating: Option<f64>,
    pub rank: Option<i64>,
    pub tags: Vec<String>,
    pub images: SubjectImages,
}

#[derive(Debug, Default, Clone)]
pub struct SubjectImages {
    pub large: Option<String>,
    pub common: Option<String>,
}

pub trait MetadataProvider {
    fn search_subjects(&self, keyword: &str) -> AppResult<Vec<SubjectSearchResult>>;
    fn get_subject(&self, provider_subject_id: &str) -> AppResult<SubjectDetail>;
    fn get_subject_images(&self, provider_subject_id: &str) -> AppResult<SubjectImages>;
    fn get_episodes(&self, provider_subject_id: &str) -> AppResult<Vec<SubjectEpisode>>;
}
