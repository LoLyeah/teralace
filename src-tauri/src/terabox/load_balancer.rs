use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use crate::terabox::types::{ApiEndpointConfig, EndpointHealthInfo};

const CIRCUIT_THRESHOLD: u32 = 5;       // 5 consecutive failures to open circuit
const CIRCUIT_COOLDOWN_SECS: u64 = 120; // 120 seconds cooldown window

#[derive(Debug, Clone)]
pub struct InternalEndpoint {
    pub id: String,
    pub name: String,
    pub url: String,
    pub token: Option<String>,
    pub enabled: bool,
    pub consecutive_fails: u32,
    pub success_count: u64,
    pub failure_count: u64,
    pub total_requests: u64,
    pub total_latency_ms: u64,
    pub circuit_open_until: Option<Instant>,
}

impl InternalEndpoint {
    pub fn new(cfg: &ApiEndpointConfig) -> Self {
        Self {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            url: cfg.url.trim_end_matches('/').to_string(),
            token: cfg.token.clone(),
            enabled: cfg.enabled,
            consecutive_fails: 0,
            success_count: 0,
            failure_count: 0,
            total_requests: 0,
            total_latency_ms: 0,
            circuit_open_until: None,
        }
    }

    pub fn is_circuit_open(&self) -> bool {
        if let Some(until) = self.circuit_open_until {
            Instant::now() < until
        } else {
            false
        }
    }

    pub fn is_available(&self) -> bool {
        self.enabled && !self.is_circuit_open()
    }

    pub fn circuit_remaining_secs(&self) -> u64 {
        if let Some(until) = self.circuit_open_until {
            let now = Instant::now();
            if now < until {
                return (until - now).as_secs();
            }
        }
        0
    }

    pub fn build_request_url(&self, target_url: &str) -> String {
        let encoded_target = urlencoding::encode(target_url);
        if let Some(token) = &self.token {
            if !token.is_empty() {
                return format!("{}?authkey={}&url={}", self.url, token, encoded_target);
            }
        }
        format!("{}?url={}", self.url, encoded_target)
    }
}

pub struct LoadBalancer {
    endpoints: Arc<RwLock<Vec<InternalEndpoint>>>,
    round_robin_index: AtomicUsize,
}

impl LoadBalancer {
    pub fn new(configs: &[ApiEndpointConfig]) -> Self {
        let endpoints: Vec<InternalEndpoint> = configs.iter().map(InternalEndpoint::new).collect();
        Self {
            endpoints: Arc::new(RwLock::new(endpoints)),
            round_robin_index: AtomicUsize::new(0),
        }
    }

    /// Update the endpoints list dynamically from user settings
    pub async fn update_endpoints(&self, configs: &[ApiEndpointConfig]) {
        let mut list = self.endpoints.write().await;
        let mut new_list = Vec::new();
        
        for cfg in configs {
            // Keep stats if endpoint already exists
            if let Some(existing) = list.iter().find(|e| e.id == cfg.id) {
                let mut updated = existing.clone();
                updated.name = cfg.name.clone();
                updated.url = cfg.url.trim_end_matches('/').to_string();
                updated.token = cfg.token.clone();
                updated.enabled = cfg.enabled;
                new_list.push(updated);
            } else {
                new_list.push(InternalEndpoint::new(cfg));
            }
        }
        *list = new_list;
    }

    /// Select next available healthy endpoint using round-robin
    pub async fn next_endpoint(&self) -> Option<InternalEndpoint> {
        let list = self.endpoints.read().await;
        if list.is_empty() {
            return None;
        }

        let total = list.len();
        let start_idx = self.round_robin_index.fetch_add(1, Ordering::Relaxed);

        for i in 0..total {
            let idx = (start_idx + i) % total;
            let ep = &list[idx];
            if ep.is_available() {
                return Some(ep.clone());
            }
        }

        None
    }

    /// Report a successful API request and record latency
    pub async fn report_success(&self, endpoint_id: &str, latency_ms: u64) {
        let mut list = self.endpoints.write().await;
        if let Some(ep) = list.iter_mut().find(|e| e.id == endpoint_id) {
            ep.success_count += 1;
            ep.total_requests += 1;
            ep.consecutive_fails = 0;
            ep.total_latency_ms += latency_ms;
            ep.circuit_open_until = None; // Reset circuit on success
        }
    }

    /// Report an API failure and trip circuit breaker if threshold reached
    pub async fn report_failure(&self, endpoint_id: &str) {
        let mut list = self.endpoints.write().await;
        if let Some(ep) = list.iter_mut().find(|e| e.id == endpoint_id) {
            ep.failure_count += 1;
            ep.total_requests += 1;
            ep.consecutive_fails += 1;

            if ep.consecutive_fails >= CIRCUIT_THRESHOLD {
                let cooldown = Duration::from_secs(CIRCUIT_COOLDOWN_SECS);
                ep.circuit_open_until = Some(Instant::now() + cooldown);
                log::warn!(
                    "[CircuitBreaker] Opened for endpoint '{}' ({} consecutive failures, cool down {}s)",
                    ep.name, ep.consecutive_fails, CIRCUIT_COOLDOWN_SECS
                );
            }
        }
    }

    /// Returns health statistics for all endpoints (for Settings UI)
    pub async fn get_health_stats(&self) -> Vec<EndpointHealthInfo> {
        let list = self.endpoints.read().await;
        list.iter()
            .map(|ep| {
                let total = ep.total_requests;
                let success_rate = if total == 0 {
                    "100.0%".to_string()
                } else {
                    format!("{:.1}%", (ep.success_count as f64 / total as f64) * 100.0)
                };

                let avg_latency = if ep.success_count == 0 {
                    0
                } else {
                    ep.total_latency_ms / ep.success_count
                };

                let circuit_open = ep.is_circuit_open();
                EndpointHealthInfo {
                    id: ep.id.clone(),
                    name: ep.name.clone(),
                    healthy: ep.enabled && !circuit_open,
                    success_count: ep.success_count,
                    failure_count: ep.failure_count,
                    total_requests: ep.total_requests,
                    success_rate,
                    avg_latency_ms: avg_latency,
                    circuit_open,
                    circuit_remaining_s: ep.circuit_remaining_secs(),
                }
            })
            .collect()
    }
}
