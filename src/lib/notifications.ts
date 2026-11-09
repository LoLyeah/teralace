import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  createChannel,
  cancel,
  Importance,
  Visibility,
} from "@tauri-apps/plugin-notification";
import { formatSpeed } from "./api";

export const DOWNLOAD_NOTIFICATION_ID = 8888;
export const COMPLETE_NOTIFICATION_ID = 8889;
export const DOWNLOAD_CHANNEL_ID = "teralace_downloads";

let channelCreated = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }

    if (granted && !channelCreated) {
      try {
        await createChannel({
          id: DOWNLOAD_CHANNEL_ID,
          name: "Download Progress",
          description: "Persistent background download notifications and task progress",
          importance: Importance.Low,
          visibility: Visibility.Public,
        });
        channelCreated = true;
      } catch {
        // Channel may already exist or running on desktop
      }
    }

    return granted;
  } catch (e) {
    console.warn("Notification permission check failed:", e);
    return false;
  }
}

let lastNotificationTime = 0;

export async function updateDownloadNotification(
  activeCount: number,
  totalSpeed: number,
  progress: number
): Promise<void> {
  if (activeCount <= 0) return;

  try {
    const now = Date.now();
    // Throttle updates to at most once per 1.5 seconds to avoid flooding Android NotificationManager
    if (now - lastNotificationTime < 1500) {
      return;
    }
    lastNotificationTime = now;

    const granted = await ensureNotificationPermission();
    if (!granted) return;

    const speedStr = formatSpeed(totalSpeed);
    const progressInt = Math.min(100, Math.max(0, Math.round(progress)));

    sendNotification({
      id: DOWNLOAD_NOTIFICATION_ID,
      channelId: DOWNLOAD_CHANNEL_ID,
      title: activeCount === 1 ? "Teralace: Downloading file..." : `Teralace: Downloading ${activeCount} files...`,
      body: `${progressInt}% completed • ${speedStr} • Active in background`,
      ongoing: true,
      autoCancel: false,
    });
  } catch (e) {
    console.warn("Failed to update download notification:", e);
  }
}

export async function notifyDownloadComplete(filename?: string): Promise<void> {
  try {
    const granted = await ensureNotificationPermission();
    
    // Clear ongoing progress notification
    try {
      await cancel([DOWNLOAD_NOTIFICATION_ID]);
    } catch {}

    if (granted) {
      sendNotification({
        id: COMPLETE_NOTIFICATION_ID,
        channelId: DOWNLOAD_CHANNEL_ID,
        title: "Download Complete",
        body: filename ? `${filename} downloaded successfully.` : "All downloads have finished successfully.",
        ongoing: false,
        autoCancel: true,
      });
    }
  } catch (e) {
    console.warn("Failed to send completion notification:", e);
  }
}

export async function clearDownloadNotification(): Promise<void> {
  try {
    await cancel([DOWNLOAD_NOTIFICATION_ID]);
  } catch {}
}
