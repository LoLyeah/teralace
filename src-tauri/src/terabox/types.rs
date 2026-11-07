use serde::{Deserialize, Serialize};

/// Computed file info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeraboxFileInfo {
    pub is_dir: bool,
    pub fs_id: String,
    pub name: String,
    pub file_type: String,
    pub size: Option<i64>,
    pub size_formatted: Option<String>,
    pub category: Option<String>,
    pub create_time: Option<i64>,
    pub thumb: Option<String>,
    /// Direct download link if provided directly by the fetch API
    pub direct_link: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeraboxInfo {
    pub ok: bool,
    pub shareid: i64,
    pub uk: i64,
    pub sign: String,
    pub timestamp: i64,
    #[serde(default)]
    pub list: Vec<TeraboxFileInfo>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub resolved_by: Option<String>,
    #[serde(default)]
    pub surl: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadParams {
    pub shareid: i64,
    pub uk: i64,
    pub sign: String,
    pub timestamp: i64,
    pub fs_id: String,
    #[serde(default = "default_mode")]
    pub mode: i32, // 1 for Server 1, 2 for Server 2
    pub direct_link: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub surl: Option<String>,
}

fn default_mode() -> i32 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub ok: bool,
    pub download_link: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareMeta {
    pub shareid: i64,
    pub uk: i64,
    pub sign: String,
    pub timestamp: i64,
    pub total: i64,
}

/// Endpoint configuration model for storage and frontend IPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpointConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub token: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Health stats returned to frontend for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointHealthInfo {
    pub id: String,
    pub name: String,
    pub healthy: bool,
    pub success_count: u64,
    pub failure_count: u64,
    pub total_requests: u64,
    pub success_rate: String,
    pub avg_latency_ms: u64,
    pub circuit_open: bool,
    pub circuit_remaining_s: u64,
}

// ============ API Response Formats ============

/// abdul97233 / ntmterabox style API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbdulApiResponse {
    pub ok: Option<bool>,
    pub status: Option<String>,
    pub files: Option<Vec<AbdulFileItem>>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbdulFileItem {
    pub filename: Option<String>,
    pub file_name: Option<String>,
    pub size: Option<serde_json::Value>,
    pub size_readable: Option<String>,
    pub download_url: Option<String>,
    pub direct_link: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    pub thumb: Option<String>,
    pub fs_id: Option<serde_json::Value>,
    pub is_dir: Option<serde_json::Value>,
}

/// Legacy Trauso Worker Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInfoResponse {
    pub ok: bool,
    pub shareid: Option<i64>,
    pub uk: Option<i64>,
    pub sign: Option<String>,
    pub timestamp: Option<i64>,
    pub list: Option<Vec<WorkerFileItem>>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerFileItem {
    pub category: Option<String>,
    #[serde(deserialize_with = "deserialize_string_or_number")]
    pub fs_id: String,
    #[serde(deserialize_with = "deserialize_string_or_number")]
    pub is_dir: String,
    #[serde(deserialize_with = "deserialize_string_or_number")]
    pub size: String,
    pub filename: String,
    pub create_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDownloadResponse {
    pub ok: bool,
    pub retry: Option<bool>,
    #[serde(rename = "downloadLink")]
    pub download_link: Option<String>,
    pub message: Option<String>,
}

pub fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        _ => Err(serde::de::Error::custom("Expected string or number")),
    }
}
