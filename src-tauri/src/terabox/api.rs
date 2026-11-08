use crate::terabox::load_balancer::{InternalEndpoint, LoadBalancer};
use crate::terabox::normalizer::normalize_terabox_url;
use crate::terabox::types::*;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CACHE_CONTROL, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
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

    /// Actively ping all configured endpoints to evaluate reachability
    pub async fn ping_endpoints(&self) -> Vec<EndpointHealthInfo> {
        self.balancer.ping_all_endpoints(&self.client).await
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
        let path_param = crate::terabox::normalizer::extract_url_path_param(raw_url);
        if let Some(ref p) = path_param {
            log::info!("[Fetch] Detected subfolder path in URL: {}", p);
        }
        log::info!("[Fetch] Trying Direct TeraBox Scraper Fallback for surl: {}", surl);
        match self.fetch_direct_terabox(&surl, path_param.as_deref(), user_cookie).await {
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
                path: f.path,
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

    /// Fetches file metadata & pre-signed direct download links (dlink) via TeraBox WAP sharing page
    async fn fetch_wap_direct(
        &self,
        clean_surl: &str,
        path: Option<&str>,
        user_cookie: Option<&str>,
    ) -> Result<TeraboxInfo, String> {
        let wap_url = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
            format!(
                "https://www.terabox.com/wap/share/filelist?surl={}&path={}",
                clean_surl,
                urlencoding::encode(p)
            )
        } else {
            format!("https://www.terabox.com/wap/share/filelist?surl={}", clean_surl)
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));

        if let Some(cookie) = user_cookie {
            let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
            if !cookie_str.is_empty() {
                let formatted_cookie = if cookie_str.contains('=') {
                    cookie_str.to_string()
                } else {
                    format!("ndus={}", cookie_str)
                };
                if let Ok(c_val) = HeaderValue::from_str(&formatted_cookie) {
                    headers.insert(COOKIE, c_val);
                }
            }
        }

        let resp = self
            .client
            .get(&wap_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("WAP request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("WAP HTTP {}", resp.status()));
        }

        let html = resp.text().await.map_err(|e| e.to_string())?;

        let marker = "window.__INITIAL_STATE__=";
        let start_idx = html
            .find(marker)
            .ok_or_else(|| "No __INITIAL_STATE__ found in WAP page".to_string())?;

        let json_start = start_idx + marker.len();
        let slice = &html[json_start..];

        let mut brace_count = 0i32;
        let mut in_string = false;
        let mut escape = false;
        let mut end_idx = None;

        for (i, ch) in slice.char_indices() {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if !in_string {
                if ch == '{' {
                    brace_count += 1;
                } else if ch == '}' {
                    brace_count -= 1;
                    if brace_count == 0 {
                        end_idx = Some(i + 1);
                        break;
                    }
                }
            }
        }

        let end = end_idx.ok_or_else(|| "Unterminated JSON in __INITIAL_STATE__".to_string())?;
        let json_str = &slice[..end];

        let state: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse __INITIAL_STATE__ JSON: {}", e))?;

        let file_list = state
            .get("share")
            .and_then(|s| s.get("fileList").or_else(|| s.get("list")))
            .and_then(|l| l.as_array())
            .ok_or_else(|| "No fileList in WAP share state".to_string())?;

        if file_list.is_empty() {
            return Err("WAP fileList is empty".to_string());
        }

        let mut files: Vec<TeraboxFileInfo> = Vec::new();
        for item in file_list {
            let name = item
                .get("server_filename")
                .and_then(|n| n.as_str())
                .unwrap_or("file")
                .to_string();
            let fs_id = item.get("fs_id").map(|f| f.to_string()).unwrap_or_default();
            let size = item
                .get("size")
                .and_then(|s| s.as_i64())
                .or_else(|| item.get("size").and_then(|s| s.as_str()).and_then(|s| s.parse().ok()));
            let is_dir = match item.get("isdir") {
                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
                Some(serde_json::Value::String(s)) => s == "1" || s == "true",
                Some(serde_json::Value::Bool(b)) => *b,
                _ => false,
            };
            let dlink = item.get("dlink").and_then(|d| d.as_str()).map(|s| s.to_string());
            let thumb = item
                .get("thumbs")
                .and_then(|t| t.get("url3").or_else(|| t.get("url2")).or_else(|| t.get("url1")))
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            let item_path = item.get("path").and_then(|p| p.as_str()).map(|s| s.to_string());

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
                path: item_path,
            });
        }

        // Robust metadata extraction across nested share, shareInfo, and top-level fields
        let find_str = |keys: &[&str]| -> Option<String> {
            for key in keys {
                if let Some(v) = state.get("share").and_then(|s| s.get("shareInfo").and_then(|si| si.get(*key)).or_else(|| s.get(*key))) {
                    if let Some(s) = v.as_str() { if !s.is_empty() { return Some(s.to_string()); } }
                }
                if let Some(v) = state.get("shareInfo").and_then(|si| si.get(*key)) {
                    if let Some(s) = v.as_str() { if !s.is_empty() { return Some(s.to_string()); } }
                }
                if let Some(v) = state.get(*key) {
                    if let Some(s) = v.as_str() { if !s.is_empty() { return Some(s.to_string()); } }
                }
            }
            None
        };

        let find_i64 = |keys: &[&str]| -> Option<i64> {
            for key in keys {
                if let Some(v) = state.get("share").and_then(|s| s.get("shareInfo").and_then(|si| si.get(*key)).or_else(|| s.get(*key))) {
                    if let Some(n) = v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) { return Some(n); }
                }
                if let Some(v) = state.get("shareInfo").and_then(|si| si.get(*key)) {
                    if let Some(n) = v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) { return Some(n); }
                }
                if let Some(v) = state.get(*key) {
                    if let Some(n) = v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) { return Some(n); }
                }
            }
            None
        };

        let shareid = find_i64(&["shareid", "share_id", "primaryid"]).unwrap_or(0);
        let uk = find_i64(&["uk", "share_uk"]).unwrap_or(0);
        let sign = find_str(&["sign", "share_sign"]).unwrap_or_default();
        let timestamp = find_i64(&["timestamp", "ctime"]).unwrap_or(0);
        let files_total = find_i64(&["filesTotal", "total", "count"]).unwrap_or(files.len() as i64);

        // TeraBox WAP SSR only renders the first 20 items in HTML.
        // If filesTotal > files.len() or files.len() >= 20, fetch remaining files via share/list pagination!
        if (files_total as usize) > files.len() || files.len() >= 20 {
            log::info!(
                "[WAP] filesTotal ({}) > current count ({}), fetching remaining files via pagination",
                files_total,
                files.len()
            );
            let mut page = 1;
            while (files_total as usize) > files.len() && page <= 20 {
                if let Ok(paged) = self.fetch_share_list_paged(clean_surl, user_cookie, page, 100, path).await {
                    if paged.is_empty() {
                        break;
                    }
                    let mut added = false;
                    for item in paged {
                        if !files.iter().any(|f| f.fs_id == item.fs_id) {
                            files.push(item);
                            added = true;
                        }
                    }
                    if !added {
                        break;
                    }
                    page += 1;
                } else {
                    break;
                }
            }
        }

        Ok(TeraboxInfo {
            ok: true,
            shareid,
            uk,
            sign,
            timestamp,
            list: files,
            error_message: None,
            resolved_by: Some("Direct TeraBox WAP Scraper".to_string()),
            surl: Some(clean_surl.to_string()),
        })
    }

    /// Fetches files inside a subfolder of a shared link via WAP endpoint
    async fn fetch_wap_folder_contents(
        &self,
        clean_surl: &str,
        folder_path: &str,
        user_cookie: Option<&str>,
    ) -> Result<Vec<TeraboxFileInfo>, String> {
        let folder_url = format!(
            "https://www.terabox.com/wap/share/filelist?surl={}&path={}",
            clean_surl,
            urlencoding::encode(folder_path)
        );

        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));

        if let Some(cookie) = user_cookie {
            let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
            if !cookie_str.is_empty() {
                let formatted_cookie = if cookie_str.contains('=') {
                    cookie_str.to_string()
                } else {
                    format!("ndus={}", cookie_str)
                };
                if let Ok(c_val) = HeaderValue::from_str(&formatted_cookie) {
                    headers.insert(COOKIE, c_val);
                }
            }
        }

        let resp = self
            .client
            .get(&folder_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("WAP folder request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("WAP folder HTTP {}", resp.status()));
        }

        let html = resp.text().await.map_err(|e| e.to_string())?;

        let marker = "window.__INITIAL_STATE__=";
        let start_idx = html
            .find(marker)
            .ok_or_else(|| "No __INITIAL_STATE__ found in WAP folder page".to_string())?;

        let json_start = start_idx + marker.len();
        let slice = &html[json_start..];

        let mut brace_count = 0i32;
        let mut in_string = false;
        let mut escape = false;
        let mut end_idx = None;

        for (i, ch) in slice.char_indices() {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if !in_string {
                if ch == '{' {
                    brace_count += 1;
                } else if ch == '}' {
                    brace_count -= 1;
                    if brace_count == 0 {
                        end_idx = Some(i + 1);
                        break;
                    }
                }
            }
        }

        let end = end_idx.ok_or_else(|| "Unterminated JSON in folder __INITIAL_STATE__".to_string())?;
        let json_str = &slice[..end];

        let state: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse folder __INITIAL_STATE__ JSON: {}", e))?;

        let file_list = state
            .get("share")
            .and_then(|s| s.get("fileList").or_else(|| s.get("list")))
            .and_then(|l| l.as_array())
            .ok_or_else(|| "No fileList in WAP folder share state".to_string())?;

        let mut folder_files: Vec<TeraboxFileInfo> = Vec::new();
        for item in file_list {
            let name = item
                .get("server_filename")
                .and_then(|n| n.as_str())
                .unwrap_or("file")
                .to_string();
            let fs_id = item.get("fs_id").map(|f| f.to_string()).unwrap_or_default();
            let size = item
                .get("size")
                .and_then(|s| s.as_i64())
                .or_else(|| item.get("size").and_then(|s| s.as_str()).and_then(|s| s.parse().ok()));
            let is_dir = match item.get("isdir") {
                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
                Some(serde_json::Value::String(s)) => s == "1" || s == "true",
                Some(serde_json::Value::Bool(b)) => *b,
                _ => false,
            };
            let dlink = item.get("dlink").and_then(|d| d.as_str()).map(|s| s.to_string());
            let thumb = item
                .get("thumbs")
                .and_then(|t| t.get("url3").or_else(|| t.get("url2")).or_else(|| t.get("url1")))
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            let item_path = item.get("path").and_then(|p| p.as_str()).map(|s| s.to_string());

            let file_type = if is_dir {
                "folder".to_string()
            } else {
                Self::detect_file_type(&name)
            };

            folder_files.push(TeraboxFileInfo {
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
                path: item_path,
            });
        }

        Ok(folder_files)
    }

    /// Fetches a specific page of files from TeraBox share list API
    async fn fetch_share_list_paged(
        &self,
        clean_surl: &str,
        user_cookie: Option<&str>,
        page: u32,
        num: u32,
        dir: Option<&str>,
    ) -> Result<Vec<TeraboxFileInfo>, String> {
        let hosts = ["www.terabox.com", "www.terabox.app", "1024tera.com"];
        let mut last_err = String::new();

        let dir_param = if let Some(d) = dir.filter(|s| !s.trim().is_empty()) {
            format!("&dir={}", urlencoding::encode(d))
        } else {
            "&root=1".to_string()
        };

        for host in &hosts {
            let api_url = format!(
                "https://{}/share/list?app_id=250528&shorturl={}{}&page={}&num={}",
                host, clean_surl, dir_param, page, num
            );

            let mut headers = HeaderMap::new();
            headers.insert(
                USER_AGENT,
                HeaderValue::from_static(DEFAULT_USER_AGENT),
            );
            headers.insert(REFERER, HeaderValue::from_str(&format!("https://{}/", host)).unwrap());
            headers.insert(ORIGIN, HeaderValue::from_str(&format!("https://{}", host)).unwrap());

            if let Some(cookie) = user_cookie {
                let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
                if !cookie_str.is_empty() {
                    let formatted = if cookie_str.contains('=') {
                        cookie_str.to_string()
                    } else {
                        format!("ndus={}", cookie_str)
                    };
                    if let Ok(c_val) = HeaderValue::from_str(&formatted) {
                        headers.insert(COOKIE, c_val);
                    }
                }
            }

            match self.client.get(&api_url).headers(headers).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(text) = resp.text().await {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                if v.get("errno").and_then(|e| e.as_i64()) == Some(0) {
                                    if let Some(list_val) = v.get("list").and_then(|l| l.as_array()) {
                                        let mut files = Vec::new();
                                        for item in list_val {
                                            let name = item
                                                .get("server_filename")
                                                .and_then(|n| n.as_str())
                                                .unwrap_or("file")
                                                .to_string();
                                            let fs_id = item
                                                .get("fs_id")
                                                .map(|f| f.to_string())
                                                .unwrap_or_default();
                                            let size = item
                                                .get("size")
                                                .and_then(|s| s.as_i64())
                                                .or_else(|| {
                                                    item.get("size")
                                                        .and_then(|s| s.as_str())
                                                        .and_then(|s| s.parse().ok())
                                                });
                                            let is_dir = match item.get("isdir") {
                                                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
                                                Some(serde_json::Value::String(s)) => s == "1" || s == "true",
                                                Some(serde_json::Value::Bool(b)) => *b,
                                                _ => false,
                                            };
                                            let dlink = item
                                                .get("dlink")
                                                .and_then(|d| d.as_str())
                                                .map(|s| s.to_string());
                                            let thumb = item
                                                .get("thumbs")
                                                .and_then(|t| t.get("url3").or_else(|| t.get("url2")).or_else(|| t.get("url1")))
                                                .and_then(|u| u.as_str())
                                                .map(|s| s.to_string());
                                            let item_path = item.get("path").and_then(|p| p.as_str()).map(|s| s.to_string());

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
                                                category: item.get("category").and_then(|c| c.as_str()).map(|s| s.to_string()),
                                                create_time: item.get("server_mtime").and_then(|m| m.as_i64()),
                                                thumb,
                                                direct_link: dlink,
                                                path: item_path,
                                            });
                                        }
                                        return Ok(files);
                                    }
                                } else {
                                    last_err = format!("errno {:?}", v.get("errno"));
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    last_err = e.to_string();
                }
            }
        }

        Err(format!("fetch_share_list_paged failed: {}", last_err))
    }

    /// Fetches share metadata (shareid, uk, sign, timestamp) via /share/list
    async fn fetch_share_meta(
        &self,
        clean_surl: &str,
        user_cookie: Option<&str>,
    ) -> Result<ShareMeta, String> {
        let hosts = ["www.terabox.app", "www.terabox.com", "1024tera.com"];
        for host in &hosts {
            let api_url = format!(
                "https://{}/share/list?app_id=250528&shorturl={}&root=1&page=1&num=1",
                host, clean_surl
            );

            let mut headers = HeaderMap::new();
            headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
            headers.insert(REFERER, HeaderValue::from_str(&format!("https://{}/", host)).unwrap());
            headers.insert(ORIGIN, HeaderValue::from_str(&format!("https://{}", host)).unwrap());

            if let Some(cookie) = user_cookie {
                let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
                if !cookie_str.is_empty() {
                    let formatted = if cookie_str.contains('=') {
                        cookie_str.to_string()
                    } else {
                        format!("ndus={}", cookie_str)
                    };
                    if let Ok(c_val) = HeaderValue::from_str(&formatted) {
                        headers.insert(COOKIE, c_val);
                    }
                }
            }

            if let Ok(resp) = self.client.get(&api_url).headers(headers).send().await {
                if resp.status().is_success() {
                    if let Ok(text) = resp.text().await {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if v.get("errno").and_then(|e| e.as_i64()) == Some(0) {
                                let shareid = v.get("shareid").or_else(|| v.get("share_id")).and_then(|s| s.as_i64()).unwrap_or(0);
                                let uk = v.get("uk").and_then(|u| u.as_i64()).unwrap_or(0);
                                let sign = v.get("sign").and_then(|s| s.as_str()).unwrap_or_default().to_string();
                                let timestamp = v.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);
                                let total = v.get("total").and_then(|t| t.as_i64()).unwrap_or(0);

                                if shareid != 0 && !sign.is_empty() {
                                    return Ok(ShareMeta {
                                        shareid,
                                        uk,
                                        sign,
                                        timestamp,
                                        total,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        Err("Failed to resolve share metadata".to_string())
    }

    /// Fetches contents of a specific folder inside a share link
    pub async fn get_folder_contents(
        &self,
        raw_url_or_surl: &str,
        folder_path: &str,
        user_cookie: Option<&str>,
    ) -> Result<Vec<TeraboxFileInfo>, String> {
        let surl = crate::terabox::normalizer::extract_surl(raw_url_or_surl);
        let clean_surl = surl.trim_start_matches('1');

        log::info!(
            "[get_folder_contents] Fetching folder '{}' for surl: {}",
            folder_path,
            clean_surl
        );

        // 1. Try desktop /share/list with dir=folder_path
        if let Ok(files) = self
            .fetch_share_list_paged(clean_surl, user_cookie, 1, 100, Some(folder_path))
            .await
        {
            if !files.is_empty() {
                return Ok(files);
            }
        }

        // 2. Fallback to WAP with path=folder_path
        self.fetch_wap_folder_contents(clean_surl, folder_path, user_cookie).await
    }

    /// Recursively collects all files inside a folder up to a maximum depth
    pub async fn get_folder_files_recursive(
        &self,
        raw_url_or_surl: &str,
        folder_path: &str,
        user_cookie: Option<&str>,
    ) -> Result<Vec<TeraboxFileInfo>, String> {
        let mut all_files = Vec::new();
        let mut queue = std::collections::VecDeque::new();
        queue.push_back((folder_path.to_string(), 0usize));

        let max_depth = 5;
        let mut visited = std::collections::HashSet::new();

        while let Some((current_dir, depth)) = queue.pop_front() {
            if !visited.insert(current_dir.clone()) {
                continue;
            }

            match self.get_folder_contents(raw_url_or_surl, &current_dir, user_cookie).await {
                Ok(items) => {
                    for item in items {
                        if item.is_dir {
                            if depth < max_depth {
                                let sub_path = item.path.clone().unwrap_or_else(|| {
                                    let base = current_dir.trim_end_matches('/');
                                    format!("{}/{}", base, item.name)
                                });
                                queue.push_back((sub_path, depth + 1));
                            }
                        } else {
                            all_files.push(item);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[get_folder_files_recursive] Failed to read dir '{}': {}", current_dir, e);
                }
            }
        }

        Ok(all_files)
    }

    /// Direct TeraBox mobile/web API scraper fallback with optional cookie
    async fn fetch_direct_terabox(
        &self,
        surl: &str,
        path: Option<&str>,
        user_cookie: Option<&str>,
    ) -> Result<TeraboxInfo, String> {
        if surl.is_empty() {
            return Err("No surl available for direct extraction".to_string());
        }

        let clean_surl = surl.trim_start_matches('1');

        // 1. Try WAP Direct Scraper first (extracts pre-signed dlink URLs!)
        let mut info_res = self.fetch_wap_direct(clean_surl, path, user_cookie).await;

        if let Ok(ref mut info) = info_res {
            // If sign or shareid is missing from WAP state, enrich them via /share/list
            if info.sign.is_empty() || info.shareid == 0 || info.timestamp == 0 {
                if let Ok(meta) = self.fetch_share_meta(clean_surl, user_cookie).await {
                    info.shareid = meta.shareid;
                    info.uk = meta.uk;
                    info.sign = meta.sign;
                    info.timestamp = meta.timestamp;
                }
            }
            log::info!(
                "[Fetch] WAP Direct Scraper succeeded with {} files (shareid: {}, has_sign: {})",
                info.list.len(),
                info.shareid,
                !info.sign.is_empty()
            );
            return Ok(info.clone());
        }

        // 2. If WAP failed, try desktop /share/list API
        let dir_param = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
            format!("&dir={}", urlencoding::encode(p))
        } else {
            "&root=1".to_string()
        };

        let api_url = format!(
            "https://www.terabox.app/share/list?app_id=250528&shorturl={}{}&page=1&num=100",
            clean_surl, dir_param
        );

        let mut headers = Self::default_headers();
        headers.insert(REFERER, HeaderValue::from_static("https://www.terabox.app/"));
        headers.insert(ORIGIN, HeaderValue::from_static("https://www.terabox.app"));

        if let Some(cookie) = user_cookie {
            let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
            if !cookie_str.is_empty() {
                let formatted_cookie = if cookie_str.contains('=') {
                    cookie_str.to_string()
                } else {
                    format!("ndus={}", cookie_str)
                };
                if let Ok(c_val) = HeaderValue::from_str(&formatted_cookie) {
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
            let is_dir = match item.get("isdir") {
                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
                Some(serde_json::Value::String(s)) => s == "1" || s == "true",
                Some(serde_json::Value::Bool(b)) => *b,
                _ => false,
            };
            let dlink = item.get("dlink").and_then(|d| d.as_str()).map(|s| s.to_string());
            let thumb = item.get("thumbs").and_then(|t| t.get("url3")).and_then(|u| u.as_str()).map(|s| s.to_string());
            let item_path = item.get("path").and_then(|p| p.as_str()).map(|s| s.to_string());

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
                path: item_path,
            });
        }

        let shareid = v.get("shareid").or_else(|| v.get("share_id")).and_then(|s| s.as_i64()).unwrap_or(0);
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
            surl: Some(clean_surl.to_string()),
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

    /// Requests direct download link via TeraBox sharedownload API
    async fn fetch_direct_sharedownload(
        &self,
        params: &DownloadParams,
        user_cookie: Option<&str>,
    ) -> Result<String, String> {
        let post_data_signed = format!(
            "encrypt=0&extra=%7B%22sekey%22%3A%22%22%7D&fid_list=%5B{}%5D&fs_ids=%5B{}%5D&primaryid={}&shareid={}&uk={}&sign={}&timestamp={}&product=share&type=nolimit",
            params.fs_id, params.fs_id, params.shareid, params.shareid, params.uk, params.sign, params.timestamp
        );
        let post_data_1 = format!(
            "encrypt=0&extra=%7B%22sekey%22%3A%22%22%7D&fid_list=%5B{}%5D&primaryid={}&uk={}&product=share&type=nolimit",
            params.fs_id, params.shareid, params.uk
        );
        let post_data_2 = format!(
            "shareid={}&uk={}&sign={}&timestamp={}&primaryid={}&fs_ids=%5B{}%5D",
            params.shareid, params.uk, params.sign, params.timestamp, params.shareid, params.fs_id
        );
        let post_data_3 = format!(
            "encrypt=0&extra=%7B%22sekey%22%3A%22%22%7D&fid_list=%5B{}%5D&fs_ids=%5B{}%5D&primaryid={}&shareid={}&uk={}&product=share&type=nolimit",
            params.fs_id, params.fs_id, params.shareid, params.shareid, params.uk
        );

        let endpoints = [
            ("dm.terabox.com", "https://dm.terabox.com/"),
            ("www.terabox.app", "https://www.terabox.app/"),
            ("www.terabox.com", "https://www.terabox.com/"),
            ("www.1024tera.com", "https://www.1024tera.com/"),
            ("www.nephobox.com", "https://www.nephobox.com/"),
        ];

        for (host, referer) in &endpoints {
            let api_urls = [
                format!(
                    "https://{}/api/sharedownload?app_id=250528&web=1&channel=dubox&clienttype=0&sign={}&timestamp={}",
                    host, params.sign, params.timestamp
                ),
                format!(
                    "https://{}/share/download?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=",
                    host
                ),
            ];

            let mut headers = HeaderMap::new();
            headers.insert(
                USER_AGENT,
                HeaderValue::from_static(DEFAULT_USER_AGENT),
            );
            headers.insert(REFERER, HeaderValue::from_str(referer).unwrap());
            headers.insert(ORIGIN, HeaderValue::from_str(&referer[..referer.len() - 1]).unwrap());
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/x-www-form-urlencoded"));

            if let Some(cookie) = user_cookie {
                let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
                if !cookie_str.is_empty() {
                    let formatted = if cookie_str.contains('=') {
                        cookie_str.to_string()
                    } else {
                        format!("ndus={}", cookie_str)
                    };
                    if let Ok(c_val) = HeaderValue::from_str(&formatted) {
                        headers.insert(COOKIE, c_val);
                    }
                }
            }

            for url in &api_urls {
                for body in [&post_data_signed, &post_data_3, &post_data_1, &post_data_2] {
                    if let Ok(resp) = self.client.post(url).headers(headers.clone()).body(body.clone()).send().await {
                        if resp.status().is_success() {
                            if let Ok(text) = resp.text().await {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if v.get("errno").and_then(|e| e.as_i64()) == Some(0) {
                                        if let Some(dlink) = v
                                            .get("list")
                                            .and_then(|l| l.as_array())
                                            .and_then(|arr| arr.first())
                                            .and_then(|item| item.get("dlink"))
                                            .and_then(|d| d.as_str())
                                        {
                                            if !dlink.is_empty() {
                                                log::info!("[sharedownload] Successfully resolved dlink via {}", host);
                                                return Ok(dlink.to_string());
                                            }
                                        }
                                    } else {
                                        log::debug!("[sharedownload] {} returned errno: {:?}", host, v.get("errno"));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Err("Failed to resolve direct download link via TeraBox API".to_string())
    }

    /// Fetches direct media stream URL for video files via /share/streaming
    pub async fn fetch_share_streaming(
        &self,
        params: &DownloadParams,
        user_cookie: Option<&str>,
    ) -> Result<String, String> {
        let stream_url = format!(
            "https://www.terabox.app/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&fid={}&shareid={}&uk={}&sign={}&timestamp={}&type=M3U8_AUTO_480",
            params.fs_id, params.shareid, params.uk, params.sign, params.timestamp
        );

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
        headers.insert(REFERER, HeaderValue::from_static("https://www.terabox.app/"));

        if let Some(cookie) = user_cookie {
            let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
            if !cookie_str.is_empty() {
                let formatted = if cookie_str.contains('=') {
                    cookie_str.to_string()
                } else {
                    format!("ndus={}", cookie_str)
                };
                if let Ok(c_val) = HeaderValue::from_str(&formatted) {
                    headers.insert(COOKIE, c_val);
                }
            }
        }

        let resp = self
            .client
            .get(&stream_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("Streaming request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Streaming HTTP status {}", resp.status()));
        }

        let body = resp.text().await.map_err(|e| e.to_string())?;
        if body.contains("#EXTM3U") {
            for line in body.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                    log::info!("[fetch_share_streaming] Extracted direct stream segment URL for fs_id={}", params.fs_id);
                    return Ok(trimmed.to_string());
                }
            }
        }

        Err("No playable media stream found in playlist".to_string())
    }

    /// Resolves direct link via indexsubtitle resolver
    pub async fn fetch_indexsubtitle_direct(
        &self,
        share_url: &str,
        fs_id: &str,
    ) -> Result<String, String> {
        let base = "https://tbx.indexsubtitle.cc";
        let key = "116486c5e3a2ea45fa2c4cfc3fdc66caf3ae134598d3aedb";
        let req_url = format!(
            "{}/api/file?url={}&fs_id={}&direct=1&key={}",
            base,
            urlencoding::encode(share_url),
            fs_id,
            key
        );

        let no_redirect_client = match Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(c) => c,
            Err(e) => return Err(e.to_string()),
        };

        let resp = no_redirect_client
            .get(&req_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status().is_redirection() {
            if let Some(loc) = resp.headers().get("location") {
                if let Ok(loc_str) = loc.to_str() {
                    if loc_str.starts_with("http") {
                        return Ok(loc_str.to_string());
                    }
                }
            }
        }

        Err("No redirect location returned by indexsubtitle resolver".to_string())
    }

    /// Resolves the final direct download link for a file
    pub async fn get_download_link(
        &self,
        mut params: DownloadParams,
        user_cookie: Option<&str>,
    ) -> Result<DownloadLink, String> {
        // If share metadata is missing, attempt to enrich it using surl
        if (params.shareid == 0 || params.sign.is_empty() || params.timestamp == 0) && params.surl.is_some() {
            if let Some(ref surl) = params.surl {
                let clean_surl = surl.trim_start_matches('1');
                if let Ok(meta) = self.fetch_share_meta(clean_surl, user_cookie).await {
                    params.shareid = meta.shareid;
                    params.uk = meta.uk;
                    params.sign = meta.sign;
                    params.timestamp = meta.timestamp;
                }
            }
        }

        let has_share_meta = params.shareid != 0
            && params.uk != 0
            && !params.sign.is_empty()
            && params.timestamp != 0;

        // 1. If share metadata is available, try direct sharedownload API first (high speed, official CDN)
        if has_share_meta {
            log::info!("[get_download_link] Attempting direct sharedownload API for fs_id={}", params.fs_id);
            if let Ok(dl) = self.fetch_direct_sharedownload(&params, user_cookie).await {
                let mut is_usable = true;
                let mut probe_req = self
                    .client
                    .get(&dl)
                    .header(reqwest::header::RANGE, "bytes=0-0")
                    .header(reqwest::header::USER_AGENT, DEFAULT_USER_AGENT)
                    .timeout(std::time::Duration::from_millis(3000));

                if let Some(cookie) = user_cookie {
                    let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
                    if !cookie_str.is_empty() {
                        let formatted = if cookie_str.contains('=') {
                            cookie_str.to_string()
                        } else {
                            format!("ndus={}", cookie_str)
                        };
                        if let Ok(c) = reqwest::header::HeaderValue::from_str(&formatted) {
                            probe_req = probe_req.header(reqwest::header::COOKIE, c);
                        }
                    }
                }

                if let Ok(probe_resp) = probe_req.send().await {
                    if probe_resp.status() == reqwest::StatusCode::FORBIDDEN {
                        log::warn!("[get_download_link] Direct dlink rejected with 403 Forbidden by CDN (session expired or missing).");
                        is_usable = false;
                    }
                }

                if is_usable {
                    return Ok(DownloadLink {
                        ok: true,
                        download_link: Some(dl),
                        error_message: None,
                    });
                }
            }
        }

        // 2. Try indexsubtitle direct resolver (works for many files without login session!)
        if let Some(ref surl) = params.surl {
            let share_url = format!("https://www.terabox.app/sharing/link?surl={}", surl.trim_start_matches('1'));
            log::info!("[get_download_link] Trying indexsubtitle resolver for fs_id={}", params.fs_id);
            if let Ok(loc) = self.fetch_indexsubtitle_direct(&share_url, &params.fs_id).await {
                // Quick probe on loc: verify byte range access
                let probe = self
                    .client
                    .get(&loc)
                    .header(reqwest::header::RANGE, "bytes=0-100")
                    .header(reqwest::header::USER_AGENT, DEFAULT_USER_AGENT)
                    .timeout(std::time::Duration::from_millis(3000))
                    .send()
                    .await;

                if let Ok(p_res) = probe {
                    let st = p_res.status().as_u16();
                    if st == 200 || st == 206 {
                        log::info!("[get_download_link] Succeeded with indexsubtitle resolver (HTTP {})", st);
                        return Ok(DownloadLink {
                            ok: true,
                            download_link: Some(loc),
                            error_message: None,
                        });
                    } else {
                        log::warn!("[get_download_link] Indexsubtitle link probe failed with HTTP {}", st);
                    }
                }
            }
        }

        // 3. Fallback: If direct_link was already resolved during get_info (or API pool), probe & return it
        if let Some(ref dl) = params.direct_link {
            if !dl.trim().is_empty() {
                return Ok(DownloadLink {
                    ok: true,
                    download_link: Some(dl.clone()),
                    error_message: None,
                });
            }
        }

        // 4. If all resolvers failed, return a clear, helpful error message
        let cookie_is_set = user_cookie.map(|c| !c.trim().is_empty()).unwrap_or(false);
        let error_msg = if cookie_is_set {
            "TeraBox session expired (error 31045: user not exists). Please re-login via Settings -> TeraBox Cookie -> 'Sign In to TeraBox' to download full original files.".to_string()
        } else {
            "TeraBox requires an active login session to download this original file (HTTP 403 Forbidden). Please sign in via Settings -> TeraBox Cookie -> 'Sign In to TeraBox' to download.".to_string()
        };

        Err(error_msg)
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
