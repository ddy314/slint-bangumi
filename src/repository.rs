use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::domain::{
    DanmakuCommentCache, DanmakuMatch, DownloadTask, MediaFile, MediaItem, MetadataCandidate,
    ResourceCandidate, ScanUpsertStatus, Subject, SubjectEpisode, SubjectImageCache,
    UiCandidateData, UiMediaCardData, UiSeriesCardData, UiSeriesEpisodeData, UiSeriesFileData,
    UiSubjectDetailData, WatchProgress,
};
use crate::error::AppResult;
use crate::metadata::provider::{SubjectDetail, SubjectSearchResult};

mod schema;

#[derive(Debug, Clone)]
pub struct Repository {
    db_path: PathBuf,
}

impl Repository {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub fn init(&self) -> AppResult<()> {
        let mut conn = self.connect()?;
        schema::init_database(&mut conn)
    }

    pub fn list_series_cards(&self) -> AppResult<Vec<UiSeriesCardData>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            WITH file_stats AS (
                SELECT
                    l.subject_id,
                    COUNT(DISTINCT m.id) AS file_count,
                    COALESCE(SUM(m.file_size), 0) AS total_size,
                    COALESCE(MAX(m.modified_at), 0) AS latest_modified_at,
                    COALESCE(MAX(m.file_name), '') AS latest_file_name
                FROM media_subject_links l
                JOIN media_items m ON m.id = l.media_id AND m.deleted_at IS NULL
                GROUP BY l.subject_id
            ),
            episode_stats AS (
                SELECT
                    e.subject_id,
                    COUNT(DISTINCT e.id) AS episode_count
                FROM episodes e
                GROUP BY e.subject_id
            ),
            linked_stats AS (
                SELECT
                    l.subject_id,
                    COUNT(DISTINCT mel.episode_id) AS linked_episode_count
                FROM media_subject_links l
                JOIN media_items m ON m.id = l.media_id AND m.deleted_at IS NULL
                JOIN media_episode_links mel ON mel.media_id = m.id
                WHERE mel.episode_id IS NOT NULL
                GROUP BY l.subject_id
            )
            SELECT
                s.id,
                s.provider,
                s.provider_subject_id,
                s.title,
                COALESCE(s.title_cn, ''),
                COALESCE(s.summary, ''),
                COALESCE(s.air_date, ''),
                s.rating,
                s.rank,
                COALESCE(s.tags, '[]'),
                COALESCE(poster.local_path, ''),
                COALESCE(hero.local_path, ''),
                COALESCE(fs.file_count, 0),
                COALESCE(es.episode_count, 0),
                COALESCE(ls.linked_episode_count, 0),
                COALESCE(fs.total_size, 0),
                COALESCE(fs.latest_file_name, '')
            FROM subjects s
            JOIN file_stats fs ON fs.subject_id = s.id
            LEFT JOIN episode_stats es ON es.subject_id = s.id
            LEFT JOIN linked_stats ls ON ls.subject_id = s.id
            LEFT JOIN subject_image_cache poster
                ON poster.subject_id = s.id AND poster.image_kind = 'poster'
            LEFT JOIN subject_image_cache hero
                ON hero.subject_id = s.id AND hero.image_kind = 'hero'
            GROUP BY s.id
            ORDER BY COALESCE(fs.latest_modified_at, 0) DESC,
                     COALESCE(NULLIF(s.title_cn, ''), s.title) COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(9)?;
            let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
            Ok(UiSeriesCardData {
                subject_id: row.get(0)?,
                provider: row.get(1)?,
                provider_subject_id: row.get(2)?,
                title: row.get(3)?,
                title_cn: row.get(4)?,
                summary: row.get(5)?,
                air_date: row.get(6)?,
                rating: row.get(7)?,
                rank: row.get(8)?,
                tags,
                poster_path: row.get(10)?,
                hero_path: row.get(11)?,
                file_count: row.get::<_, i64>(12)? as usize,
                episode_count: row.get::<_, i64>(13)? as usize,
                linked_episode_count: row.get::<_, i64>(14)? as usize,
                total_size: row.get::<_, i64>(15)? as u64,
                latest_file_name: row.get(16)?,
                local_files: Vec::new(),
                episodes: Vec::new(),
            })
        })?;
        let mut cards = rows.collect::<Result<Vec<_>, _>>()?;
        for card in &mut cards {
            card.local_files = self.list_series_files(card.subject_id)?;
            card.episodes = self.list_series_episodes(card.subject_id)?;
        }
        Ok(cards)
    }

    fn list_series_files(&self, subject_id: i64) -> AppResult<Vec<UiSeriesFileData>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                m.id,
                m.file_name,
                m.file_size,
                mel.episode_number,
                m.modified_at
            FROM media_items m
            JOIN media_subject_links l ON l.media_id = m.id
            LEFT JOIN media_episode_links mel ON mel.media_id = m.id
            WHERE l.subject_id = ?1 AND m.deleted_at IS NULL
            ORDER BY
                mel.episode_number IS NULL,
                mel.episode_number,
                m.file_name COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map(params![subject_id], |row| {
            Ok(UiSeriesFileData {
                media_id: row.get(0)?,
                file_name: row.get(1)?,
                file_size: row.get::<_, i64>(2)? as u64,
                episode_number: row.get(3)?,
                modified_at: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn list_series_episodes(&self, subject_id: i64) -> AppResult<Vec<UiSeriesEpisodeData>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                e.sort_number,
                COALESCE(e.title, ''),
                COALESCE(e.title_cn, ''),
                COALESCE(e.air_date, ''),
                m.id,
                m.file_name,
                m.file_size
            FROM episodes e
            LEFT JOIN media_episode_links mel ON mel.episode_id = e.id
            LEFT JOIN media_items m ON m.id = mel.media_id AND m.deleted_at IS NULL
            WHERE e.subject_id = ?1
            ORDER BY e.sort_number, m.file_name COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map(params![subject_id], |row| {
            Ok(UiSeriesEpisodeData {
                episode_number: row.get(0)?,
                title: row.get(1)?,
                title_cn: row.get(2)?,
                air_date: row.get(3)?,
                media_id: row.get(4)?,
                file_name: row.get(5)?,
                file_size: row.get::<_, Option<i64>>(6)?.map(|size| size as u64),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_media(&self, include_deleted: bool) -> AppResult<Vec<MediaItem>> {
        let conn = self.connect()?;
        let sql = if include_deleted {
            "SELECT id, path, file_name, file_size, modified_at, file_hash, match_ignored, deleted_at FROM media_items ORDER BY file_name COLLATE NOCASE"
        } else {
            "SELECT id, path, file_name, file_size, modified_at, file_hash, match_ignored, deleted_at FROM media_items WHERE deleted_at IS NULL ORDER BY file_name COLLATE NOCASE"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], map_media_item)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_media(&self, media_id: i64) -> AppResult<Option<MediaItem>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, path, file_name, file_size, modified_at, file_hash, match_ignored, deleted_at FROM media_items WHERE id = ?1",
            params![media_id],
            map_media_item,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn list_media_cards(&self) -> AppResult<Vec<UiMediaCardData>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                m.id,
                COALESCE(s.id, 0),
                COALESCE(NULLIF(s.title_cn, ''), s.title, m.file_name),
                m.file_name,
                CASE
                    WHEN m.match_ignored = 1 THEN '已忽略'
                    WHEN s.id IS NULL AND c.id IS NOT NULL THEN '待确认'
                    WHEN s.id IS NULL THEN '未匹配'
                    WHEN l.confirmed = 0 THEN '待确认'
                    ELSE '已匹配'
                END,
                CASE
                    WHEN m.match_ignored = 1 THEN 'ignored'
                    WHEN s.id IS NULL AND c.id IS NOT NULL THEN 'tentative'
                    WHEN s.id IS NULL THEN 'unmatched'
                    WHEN l.confirmed = 0 THEN 'tentative'
                    ELSE 'matched'
                END,
                COALESCE(CAST((wp.position_ms * 100) / NULLIF(wp.duration_ms, 0) AS INTEGER), 0),
                COALESCE(mel.episode_title, ''),
                COALESCE(pic.local_path, '')
            FROM media_items m
            LEFT JOIN (
                SELECT media_id, subject_id, confirmed, MAX(updated_at)
                FROM media_subject_links
                GROUP BY media_id
            ) l ON l.media_id = m.id
            LEFT JOIN subjects s ON s.id = l.subject_id
            LEFT JOIN watch_progress wp ON wp.media_id = m.id
            LEFT JOIN media_episode_links mel ON mel.media_id = m.id
            LEFT JOIN subject_image_cache pic
                ON pic.subject_id = s.id AND pic.image_kind = 'poster'
            LEFT JOIN (
                SELECT media_id, MAX(id) AS id
                FROM metadata_candidates
                WHERE selected = 1
                GROUP BY media_id
            ) c ON c.media_id = m.id
            WHERE m.deleted_at IS NULL
            ORDER BY title COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            let poster_path: String = row.get(8)?;
            Ok(UiMediaCardData {
                media_id: row.get(0)?,
                subject_id: row.get(1)?,
                title: row.get(2)?,
                subtitle: row.get(3)?,
                status_text: row.get(4)?,
                match_status: row.get(5)?,
                progress_percent: row.get::<_, i64>(6)? as i32,
                episode_text: row.get(7)?,
                has_cached_poster: !poster_path.is_empty(),
                poster_path,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn library_counts(&self) -> AppResult<(usize, usize, usize)> {
        let conn = self.connect()?;
        let indexed = conn.query_row(
            "SELECT COUNT(*) FROM media_items WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )? as usize;
        let matched = conn.query_row(
            r#"
            SELECT COUNT(DISTINCT media_id)
            FROM media_subject_links l
            JOIN media_items m ON m.id = l.media_id
            WHERE m.deleted_at IS NULL
            "#,
            [],
            |row| row.get::<_, i64>(0),
        )? as usize;
        Ok((indexed, matched, indexed.saturating_sub(matched)))
    }

    pub fn tentative_count(&self) -> AppResult<usize> {
        let conn = self.connect()?;
        let count = conn.query_row(
            r#"
            SELECT COUNT(DISTINCT c.media_id)
            FROM metadata_candidates c
            LEFT JOIN media_subject_links l ON l.media_id = c.media_id
            JOIN media_items m ON m.id = c.media_id
            WHERE c.selected = 1 AND l.media_id IS NULL AND m.deleted_at IS NULL AND m.match_ignored = 0
            "#,
            [],
            |row| row.get::<_, i64>(0),
        )? as usize;
        Ok(count)
    }

    pub fn unmatched_media(&self) -> AppResult<Vec<MediaItem>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT m.id, m.path, m.file_name, m.file_size, m.modified_at, m.file_hash, m.match_ignored, m.deleted_at
            FROM media_items m
            LEFT JOIN media_subject_links l ON l.media_id = m.id
            WHERE m.deleted_at IS NULL AND m.match_ignored = 0 AND l.media_id IS NULL
            ORDER BY m.file_name COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map([], map_media_item)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn metadata_scrape_targets(&self) -> AppResult<Vec<MediaItem>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            WITH suspicious_anime AS (
                SELECT dm.anime_id
                FROM danmaku_matches dm
                JOIN media_items m ON m.id = dm.media_id AND m.deleted_at IS NULL
                JOIN media_subject_links l ON l.media_id = m.id
                LEFT JOIN episodes e ON e.subject_id = l.subject_id
                WHERE dm.exact = 1 AND dm.anime_id IS NOT NULL
                GROUP BY dm.anime_id
                HAVING COUNT(DISTINCT m.id) > 1
                    AND (
                        (COUNT(DISTINCT l.subject_id) = 1 AND COUNT(DISTINCT e.id) <= 1)
                        OR COUNT(DISTINCT l.subject_id) > 1
                    )
            )
            SELECT DISTINCT
                m.id, m.path, m.file_name, m.file_size, m.modified_at,
                m.file_hash, m.match_ignored, m.deleted_at
            FROM media_items m
            LEFT JOIN media_subject_links l ON l.media_id = m.id
            LEFT JOIN danmaku_matches dm ON dm.media_id = m.id
            WHERE m.deleted_at IS NULL
                AND m.match_ignored = 0
                AND (
                    l.media_id IS NULL
                    OR dm.anime_id IN (SELECT anime_id FROM suspicious_anime)
                )
            ORDER BY m.file_name COLLATE NOCASE
            "#,
        )?;
        let rows = stmt.query_map([], map_media_item)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn upsert_subject_from_search(
        &self,
        subject: &SubjectSearchResult,
        now: i64,
    ) -> AppResult<i64> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO subjects
                (provider, provider_subject_id, title, title_cn, summary, air_date, rating, rank,
                 image_large, image_common, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11)
            ON CONFLICT(provider, provider_subject_id) DO UPDATE SET
                title = excluded.title,
                title_cn = excluded.title_cn,
                summary = COALESCE(excluded.summary, subjects.summary),
                air_date = COALESCE(excluded.air_date, subjects.air_date),
                rating = COALESCE(excluded.rating, subjects.rating),
                rank = COALESCE(excluded.rank, subjects.rank),
                image_large = COALESCE(excluded.image_large, subjects.image_large),
                image_common = COALESCE(excluded.image_common, subjects.image_common),
                updated_at = excluded.updated_at
            "#,
            params![
                subject.provider,
                subject.provider_subject_id,
                subject.title,
                subject.title_cn,
                subject.summary,
                subject.air_date,
                subject.rating,
                subject.rank,
                subject.image_large,
                subject.image_common,
                now
            ],
        )?;
        self.find_subject_id(&subject.provider, &subject.provider_subject_id)
    }

    pub fn upsert_metadata_candidates(
        &self,
        media_id: i64,
        candidates: &[SubjectSearchResult],
        source: &str,
        now: i64,
    ) -> AppResult<Vec<MetadataCandidate>> {
        let conn = self.connect()?;
        for (index, candidate) in candidates.iter().enumerate() {
            let confidence = match (source, index) {
                ("dandanplay_exact", 0) => 0.95,
                (_, 0) => 0.72,
                _ => 0.42,
            };
            let selected = if index == 0 { 1 } else { 0 };
            conn.execute(
                r#"
                INSERT INTO metadata_candidates
                    (media_id, provider, provider_subject_id, title, title_cn, summary, air_date,
                     rating, rank, image_large, image_common, confidence, source, selected,
                     created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
                ON CONFLICT(media_id, provider, provider_subject_id) DO UPDATE SET
                    title = excluded.title,
                    title_cn = excluded.title_cn,
                    summary = excluded.summary,
                    air_date = excluded.air_date,
                    rating = excluded.rating,
                    rank = excluded.rank,
                    image_large = excluded.image_large,
                    image_common = excluded.image_common,
                    confidence = excluded.confidence,
                    source = excluded.source,
                    selected = excluded.selected,
                    updated_at = excluded.updated_at
                "#,
                params![
                    media_id,
                    candidate.provider,
                    candidate.provider_subject_id,
                    candidate.title,
                    candidate.title_cn,
                    candidate.summary,
                    candidate.air_date,
                    candidate.rating,
                    candidate.rank,
                    candidate.image_large,
                    candidate.image_common,
                    confidence,
                    source,
                    selected,
                    now
                ],
            )?;
        }
        self.list_candidates_for_media(media_id)
    }

    pub fn list_candidates_for_media(&self, media_id: i64) -> AppResult<Vec<MetadataCandidate>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, media_id, provider, provider_subject_id, title, title_cn, summary,
                   air_date, rating, rank, image_large, image_common, confidence, source, selected
            FROM metadata_candidates
            WHERE media_id = ?1
            ORDER BY selected DESC, confidence DESC, updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map(params![media_id], map_candidate)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn selected_candidate_for_media(
        &self,
        media_id: i64,
    ) -> AppResult<Option<MetadataCandidate>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT id, media_id, provider, provider_subject_id, title, title_cn, summary,
                   air_date, rating, rank, image_large, image_common, confidence, source, selected
            FROM metadata_candidates
            WHERE media_id = ?1 AND selected = 1
            ORDER BY confidence DESC, updated_at DESC
            LIMIT 1
            "#,
            params![media_id],
            map_candidate,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn get_candidate(&self, candidate_id: i64) -> AppResult<Option<MetadataCandidate>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT id, media_id, provider, provider_subject_id, title, title_cn, summary,
                   air_date, rating, rank, image_large, image_common, confidence, source, selected
            FROM metadata_candidates
            WHERE id = ?1
            "#,
            params![candidate_id],
            map_candidate,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn select_candidate(&self, media_id: i64, candidate_id: i64, now: i64) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE metadata_candidates SET selected = 0, updated_at = ?2 WHERE media_id = ?1",
            params![media_id, now],
        )?;
        conn.execute(
            "UPDATE metadata_candidates SET selected = 1, updated_at = ?3 WHERE media_id = ?1 AND id = ?2",
            params![media_id, candidate_id, now],
        )?;
        Ok(())
    }

    pub fn upsert_subject_from_candidate(
        &self,
        candidate: &MetadataCandidate,
        now: i64,
    ) -> AppResult<i64> {
        let search = SubjectSearchResult {
            provider: candidate.provider.clone(),
            provider_subject_id: candidate.provider_subject_id.clone(),
            title: candidate.title.clone(),
            title_cn: candidate.title_cn.clone(),
            summary: candidate.summary.clone(),
            air_date: candidate.air_date.clone(),
            rating: candidate.rating,
            rank: candidate.rank,
            image_large: candidate.image_large.clone(),
            image_common: candidate.image_common.clone(),
            aliases: Vec::new(),
            episode_count: None,
        };
        self.upsert_subject_from_search(&search, now)
    }

    pub fn upsert_subject_detail(&self, detail: &SubjectDetail, now: i64) -> AppResult<i64> {
        let conn = self.connect()?;
        let tags = serde_json::to_string(&detail.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            r#"
            INSERT INTO subjects
                (provider, provider_subject_id, title, title_cn, summary, air_date, rating, rank,
                 image_large, image_common, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
            ON CONFLICT(provider, provider_subject_id) DO UPDATE SET
                title = excluded.title,
                title_cn = excluded.title_cn,
                summary = excluded.summary,
                air_date = excluded.air_date,
                rating = excluded.rating,
                rank = excluded.rank,
                image_large = excluded.image_large,
                image_common = excluded.image_common,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            "#,
            params![
                detail.provider,
                detail.provider_subject_id,
                detail.title,
                detail.title_cn,
                detail.summary,
                detail.air_date,
                detail.rating,
                detail.rank,
                detail.images.large,
                detail.images.common,
                tags,
                now
            ],
        )?;
        self.find_subject_id(&detail.provider, &detail.provider_subject_id)
    }

    pub fn upsert_subject_episodes(
        &self,
        subject_id: i64,
        episodes: &[SubjectEpisode],
    ) -> AppResult<()> {
        let conn = self.connect()?;
        for episode in episodes {
            conn.execute(
                r#"
                INSERT INTO episodes
                    (subject_id, provider_episode_id, sort_number, title, title_cn, air_date)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(subject_id, provider_episode_id) DO UPDATE SET
                    sort_number = excluded.sort_number,
                    title = excluded.title,
                    title_cn = excluded.title_cn,
                    air_date = excluded.air_date
                "#,
                params![
                    subject_id,
                    episode.provider_episode_id,
                    episode.ep_number.unwrap_or(episode.sort_number),
                    episode.title,
                    episode.title_cn,
                    episode.air_date
                ],
            )?;
        }
        Ok(())
    }

    pub fn link_media_episode_by_number(
        &self,
        media_id: i64,
        subject_id: i64,
        episode_number: Option<f64>,
        episode_title: Option<&str>,
        confidence: f64,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        let episode = episode_number.and_then(|number| {
            conn.query_row(
                r#"
                    SELECT id, COALESCE(NULLIF(title_cn, ''), title), sort_number
                    FROM episodes
                    WHERE subject_id = ?1 AND ABS(sort_number - ?2) < 0.001
                    ORDER BY id
                    LIMIT 1
                    "#,
                params![subject_id, number],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<f64>>(2)?.unwrap_or(number),
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()
        });

        let (episode_id, title, number) = match episode {
            Some((id, title, number)) => (Some(id), Some(title), Some(number)),
            None => (
                None,
                episode_title.map(str::to_string),
                episode_number.or_else(|| {
                    infer_episode_number_from_media(media_id, &conn)
                        .ok()
                        .flatten()
                }),
            ),
        };

        conn.execute(
            r#"
            INSERT INTO media_episode_links
                (media_id, episode_id, episode_title, episode_number, match_source, confidence)
            VALUES (?1, ?2, ?3, ?4, 'episode_inference', ?5)
            ON CONFLICT(media_id) DO UPDATE SET
                episode_id = excluded.episode_id,
                episode_title = excluded.episode_title,
                episode_number = excluded.episode_number,
                match_source = excluded.match_source,
                confidence = excluded.confidence
            "#,
            params![media_id, episode_id, title, number, confidence],
        )?;
        let _ = now;
        Ok(())
    }

    pub fn link_media_subject(
        &self,
        media_id: i64,
        subject_id: i64,
        match_source: &str,
        confidence: f64,
        confirmed: bool,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO media_subject_links
                (media_id, subject_id, match_source, confidence, confirmed, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(media_id, subject_id) DO UPDATE SET
                match_source = excluded.match_source,
                confidence = excluded.confidence,
                confirmed = excluded.confirmed,
                updated_at = excluded.updated_at
            "#,
            params![
                media_id,
                subject_id,
                match_source,
                confidence,
                if confirmed { 1 } else { 0 },
                now
            ],
        )?;
        Ok(())
    }

    pub fn replace_media_subject_link(
        &self,
        media_id: i64,
        subject_id: i64,
        match_source: &str,
        confidence: f64,
        confirmed: bool,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "DELETE FROM media_subject_links WHERE media_id = ?1 AND subject_id <> ?2",
            params![media_id, subject_id],
        )?;
        drop(conn);
        self.link_media_subject(
            media_id,
            subject_id,
            match_source,
            confidence,
            confirmed,
            now,
        )
    }

    pub fn subject_episode_count(&self, subject_id: i64) -> AppResult<usize> {
        let conn = self.connect()?;
        let count = conn.query_row(
            "SELECT COUNT(*) FROM episodes WHERE subject_id = ?1",
            params![subject_id],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(count as usize)
    }

    pub fn get_subject(&self, subject_id: i64) -> AppResult<Option<Subject>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT id, provider, provider_subject_id, title, title_cn, summary, air_date,
                   rating, rank, image_large, image_common
            FROM subjects WHERE id = ?1
            "#,
            params![subject_id],
            |row| {
                Ok(Subject {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    provider_subject_id: row.get(2)?,
                    title: row.get(3)?,
                    title_cn: row.get(4)?,
                    summary: row.get(5)?,
                    air_date: row.get(6)?,
                    rating: row.get(7)?,
                    rank: row.get(8)?,
                    image_large: row.get(9)?,
                    image_common: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn subject_for_media(&self, media_id: i64) -> AppResult<Option<Subject>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT s.id, s.provider, s.provider_subject_id, s.title, s.title_cn, s.summary,
                   s.air_date, s.rating, s.rank, s.image_large, s.image_common
            FROM media_subject_links l
            JOIN subjects s ON s.id = l.subject_id
            WHERE l.media_id = ?1
            ORDER BY l.confirmed DESC, l.updated_at DESC
            LIMIT 1
            "#,
            params![media_id],
            |row| {
                Ok(Subject {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    provider_subject_id: row.get(2)?,
                    title: row.get(3)?,
                    title_cn: row.get(4)?,
                    summary: row.get(5)?,
                    air_date: row.get(6)?,
                    rating: row.get(7)?,
                    rank: row.get(8)?,
                    image_large: row.get(9)?,
                    image_common: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn upsert_image_cache(
        &self,
        subject_id: i64,
        image_kind: &str,
        source_url: &str,
        local_path: &Path,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO subject_image_cache
                (subject_id, image_kind, source_url, local_path, downloaded_at, last_accessed_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(subject_id, image_kind) DO UPDATE SET
                source_url = excluded.source_url,
                local_path = excluded.local_path,
                downloaded_at = excluded.downloaded_at,
                last_accessed_at = excluded.last_accessed_at
            "#,
            params![
                subject_id,
                image_kind,
                source_url,
                local_path.to_string_lossy(),
                now
            ],
        )?;
        Ok(())
    }

    pub fn external_subject_mapping(
        &self,
        provider: &str,
        external_id: &str,
    ) -> AppResult<Option<i64>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT subject_id FROM external_subject_mappings WHERE provider = ?1 AND external_id = ?2",
            params![provider, external_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn upsert_external_subject_mapping(
        &self,
        provider: &str,
        external_id: &str,
        subject_id: i64,
        title: Option<&str>,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO external_subject_mappings
                (provider, external_id, subject_id, title, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(provider, external_id) DO UPDATE SET
                subject_id = excluded.subject_id,
                title = excluded.title,
                updated_at = excluded.updated_at
            "#,
            params![provider, external_id, subject_id, title, now],
        )?;
        Ok(())
    }

    pub fn get_image_cache(
        &self,
        subject_id: i64,
        image_kind: &str,
    ) -> AppResult<Option<SubjectImageCache>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT subject_id, image_kind, source_url, local_path
            FROM subject_image_cache
            WHERE subject_id = ?1 AND image_kind = ?2
            "#,
            params![subject_id, image_kind],
            |row| {
                Ok(SubjectImageCache {
                    subject_id: row.get(0)?,
                    image_kind: row.get(1)?,
                    source_url: row.get(2)?,
                    local_path: PathBuf::from(row.get::<_, String>(3)?),
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn subject_detail_for_media(&self, media_id: i64) -> AppResult<UiSubjectDetailData> {
        let media = self
            .get_media(media_id)?
            .ok_or(crate::error::AppError::MediaNotFound)?;
        let subject = self.subject_for_media(media_id)?;
        let files = vec![format!(
            "{}  ({} MB, modified_at={})",
            media.path.display(),
            media.file_size / 1024 / 1024,
            media.modified_at
        )];

        if let Some(subject) = subject {
            let confirmed = self.media_subject_confirmed(media_id, subject.id)?;
            let poster = self
                .get_image_cache(subject.id, "poster")?
                .map(|cache| cache.local_path.display().to_string())
                .unwrap_or_default();
            let hero = self
                .get_image_cache(subject.id, "hero")?
                .map(|cache| cache.local_path.display().to_string())
                .unwrap_or_default();
            let poster_cached = !poster.is_empty();
            let hero_cached = !hero.is_empty();
            Ok(UiSubjectDetailData {
                media_id,
                subject_id: subject.id,
                title: subject.title,
                title_cn: subject.title_cn.unwrap_or_default(),
                summary: subject
                    .summary
                    .unwrap_or_else(|| "No summary cached yet.".to_string()),
                air_date: subject.air_date.unwrap_or_else(|| "-".to_string()),
                rating_text: subject
                    .rating
                    .map(|rating| format!("{rating:.1}"))
                    .unwrap_or_else(|| "-".to_string()),
                rank_text: subject
                    .rank
                    .map(|rank| format!("#{rank}"))
                    .unwrap_or_else(|| "-".to_string()),
                poster_path: poster,
                hero_path: hero,
                match_status: if confirmed { "已匹配" } else { "待确认" }.to_string(),
                cache_status: format!(
                    "poster: {}, hero: {}",
                    if poster_cached {
                        "cached"
                    } else {
                        "not cached"
                    },
                    if hero_cached { "cached" } else { "not cached" }
                ),
                files,
                episodes: self.ui_episodes_for_subject(subject.id, media_id)?,
            })
        } else if let Some(candidate) = self.selected_candidate_for_media(media_id)? {
            Ok(UiSubjectDetailData {
                media_id,
                subject_id: 0,
                title: candidate
                    .title_cn
                    .clone()
                    .filter(|title| !title.is_empty())
                    .unwrap_or(candidate.title),
                title_cn: candidate.title_cn.unwrap_or_default(),
                summary: candidate
                    .summary
                    .unwrap_or_else(|| "候选已保存，确认后会拉取完整条目信息和图片。".to_string()),
                air_date: candidate.air_date.unwrap_or_else(|| "-".to_string()),
                rating_text: candidate
                    .rating
                    .map(|rating| format!("{rating:.1}"))
                    .unwrap_or_else(|| "-".to_string()),
                rank_text: candidate
                    .rank
                    .map(|rank| format!("#{rank}"))
                    .unwrap_or_else(|| "-".to_string()),
                poster_path: String::new(),
                hero_path: String::new(),
                match_status: "待确认".to_string(),
                cache_status: "poster: not cached, hero: not cached".to_string(),
                files,
                episodes: Vec::new(),
            })
        } else {
            Ok(UiSubjectDetailData {
                media_id,
                subject_id: 0,
                title: media.file_name.clone(),
                title_cn: String::new(),
                summary: "未匹配。可以在这里搜索 Bangumi 候选并绑定。".to_string(),
                air_date: "-".to_string(),
                rating_text: "-".to_string(),
                rank_text: "-".to_string(),
                poster_path: String::new(),
                hero_path: String::new(),
                match_status: "未匹配".to_string(),
                cache_status: "poster: not cached, hero: not cached".to_string(),
                files,
                episodes: Vec::new(),
            })
        }
    }

    fn ui_episodes_for_subject(&self, subject_id: i64, media_id: i64) -> AppResult<Vec<String>> {
        let conn = self.connect()?;
        let current = conn
            .query_row(
                "SELECT episode_id FROM media_episode_links WHERE media_id = ?1",
                params![media_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, sort_number, COALESCE(NULLIF(title_cn, ''), title), air_date
            FROM episodes
            WHERE subject_id = ?1
            ORDER BY sort_number, id
            LIMIT 200
            "#,
        )?;
        let rows = stmt.query_map(params![subject_id], |row| {
            let id = row.get::<_, i64>(0)?;
            let sort = row.get::<_, Option<f64>>(1)?.unwrap_or_default();
            let title = row
                .get::<_, Option<String>>(2)?
                .unwrap_or_else(|| "-".to_string());
            let air_date = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let marker = if Some(id) == current { "Now  " } else { "" };
            Ok(format!(
                "{marker}EP{}  {title}  {air_date}",
                format_episode_number(sort)
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn ignore_media_match(&self, media_id: i64, now: i64) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE media_items SET match_ignored = 1, updated_at = ?2 WHERE id = ?1",
            params![media_id, now],
        )?;
        conn.execute(
            "UPDATE metadata_candidates SET selected = 0, updated_at = ?2 WHERE media_id = ?1",
            params![media_id, now],
        )?;
        Ok(())
    }

    pub fn clear_media_match_ignore(&self, media_id: i64, now: i64) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE media_items SET match_ignored = 0, updated_at = ?2 WHERE id = ?1",
            params![media_id, now],
        )?;
        Ok(())
    }

    pub fn ui_candidates_for_media(&self, media_id: i64) -> AppResult<Vec<UiCandidateData>> {
        Ok(self
            .list_candidates_for_media(media_id)?
            .into_iter()
            .map(|candidate| UiCandidateData {
                candidate_id: candidate.id,
                media_id: candidate.media_id,
                title: candidate
                    .title_cn
                    .clone()
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| candidate.title.clone()),
                subtitle: format!(
                    "{}  {}  confidence {:.0}%",
                    candidate.provider,
                    candidate
                        .air_date
                        .clone()
                        .unwrap_or_else(|| "date unknown".to_string()),
                    candidate.confidence * 100.0
                ),
                summary: candidate
                    .summary
                    .unwrap_or_else(|| "No summary in candidate.".to_string()),
                score_text: candidate
                    .rating
                    .map(|rating| format!("{rating:.1}"))
                    .unwrap_or_else(|| "-".to_string()),
                selected: candidate.selected,
            })
            .collect())
    }

    fn find_subject_id(&self, provider: &str, provider_subject_id: &str) -> AppResult<i64> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id FROM subjects WHERE provider = ?1 AND provider_subject_id = ?2",
            params![provider, provider_subject_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
    }

    fn media_subject_confirmed(&self, media_id: i64, subject_id: i64) -> AppResult<bool> {
        let conn = self.connect()?;
        let confirmed = conn
            .query_row(
                "SELECT confirmed FROM media_subject_links WHERE media_id = ?1 AND subject_id = ?2",
                params![media_id, subject_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or_default();
        Ok(confirmed != 0)
    }

    pub fn needs_hash_update(
        &self,
        path: &Path,
        file_size: u64,
        modified_at: i64,
    ) -> AppResult<bool> {
        let conn = self.connect()?;
        let path = path.to_string_lossy().to_string();
        let existing = conn
            .query_row(
                "SELECT file_size, modified_at, file_hash, deleted_at FROM media_items WHERE path = ?1",
                params![path],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?;

        Ok(match existing {
            None => true,
            Some((size, modified, hash, deleted_at)) => {
                size != file_size as i64
                    || modified != modified_at
                    || hash.is_none()
                    || deleted_at.is_some()
            }
        })
    }

    pub fn upsert_scanned_media(&self, file: &MediaFile, now: i64) -> AppResult<ScanUpsertStatus> {
        let conn = self.connect()?;
        let path = file.path.to_string_lossy().to_string();

        let existing = conn
            .query_row(
                "SELECT id, file_size, modified_at, deleted_at FROM media_items WHERE path = ?1",
                params![path],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?;

        match existing {
            None => {
                conn.execute(
                    r#"
                    INSERT INTO media_items
                        (path, file_name, file_size, modified_at, file_hash, deleted_at, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)
                    "#,
                    params![
                        file.path.to_string_lossy(),
                        file.file_name,
                        file.file_size as i64,
                        file.modified_at,
                        file.file_hash,
                        now
                    ],
                )?;
                Ok(ScanUpsertStatus::Added)
            }
            Some((_id, size, modified_at, deleted_at)) => {
                let changed = size != file.file_size as i64
                    || modified_at != file.modified_at
                    || file.file_hash.is_some();
                if changed || deleted_at.is_some() {
                    conn.execute(
                        r#"
                        UPDATE media_items
                        SET file_name = ?2,
                            file_size = ?3,
                            modified_at = ?4,
                            file_hash = ?5,
                            deleted_at = NULL,
                            updated_at = ?6
                        WHERE path = ?1
                        "#,
                        params![
                            file.path.to_string_lossy(),
                            file.file_name,
                            file.file_size as i64,
                            file.modified_at,
                            file.file_hash,
                            now
                        ],
                    )?;

                    if deleted_at.is_some() {
                        Ok(ScanUpsertStatus::Restored)
                    } else {
                        Ok(ScanUpsertStatus::Modified)
                    }
                } else {
                    Ok(ScanUpsertStatus::Unchanged)
                }
            }
        }
    }

    pub fn mark_missing_under_roots(
        &self,
        roots: &[PathBuf],
        seen_paths: &[PathBuf],
        now: i64,
    ) -> AppResult<usize> {
        let conn = self.connect()?;
        let active = self.list_media(false)?;
        let mut deleted = 0;

        for item in active {
            let under_scan_root = roots.iter().any(|root| item.path.starts_with(root));
            let still_seen = seen_paths.iter().any(|path| path == &item.path);
            if under_scan_root && !still_seen {
                conn.execute(
                    "UPDATE media_items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                    params![item.id, now],
                )?;
                deleted += 1;
            }
        }

        Ok(deleted)
    }

    pub fn get_progress(&self, media_id: i64) -> AppResult<Option<WatchProgress>> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT media_id, position_ms, duration_ms, updated_at FROM watch_progress WHERE media_id = ?1",
            params![media_id],
            |row| {
                Ok(WatchProgress {
                    media_id: row.get(0)?,
                    position_ms: row.get(1)?,
                    duration_ms: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn save_progress(
        &self,
        media_id: i64,
        position_ms: i64,
        duration_ms: i64,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO watch_progress (media_id, position_ms, duration_ms, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(media_id) DO UPDATE SET
                position_ms = excluded.position_ms,
                duration_ms = excluded.duration_ms,
                updated_at = excluded.updated_at
            "#,
            params![media_id, position_ms, duration_ms, now],
        )?;
        Ok(())
    }

    pub fn clear_progress(&self, media_id: i64) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            "DELETE FROM watch_progress WHERE media_id = ?1",
            params![media_id],
        )?;
        Ok(())
    }

    pub fn upsert_danmaku_match(
        &self,
        media_id: i64,
        result: &DanmakuMatch,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO danmaku_matches
                (media_id, provider, title, anime_id, episode_id, anime_title, episode,
                 comment_count, exact, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(media_id) DO UPDATE SET
                provider = excluded.provider,
                title = excluded.title,
                anime_id = excluded.anime_id,
                episode_id = excluded.episode_id,
                anime_title = excluded.anime_title,
                episode = excluded.episode,
                comment_count = excluded.comment_count,
                exact = excluded.exact,
                updated_at = excluded.updated_at
            "#,
            params![
                media_id,
                result.provider,
                result.title,
                result.anime_id,
                result.episode_id,
                result.anime_title,
                result.episode,
                result.comment_count as i64,
                if result.exact { 1 } else { 0 },
                now
            ],
        )?;
        Ok(())
    }

    pub fn danmaku_match_for_media(&self, media_id: i64) -> AppResult<Option<DanmakuMatch>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT provider, title, anime_id, episode_id, anime_title, episode, comment_count, exact
            FROM danmaku_matches
            WHERE media_id = ?1
            "#,
            params![media_id],
            |row| {
                Ok(DanmakuMatch {
                    provider: row.get(0)?,
                    title: row.get(1)?,
                    anime_id: row.get(2)?,
                    episode_id: row.get(3)?,
                    anime_title: row.get(4)?,
                    episode: row.get(5)?,
                    comment_count: row.get::<_, i64>(6)? as usize,
                    exact: row.get::<_, i64>(7)? != 0,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn danmaku_comment_cache(
        &self,
        provider: &str,
        episode_id: i64,
        variant: &str,
    ) -> AppResult<Option<DanmakuCommentCache>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT provider, episode_id, variant, payload_json, comment_count, fetched_at, expires_at, error
            FROM danmaku_comment_cache
            WHERE provider = ?1 AND episode_id = ?2 AND variant = ?3
            "#,
            params![provider, episode_id, variant],
            |row| {
                Ok(DanmakuCommentCache {
                    provider: row.get(0)?,
                    episode_id: row.get(1)?,
                    variant: row.get(2)?,
                    payload_json: row.get(3)?,
                    comment_count: row.get::<_, i64>(4)? as usize,
                    fetched_at: row.get(5)?,
                    expires_at: row.get(6)?,
                    error: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn upsert_danmaku_comment_cache(&self, cache: &DanmakuCommentCache) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO danmaku_comment_cache
                (provider, episode_id, variant, payload_json, comment_count, fetched_at, expires_at, error)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(provider, episode_id, variant) DO UPDATE SET
                payload_json = excluded.payload_json,
                comment_count = excluded.comment_count,
                fetched_at = excluded.fetched_at,
                expires_at = excluded.expires_at,
                error = excluded.error
            "#,
            params![
                cache.provider.as_str(),
                cache.episode_id,
                cache.variant.as_str(),
                cache.payload_json.as_str(),
                cache.comment_count as i64,
                cache.fetched_at,
                cache.expires_at,
                cache.error.as_deref(),
            ],
        )?;
        Ok(())
    }

    pub fn mark_danmaku_comment_cache_error(
        &self,
        provider: &str,
        episode_id: i64,
        variant: &str,
        error: &str,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            UPDATE danmaku_comment_cache
            SET error = ?4
            WHERE provider = ?1 AND episode_id = ?2 AND variant = ?3
            "#,
            params![provider, episode_id, variant, error],
        )?;
        Ok(())
    }

    pub fn upsert_resource_candidate(
        &self,
        candidate: &ResourceCandidate,
        now: i64,
    ) -> AppResult<i64> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO resource_candidates
                (subject_provider, provider_subject_id, episode_number, provider, title,
                 subtitle_group, resolution, torrent_url, page_url, info_hash, size_text,
                 seeders, leechers, downloads, trusted, remake, batch, published_at,
                 created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19, ?19)
            ON CONFLICT(provider, torrent_url) DO UPDATE SET
                subject_provider = excluded.subject_provider,
                provider_subject_id = excluded.provider_subject_id,
                episode_number = excluded.episode_number,
                title = excluded.title,
                subtitle_group = excluded.subtitle_group,
                resolution = excluded.resolution,
                page_url = excluded.page_url,
                info_hash = excluded.info_hash,
                size_text = excluded.size_text,
                seeders = excluded.seeders,
                leechers = excluded.leechers,
                downloads = excluded.downloads,
                trusted = excluded.trusted,
                remake = excluded.remake,
                batch = excluded.batch,
                published_at = excluded.published_at,
                updated_at = excluded.updated_at
            "#,
            params![
                candidate.subject_provider,
                candidate.provider_subject_id,
                candidate.episode_number,
                candidate.provider,
                candidate.title,
                candidate.subtitle_group,
                candidate.resolution,
                candidate.torrent_url,
                candidate.page_url,
                candidate.info_hash,
                candidate.size_text,
                candidate.seeders,
                candidate.leechers,
                candidate.downloads,
                if candidate.trusted { 1 } else { 0 },
                if candidate.remake { 1 } else { 0 },
                if candidate.batch { 1 } else { 0 },
                candidate.published_at,
                now
            ],
        )?;
        conn.query_row(
            "SELECT id FROM resource_candidates WHERE provider = ?1 AND torrent_url = ?2",
            params![candidate.provider, candidate.torrent_url],
            |row| row.get(0),
        )
        .map_err(Into::into)
    }

    pub fn create_download_task(&self, task: &DownloadTask, now: i64) -> AppResult<DownloadTask> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            INSERT INTO download_tasks
                (resource_id, subject_provider, provider_subject_id, episode_number, title,
                 torrent_url, info_hash, qbittorrent_hash, status, progress, save_path, error,
                 created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
            "#,
            params![
                task.resource_id,
                task.subject_provider,
                task.provider_subject_id,
                task.episode_number,
                task.title,
                task.torrent_url,
                task.info_hash,
                task.qbittorrent_hash,
                task.status,
                task.progress,
                task.save_path,
                task.error,
                now
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_download_task(id)?.ok_or_else(|| {
            crate::error::AppError::Api("download task was not inserted".to_string())
        })
    }

    pub fn update_download_task_status(
        &self,
        task_id: i64,
        status: &str,
        progress: f64,
        qbittorrent_hash: Option<&str>,
        save_path: Option<&str>,
        error: Option<&str>,
        now: i64,
    ) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute(
            r#"
            UPDATE download_tasks
            SET status = ?2,
                progress = ?3,
                qbittorrent_hash = COALESCE(?4, qbittorrent_hash),
                save_path = COALESCE(?5, save_path),
                error = ?6,
                updated_at = ?7
            WHERE id = ?1
            "#,
            params![
                task_id,
                status,
                progress,
                qbittorrent_hash,
                save_path,
                error,
                now
            ],
        )?;
        Ok(())
    }

    pub fn get_download_task(&self, task_id: i64) -> AppResult<Option<DownloadTask>> {
        let conn = self.connect()?;
        conn.query_row(
            r#"
            SELECT id, resource_id, subject_provider, provider_subject_id, episode_number,
                   title, torrent_url, info_hash, qbittorrent_hash, status, progress,
                   save_path, error, updated_at
            FROM download_tasks
            WHERE id = ?1
            "#,
            params![task_id],
            map_download_task,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn list_download_tasks(&self) -> AppResult<Vec<DownloadTask>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, resource_id, subject_provider, provider_subject_id, episode_number,
                   title, torrent_url, info_hash, qbittorrent_hash, status, progress,
                   save_path, error, updated_at
            FROM download_tasks
            ORDER BY updated_at DESC, id DESC
            LIMIT 100
            "#,
        )?;
        let rows = stmt.query_map([], map_download_task)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_download_task(&self, task_id: i64) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM download_tasks WHERE id = ?1", params![task_id])?;
        Ok(())
    }

    fn connect(&self) -> AppResult<Connection> {
        if let Some(parent) = self
            .db_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent).map_err(|err| crate::error::io_error(parent, err))?;
        }
        let conn = Connection::open(&self.db_path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }
}

fn map_media_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaItem> {
    let path: String = row.get(1)?;
    Ok(MediaItem {
        id: row.get(0)?,
        path: Path::new(&path).to_path_buf(),
        file_name: row.get(2)?,
        file_size: row.get::<_, i64>(3)? as u64,
        modified_at: row.get(4)?,
        file_hash: row.get(5)?,
        match_ignored: row.get::<_, i64>(6)? != 0,
        deleted_at: row.get(7)?,
    })
}

fn map_download_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadTask> {
    Ok(DownloadTask {
        id: row.get(0)?,
        resource_id: row.get(1)?,
        subject_provider: row.get(2)?,
        provider_subject_id: row.get(3)?,
        episode_number: row.get(4)?,
        title: row.get(5)?,
        torrent_url: row.get(6)?,
        info_hash: row.get(7)?,
        qbittorrent_hash: row.get(8)?,
        status: row.get(9)?,
        progress: row.get(10)?,
        save_path: row.get(11)?,
        error: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn infer_episode_number_from_media(
    media_id: i64,
    conn: &Connection,
) -> rusqlite::Result<Option<f64>> {
    let file_name = conn.query_row(
        "SELECT file_name FROM media_items WHERE id = ?1",
        params![media_id],
        |row| row.get::<_, String>(0),
    )?;
    Ok(infer_episode_number(&file_name))
}

fn infer_episode_number(file_name: &str) -> Option<f64> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let mut best = None;
    let mut current = String::new();
    for ch in stem.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_digit() {
            current.push(ch);
            continue;
        }
        if (1..=3).contains(&current.len())
            && let Ok(value) = current.parse::<i64>()
            && (1..=999).contains(&value)
        {
            best = Some(value as f64);
        }
        current.clear();
    }
    best
}

fn format_episode_number(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{value:.1}")
    }
}

fn map_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<MetadataCandidate> {
    Ok(MetadataCandidate {
        id: row.get(0)?,
        media_id: row.get(1)?,
        provider: row.get(2)?,
        provider_subject_id: row.get(3)?,
        title: row.get(4)?,
        title_cn: row.get(5)?,
        summary: row.get(6)?,
        air_date: row.get(7)?,
        rating: row.get(8)?,
        rank: row.get(9)?,
        image_large: row.get(10)?,
        image_common: row.get(11)?,
        confidence: row.get::<_, Option<f64>>(12)?.unwrap_or_default(),
        source: row.get(13)?,
        selected: row.get::<_, i64>(14)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn upserts_media_and_persists_watch_progress() {
        let db_path =
            std::env::temp_dir().join(format!("nexplay-test-{}.sqlite3", std::process::id()));
        let _ = fs::remove_file(&db_path);

        let repository = Repository::new(db_path.clone());
        repository.init().expect("init database");

        let file = MediaFile {
            path: PathBuf::from("/tmp/example/episode01.mkv"),
            file_name: "episode01.mkv".to_string(),
            file_size: 1024,
            modified_at: 100,
            file_hash: None,
        };

        let status = repository
            .upsert_scanned_media(&file, 1)
            .expect("insert media");
        assert_eq!(status, ScanUpsertStatus::Added);

        let mut changed = file.clone();
        changed.file_size = 2048;
        let status = repository
            .upsert_scanned_media(&changed, 2)
            .expect("update media");
        assert_eq!(status, ScanUpsertStatus::Modified);

        let media = repository.list_media(false).expect("list media");
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].file_size, 2048);

        repository
            .save_progress(media[0].id, 1234, 5678, 9)
            .expect("save progress");
        let progress = repository
            .get_progress(media[0].id)
            .expect("read progress")
            .expect("progress exists");
        assert_eq!(progress.position_ms, 1234);
        assert_eq!(progress.duration_ms, 5678);

        repository
            .clear_progress(media[0].id)
            .expect("clear progress");
        assert!(
            repository
                .get_progress(media[0].id)
                .expect("read cleared progress")
                .is_none()
        );

        let _ = fs::remove_file(db_path);
    }

    #[test]
    fn persists_danmaku_comment_cache() {
        let db_path = std::env::temp_dir().join(format!(
            "nexplay-danmaku-cache-test-{}.sqlite3",
            std::process::id()
        ));
        let _ = fs::remove_file(&db_path);

        let repository = Repository::new(db_path.clone());
        repository.init().expect("init database");

        let cache = DanmakuCommentCache {
            provider: "dandanplay".to_string(),
            episode_id: 123,
            variant: "withRelated=true;chConvert=1".to_string(),
            payload_json: "[]".to_string(),
            comment_count: 0,
            fetched_at: 1000,
            expires_at: 2000,
            error: None,
        };
        repository
            .upsert_danmaku_comment_cache(&cache)
            .expect("write cache");

        let cached = repository
            .danmaku_comment_cache("dandanplay", 123, "withRelated=true;chConvert=1")
            .expect("read cache")
            .expect("cache exists");
        assert_eq!(cached.payload_json, "[]");
        assert_eq!(cached.fetched_at, 1000);
        assert_eq!(cached.expires_at, 2000);

        repository
            .mark_danmaku_comment_cache_error(
                "dandanplay",
                123,
                "withRelated=true;chConvert=1",
                "network failed",
            )
            .expect("mark error");
        let cached = repository
            .danmaku_comment_cache("dandanplay", 123, "withRelated=true;chConvert=1")
            .expect("read cache")
            .expect("cache exists");
        assert_eq!(cached.error.as_deref(), Some("network failed"));

        let _ = fs::remove_file(db_path);
    }
}
