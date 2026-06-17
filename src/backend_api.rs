use serde::Serialize;

use crate::app::AppContext;
use crate::domain::{ScanSummary, UiSeriesCardData};
use crate::error::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendSnapshot {
    pub subjects: Vec<FrontendSubject>,
    pub stats: LibraryStats,
    pub settings: FrontendSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub tentative: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSettings {
    pub bangumi_enabled: bool,
    pub bangumi_auto_match: bool,
    pub bangumi_cache_images: bool,
    pub dandanplay_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSubject {
    pub id: String,
    pub media_id: i64,
    pub subject_id: i64,
    pub title: String,
    pub title_cn: String,
    pub year: i32,
    pub air_date: String,
    pub rating: f64,
    pub rank: i64,
    pub tags: Vec<String>,
    pub summary: String,
    pub poster: String,
    pub hero: String,
    pub status: String,
    pub episodes: usize,
    pub watched_episodes: usize,
    pub current_episode: Option<usize>,
    pub progress: f64,
    pub files: usize,
    pub total_size: String,
    pub last_played: Option<String>,
    pub new_episode: bool,
    pub metadata_ready: bool,
    pub file_summary: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub summary: ScanSummary,
    pub scraped: usize,
    pub snapshot: BackendSnapshot,
}

pub fn snapshot(context: &AppContext) -> AppResult<BackendSnapshot> {
    let cards = context.media.list_series_cards()?;
    let series_count = cards.len();
    let (_, _, unmatched) = context.media.library_counts()?;
    let tentative = context.metadata.tentative_count()?;
    let flags = context.media.settings_flags();

    Ok(BackendSnapshot {
        subjects: cards.into_iter().map(frontend_subject_from_series).collect(),
        stats: LibraryStats {
            total: series_count,
            matched: series_count,
            unmatched,
            tentative,
        },
        settings: FrontendSettings {
            bangumi_enabled: flags.bangumi_enabled,
            bangumi_auto_match: flags.bangumi_auto_match,
            bangumi_cache_images: flags.bangumi_cache_images,
            dandanplay_configured: flags.dandanplay_configured,
        },
    })
}

pub fn scan(context: &AppContext) -> AppResult<ScanResponse> {
    let summary = context.media.scan_now()?;
    let scraped = context.metadata.scrape_library_blocking()?;
    let snapshot = snapshot(context)?;
    Ok(ScanResponse {
        summary,
        scraped,
        snapshot,
    })
}

fn frontend_subject_from_series(card: UiSeriesCardData) -> FrontendSubject {
    let display_title = if card.title_cn.trim().is_empty() {
        card.title.clone()
    } else {
        card.title_cn.clone()
    };
    let progress = if card.episode_count == 0 {
        0.0
    } else {
        (card.linked_episode_count as f64 / card.episode_count as f64).clamp(0.0, 1.0)
    };
    FrontendSubject {
        id: format!("subject-{}", card.subject_id),
        media_id: 0,
        subject_id: card.subject_id,
        title: display_title,
        title_cn: card.title,
        year: card
            .air_date
            .get(0..4)
            .and_then(|year| year.parse().ok())
            .unwrap_or_default(),
        air_date: card.air_date,
        rating: card.rating.unwrap_or_default(),
        rank: card.rank.unwrap_or_default(),
        tags: card.tags,
        summary: card.summary,
        poster: normalize_asset_path(&card.poster_path),
        hero: normalize_asset_path(&card.hero_path),
        status: "matched".to_string(),
        episodes: card.episode_count,
        watched_episodes: card.linked_episode_count,
        current_episode: None,
        progress,
        files: card.file_count,
        total_size: format_bytes(card.total_size),
        last_played: None,
        new_episode: false,
        metadata_ready: true,
        file_summary: card.latest_file_name,
    }
}

fn format_bytes(value: u64) -> String {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    if value as f64 >= GIB {
        format!("{:.1} GB", value as f64 / GIB)
    } else if value as f64 >= MIB {
        format!("{:.1} MB", value as f64 / MIB)
    } else {
        format!("{value} B")
    }
}

fn normalize_asset_path(path: &str) -> String {
    if path.is_empty() {
        String::new()
    } else if path.starts_with("file://") || path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!("file://{path}")
    }
}
