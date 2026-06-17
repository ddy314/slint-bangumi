use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, io_error};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub media_libraries: Vec<PathBuf>,
    pub dandanplay: DandanplayConfig,
    #[serde(default)]
    pub bangumi: BangumiConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DandanplayConfig {
    pub app_id: String,
    pub app_secret: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiConfig {
    pub enabled: bool,
    pub base_url: String,
    pub access_token: String,
    pub user_agent: String,
    pub request_timeout_secs: u64,
    pub auto_match: bool,
    pub cache_images: bool,
}

impl Default for BangumiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            base_url: "https://api.bgm.tv".to_string(),
            access_token: String::new(),
            user_agent: format!("slint-bangumi/{}", env!("CARGO_PKG_VERSION")),
            request_timeout_secs: 20,
            auto_match: true,
            cache_images: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database: DatabaseConfig {
                path: PathBuf::from("data/slint-bangumi.sqlite3"),
            },
            media_libraries: Vec::new(),
            dandanplay: DandanplayConfig {
                app_id: String::new(),
                app_secret: String::new(),
                api_key: String::new(),
            },
            bangumi: BangumiConfig::default(),
            logging: LoggingConfig {
                level: "info".to_string(),
            },
        }
    }
}

#[derive(Debug)]
pub struct ConfigStore {
    path: PathBuf,
    config: Mutex<AppConfig>,
}

impl ConfigStore {
    pub fn load_or_create(path: impl Into<PathBuf>) -> AppResult<Self> {
        let path = path.into();
        if !path.exists() {
            let default_config = AppConfig::default();
            write_config(&path, &default_config)?;
            return Ok(Self {
                path,
                config: Mutex::new(default_config),
            });
        }

        let raw = fs::read_to_string(&path).map_err(|err| io_error(&path, err))?;
        let config: AppConfig = toml::from_str(&raw).map_err(|err| {
            AppError::Config(format!("failed to parse {}: {err}", path.display()))
        })?;

        Ok(Self {
            path,
            config: Mutex::new(config),
        })
    }

    pub fn snapshot(&self) -> AppConfig {
        self.config.lock().expect("config mutex poisoned").clone()
    }

    pub fn add_media_library(&self, path: PathBuf) -> AppResult<Vec<PathBuf>> {
        if !path.is_dir() {
            return Err(AppError::InvalidMediaDirectory(path));
        }

        let canonical = path
            .canonicalize()
            .map_err(|err| io_error(path.clone(), err))?;

        let mut config = self.config.lock().expect("config mutex poisoned");
        if !config.media_libraries.iter().any(|item| item == &canonical) {
            config.media_libraries.push(canonical);
            write_config(&self.path, &config)?;
        }

        Ok(config.media_libraries.clone())
    }
}

fn write_config(path: &Path, config: &AppConfig) -> AppResult<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| io_error(parent, err))?;
    }

    let raw = toml::to_string_pretty(config)
        .map_err(|err| AppError::Config(format!("failed to serialize config: {err}")))?;
    fs::write(path, raw).map_err(|err| io_error(path, err))
}
