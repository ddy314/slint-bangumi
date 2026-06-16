use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::domain::{MediaFile, MediaItem, ScanUpsertStatus, WatchProgress};
use crate::error::AppResult;

#[derive(Debug, Clone)]
pub struct Repository {
    db_path: PathBuf,
}

impl Repository {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub fn init(&self) -> AppResult<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS media_items (
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

            CREATE INDEX IF NOT EXISTS idx_media_items_deleted_at
                ON media_items(deleted_at);

            CREATE TABLE IF NOT EXISTS watch_progress (
                media_id INTEGER PRIMARY KEY,
                position_ms INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(media_id) REFERENCES media_items(id) ON DELETE CASCADE
            );
            "#,
        )?;
        Ok(())
    }

    pub fn list_media(&self, include_deleted: bool) -> AppResult<Vec<MediaItem>> {
        let conn = self.connect()?;
        let sql = if include_deleted {
            "SELECT id, path, file_name, file_size, modified_at, file_hash, deleted_at FROM media_items ORDER BY file_name COLLATE NOCASE"
        } else {
            "SELECT id, path, file_name, file_size, modified_at, file_hash, deleted_at FROM media_items WHERE deleted_at IS NULL ORDER BY file_name COLLATE NOCASE"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], map_media_item)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
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
                let changed = size != file.file_size as i64 || modified_at != file.modified_at;
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
        deleted_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn upserts_media_and_persists_watch_progress() {
        let db_path =
            std::env::temp_dir().join(format!("slint-bangumi-test-{}.sqlite3", std::process::id()));
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
}
