use crate::settings::types::*;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static SETTINGS: Mutex<Option<AppSettings>> = Mutex::new(None);
static HISTORY: Mutex<Option<DownloadHistory>> = Mutex::new(None);

pub fn load_settings() -> AppSettings {
    let mut settings_guard = SETTINGS.lock().unwrap();

    if let Some(ref settings) = *settings_guard {
        return settings.clone();
    }

    let config_dir = get_config_dir();
    let path = config_dir.join("settings.json");
    let mut settings: AppSettings = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        AppSettings::default()
    };

    let default_endpoints = default_api_endpoints();
    if !settings
        .api_endpoints
        .iter()
        .any(|ep| ep.id == "default-teralace" || ep.url.contains("teralace.secretrizqi.workers.dev"))
    {
        if let Some(default_ep) = default_endpoints.first() {
            settings.api_endpoints.insert(0, default_ep.clone());
        }
    }

    *settings_guard = Some(settings.clone());
    settings
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let config_dir = get_config_dir();
    let path = config_dir.join("settings.json");
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    let mut settings_guard = SETTINGS.lock().unwrap();
    *settings_guard = Some(settings.clone());

    Ok(())
}

pub fn load_history() -> DownloadHistory {
    let mut history_guard = HISTORY.lock().unwrap();

    if let Some(ref history) = *history_guard {
        return history.clone();
    }

    let config_dir = get_config_dir();
    let path = config_dir.join("history.json");
    let history = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        DownloadHistory::default()
    };

    *history_guard = Some(history.clone());
    history
}

pub fn save_history(history: &DownloadHistory) -> Result<(), String> {
    let config_dir = get_config_dir();
    let path = config_dir.join("history.json");
    let content = serde_json::to_string_pretty(history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("Failed to write history: {}", e))?;

    let mut history_guard = HISTORY.lock().unwrap();
    *history_guard = Some(history.clone());

    Ok(())
}

pub fn add_history_item(item: DownloadHistoryItem) -> Result<(), String> {
    let mut history = load_history();
    history.items.insert(0, item);

    if history.items.len() > 100 {
        history.items.truncate(100);
    }

    save_history(&history)
}

pub fn clear_history() -> Result<(), String> {
    save_history(&DownloadHistory::default())
}

fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("teralace")
}

