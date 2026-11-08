use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Active,
    Waiting,
    Paused,
    Complete,
    Error,
    Removed,
}

impl From<&str> for DownloadStatus {
    fn from(s: &str) -> Self {
        match s {
            "active" => DownloadStatus::Active,
            "waiting" => DownloadStatus::Waiting,
            "paused" => DownloadStatus::Paused,
            "complete" => DownloadStatus::Complete,
            "error" => DownloadStatus::Error,
            "removed" => DownloadStatus::Removed,
            _ => DownloadStatus::Error,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
    pub gid: String,
    pub filename: String,
    pub total_size: u64,
    pub downloaded: u64,
    pub speed: u64,
    pub progress: f64,
    pub status: DownloadStatus,
    pub error_message: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub dir: Option<String>,
    pub out: Option<String>,
    pub max_connections: Option<usize>,
    pub user_agent: Option<String>,
    pub headers: Option<Vec<(String, String)>>,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        Self {
            dir: None,
            out: None,
            max_connections: Some(8),
            user_agent: Some("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string()),
            headers: None,
        }
    }
}
