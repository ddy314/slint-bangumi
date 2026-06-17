#![allow(dead_code)]

mod app;
mod backend_api;
mod config;
mod domain;
mod error;
mod metadata;
mod repository;
mod service;
mod task;

use crate::app::AppContext;
use crate::backend_api::{scan, snapshot};
use crate::config::ConfigStore;
use crate::error::AppResult;

fn main() -> AppResult<()> {
    let config = ConfigStore::load_or_create("config.toml")?;
    let context = AppContext::new(config)?;
    let command = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "snapshot".to_string());

    match command.as_str() {
        "snapshot" => print_json(&snapshot(&context)?)?,
        "scan" => print_json(&scan(&context)?)?,
        "help" | "--help" | "-h" => {
            println!("NexPlay backend commands:");
            println!("  snapshot  print the current library snapshot as JSON");
            println!("  scan      scan configured media libraries and print JSON");
        }
        other => {
            return Err(crate::error::AppError::Config(format!(
                "unknown backend command: {other}"
            )));
        }
    }

    Ok(())
}

fn print_json<T: serde::Serialize>(value: &T) -> AppResult<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}
