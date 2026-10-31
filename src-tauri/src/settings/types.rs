use serde::{Deserialize, Serialize};
use crate::terabox::types::ApiEndpointConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_dir: String,
    pub max_connections: u32,
    pub split_count: u32,
    pub min_split_size: String,
    pub user_agent: String,
    pub auto_start_aria2: bool,
    pub theme: String,
    pub max_overall_download_limit_kb_per_sec: u64,
    pub max_download_limit_kb_per_sec: u64,
    #[serde(default = "default_api_endpoints")]
    pub api_endpoints: Vec<ApiEndpointConfig>,
    #[serde(default)]
    pub terabox_cookie: Option<String>,
    #[serde(default = "default_concurrent")]
    pub max_concurrent: u32,
}

fn default_concurrent() -> u32 {
    3
}

fn default_api_endpoints() -> Vec<ApiEndpointConfig> {
    vec![
        ApiEndpointConfig {
            id: "default-ntm".to_string(),
            name: "NTM TeraBox API".to_string(),
            url: "https://api-free.ntmterabox.me/".to_string(),
            token: None,
            enabled: true,
        },
        ApiEndpointConfig {
            id: "default-fast".to_string(),
            name: "Fast Tera API".to_string(),
            url: "https://terabox-api.saiyanprojects.com/".to_string(),
            token: None,
            enabled: true,
        },
    ]
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: "downloads".to_string(),
            max_connections: 16,
            split_count: 16,
            min_split_size: "1M".to_string(),
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
            auto_start_aria2: true,
            theme: "system".to_string(),
            max_overall_download_limit_kb_per_sec: 0,
            max_download_limit_kb_per_sec: 0,
            api_endpoints: default_api_endpoints(),
            terabox_cookie: None,
            max_concurrent: 3,
        }
    }
}

impl AppSettings {
    pub fn format_bandwidth(kb_per_sec: u64) -> String {
        if kb_per_sec == 0 {
            "Unlimited".to_string()
        } else if kb_per_sec >= 1024 {
            format!("{:.2} MB/s", kb_per_sec as f64 / 1024.0)
        } else {
            format!("{} KB/s", kb_per_sec)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHistoryItem {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub size: u64,
    pub status: String,
    pub downloaded_at: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DownloadHistory {
    pub items: Vec<DownloadHistoryItem>,
}
