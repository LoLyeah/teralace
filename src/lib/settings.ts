import { load } from '@tauri-apps/plugin-store';
import { ApiEndpointConfig } from './types';
import { saveTeraboxCookie } from './api';

const STORE_PATH = 'settings.json';

export interface AppSettings {
  downloadDir: string;
  downloadMode: number;
  maxConcurrent: number;
  maxOverallDownloadLimitKbPerSec: number;
  maxDownloadLimitKbPerSec: number;
  apiEndpoints: ApiEndpointConfig[];
  teraboxCookie: string;
}

export const DEFAULT_ENDPOINTS: ApiEndpointConfig[] = [
  {
    id: "default-ntm",
    name: "NTM TeraBox API",
    url: "https://api-free.ntmterabox.me/",
    token: null,
    enabled: true,
  },
  {
    id: "default-fast",
    name: "Fast Tera API",
    url: "https://terabox-api.saiyanprojects.com/",
    token: null,
    enabled: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  downloadMode: 2,
  maxConcurrent: 2,
  maxOverallDownloadLimitKbPerSec: 0,
  maxDownloadLimitKbPerSec: 0,
  apiEndpoints: DEFAULT_ENDPOINTS,
  teraboxCookie: '',
};

let storePromise: Promise<any> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = load(STORE_PATH);
  }
  return storePromise;
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const s = await getStore();
    const val = await s.get('config');
    const result: AppSettings = { ...DEFAULT_SETTINGS, ...val };
    if (result.teraboxCookie) {
      saveTeraboxCookie(result.teraboxCookie).catch(() => {});
    }
    return result;
  } catch (e) {
    console.error("Failed to load settings:", e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const s = await getStore();
    await s.set('config', settings);
    await s.save();
    if (settings.teraboxCookie !== undefined) {
      await saveTeraboxCookie(settings.teraboxCookie).catch(() => {});
    }
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}
