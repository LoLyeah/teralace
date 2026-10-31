use crate::terabox::load_balancer::{InternalEndpoint, LoadBalancer};
use crate::terabox::normalizer::normalize_terabox_url;
use crate::terabox::types::*;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CACHE_CONTROL, COOKIE, ORIGIN, REFERER, USER_AGENT};
use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

pub struct TeraboxApi {
    client: Client,
    pub balancer: Arc<LoadBalancer>,
}

impl TeraboxApi {
    pub fn new(initial_endpoints: &[ApiEndpointConfig]) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .gzip(true)
            .deflate(true)
            .build()
            .expect("Failed to build HTTP client");

        let balancer = Arc::new(LoadBalancer::new(initial_endpoints));
        Self { client, balancer }
    }

    fn default_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
        headers.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("en-US,en;q=0.9,id;q=0.8"),
        );
        headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        headers
    }

    /// Fetches file information for any TeraBox link
    pub async fn get_info(
        &self,
        raw_url: &str,
        user_cookie: Option<&str>,
    ) -> Result<TeraboxInfo, String> {
        let (canonical_url, surl) = normalize_terabox_url(raw_url)
            .ok_or_else(|| "Invalid TeraBox URL format. Please paste a valid TeraBox share link.".to_string())?;

        let mut errors: Vec<String> = Vec::new();

        // 1. Try Load-Balanced API Endpoints (abdul97233 / ntmterabox pool)
        let max_attempts = 3;
        for attempt in 1..=max_attempts {
            if let Some(endpoint) = self.balancer.next_endpoint().await {
                let start_time = Instant::now();
                match self.fetch_from_endpoint(&endpoint, &canonical_url).await {
                    Ok(info) => {
                        let latency = start_time.elapsed().as_millis() as u64;
                        self.balancer.report_success(&endpoint.id, latency).await;
                        log::info!("[LB] Succeeded with endpoint '{}' in {}ms", endpoint.name, latency);
                        return Ok(info);
                    }
                    Err(err) => {
                        self.balancer.report_failure(&endpoint.id).await;
                        log::warn!("[LB] Attempt {} failed on '{}': {}", attempt, endpoint.name, err);
                        errors.push(format!("{}: {}", endpoint.name, err));
                    }
                }
            } else {
                break; // No more healthy endpoints
            }
        }

        // 2. Fallback: Direct Scraping with Client Session & Optional Cookie
        log::info!("[Fetch] Trying Direct TeraBox Scraper Fallback for surl: {}", surl);
        match self.fetch_direct_terabox(&surl, user_cookie).await {
            Ok(info) => return Ok(info),
            Err(direct_err) => {
                errors.push(format!("Direct scraper: {}", direct_err));
            }
        }

        // 3. Fallback: Legacy Trauso Worker if available
        match self.fetch_legacy_worker(&canonical_url, &surl).await {
            Ok(info) => return Ok(info),
            Err(legacy_err) => {
                errors.push(format!("Legacy worker: {}", legacy_err));
            }
        }

        Err(format!(
            "Failed to fetch TeraBox link. All resolvers failed:\n• {}",
            errors.join("\n• ")
        ))
    }

    /// Fetch using an abdul97233 / ntmterabox compatible endpoint
    async fn fetch_from_endpoint(
        &self,
        endpoint: &InternalEndpoint,
        target_url: &str,
    ) -> Result<TeraboxInfo, String> {
        let req_url = endpoint.build_request_url(target_url);

        let resp = self
            .client
            .get(&req_url)
            .headers(Self::default_headers())
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP status {}", resp.status()));
        }

        let body_text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;

        // Parse JSON response
        let data: AbdulApiResponse = serde_json::from_str(&body_text)
            .map_err(|e| format!("Invalid JSON response: {}", e))?;

        let is_ok = data.ok.unwrap_or(false) || data.status.as_deref() == Some("success");
        if !is_ok {
            let msg = data.message.unwrap_or_else(|| "API returned ok=false".to_string());
            return Err(msg);
        }

        let files = data.files.ok_or_else(|| "Empty file list in API response".to_string())?;
        if files.is_empty() {
            return Err("No files found in share link".to_string());
        }

        let mut list: Vec<TeraboxFileInfo> = Vec::new();

        for (idx, f) in files.into_iter().enumerate() {
            let name = f.file_name.or(f.filename).unwrap_or_else(|| format!("file_{}", idx + 1));
            let fs_id = match f.fs_id {
                Some(serde_json::Value::String(s)) => s,
                Some(serde_json::Value::Number(n)) => n.to_string(),
                _ => (idx + 1).to_string(),
            };

            let size_num: Option<i64> = match f.size {
                Some(serde_json::Value::Number(n)) => n.as_i64(),
                Some(serde_json::Value::String(s)) => s.parse::<i64>().ok(),
                _ => None,
            };

            let is_dir = match f.is_dir {
                Some(serde_json::Value::Bool(b)) => b,
                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
                Some(serde_json::Value::String(s)) => s == "1" || s == "true",
                _ => false,
            };

            let direct_link = f.download_url.or(f.direct_link);
            let file_type = if is_dir {
                "folder".to_string()
            } else {
                Self::detect_file_type(&name)
            };

            list.push(TeraboxFileInfo {
                is_dir,
                fs_id,
                name,
                file_type,
                size: size_num,
                size_formatted: f.size_readable,
                category: None,
                create_time: None,
                thumb: f.thumb,
                direct_link,
            });
        }

        Ok(TeraboxInfo {
            ok: true,
            shareid: 0,
            uk: 0,
            sign: String::new(),
            timestamp: 0,
            list,
            error_message: None,
            resolved_by: Some(endpoint.name.clone()),
        })
    }

    /// Direct TeraBox mobile/web API scraper fallback with optional cookie
    async fn fetch_direct_terabox(
        &self,
        surl: &str,
        user_cookie: Option<&str>,
    ) -> Result<TeraboxInfo, String> {
        if surl.is_empty() {
            return Err("No surl available for direct extraction".to_string());
        }

        let clean_surl = surl.trim_start_matches('1');
        let api_url = format!(
            "https://www.terabox.app/share/list?app_id=250528&shorturl={}&root=1",
            clean_surl
        );

        let mut headers = Self::default_headers();
        headers.insert(REFERER, HeaderValue::from_static("https://www.terabox.app/"));
        headers.insert(ORIGIN, HeaderValue::from_static("https://www.terabox.app"));

        if let Some(cookie) = user_cookie {
            if !cookie.trim().is_empty() {
                if let Ok(c_val) = HeaderValue::from_str(cookie.trim()) {
                    headers.insert(COOKIE, c_val);
                }
            }
        }

        let resp = self
            .client
            .get(&api_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Direct request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Direct API HTTP {}", resp.status()));
        }

        let text = resp.text().await.map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

        let errno = v.get("errno").and_then(|e| e.as_i64()).unwrap_or(-1);
        if errno != 0 {
            return Err(format!("TeraBox returned errno: {}", errno));
        }

        let list_val = v.get("list").and_then(|l| l.as_array()).ok_or("No list array in direct response")?;
        let mut files: Vec<TeraboxFileInfo> = Vec::new();

        for item in list_val {
            let name = item.get("server_filename").and_then(|n| n.as_str()).unwrap_or("file").to_string();
            let fs_id = item.get("fs_id").map(|f| f.to_string()).unwrap_or_default();
            let size = item.get("size").and_then(|s| s.as_i64()).or_else(|| {
                item.get("size").and_then(|s| s.as_str()).and_then(|s| s.parse().ok())
            });
            let is_dir = item.get("isdir").and_then(|d| d.as_i64()).unwrap_or(0) == 1;
            let dlink = item.get("dlink").and_then(|d| d.as_str()).map(|s| s.to_string());
            let thumb = item.get("thumbs").and_then(|t| t.get("url3")).and_then(|u| u.as_str()).map(|s| s.to_string());

            let file_type = if is_dir {
                "folder".to_string()
            } else {
                Self::detect_file_type(&name)
            };

            files.push(TeraboxFileInfo {
                is_dir,
                fs_id,
                name,
                file_type,
                size,
                size_formatted: None,
                category: None,
                create_time: item.get("server_mtime").and_then(|m| m.as_i64()),
                thumb,
                direct_link: dlink,
            });
        }

        let shareid = v.get("shareid").and_then(|s| s.as_i64()).unwrap_or(0);
        let uk = v.get("uk").and_then(|u| u.as_i64()).unwrap_or(0);
        let sign = v.get("sign").and_then(|s| s.as_str()).unwrap_or_default().to_string();
        let timestamp = v.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);

        Ok(TeraboxInfo {
            ok: true,
            shareid,
            uk,
            sign,
            timestamp,
            list: files,
            error_message: None,
            resolved_by: Some("Direct TeraBox Scraper".to_string()),
        })
    }

    /// Legacy Trauso Cloudflare Worker fallback
    async fn fetch_legacy_worker(&self, _url: &str, surl: &str) -> Result<TeraboxInfo, String> {
        let worker_base = "https://terabox.hnn.workers.dev";
        let req_url = format!("{}/api/get-info-new?shorturl={}", worker_base, surl);

        let resp = self
            .client
            .get(&req_url)
            .headers(Self::default_headers())
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Worker status {}", resp.status()));
        }

        let data: WorkerInfoResponse = resp.json().await.map_err(|e| e.to_string())?;
        if !data.ok {
            return Err(data.message.unwrap_or_else(|| "Worker ok=false".to_string()));
        }

        let raw_list = data.list.unwrap_or_default();
        let files = raw_list
            .into_iter()
            .map(|item| {
                let is_dir = item.is_dir == "1";
                let size = if is_dir { None } else { item.size.parse().ok() };
                let file_type = if is_dir {
                    "folder".to_string()
                } else {
                    Self::detect_file_type(&item.filename)
                };

                TeraboxFileInfo {
                    is_dir,
                    fs_id: item.fs_id,
                    name: item.filename,
                    file_type,
                    size,
                    size_formatted: None,
                    category: item.category,
                    create_time: item.create_time.and_then(|t| t.parse().ok()),
                    thumb: None,
                    direct_link: None,
                }
            })
            .collect();

        Ok(TeraboxInfo {
            ok: true,
            shareid: data.shareid.unwrap_or(0),
            uk: data.uk.unwrap_or(0),
            sign: data.sign.unwrap_or_default(),
            timestamp: data.timestamp.unwrap_or(0),
            list: files,
            error_message: None,
            resolved_by: Some("Worker Fallback".to_string()),
        })
    }

    /// Resolves the final direct download link for a file
    pub async fn get_download_link(&self, params: DownloadParams) -> Result<DownloadLink, String> {
        // If direct_link was already resolved during get_info, return it immediately!
        if let Some(dl) = params.direct_link {
            if !dl.trim().is_empty() {
                return Ok(DownloadLink {
                    ok: true,
                    download_link: Some(dl),
                    error_message: None,
                });
            }
        }

        // Otherwise, request download link from worker endpoints
        let worker_base = "https://terabox.hnn.workers.dev";
        let endpoint = if params.mode == 1 {
            "/api/get-download"
        } else {
            "/api/get-downloadp"
        };

        let request_body = serde_json::json!({
            "shareid": params.shareid,
            "uk": params.uk,
            "sign": params.sign,
            "timestamp": params.timestamp,
            "fs_id": params.fs_id,
        });

        let resp = self
            .client
            .post(format!("{}{}", worker_base, endpoint))
            .headers(Self::default_headers())
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Download link request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }

        let data: WorkerDownloadResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse download response: {}", e))?;

        if data.ok && data.download_link.is_some() {
            Ok(DownloadLink {
                ok: true,
                download_link: data.download_link,
                error_message: None,
            })
        } else {
            Err(data.message.unwrap_or_else(|| "Failed to resolve download link".to_string()))
        }
    }

    pub fn detect_file_type(name: &str) -> String {
        let name_lower = name.to_lowercase();
        let video_exts = [".mp4", ".mkv", ".mov", ".avi", ".flv", ".wmv", ".m4v", ".webm", ".ts"];
        let audio_exts = [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"];
        let image_exts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"];
        let archive_exts = [".zip", ".rar", ".7z", ".tar", ".gz", ".iso"];
        let doc_exts = [".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".txt", ".epub"];

        if video_exts.iter().any(|ext| name_lower.ends_with(ext)) {
            "video".to_string()
        } else if audio_exts.iter().any(|ext| name_lower.ends_with(ext)) {
            "audio".to_string()
        } else if image_exts.iter().any(|ext| name_lower.ends_with(ext)) {
            "image".to_string()
        } else if archive_exts.iter().any(|ext| name_lower.ends_with(ext)) {
            "archive".to_string()
        } else if doc_exts.iter().any(|ext| name_lower.ends_with(ext)) {
            "document".to_string()
        } else {
            "file".to_string()
        }
    }
}
