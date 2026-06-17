use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::blocking::Client;

use crate::error::{AppResult, io_error};

#[derive(Clone)]
pub struct ImageCache {
    root: PathBuf,
    client: Client,
}

impl ImageCache {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("slint-bangumi/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { root, client })
    }

    pub fn subject_image_path(&self, provider: &str, subject_id: i64, kind: &str) -> PathBuf {
        self.root
            .join(provider)
            .join("subjects")
            .join(subject_id.to_string())
            .join(format!("{kind}.jpg"))
    }

    pub fn download_subject_image(
        &self,
        provider: &str,
        subject_id: i64,
        kind: &str,
        url: &str,
    ) -> AppResult<PathBuf> {
        let path = self.subject_image_path(provider, subject_id, kind);
        if path.is_file() {
            return Ok(path);
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| io_error(parent, err))?;
        }

        let tmp = path.with_extension("jpg.tmp");
        let bytes = self.client.get(url).send()?.error_for_status()?.bytes()?;
        fs::write(&tmp, bytes).map_err(|err| io_error(&tmp, err))?;
        fs::rename(&tmp, &path).map_err(|err| io_error(&path, err))?;
        Ok(path)
    }
}
