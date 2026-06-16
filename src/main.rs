mod app;
mod config;
mod domain;
mod error;
mod repository;
mod service;
mod task;
mod ui;

slint::include_modules!();

use crate::app::AppContext;
use crate::config::ConfigStore;
use crate::error::AppResult;
use crate::ui::bridge;

fn main() -> AppResult<()> {
    let config = ConfigStore::load_or_create("config.toml")?;
    let context = AppContext::new(config)?;
    let window = MainWindow::new()?;

    let bridge_state = bridge::bind(window.as_weak(), context.clone())?;
    bridge::start_event_pump(window.as_weak(), context, bridge_state)?;

    window.run()?;
    Ok(())
}
