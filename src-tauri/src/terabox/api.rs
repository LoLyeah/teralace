use crate::terabox::load_balancer::{InternalEndpoint, LoadBalancer};
use crate::terabox::normalizer::normalize_terabox_url;
use crate::terabox::types::*;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CACHE_CONTROL, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
pub const TERABOX_CLIENT_USER_AGENT: &str = "netdisk;P2SP;2.2.60.2";

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
            surl: None,
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
        let files_total = find_i64(&["filesTotal", "total", "count"]);

        // TeraBox WAP SSR only renders the first 20 items in HTML.
        // If files.len() >= 20 or filesTotal > files.len(), fetch remaining files via share/list pagination!
        let should_paginate = files.len() >= 20 || files_total.map(|t| t as usize > files.len()).unwrap_or(false);
        if should_paginate {
            log::info!(
                "[WAP] files count {} (total: {:?}), fetching remaining files via pagination",
                files.len(),
                files_total
            );
            self.paginate_remaining_files(&mut files, clean_surl, user_cookie, path).await;
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
            let fs_id = match item.get("fs_id") {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Number(n)) => n.to_string(),
                _ => String::new(),
            };
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

        let files_total = state
            .get("share")
            .and_then(|s| s.get("filesTotal").or_else(|| s.get("total")).or_else(|| s.get("count")))
            .or_else(|| state.get("filesTotal").or_else(|| state.get("total")))
            .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(|s| s.parse().ok())));

        let should_paginate = folder_files.len() >= 20
            || files_total.map(|t| t as usize > folder_files.len()).unwrap_or(false);
        if should_paginate {
            log::info!(
                "[WAP folder] folder_files count {} (total: {:?}), fetching remaining files via pagination",
                folder_files.len(),
                files_total
            );
            self.paginate_remaining_files(&mut folder_files, clean_surl, user_cookie, Some(folder_path)).await;
        }

        Ok(folder_files)
    }

    pub fn is_file_match(a: &TeraboxFileInfo, b: &TeraboxFileInfo) -> bool {
        if !a.fs_id.is_empty() && !b.fs_id.is_empty() {
            a.fs_id == b.fs_id
        } else {
            a.name == b.name && a.path == b.path && a.size == b.size
        }
    }

    pub fn merge_file_info(existing: &mut TeraboxFileInfo, item: &TeraboxFileInfo) {
        if existing.direct_link.is_none() && item.direct_link.is_some() {
            existing.direct_link = item.direct_link.clone();
        }
        if existing.thumb.is_none() && item.thumb.is_some() {
            existing.thumb = item.thumb.clone();
        }
        if existing.category.is_none() && item.category.is_some() {
            existing.category = item.category.clone();
        }
        if existing.create_time.is_none() && item.create_time.is_some() {
            existing.create_time = item.create_time;
        }
        if existing.path.is_none() && item.path.is_some() {
            existing.path = item.path.clone();
        }
    }

    /// Paginates remaining files via /share/list and appends them to existing files, deduping by fs_id
    async fn paginate_remaining_files(
        &self,
        files: &mut Vec<TeraboxFileInfo>,
        clean_surl: &str,
        user_cookie: Option<&str>,
        path: Option<&str>,
    ) {
        const PAGE_SIZE: u32 = 100;
        const MAX_PAGES: u32 = 100;

        let mut page = 1;
        while page <= MAX_PAGES {
            match self
                .fetch_share_list_page_full(clean_surl, user_cookie, page, PAGE_SIZE, path)
                .await
            {
                Ok(res) => {
                    let batch_len = res.files.len();
                    if batch_len == 0 {
                        break;
                    }

                    let mut added = 0;
                    for item in res.files {
                        if let Some(existing) = files.iter_mut().find(|f| Self::is_file_match(f, &item)) {
                            Self::merge_file_info(existing, &item);
                        } else {
                            files.push(item);
                            added += 1;
                        }
                    }

                    log::info!(
                        "[paginate_remaining_files] Page {} for surl '{}' path '{:?}': returned {} items ({} new). Total: {}",
                        page, clean_surl, path, batch_len, added, files.len()
                    );

                    // End conditions:
                    // 1. Last page reached (fewer than PAGE_SIZE, or has_more is explicitly false)
                    if !res.has_more || batch_len < PAGE_SIZE as usize {
                        break;
                    }

                    // 2. Full page returned but no new items were added (duplicate batch loop prevention)
                    if added == 0 {
                        log::warn!(
                            "[paginate_remaining_files] Page {} returned only duplicates for surl '{}'. Stopping pagination.",
                            page, clean_surl
                        );
                        break;
                    }

                    page += 1;
                }
                Err(err) => {
                    log::warn!(
                        "[paginate_remaining_files] Page {} failed for surl '{}' path '{:?}': {}. Retaining {} files.",
                        page, clean_surl, path, err, files.len()
                    );
                    break;
                }
            }
        }

        if page > MAX_PAGES {
            log::warn!(
                "[paginate_remaining_files] Reached MAX_PAGES limit ({}) for surl '{}' path '{:?}'. Total files: {}",
                MAX_PAGES, clean_surl, path, files.len()
            );
        }
    }

    /// Fetches all files from /share/list for a directory, paginating until no more items
    pub async fn fetch_share_list_all(
        &self,
        clean_surl: &str,
        user_cookie: Option<&str>,
        dir: Option<&str>,
    ) -> Result<TeraboxInfo, String> {
        const PAGE_SIZE: u32 = 100;
        const MAX_PAGES: u32 = 100; // Sane upper bound: up to 10,000 files

        let mut all_files: Vec<TeraboxFileInfo> = Vec::new();
        let mut meta_shareid = 0i64;
        let mut meta_uk = 0i64;
        let mut meta_sign = String::new();
        let mut meta_timestamp = 0i64;
        let mut page = 1;

        while page <= MAX_PAGES {
            match self
                .fetch_share_list_page_full(clean_surl, user_cookie, page, PAGE_SIZE, dir)
                .await
            {
                Ok(res) => {
                    if meta_shareid == 0 && res.shareid != 0 {
                        meta_shareid = res.shareid;
                    }
                    if meta_uk == 0 && res.uk != 0 {
                        meta_uk = res.uk;
                    }
                    if meta_sign.is_empty() && !res.sign.is_empty() {
                        meta_sign = res.sign;
                    }
                    if meta_timestamp == 0 && res.timestamp != 0 {
                        meta_timestamp = res.timestamp;
                    }

                    let batch_len = res.files.len();
                    let mut added = 0;
                    for item in res.files {
                        if let Some(existing) = all_files.iter_mut().find(|f| Self::is_file_match(f, &item)) {
                            Self::merge_file_info(existing, &item);
                        } else {
                            all_files.push(item);
                            added += 1;
                        }
                    }

                    log::info!(
                        "[fetch_share_list_all] Page {} for surl '{}' dir '{:?}': returned {} items ({} new). Total: {}",
                        page, clean_surl, dir, batch_len, added, all_files.len()
                    );

                    // End conditions:
                    // 1. Batch is empty
                    // 2. has_more is explicitly false
                    // 3. Batch has fewer than requested page size (last page reached)
                    if batch_len == 0 || !res.has_more || batch_len < PAGE_SIZE as usize {
                        break;
                    }

                    // 4. Batch was full size but all were duplicates (prevents endless loop if server repeats)
                    if added == 0 {
                        log::warn!(
                            "[fetch_share_list_all] Page {} returned only duplicates for surl '{}'. Breaking pagination loop.",
                            page, clean_surl
                        );
                        break;
                    }

                    page += 1;
                }
                Err(err) => {
                    if page == 1 {
                        // First page failed -> propagate error so caller can try fallback
                        return Err(err);
                    } else {
                        // Page N > 1 failed -> treat as partial result with logged warning, not silent success
                        log::warn!(
                            "[fetch_share_list_all] Failed on page {} for surl '{}' dir '{:?}': {}. Returning {} partial files collected so far.",
                            page, clean_surl, dir, err, all_files.len()
                        );
                        break;
                    }
                }
            }
        }

        if page > MAX_PAGES {
            log::warn!(
                "[fetch_share_list_all] Reached MAX_PAGES limit ({}) for surl '{}' dir '{:?}'. Total files: {}",
                MAX_PAGES, clean_surl, dir, all_files.len()
            );
        }

        Ok(TeraboxInfo {
            ok: true,
            shareid: meta_shareid,
            uk: meta_uk,
            sign: meta_sign,
            timestamp: meta_timestamp,
            list: all_files,
            error_message: None,
            resolved_by: Some("Direct TeraBox Scraper".to_string()),
            surl: Some(clean_surl.to_string()),
        })
    }

    /// Fetches a specific page of files & metadata from TeraBox share list API
    async fn fetch_share_list_page_full(
        &self,
        clean_surl: &str,
        user_cookie: Option<&str>,
        page: u32,
        num: u32,
        dir: Option<&str>,
    ) -> Result<ShareListPageResult, String> {
        let hosts = ["www.terabox.com", "www.terabox.app", "1024tera.com"];
        let mut last_err = String::new();

        let dir_param = if let Some(d) = dir.filter(|s| !s.trim().is_empty() && s.trim() != "/") {
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
                HeaderValue::from_static(TERABOX_CLIENT_USER_AGENT),
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
                                    let mut files = Vec::new();
                                    if let Some(list_val) = v.get("list").and_then(|l| l.as_array()) {
                                        for item in list_val {
                                            let name = item
                                                .get("server_filename")
                                                .and_then(|n| n.as_str())
                                                .unwrap_or("file")
                                                .to_string();
                                            let fs_id = match item.get("fs_id") {
                                                Some(serde_json::Value::String(s)) => s.clone(),
                                                Some(serde_json::Value::Number(n)) => n.to_string(),
                                                _ => String::new(),
                                            };
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
                                    }

                                    let has_more = match v.get("has_more") {
                                        Some(serde_json::Value::Bool(b)) => Some(*b),
                                        Some(serde_json::Value::Number(n)) => Some(n.as_i64() == Some(1)),
                                        Some(serde_json::Value::String(s)) => Some(s == "1" || s == "true"),
                                        _ => None,
                                    };
                                    let has_more_effective = has_more.unwrap_or(files.len() >= num as usize);

                                    let shareid = v
                                        .get("shareid")
                                        .or_else(|| v.get("share_id"))
                                        .or_else(|| v.get("primaryid"))
                                        .and_then(|s| s.as_i64().or_else(|| s.as_str().and_then(|str_val| str_val.parse().ok())))
                                        .unwrap_or(0);
                                    let uk = v
                                        .get("uk")
                                        .or_else(|| v.get("share_uk"))
                                        .and_then(|u| u.as_i64().or_else(|| u.as_str().and_then(|str_val| str_val.parse().ok())))
                                        .unwrap_or(0);
                                    let sign = v
                                        .get("sign")
                                        .or_else(|| v.get("share_sign"))
                                        .and_then(|s| s.as_str())
                                        .unwrap_or_default()
                                        .to_string();
                                    let timestamp = v
                                        .get("timestamp")
                                        .or_else(|| v.get("ctime"))
                                        .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(|str_val| str_val.parse().ok())))
                                        .unwrap_or(0);
                                    let total = v
                                        .get("total")
                                        .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(|str_val| str_val.parse().ok())))
                                        .unwrap_or(0);

                                    return Ok(ShareListPageResult {
                                        files,
                                        has_more: has_more_effective,
                                        shareid,
                                        uk,
                                        sign,
                                        timestamp,
                                        total,
                                    });
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

    /// Fetches a specific page of files from TeraBox share list API
    pub async fn fetch_share_list_paged(
        &self,
        clean_surl: &str,
        user_cookie: Option<&str>,
        page: u32,
        num: u32,
        dir: Option<&str>,
    ) -> Result<Vec<TeraboxFileInfo>, String> {
        self.fetch_share_list_page_full(clean_surl, user_cookie, page, num, dir)
            .await
            .map(|res| res.files)
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

        // 1. Try desktop /share/list with dir=folder_path (with full pagination)
        match self
            .fetch_share_list_all(clean_surl, user_cookie, Some(folder_path))
            .await
        {
            Ok(info) if !info.list.is_empty() => return Ok(info.list),
            Ok(info) => {
                log::info!("[get_folder_contents] /share/list returned empty, trying WAP fallback");
                match self.fetch_wap_folder_contents(clean_surl, folder_path, user_cookie).await {
                    Ok(wap_files) if !wap_files.is_empty() => return Ok(wap_files),
                    _ => return Ok(info.list),
                }
            }
            Err(e) => {
                log::warn!("[get_folder_contents] /share/list failed: {}, trying WAP fallback", e);
                self.fetch_wap_folder_contents(clean_surl, folder_path, user_cookie).await
            }
        }
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

        // 2. If WAP failed, try desktop /share/list API with full pagination
        log::info!(
            "[Fetch] WAP Direct Scraper failed ({:?}), trying paginated /share/list fallback",
            info_res.as_ref().err()
        );
        let mut info = self.fetch_share_list_all(clean_surl, user_cookie, path).await?;
        if info.sign.is_empty() || info.shareid == 0 || info.timestamp == 0 {
            if let Ok(meta) = self.fetch_share_meta(clean_surl, user_cookie).await {
                info.shareid = meta.shareid;
                info.uk = meta.uk;
                info.sign = meta.sign;
                info.timestamp = meta.timestamp;
            }
        }
        Ok(info)
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
                    path: None,
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
            surl: Some(surl.to_string()),
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
                HeaderValue::from_static(TERABOX_CLIENT_USER_AGENT),
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
                    .header(reqwest::header::USER_AGENT, TERABOX_CLIENT_USER_AGENT)
                    .timeout(std::time::Duration::from_millis(5000));

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_file_match_by_fs_id() {
        let f1 = TeraboxFileInfo {
            is_dir: false,
            fs_id: "12345".to_string(),
            name: "a.png".to_string(),
            file_type: "image".to_string(),
            size: Some(100),
            size_formatted: None,
            category: None,
            create_time: None,
            thumb: None,
            direct_link: None,
            path: None,
        };
        let f2 = TeraboxFileInfo {
            is_dir: false,
            fs_id: "12345".to_string(),
            name: "renamed.png".to_string(),
            file_type: "image".to_string(),
            size: Some(200),
            size_formatted: None,
            category: None,
            create_time: None,
            thumb: None,
            direct_link: None,
            path: None,
        };
        assert!(TeraboxApi::is_file_match(&f1, &f2));
    }

    #[test]
    fn test_is_file_match_fallback() {
        let f1 = TeraboxFileInfo {
            is_dir: false,
            fs_id: "".to_string(),
            name: "a.png".to_string(),
            file_type: "image".to_string(),
            size: Some(100),
            size_formatted: None,
            category: None,
            create_time: None,
            thumb: None,
            direct_link: None,
            path: Some("/Cards/a.png".to_string()),
        };
        let f2 = TeraboxFileInfo {
            is_dir: false,
            fs_id: "".to_string(),
            name: "a.png".to_string(),
            file_type: "image".to_string(),
            size: Some(100),
            size_formatted: None,
            category: None,
            create_time: None,
            thumb: None,
            direct_link: None,
            path: Some("/Cards/a.png".to_string()),
        };
        assert!(TeraboxApi::is_file_match(&f1, &f2));
    }

    #[test]
    fn test_merge_file_info_enriches_fields() {
        let mut existing = TeraboxFileInfo {
            is_dir: false,
            fs_id: "12345".to_string(),
            name: "a.png".to_string(),
            file_type: "image".to_string(),
            size: Some(100),
            size_formatted: None,
            category: None,
            create_time: None,
            thumb: None,
            direct_link: None,
            path: None,
        };
        let incoming = TeraboxFileInfo {
            is_dir: false,
            fs_id: "12345".to_string(),
            name: "a.png".to_string(),
            file_type: "image".to_string(),
            size: Some(100),
            size_formatted: None,
            category: Some("3".to_string()),
            create_time: Some(1700000000),
            thumb: Some("https://thumb.url".to_string()),
            direct_link: Some("https://dlink.url".to_string()),
            path: Some("/Cards/a.png".to_string()),
        };
        TeraboxApi::merge_file_info(&mut existing, &incoming);
        assert_eq!(existing.direct_link, Some("https://dlink.url".to_string()));
        assert_eq!(existing.thumb, Some("https://thumb.url".to_string()));
        assert_eq!(existing.category, Some("3".to_string()));
        assert_eq!(existing.create_time, Some(1700000000));
        assert_eq!(existing.path, Some("/Cards/a.png".to_string()));
    }
}
