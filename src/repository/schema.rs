use rusqlite::{Connection, Transaction};
use rusqlite_migration::{M, Migrations};

use crate::error::AppResult;

const BASELINE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    file_hash TEXT,
    match_ignored INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_items_deleted_at
    ON media_items(deleted_at);

CREATE TABLE IF NOT EXISTS watch_progress (
    media_id INTEGER PRIMARY KEY,
    position_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_subject_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_cn TEXT,
    summary TEXT,
    air_date TEXT,
    rating REAL,
    rank INTEGER,
    image_large TEXT,
    image_common TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_subject_id)
);

CREATE TABLE IF NOT EXISTS media_subject_links (
    media_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    match_source TEXT NOT NULL,
    confidence REAL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(media_id, subject_id),
    FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_subject_links_media
    ON media_subject_links(media_id);

CREATE TABLE IF NOT EXISTS subject_image_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    image_kind TEXT NOT NULL,
    source_url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    content_hash TEXT,
    width INTEGER,
    height INTEGER,
    downloaded_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL,
    UNIQUE(subject_id, image_kind),
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    provider_episode_id TEXT,
    sort_number REAL,
    title TEXT,
    title_cn TEXT,
    air_date TEXT,
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_episode_links (
    media_id INTEGER NOT NULL,
    episode_id INTEGER,
    episode_title TEXT,
    episode_number REAL,
    match_source TEXT,
    confidence REAL,
    FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metadata_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_subject_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_cn TEXT,
    summary TEXT,
    air_date TEXT,
    rating REAL,
    rank INTEGER,
    image_large TEXT,
    image_common TEXT,
    confidence REAL,
    source TEXT NOT NULL,
    selected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(media_id, provider, provider_subject_id),
    FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_subject_provider
    ON episodes(subject_id, provider_episode_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_episode_links_media
    ON media_episode_links(media_id);

CREATE TABLE IF NOT EXISTS danmaku_matches (
    media_id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    title TEXT NOT NULL,
    anime_id INTEGER,
    episode_id INTEGER,
    anime_title TEXT,
    episode TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0,
    exact INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_subject_mappings (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(provider, external_id),
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);
"#;

const DANMAKU_COMMENT_CACHE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS danmaku_comment_cache (
    provider TEXT NOT NULL,
    episode_id INTEGER NOT NULL,
    variant TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    comment_count INTEGER NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    error TEXT,
    PRIMARY KEY(provider, episode_id, variant)
);

CREATE INDEX IF NOT EXISTS idx_danmaku_comment_cache_expires_at
    ON danmaku_comment_cache(expires_at);
"#;

const ONLINE_CATALOG_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS online_subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_subject_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_cn TEXT,
    summary TEXT,
    air_date TEXT,
    rating REAL,
    rank INTEGER,
    image_large TEXT,
    image_common TEXT,
    episode_count INTEGER NOT NULL DEFAULT 0,
    source_payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_subject_id)
);

CREATE TABLE IF NOT EXISTS resource_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_provider TEXT NOT NULL,
    provider_subject_id TEXT NOT NULL,
    episode_number REAL,
    provider TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle_group TEXT,
    resolution TEXT,
    torrent_url TEXT NOT NULL,
    page_url TEXT,
    info_hash TEXT,
    size_text TEXT,
    seeders INTEGER NOT NULL DEFAULT 0,
    leechers INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    remake INTEGER NOT NULL DEFAULT 0,
    batch INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, torrent_url)
);

CREATE TABLE IF NOT EXISTS download_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER,
    subject_provider TEXT NOT NULL,
    provider_subject_id TEXT NOT NULL,
    episode_number REAL,
    title TEXT NOT NULL,
    torrent_url TEXT NOT NULL,
    info_hash TEXT,
    qbittorrent_hash TEXT,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    save_path TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(resource_id) REFERENCES resource_candidates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_candidates_subject
    ON resource_candidates(subject_provider, provider_subject_id, episode_number);

CREATE INDEX IF NOT EXISTS idx_download_tasks_subject
    ON download_tasks(subject_provider, provider_subject_id, episode_number);
"#;

const BANGUMI_ACCOUNT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS bangumi_accounts (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type TEXT,
    scope TEXT,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bangumi_subject_collections (
    subject_id INTEGER PRIMARY KEY,
    subject_type INTEGER NOT NULL DEFAULT 2,
    collection_type INTEGER NOT NULL,
    rate INTEGER NOT NULL DEFAULT 0,
    comment TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    ep_status INTEGER NOT NULL DEFAULT 0,
    vol_status INTEGER NOT NULL DEFAULT 0,
    private INTEGER NOT NULL DEFAULT 0,
    subject_json TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bangumi_subject_collections_type
    ON bangumi_subject_collections(collection_type, rate);

CREATE TABLE IF NOT EXISTS bangumi_episode_collections (
    episode_id INTEGER PRIMARY KEY,
    subject_id INTEGER NOT NULL,
    sort_number REAL,
    ep_number REAL,
    title TEXT,
    title_cn TEXT,
    air_date TEXT,
    collection_type INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bangumi_episode_collections_subject
    ON bangumi_episode_collections(subject_id, sort_number, episode_id);

CREATE TABLE IF NOT EXISTS bangumi_sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    subject_id INTEGER,
    episode_id INTEGER,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bangumi_sync_queue_pending
    ON bangumi_sync_queue(updated_at, id);

CREATE TABLE IF NOT EXISTS bangumi_sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    subject_id INTEGER,
    episode_id INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bangumi_sync_logs_created
    ON bangumi_sync_logs(created_at DESC);
"#;

pub fn init_database(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let migrations = Migrations::new(vec![
        M::up_with_hook(BASELINE_SCHEMA, |tx: &Transaction| {
            add_column_if_missing(
                tx,
                "media_items",
                "match_ignored",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            Ok(())
        })
        .comment("baseline NexPlay media library schema"),
        M::up(DANMAKU_COMMENT_CACHE_SCHEMA).comment("cache normalized dandanplay comments"),
        M::up(ONLINE_CATALOG_SCHEMA).comment("cache online catalog resources and downloads"),
        M::up(BANGUMI_ACCOUNT_SCHEMA).comment("store Bangumi account collections and sync queue"),
    ]);
    migrations.to_latest(conn)?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let existing: String = row.get(1)?;
        if existing == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_fresh_database_at_baseline_version() {
        let mut conn = Connection::open_in_memory().expect("open db");
        init_database(&mut conn).expect("migrate");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read version");
        assert_eq!(version, 4);
        assert!(column_exists(&conn, "media_items", "match_ignored"));
        assert!(table_exists(&conn, "danmaku_comment_cache"));
        assert!(table_exists(&conn, "online_subjects"));
        assert!(table_exists(&conn, "resource_candidates"));
        assert!(table_exists(&conn, "download_tasks"));
        assert!(table_exists(&conn, "bangumi_accounts"));
        assert!(table_exists(&conn, "bangumi_subject_collections"));
        assert!(table_exists(&conn, "bangumi_episode_collections"));
        assert!(table_exists(&conn, "bangumi_sync_queue"));
    }

    #[test]
    fn upgrades_legacy_database_missing_match_ignored() {
        let mut conn = Connection::open_in_memory().expect("open db");
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                modified_at INTEGER NOT NULL,
                file_hash TEXT,
                deleted_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )
        .expect("legacy schema");

        init_database(&mut conn).expect("migrate");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read version");
        assert_eq!(version, 4);
        assert!(column_exists(&conn, "media_items", "match_ignored"));
        assert!(table_exists(&conn, "danmaku_comment_cache"));
        assert!(table_exists(&conn, "online_subjects"));
        assert!(table_exists(&conn, "resource_candidates"));
        assert!(table_exists(&conn, "download_tasks"));
        assert!(table_exists(&conn, "bangumi_accounts"));
        assert!(table_exists(&conn, "bangumi_subject_collections"));
        assert!(table_exists(&conn, "bangumi_episode_collections"));
    }

    #[test]
    fn upgrades_without_losing_watch_progress() {
        let mut conn = Connection::open_in_memory().expect("open db");
        Migrations::new(vec![M::up(BASELINE_SCHEMA)])
            .to_latest(&mut conn)
            .expect("baseline");
        conn.execute(
            "INSERT INTO media_items (path, file_name, file_size, modified_at, created_at, updated_at)
             VALUES ('/tmp/a.mkv', 'a.mkv', 1, 1, 1, 1)",
            [],
        )
        .expect("media");
        conn.execute(
            "INSERT INTO watch_progress (media_id, position_ms, duration_ms, updated_at)
             VALUES (1, 1234, 5678, 9)",
            [],
        )
        .expect("progress");

        init_database(&mut conn).expect("migrate");

        let progress: (i64, i64, i64) = conn
            .query_row(
                "SELECT media_id, position_ms, duration_ms FROM watch_progress WHERE media_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read progress");
        assert_eq!(progress, (1, 1234, 5678));
        assert!(table_exists(&conn, "bangumi_subject_collections"));
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table info");
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("columns");
        rows.filter_map(Result::ok).any(|name| name == column)
    }

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |_| Ok(()),
        )
        .is_ok()
    }
}
