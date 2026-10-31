mod downloader;
mod settings;
mod terabox;

use downloader::{DownloadInfo, DownloadManager, DownloadOptions};
use settings::types::AppSettings;
use std::path::PathBuf;
use std::sync::LazyLock;
use tauri_plugin_store::StoreExt;
use terabox::{
    ApiEndpointConfig, DownloadLink, DownloadParams, EndpointHealthInfo, TeraboxApi, TeraboxInfo,
};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

static DOWNLOAD_MANAGER: LazyLock<DownloadManager> = LazyLock::new(DownloadManager::new);
static TERABOX_API: LazyLock<TeraboxApi> = LazyLock::new(|| {
    let default_settings = AppSettings::default();
    TeraboxApi::new(&default_settings.api_endpoints)
});

fn get_settings(handle: &tauri::AppHandle) -> AppSettings {
    if let Ok(store) = handle.store("settings") {
        if let Some(value) = store.get("app_settings") {
            return serde_json::from_value(value).unwrap_or_default();
        }
    }
    AppSettings::default()
}

fn save_settings(handle: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = handle.store("settings").map_err(|e| e.to_string())?;
    let value = serde_json::to_value(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    store.set("app_settings", value);
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
        let cookie_str = cookie.trim();
        if !cookie_str.is_empty() {
            let formatted = if cookie_str.contains('=') {
                cookie_str.to_string()
            } else {
                format!("ndus={}", cookie_str)
            };
            headers.push(("Cookie".to_string(), formatted));
        }
    }

    let options = DownloadOptions {
        dir,
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

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    {
        builder = builder.setup(|app| {
            setup_tray(app)?;
            Ok(())
        });
    }

    builder
        .invoke_handler(tauri::generate_handler![
            get_terabox_info,
            get_download_link,
            extract_shorturl,
            get_endpoint_stats,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
