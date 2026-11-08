mod downloader;
pub mod logging;
mod settings;
mod terabox;

use downloader::{DownloadInfo, DownloadManager, DownloadOptions};
use logging::LogEntry;
use settings::types::AppSettings;
use std::path::PathBuf;
use std::sync::LazyLock;
use tauri::Emitter;
use tauri_plugin_store::StoreExt;
use terabox::{
    ApiEndpointConfig, DownloadLink, DownloadParams, EndpointHealthInfo, TeraboxApi,
    TeraboxFileInfo, TeraboxInfo,
};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

static DOWNLOAD_MANAGER: LazyLock<DownloadManager> = LazyLock::new(DownloadManager::new);
static TERABOX_API: LazyLock<TeraboxApi> = LazyLock::new(|| {
    let default_settings = AppSettings::default();
    TeraboxApi::new(&default_settings.api_endpoints)
});

fn get_settings(handle: &tauri::AppHandle) -> AppSettings {
    let mut settings = if let Ok(store) = handle.store("settings") {
        if let Some(value) = store.get("app_settings") {
            serde_json::from_value(value).unwrap_or_default()
        } else {
            AppSettings::default()
        }
    } else {
        AppSettings::default()
    };

    // Cross-check store "settings.json" (written by frontend saveSettings under "config")
    if let Ok(json_store) = handle.store("settings.json") {
        if let Some(val) = json_store.get("config") {
            if let Some(cookie) = val.get("teraboxCookie").and_then(|c| c.as_str()) {
                let trimmed = cookie.trim();
                if !trimmed.is_empty() && settings.terabox_cookie.as_deref().unwrap_or("").is_empty() {
                    settings.terabox_cookie = Some(trimmed.to_string());
                }
            }
            if let Some(dir) = val.get("downloadDir").and_then(|d| d.as_str()) {
                let trimmed = dir.trim();
                if !trimmed.is_empty() && (settings.download_dir.is_empty() || settings.download_dir == "downloads") {
                    settings.download_dir = trimmed.to_string();
                }
            }
            if let Some(concurrent) = val.get("maxConcurrent").and_then(|c| c.as_u64()) {
                if concurrent > 0 {
                    settings.max_concurrent = concurrent as u32;
                }
            }
        }
    }

    settings
}

fn save_settings(handle: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    if let Ok(store) = handle.store("settings") {
        let value = serde_json::to_value(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        store.set("app_settings", value);
        let _ = store.save();
    }

    // Mirror to settings.json for seamless frontend synchronization
    if let Ok(json_store) = handle.store("settings.json") {
        let mut config = json_store.get("config").unwrap_or_else(|| serde_json::json!({}));
        if let Some(obj) = config.as_object_mut() {
            if let Some(ref cookie) = settings.terabox_cookie {
                obj.insert("teraboxCookie".to_string(), serde_json::Value::String(cookie.clone()));
            }
            if !settings.download_dir.is_empty() {
                obj.insert("downloadDir".to_string(), serde_json::Value::String(settings.download_dir.clone()));
            }
            obj.insert("maxConcurrent".to_string(), serde_json::json!(settings.max_concurrent));
        }
        json_store.set("config", config);
        let _ = json_store.save();
    }

    Ok(())
}

#[tauri::command]
async fn save_terabox_cookie(handle: tauri::AppHandle, cookie: String) -> Result<(), String> {
    let mut settings = get_settings(&handle);
    let trimmed = cookie.trim().to_string();
    settings.terabox_cookie = if trimmed.is_empty() { None } else { Some(trimmed) };
    save_settings(&handle, &settings)?;
    log::info!("[save_terabox_cookie] TeraBox session cookie updated (has_cookie: {})", settings.terabox_cookie.is_some());
    Ok(())
}

#[tauri::command]
async fn get_terabox_info(handle: tauri::AppHandle, url: String) -> Result<TeraboxInfo, String> {
    let settings = get_settings(&handle);
    TERABOX_API
        .balancer
        .update_endpoints(&settings.api_endpoints)
        .await;

    TERABOX_API
        .get_info(&url, settings.terabox_cookie.as_deref())
        .await
}

#[tauri::command]
async fn get_folder_contents(
    handle: tauri::AppHandle,
    surl: String,
    folder_path: String,
) -> Result<Vec<TeraboxFileInfo>, String> {
    let settings = get_settings(&handle);
    TERABOX_API
        .get_folder_contents(&surl, &folder_path, settings.terabox_cookie.as_deref())
        .await
}

#[tauri::command]
async fn get_folder_files_recursive(
    handle: tauri::AppHandle,
    surl: String,
    folder_path: String,
) -> Result<Vec<TeraboxFileInfo>, String> {
    let settings = get_settings(&handle);
    TERABOX_API
        .get_folder_files_recursive(&surl, &folder_path, settings.terabox_cookie.as_deref())
        .await
}

#[tauri::command]
async fn get_download_link(
    handle: tauri::AppHandle,
    params: DownloadParams,
) -> Result<DownloadLink, String> {
    let settings = get_settings(&handle);
    TERABOX_API
        .get_download_link(params, settings.terabox_cookie.as_deref())
        .await
}

#[tauri::command]
fn extract_shorturl(url: String) -> Option<String> {
    terabox::normalize_terabox_url(&url).map(|(_, surl)| surl)
}

#[tauri::command]
async fn get_endpoint_stats() -> Result<Vec<EndpointHealthInfo>, String> {
    Ok(TERABOX_API.balancer.get_health_stats().await)
}

#[tauri::command]
async fn ping_endpoint_health(handle: tauri::AppHandle) -> Result<Vec<EndpointHealthInfo>, String> {
    let settings = get_settings(&handle);
    TERABOX_API.balancer.update_endpoints(&settings.api_endpoints).await;
    Ok(TERABOX_API.ping_endpoints().await)
}

#[cfg(desktop)]
#[tauri::command]
async fn open_terabox_login(handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(existing) = handle.get_webview_window("terabox_login") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok("focused_existing".to_string());
    }

    let h = handle.clone();
    std::thread::spawn(move || {
        let login_url = match "https://www.terabox.app/login".parse::<Url>() {
            Ok(u) => u,
            Err(e) => {
                log::error!("[open_terabox_login] Failed to parse login URL: {}", e);
                return;
            }
        };

        let init_script = r#"
            (function() {
                var reported = false;
                function check() {
                    if (reported) return;
                    try {
                        var m = document.cookie.match(/(?:^|;\s*)ndus=([^;]+)/);
                        if (m && m[1]) {
                            reported = true;
                            window.location.hash = "teralace_ndus=" + encodeURIComponent(m[1].trim());
                        }
                    } catch (e) {}
                }
                setInterval(check, 600);
                document.addEventListener('DOMContentLoaded', check);
            })();
        "#;

        let handle_for_nav = h.clone();
        let builder = WebviewWindowBuilder::new(&h, "terabox_login", WebviewUrl::External(login_url))
            .title("Sign In to TeraBox - TeraLace Auto-Capture")
            .inner_size(840.0, 720.0)
            .center()
            .resizable(true)
            .initialization_script(init_script)
            .on_navigation(move |url: &Url| {
                if let Some(fragment) = url.fragment() {
                    if fragment.starts_with("teralace_ndus=") {
                        let encoded = fragment.trim_start_matches("teralace_ndus=");
                        if let Ok(cookie_val) = urlencoding::decode(encoded) {
                            let clean_cookie = cookie_val.into_owned();
                            log::info!("[open_terabox_login] TeraBox ndus cookie auto-captured successfully!");
                            let nav_handle = handle_for_nav.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut settings = get_settings(&nav_handle);
                                settings.terabox_cookie = Some(clean_cookie.clone());
                                let _ = save_settings(&nav_handle, &settings);
                                let _ = nav_handle.emit("terabox-cookie-captured", clean_cookie);
                                if let Some(w) = nav_handle.get_webview_window("terabox_login") {
                                    let _ = w.close();
                                }
                            });
                            return false;
                        }
                    }
                }
                true
            });

        match builder.build() {
            Ok(_) => log::info!("[open_terabox_login] TeraBox login window launched successfully"),
            Err(e) => log::error!("[open_terabox_login] Failed to launch login window: {}", e),
        }
    });

    Ok("opened_window".to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
async fn open_terabox_login(_handle: tauri::AppHandle) -> Result<String, String> {
    let _ = tauri_plugin_opener::open_url("https://www.terabox.app/login", None::<&str>);
    Ok("opened_external".to_string())
}

#[tauri::command]
async fn save_api_endpoints(
    handle: tauri::AppHandle,
    endpoints: Vec<ApiEndpointConfig>,
) -> Result<(), String> {
    let mut settings = get_settings(&handle);
    settings.api_endpoints = endpoints.clone();
    save_settings(&handle, &settings)?;
    TERABOX_API.balancer.update_endpoints(&endpoints).await;
    Ok(())
}

// ============ Embedded Multi-Threaded Chunk Downloader Commands ============

#[tauri::command]
async fn add_download(
    handle: tauri::AppHandle,
    url: String,
    dir: Option<String>,
    filename: Option<String>,
) -> Result<String, String> {
    let settings = get_settings(&handle);
    let mut headers = Vec::new();
    if let Some(cookie) = &settings.terabox_cookie {
        let cookie_str = cookie.trim().trim_matches('"').trim_matches('\'').trim();
        if !cookie_str.is_empty() {
            let formatted = if cookie_str.contains('=') {
                cookie_str.to_string()
            } else {
                format!("ndus={}", cookie_str)
            };
            headers.push(("Cookie".to_string(), formatted));
        }
    }

    // Determine effective target directory with Android fallback
    let effective_dir = if let Some(d) = dir.filter(|s| !s.trim().is_empty()) {
        Some(d)
    } else {
        #[cfg(target_os = "android")]
        {
            // On Android, verify settings path is an absolute Android path, otherwise fall back to public Download/TeraBox
            if !settings.download_dir.trim().is_empty() && settings.download_dir.starts_with('/') {
                Some(settings.download_dir.clone())
            } else {
                use tauri::Manager;
                let p = handle
                    .path()
                    .download_dir()
                    .unwrap_or_else(|_| PathBuf::from("/storage/emulated/0/Download"))
                    .join("TeraBox");
                Some(p.to_string_lossy().to_string())
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            if !settings.download_dir.trim().is_empty() {
                Some(settings.download_dir.clone())
            } else {
                None
            }
        }
    };

    let options = DownloadOptions {
        dir: effective_dir,
        out: filename,
        headers: if headers.is_empty() { None } else { Some(headers) },
        ..Default::default()
    };
    DOWNLOAD_MANAGER.add_download(&url, Some(options)).await
}

#[tauri::command]
async fn get_download_status(gid: String) -> Result<DownloadInfo, String> {
    DOWNLOAD_MANAGER.get_status(&gid).await
}

#[tauri::command]
async fn pause_download(gid: String) -> Result<String, String> {
    DOWNLOAD_MANAGER.pause_download(&gid).await
}

#[tauri::command]
async fn resume_download(gid: String) -> Result<String, String> {
    DOWNLOAD_MANAGER.resume_download(&gid).await
}

#[tauri::command]
async fn cancel_download(gid: String) -> Result<String, String> {
    DOWNLOAD_MANAGER.cancel_download(&gid).await
}

#[tauri::command]
async fn get_all_downloads() -> Result<Vec<DownloadInfo>, String> {
    DOWNLOAD_MANAGER.get_all_downloads().await
}

#[tauri::command]
async fn pause_all_downloads() -> Result<String, String> {
    let all = DOWNLOAD_MANAGER.get_all_downloads().await?;
    for item in all {
        let _ = DOWNLOAD_MANAGER.pause_download(&item.gid).await;
    }
    Ok("ok".to_string())
}

#[tauri::command]
async fn resume_all_downloads() -> Result<String, String> {
    let all = DOWNLOAD_MANAGER.get_all_downloads().await?;
    for item in all {
        let _ = DOWNLOAD_MANAGER.resume_download(&item.gid).await;
    }
    Ok("ok".to_string())
}

#[tauri::command]
async fn open_download_dir(handle: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let target = if let Some(p) = path {
        p
    } else {
        let settings = get_settings(&handle);
        if !settings.download_dir.is_empty() {
            settings.download_dir
        } else {
            DOWNLOAD_MANAGER
                .get_default_dir()
                .await
                .to_string_lossy()
                .to_string()
        }
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "android")]
    {
        let _ = (&handle, &target);
    }

    Ok(())
}

// Backward compatibility stubs for UI
#[tauri::command]
async fn start_aria2() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn stop_aria2() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn is_aria2_running() -> bool {
    true
}

#[tauri::command]
async fn set_bandwidth_limit(
    handle: tauri::AppHandle,
    max_overall_limit_kb_per_sec: u64,
    max_download_limit_kb_per_sec: u64,
) -> Result<(), String> {
    let mut settings = get_settings(&handle);
    settings.max_overall_download_limit_kb_per_sec = max_overall_limit_kb_per_sec;
    settings.max_download_limit_kb_per_sec = max_download_limit_kb_per_sec;
    save_settings(&handle, &settings)?;
    Ok(())
}

#[tauri::command]
async fn get_bandwidth_limit(handle: tauri::AppHandle) -> Result<(u64, u64), String> {
    let settings = get_settings(&handle);
    Ok((
        settings.max_overall_download_limit_kb_per_sec,
        settings.max_download_limit_kb_per_sec,
    ))
}

#[tauri::command]
async fn get_app_settings(handle: tauri::AppHandle) -> Result<AppSettings, String> {
    Ok(get_settings(&handle))
}

#[tauri::command]
async fn save_app_settings(
    handle: tauri::AppHandle,
    settings: AppSettings,
) -> Result<(), String> {
    if !settings.download_dir.is_empty() {
        DOWNLOAD_MANAGER
            .set_default_dir(PathBuf::from(&settings.download_dir))
            .await;
    }
    DOWNLOAD_MANAGER
        .set_max_connections(settings.max_connections as usize)
        .await;
    TERABOX_API
        .balancer
        .update_endpoints(&settings.api_endpoints)
        .await;
    save_settings(&handle, &settings)?;
    Ok(())
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "Show TeraLace", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit TeraLace", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

    let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap()
    });

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("TeraLace - TeraBox Downloader")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn get_app_logs(filter_level: Option<String>) -> Result<Vec<LogEntry>, String> {
    if let Some(logger) = logging::get_logger() {
        Ok(logger.get_entries(filter_level.as_deref()))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn clear_app_logs() -> Result<(), String> {
    if let Some(logger) = logging::get_logger() {
        logger.clear();
    }
    Ok(())
}

#[tauri::command]
fn log_client_message(level: String, target: Option<String>, message: String) -> Result<(), String> {
    if let Some(logger) = logging::get_logger() {
        let tgt = target.unwrap_or_else(|| "frontend".to_string());
        logger.push_entry(&level, &tgt, &message);
    }
    Ok(())
}

#[tauri::command]
fn set_debug_log_mode(enabled: bool) -> Result<(), String> {
    if let Some(logger) = logging::get_logger() {
        logger.set_debug_mode(enabled);
        log::info!("[Logging] Debug log mode set to: {}", enabled);
    }
    Ok(())
}

#[tauri::command]
fn get_debug_log_mode() -> Result<bool, String> {
    if let Some(logger) = logging::get_logger() {
        Ok(logger.is_debug_mode())
    } else {
        Ok(false)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init_logger();
    log::info!("[App] TeraLace initialized (version {})", env!("CARGO_PKG_VERSION"));
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());

    builder = builder.setup(|app| {
        #[cfg(desktop)]
        {
            setup_tray(app)?;
        }

        #[cfg(target_os = "android")]
        {
            use tauri::Manager;
            if let Ok(dl_dir) = app.path().download_dir() {
                let tb_dir = dl_dir.join("TeraBox");
                tauri::async_runtime::block_on(async {
                    DOWNLOAD_MANAGER.set_default_dir(tb_dir).await;
                });
            }
        }

        let handle_for_ping = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
            log::info!("[Startup] Probing API endpoints health in background...");
            let stats = TERABOX_API.ping_endpoints().await;
            let healthy = stats.iter().filter(|s| s.healthy && !s.is_offline).count();
            log::info!("[Startup] Endpoints checked: {} total, {} online", stats.len(), healthy);
            let _ = handle_for_ping.emit("endpoint-health-updated", stats);
        });

        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![
            get_terabox_info,
            get_folder_contents,
            get_folder_files_recursive,
            get_download_link,
            extract_shorturl,
            get_endpoint_stats,
            ping_endpoint_health,
            open_terabox_login,
            save_api_endpoints,
            start_aria2,
            stop_aria2,
            is_aria2_running,
            add_download,
            get_download_status,
            pause_download,
            resume_download,
            cancel_download,
            get_all_downloads,
            pause_all_downloads,
            resume_all_downloads,
            open_download_dir,
            set_bandwidth_limit,
            get_bandwidth_limit,
            get_app_settings,
            save_app_settings,
            save_terabox_cookie,
            get_app_logs,
            clear_app_logs,
            log_client_message,
            set_debug_log_mode,
            get_debug_log_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
