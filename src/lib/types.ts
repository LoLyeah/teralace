export interface TeraboxFileInfo {
  is_dir: boolean;
  fs_id: string;
  name: string;
  file_type: "video" | "image" | "file" | "folder" | "audio" | "archive" | "document" | "other";
  size: number | null;
  size_formatted?: string;
  category?: string | null;
  create_time?: number | null;
  thumb?: string | null;
  direct_link?: string | null;
}

export interface TeraboxInfo {
  ok: boolean;
  shareid: number;
  uk: number;
  sign: string;
  timestamp: number;
  list: TeraboxFileInfo[];
  error_message?: string;
  resolved_by?: string;
}

export interface DownloadParams {
  shareid: number;
  uk: number;
  sign: string;
  timestamp: number;
  fs_id: string;
  mode: number;
  direct_link?: string | null;
}

export interface DownloadLink {
  ok: boolean;
  download_link: string | null;
  error_message?: string;
}

export interface DownloadInfo {
  gid: string;
  filename: string;
  total_size: number;
  downloaded: number;
  speed: number;
  progress: number;
  status: "active" | "waiting" | "paused" | "complete" | "error" | "removed";
  error_message: string | null;
}

export type DownloadStatus = DownloadInfo["status"];

export interface ApiEndpointConfig {
  id: string;
  name: string;
  url: string;
  token?: string | null;
  enabled: boolean;
}

export interface EndpointHealthInfo {
  id: string;
  name: string;
  healthy: boolean;
  success_count: number;
  failure_count: number;
  total_requests: number;
  success_rate: string;
  avg_latency_ms: number;
  circuit_open: boolean;
  circuit_remaining_s: number;
}

export interface AppSettings {
  download_dir: string;
  max_connections: number;
  split_count: number;
  min_split_size: string;
  user_agent: string;
  auto_start_aria2: boolean;
  theme: string;
  max_overall_download_limit_kb_per_sec: number;
  max_download_limit_kb_per_sec: number;
  api_endpoints: ApiEndpointConfig[];
  terabox_cookie?: string | null;
  max_concurrent: number;
}

export function formatBandwidth(kbPerSec: number): string {
  if (kbPerSec === 0) {
    return "Unlimited";
  } else if (kbPerSec >= 1024) {
    return `${(kbPerSec / 1024).toFixed(2)} MB/s`;
  } else {
    return `${kbPerSec} KB/s`;
  }
}

export const BANDWIDTH_PRESETS: Array<{ label: string; value: number }> = [
  { label: "Unlimited", value: 0 },
  { label: "100 KB/s", value: 100 },
  { label: "250 KB/s", value: 250 },
  { label: "500 KB/s", value: 500 },
  { label: "1 MB/s", value: 1024 },
  { label: "2 MB/s", value: 2048 },
  { label: "5 MB/s", value: 5120 },
  { label: "10 MB/s", value: 10240 },
];
