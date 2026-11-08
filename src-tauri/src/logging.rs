use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;
use log::{Level, LevelFilter, Log, Metadata, Record};
use serde::{Deserialize, Serialize};

pub const MAX_LOG_ENTRIES: usize = 600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp_ms: u64,
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

pub struct AppLogger {
    buffer: Arc<Mutex<VecDeque<LogEntry>>>,
    debug_mode: Mutex<bool>,
}

static LOGGER_INSTANCE: OnceLock<AppLogger> = OnceLock::new();

impl AppLogger {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES))),
            debug_mode: Mutex::new(false),
        }
    }

    pub fn push_entry(&self, level: &str, target: &str, message: &str) {
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default();
        let timestamp_ms = now.as_millis() as u64;
        let total_secs = now.as_secs();
        let secs = total_secs % 60;
        let mins = (total_secs / 60) % 60;
        let hours = (total_secs / 3600) % 24;
        let timestamp = format!("{:02}:{:02}:{:02}", hours, mins, secs);

        let entry = LogEntry {
            timestamp_ms,
            timestamp,
            level: level.to_uppercase(),
            target: target.to_string(),
            message: message.to_string(),
        };

        if let Ok(mut buf) = self.buffer.lock() {
            if buf.len() >= MAX_LOG_ENTRIES {
                buf.pop_front();
            }
            buf.push_back(entry);
        }
    }

    pub fn get_entries(&self, filter_level: Option<&str>) -> Vec<LogEntry> {
        if let Ok(buf) = self.buffer.lock() {
            if let Some(lvl) = filter_level.map(|s| s.trim().to_uppercase()) {
                if !lvl.is_empty() && lvl != "ALL" {
                    return buf
                        .iter()
                        .filter(|e| e.level == lvl)
                        .cloned()
                        .collect();
                }
            }
            buf.iter().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.buffer.lock() {
            buf.clear();
        }
    }

    pub fn set_debug_mode(&self, enabled: bool) {
        if let Ok(mut mode) = self.debug_mode.lock() {
            *mode = enabled;
            if enabled {
                log::set_max_level(LevelFilter::Debug);
            } else {
                log::set_max_level(LevelFilter::Info);
            }
        }
    }

    pub fn is_debug_mode(&self) -> bool {
        self.debug_mode.lock().map(|m| *m).unwrap_or(false)
    }
}

impl Log for AppLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        let is_debug = self.is_debug_mode();
        if is_debug {
            metadata.level() <= Level::Debug
        } else {
            metadata.level() <= Level::Info
        }
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            let target = record.target();
            // Filter noise from hyper / rustls / reqwest internal trace unless debug
            if (target.starts_with("hyper") || target.starts_with("reqwest") || target.starts_with("rustls"))
                && record.level() > Level::Warn
                && !self.is_debug_mode()
            {
                return;
            }

            let msg = format!("{}", record.args());
            let level_str = record.level().to_string();

            // Store in memory ring buffer for frontend/UI diagnostics
            self.push_entry(&level_str, target, &msg);

            // Also print to console/logcat
            eprintln!("[{}] [{}] {}", level_str, target, msg);
        }
    }

    fn flush(&self) {}
}

pub fn init_logger() {
    let logger = AppLogger::new();
    let _ = LOGGER_INSTANCE.set(logger);
    if let Some(logger_ref) = LOGGER_INSTANCE.get() {
        let _ = log::set_logger(logger_ref);
        log::set_max_level(LevelFilter::Info);
    }
}

pub fn get_logger() -> Option<&'static AppLogger> {
    LOGGER_INSTANCE.get()
}
