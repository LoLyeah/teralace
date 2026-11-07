use crate::downloader::types::{DownloadInfo, DownloadOptions, DownloadStatus};
use futures_util::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_LENGTH, RANGE, REFERER, USER_AGENT};
use reqwest::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

const CHUNK_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

#[derive(Clone)]
pub struct DownloadTask {
    pub gid: String,
    pub url: String,
    pub filename: String,
    pub filepath: PathBuf,
    pub total_size: Arc<AtomicU64>,
    pub downloaded: Arc<AtomicU64>,
    pub speed: Arc<AtomicU64>,
    pub status: Arc<RwLock<DownloadStatus>>,
    pub error_message: Arc<RwLock<Option<String>>>,
    pub cancel_flag: Arc<AtomicBool>,
    pub pause_flag: Arc<AtomicBool>,
    pub headers: Vec<(String, String)>,
}

pub struct DownloadManager {
    client: Client,
    tasks: Arc<RwLock<HashMap<String, DownloadTask>>>,
    default_download_dir: Arc<RwLock<PathBuf>>,
    max_connections: Arc<RwLock<usize>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent(CHUNK_USER_AGENT)
            .referer(true)
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("Failed to build downloader HTTP client");

        #[cfg(target_os = "android")]
        let default_dir = PathBuf::from("/storage/emulated/0/Download/TeraBox");

        #[cfg(not(target_os = "android"))]
        let default_dir = dirs::download_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .join("TeraBox");

        Self {
            client,
            tasks: Arc::new(RwLock::new(HashMap::new())),
            default_download_dir: Arc::new(RwLock::new(default_dir)),
            max_connections: Arc::new(RwLock::new(8)),
        }
    }

    pub async fn set_default_dir(&self, dir: PathBuf) {
        let mut d = self.default_download_dir.write().await;
        *d = dir;
    }

    pub async fn get_default_dir(&self) -> PathBuf {
        self.default_download_dir.read().await.clone()
    }

    pub async fn set_max_connections(&self, count: usize) {
        let mut c = self.max_connections.write().await;
        *c = count.clamp(1, 16);
    }

    /// Adds and immediately begins a new download
    pub async fn add_download(
        &self,
        url: &str,
        options: Option<DownloadOptions>,
    ) -> Result<String, String> {
        let gid = uuid::Uuid::new_v4().to_string();
        let opts = options.unwrap_or_default();

        let mut target_dir = if let Some(dir_str) = opts.dir {
            PathBuf::from(dir_str)
        } else {
            self.get_default_dir().await
        };

        // Ensure destination folder exists, with resilient fallback for Android scoped storage
        if let Err(e) = tokio::fs::create_dir_all(&target_dir).await {
            #[cfg(target_os = "android")]
            {
                let mut resolved = false;
                let fallbacks = [
                    PathBuf::from("/storage/emulated/0/Download/TeraBox"),
                    PathBuf::from("/storage/emulated/0/Download"),
                    PathBuf::from("/sdcard/Download"),
                    PathBuf::from("/data/data/com.teralace.downloader/files/Download"),
                ];
                for fb in &fallbacks {
                    if tokio::fs::create_dir_all(fb).await.is_ok() {
                        target_dir = fb.clone();
                        resolved = true;
                        break;
                    }
                }
                if !resolved {
                    return Err(format!("Failed to create download folder on Android: {}", e));
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                return Err(format!("Failed to create download folder: {}", e));
            }
        }

        let filename = if let Some(out_name) = opts.out {
            out_name
        } else {
            Self::extract_filename_from_url(url)
        };

        let filepath = target_dir.join(&filename);
        let headers = opts.headers.unwrap_or_default();

        let task = DownloadTask {
            gid: gid.clone(),
            url: url.to_string(),
            filename,
            filepath,
            total_size: Arc::new(AtomicU64::new(0)),
            downloaded: Arc::new(AtomicU64::new(0)),
            speed: Arc::new(AtomicU64::new(0)),
            status: Arc::new(RwLock::new(DownloadStatus::Active)),
            error_message: Arc::new(RwLock::new(None)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            pause_flag: Arc::new(AtomicBool::new(false)),
            headers,
        };

        {
            let mut map = self.tasks.write().await;
            map.insert(gid.clone(), task.clone());
        }

        // Spawn async worker
        let client = self.client.clone();
        let max_conn = *self.max_connections.read().await;
        tokio::spawn(async move {
            Self::run_download_task(client, task, max_conn).await;
        });

        Ok(gid)
    }

    fn get_candidate_referers(url_str: &str, custom_headers: &[(String, String)]) -> Vec<Option<String>> {
        for (k, v) in custom_headers {
            if k.eq_ignore_ascii_case("referer") {
                return vec![Some(v.clone()), None];
            }
        }

        let mut list = Vec::new();

        if let Ok(parsed) = url::Url::parse(url_str) {
            if let Some(host) = parsed.host_str() {
                let h = host.to_lowercase();
                if h.ends_with("nephobox.com") {
                    list.push(Some("https://www.nephobox.com/".to_string()));
                    list.push(Some("https://nephobox.com/".to_string()));
                } else if h.ends_with("terabox.app") {
                    list.push(Some("https://www.terabox.app/".to_string()));
                    list.push(Some("https://terabox.app/".to_string()));
                } else if h.ends_with("terabox.com") {
                    list.push(Some("https://www.terabox.com/".to_string()));
                    list.push(Some("https://terabox.com/".to_string()));
                } else if h.ends_with("1024tera.com") {
                    list.push(Some("https://www.1024tera.com/".to_string()));
                    list.push(Some("https://1024tera.com/".to_string()));
                } else if h.ends_with("4funbox.com") {
                    list.push(Some("https://www.4funbox.com/".to_string()));
                } else if h.ends_with("mirrobox.com") {
                    list.push(Some("https://www.mirrobox.com/".to_string()));
                } else if h.ends_with("momerybox.com") {
                    list.push(Some("https://www.momerybox.com/".to_string()));
                } else if h.ends_with("tibabox.com") {
                    list.push(Some("https://www.tibabox.com/".to_string()));
                } else {
                    list.push(Some(format!("https://{}/", host)));
                }
            }
        }

        // None (no referer header, just like aria2) is an essential fallback for CDNs that reject foreign referers
        list.push(None);
        list.push(Some("https://www.terabox.app/".to_string()));
        list.push(Some("https://www.terabox.com/".to_string()));
        list.push(Some("https://terabox.hnn.workers.dev/".to_string()));

        list
    }

    async fn run_download_task(client: Client, task: DownloadTask, max_conn: usize) {
        let candidate_referers = Self::get_candidate_referers(&task.url, &task.headers);
        let mut chosen_referer: Option<String> = candidate_referers.first().cloned().flatten();
        let mut total_size: u64 = 0;
        let mut supports_range = false;
        let mut probe_succeeded = false;

        // Try probing with candidate referers using Range: bytes=0-0 GET first (most reliable across CDNs)
        for ref_opt in &candidate_referers {
            let mut req = client
                .get(&task.url)
                .header(RANGE, "bytes=0-0")
                .header(USER_AGENT, CHUNK_USER_AGENT);
            if let Some(r) = ref_opt {
                req = req.header(REFERER, r);
            }
            for (k, v) in &task.headers {
                if !k.eq_ignore_ascii_case("referer") && !k.eq_ignore_ascii_case("user-agent") {
                    req = req.header(k, v);
                }
            }

            if let Ok(resp) = req.send().await {
                let status = resp.status();
                if status.as_u16() == 206 {
                    supports_range = true;
                    if let Some(cr) = resp.headers().get("content-range") {
                        if let Ok(s) = cr.to_str() {
                            if let Some(total_str) = s.split('/').last() {
                                total_size = total_str.parse::<u64>().unwrap_or(0);
                            }
                        }
                    }
                    chosen_referer = ref_opt.clone();
                    probe_succeeded = true;
                    log::info!("[Downloader] Probe succeeded (206) with referer: {:?}", ref_opt);
                    break;
                } else if status.is_success() {
                    if let Some(cl) = resp.headers().get(CONTENT_LENGTH) {
                        if let Ok(s) = cl.to_str() {
                            total_size = s.parse::<u64>().unwrap_or(0);
                        }
                    }
                    chosen_referer = ref_opt.clone();
                    probe_succeeded = true;
                    log::info!("[Downloader] Probe succeeded (200) with referer: {:?}", ref_opt);
                    break;
                }
            }
        }

        // If GET range probe didn't succeed, try HEAD with candidate referers as fallback
        if !probe_succeeded {
            for ref_opt in &candidate_referers {
                let mut req = client
                    .head(&task.url)
                    .header(USER_AGENT, CHUNK_USER_AGENT);
                if let Some(r) = ref_opt {
                    req = req.header(REFERER, r);
                }
                for (k, v) in &task.headers {
                    if !k.eq_ignore_ascii_case("referer") && !k.eq_ignore_ascii_case("user-agent") {
                        req = req.header(k, v);
                    }
                }

                if let Ok(resp) = req.send().await {
                    if resp.status().is_success() {
                        if let Some(cl) = resp.headers().get(CONTENT_LENGTH) {
                            if let Ok(s) = cl.to_str() {
                                total_size = s.parse::<u64>().unwrap_or(0);
                            }
                        }
                        if let Some(ar) = resp.headers().get(ACCEPT_RANGES) {
                            if let Ok(s) = ar.to_str() {
                                supports_range = s.to_lowercase().contains("bytes");
                            }
                        }
                        chosen_referer = ref_opt.clone();
                        probe_succeeded = true;
                        log::info!("[Downloader] HEAD probe succeeded with referer: {:?}", ref_opt);
                        break;
                    }
                }
            }
        }

        task.total_size.store(total_size, Ordering::SeqCst);

        // Speed calculator task
        let task_clone = task.clone();
        let monitor_handle = tokio::spawn(async move {
            let mut last_downloaded = 0u64;
            loop {
                tokio::time::sleep(Duration::from_millis(1000)).await;
                if task_clone.cancel_flag.load(Ordering::Relaxed) {
                    break;
                }
                let current = task_clone.downloaded.load(Ordering::Relaxed);
                let speed = current.saturating_sub(last_downloaded);
                task_clone.speed.store(speed, Ordering::Relaxed);
                last_downloaded = current;

                let status = task_clone.status.read().await;
                if *status == DownloadStatus::Complete || *status == DownloadStatus::Error {
                    break;
                }
            }
        });

        // 2. Execute Download: Multi-chunk with parts merging or single stream
        let download_result = if supports_range && total_size > 2 * 1024 * 1024 {
            Self::download_chunked_parts(&client, &task, total_size, max_conn, chosen_referer.as_deref()).await
        } else {
            Self::download_single_stream(&client, &task, chosen_referer.as_deref()).await
        };

        monitor_handle.abort();
        task.speed.store(0, Ordering::Relaxed);

        match download_result {
            Ok(_) => {
                if !task.cancel_flag.load(Ordering::Relaxed) {
                    *task.status.write().await = DownloadStatus::Complete;
                }
            }
            Err(e) => {
                if !task.cancel_flag.load(Ordering::Relaxed) {
                    *task.status.write().await = DownloadStatus::Error;
                    *task.error_message.write().await = Some(e);
                }
            }
        }
    }

    /// Parallel chunk downloading with separate part files & final assembly
    async fn download_chunked_parts(
        client: &Client,
        task: &DownloadTask,
        total_size: u64,
        max_conn: usize,
        referer: Option<&str>,
    ) -> Result<(), String> {
        let chunk_count = max_conn.clamp(2, 16);
        let chunk_size = total_size / (chunk_count as u64);
        let mut handles = Vec::new();
        let mut part_paths = Vec::new();

        for i in 0..chunk_count {
            let start = i as u64 * chunk_size;
            let end = if i == chunk_count - 1 {
                total_size - 1
            } else {
                (i as u64 + 1) * chunk_size - 1
            };

            let part_path = task.filepath.with_extension(format!("part{}", i));
            part_paths.push(part_path.clone());

            let client_c = client.clone();
            let task_c = task.clone();
            let ref_c = referer.map(|s| s.to_string());

            handles.push(tokio::spawn(async move {
                Self::download_part(client_c, task_c, part_path, start, end, ref_c.as_deref()).await
            }));
        }

        // Wait for all parts to complete
        for handle in handles {
            match handle.await {
                Ok(Ok(_)) => (),
                Ok(Err(e)) => {
                    Self::cleanup_parts(&part_paths).await;
                    return Err(e);
                }
                Err(join_err) => {
                    Self::cleanup_parts(&part_paths).await;
                    return Err(format!("Chunk worker error: {}", join_err));
                }
            }
        }

        if task.cancel_flag.load(Ordering::Relaxed) {
            Self::cleanup_parts(&part_paths).await;
            return Ok(());
        }

        // Merge all parts into final destination file
        let mut final_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&task.filepath)
            .await
            .map_err(|e| format!("Failed to create final assembled file: {}", e))?;

        for part in &part_paths {
            let mut part_file = File::open(part)
                .await
                .map_err(|e| format!("Failed to open part file: {}", e))?;

            tokio::io::copy(&mut part_file, &mut final_file)
                .await
                .map_err(|e| format!("Failed to merge part file: {}", e))?;
        }

        final_file.flush().await.map_err(|e| e.to_string())?;

        // Cleanup temporary parts
        Self::cleanup_parts(&part_paths).await;

        Ok(())
    }

    async fn download_part(
        client: Client,
        task: DownloadTask,
        part_path: PathBuf,
        start: u64,
        end: u64,
        referer: Option<&str>,
    ) -> Result<(), String> {
        let range_val = format!("bytes={}-{}", start, end);
        let mut req = client
            .get(&task.url)
            .header(RANGE, range_val)
            .header(USER_AGENT, CHUNK_USER_AGENT);
        if let Some(r) = referer {
            req = req.header(REFERER, r);
        }
        for (k, v) in &task.headers {
            if !k.eq_ignore_ascii_case("referer") && !k.eq_ignore_ascii_case("user-agent") {
                req = req.header(k, v);
            }
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Range request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to open part file: {}", e))?;

        let mut stream = resp.bytes_stream();
        while let Some(chunk_res) = stream.next().await {
            if task.cancel_flag.load(Ordering::Relaxed) {
                return Ok(());
            }

            while task.pause_flag.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(300)).await;
                if task.cancel_flag.load(Ordering::Relaxed) {
                    return Ok(());
                }
            }

            let chunk = chunk_res.map_err(|e| format!("Read error: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {}", e))?;

            task.downloaded.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        }

        file.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Single stream download fallback
    async fn download_single_stream(
        client: &Client,
        task: &DownloadTask,
        referer: Option<&str>,
    ) -> Result<(), String> {
        let mut req = client
            .get(&task.url)
            .header(USER_AGENT, CHUNK_USER_AGENT);
        if let Some(r) = referer {
            req = req.header(REFERER, r);
        }
        for (k, v) in &task.headers {
            if !k.eq_ignore_ascii_case("referer") && !k.eq_ignore_ascii_case("user-agent") {
                req = req.header(k, v);
            }
        }
        let mut resp = req
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.status().as_u16() == 403 {
            // Dynamic fallback for anti-hotlinking
            let candidates = Self::get_candidate_referers(&task.url, &task.headers);
            for ref_opt in candidates {
                if ref_opt.as_deref() == referer {
                    continue;
                }
                let mut retry_req = client
                    .get(&task.url)
                    .header(USER_AGENT, CHUNK_USER_AGENT);
                if let Some(ref r) = ref_opt {
                    retry_req = retry_req.header(REFERER, r);
                }
                for (k, v) in &task.headers {
                    if !k.eq_ignore_ascii_case("referer") && !k.eq_ignore_ascii_case("user-agent") {
                        retry_req = retry_req.header(k, v);
                    }
                }
                if let Ok(retry_resp) = retry_req.send().await {
                    if retry_resp.status().is_success() {
                        resp = retry_resp;
                        break;
                    }
                }
            }
        }

        if !resp.status().is_success() {
            return Err(format!("HTTP status {}", resp.status()));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&task.filepath)
            .await
            .map_err(|e| format!("Failed to open output file: {}", e))?;

        let mut stream = resp.bytes_stream();
        while let Some(chunk_res) = stream.next().await {
            if task.cancel_flag.load(Ordering::Relaxed) {
                return Ok(());
            }

            while task.pause_flag.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(300)).await;
                if task.cancel_flag.load(Ordering::Relaxed) {
                    return Ok(());
                }
            }

            let chunk = chunk_res.map_err(|e| format!("Chunk error: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {}", e))?;

            task.downloaded.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        }

        file.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn cleanup_parts(paths: &[PathBuf]) {
        for p in paths {
            let _ = tokio::fs::remove_file(p).await;
        }
    }

    pub async fn get_status(&self, gid: &str) -> Result<DownloadInfo, String> {
        let map = self.tasks.read().await;
        let task = map.get(gid).ok_or_else(|| "Download not found".to_string())?;

        let downloaded = task.downloaded.load(Ordering::Relaxed);
        let total = task.total_size.load(Ordering::Relaxed);
        let speed = task.speed.load(Ordering::Relaxed);
        let status = task.status.read().await.clone();
        let error = task.error_message.read().await.clone();

        let progress = if total == 0 {
            0.0
        } else {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0)
        };

        Ok(DownloadInfo {
            gid: task.gid.clone(),
            filename: task.filename.clone(),
            total_size: total,
            downloaded,
            speed,
            progress,
            status,
            error_message: error,
        })
    }

    pub async fn pause_download(&self, gid: &str) -> Result<String, String> {
        let map = self.tasks.read().await;
        let task = map.get(gid).ok_or_else(|| "Download not found".to_string())?;
        task.pause_flag.store(true, Ordering::Relaxed);
        *task.status.write().await = DownloadStatus::Paused;
        Ok(gid.to_string())
    }

    pub async fn resume_download(&self, gid: &str) -> Result<String, String> {
        let map = self.tasks.read().await;
        let task = map.get(gid).ok_or_else(|| "Download not found".to_string())?;
        task.pause_flag.store(false, Ordering::Relaxed);
        *task.status.write().await = DownloadStatus::Active;
        Ok(gid.to_string())
    }

    pub async fn cancel_download(&self, gid: &str) -> Result<String, String> {
        let mut map = self.tasks.write().await;
        if let Some(task) = map.remove(gid) {
            task.cancel_flag.store(true, Ordering::Relaxed);
            *task.status.write().await = DownloadStatus::Removed;
            let _ = tokio::fs::remove_file(&task.filepath).await;
        }
        Ok(gid.to_string())
    }

    pub async fn get_all_downloads(&self) -> Result<Vec<DownloadInfo>, String> {
        let map = self.tasks.read().await;
        let mut list = Vec::new();

        for task in map.values() {
            let downloaded = task.downloaded.load(Ordering::Relaxed);
            let total = task.total_size.load(Ordering::Relaxed);
            let speed = task.speed.load(Ordering::Relaxed);
            let status = task.status.read().await.clone();
            let error = task.error_message.read().await.clone();

            let progress = if total == 0 {
                0.0
            } else {
                ((downloaded as f64 / total as f64) * 100.0).min(100.0)
            };

            list.push(DownloadInfo {
                gid: task.gid.clone(),
                filename: task.filename.clone(),
                total_size: total,
                downloaded,
                speed,
                progress,
                status,
                error_message: error,
            });
        }

        Ok(list)
    }

    fn extract_filename_from_url(url: &str) -> String {
        if let Ok(parsed) = url::Url::parse(url) {
            if let Some(mut segments) = parsed.path_segments() {
                if let Some(last) = segments.next_back() {
                    let decoded = urlencoding::decode(last).unwrap_or_default().to_string();
                    if !decoded.trim().is_empty() {
                        return decoded;
                    }
                }
            }
        }
        format!("terabox_download_{}.bin", uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>())
    }
}
