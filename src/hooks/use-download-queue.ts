import { useState, useEffect, useCallback, useRef } from "react";
import {
  DownloadParams,
  TeraboxFileInfo,
} from "../lib/types";
import {
  getDownloadLink,
  addDownload,
  getDownloadStatus,
  startAria2,
  cancelDownload,
} from "../lib/api";
import {
  notifyDownloadStarted,
  notifyDownloadComplete,
  notifyDownloadError,
} from "../lib/notifications";
import { extractFileSubpath } from "../lib/utils";
import { load } from "@tauri-apps/plugin-store";

export type QueueStatus = "pending" | "fetching_link" | "downloading" | "completed" | "error" | "cancelled";

export interface QueueItem {
  id: string;
  file: TeraboxFileInfo;
  status: QueueStatus;
  gid?: string;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
  error?: string;
  params: DownloadParams;
  downloadDir?: string;
  subpath?: string;
  filePath?: string;
  linkRetries?: number;
}

const QUEUE_STORAGE_KEY = "teralace_persisted_queue";
const STORE_FILE = "queue.json";

interface PersistedQueueItem {
  id: string;
  file: TeraboxFileInfo;
  params: DownloadParams;
  downloadDir?: string;
  subpath?: string;
  filePath?: string;
  total: number;
  downloaded: number;
  progress: number;
}

let tauriStorePromise: Promise<any> | null = null;
function getTauriStore() {
  if (!tauriStorePromise) {
    tauriStorePromise = load(STORE_FILE);
  }
  return tauriStorePromise;
}

async function syncToTauriStore(items: PersistedQueueItem[]): Promise<void> {
  try {
    const s = await getTauriStore();
    await s.set("queue", items);
    await s.save();
  } catch {
    // Non-critical background sync
  }
}

/**
 * Persists pending and active queue items to local storage.
 * Completed or cancelled items are removed from persistence.
 */
function persistQueueToStorage(queue: QueueItem[]) {
  try {
    const itemsToSave: PersistedQueueItem[] = queue
      .filter(item => item.status === "pending" || item.status === "downloading" || item.status === "fetching_link")
      .map(item => ({
        id: item.id,
        file: item.file,
        params: { ...item.params, direct_link: undefined }, // Clear stale direct_link so fresh link is requested on restore
        downloadDir: item.downloadDir,
        subpath: item.subpath,
        filePath: item.filePath,
        total: item.total || item.file?.size || 0,
        downloaded: item.downloaded || 0,
        progress: item.progress || 0,
      }));

    if (itemsToSave.length > 0) {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(itemsToSave));
    } else {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    }

    syncToTauriStore(itemsToSave).catch(() => {});
  } catch (e) {
    console.error("Failed to persist download queue to localStorage:", e);
  }
}

/**
 * Restores queue items from local storage into pending state on startup.
 */
function loadInitialQueue(): QueueItem[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(QUEUE_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    console.log(`[Queue] Restoring ${parsed.length} pending items from persistent queue`);

    return parsed.map((item: PersistedQueueItem) => ({
      id: item.id,
      file: item.file,
      status: "pending" as QueueStatus,
      progress: item.progress || 0,
      speed: 0,
      downloaded: item.downloaded || 0,
      total: item.total || item.file?.size || 0,
      params: { ...item.params, direct_link: undefined },
      downloadDir: item.downloadDir,
      subpath: item.subpath,
      filePath: item.filePath,
      linkRetries: 0,
    }));
  } catch (e) {
    console.warn("Failed to load initial queue from localStorage:", e);
    return [];
  }
}

/**
 * Checks if an error message indicates an HTTP 403 Forbidden or expired link response.
 */
function isForbiddenError(errorMessage?: string | null): boolean {
  if (!errorMessage) return false;
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("403") ||
    msg.includes("forbidden") ||
    msg.includes("access denied") ||
    msg.includes("user not exists") ||
    msg.includes("31045")
  );
}

export function useDownloadQueue() {
  const [queue, setQueue] = useState<QueueItem[]>(() => loadInitialQueue());
  // Auto-resume on startup if queue items were restored from storage
  const [isProcessing, setIsProcessing] = useState<boolean>(() => loadInitialQueue().length > 0);
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Track lifecycle notifications to avoid duplicate toasts
  const notifiedStartedRef = useRef<Set<string>>(new Set());
  const notifiedCompleteRef = useRef<Set<string>>(new Set());
  const notifiedErrorRef = useRef<Set<string>>(new Set());
  const retrying403Ref = useRef<Set<string>>(new Set());

  // Automatically persist queue changes
  useEffect(() => {
    persistQueueToStorage(queue);
  }, [queue]);

  // Fallback check from Tauri store if localStorage was empty
  useEffect(() => {
    if (queue.length === 0) {
      getTauriStore().then(async (s) => {
        try {
          const items = await s.get("queue");
          if (Array.isArray(items) && items.length > 0 && queueRef.current.length === 0) {
            console.log(`[Queue] Restoring ${items.length} items from Tauri store backup`);
            const restored: QueueItem[] = items.map((item: PersistedQueueItem) => ({
              id: item.id,
              file: item.file,
              status: "pending" as QueueStatus,
              progress: item.progress || 0,
              speed: 0,
              downloaded: item.downloaded || 0,
              total: item.total || item.file?.size || 0,
              params: { ...item.params, direct_link: undefined },
              downloadDir: item.downloadDir,
              subpath: item.subpath,
              filePath: item.filePath,
              linkRetries: 0,
            }));
            setQueue(restored);
            setIsProcessing(true);
          }
        } catch {}
      }).catch(() => {});
    }
  }, []);

  const addToQueue = useCallback((
    files: TeraboxFileInfo[], 
    params: Omit<DownloadParams, "fs_id">,
    downloadDir?: string,
    preserveHierarchy: boolean = true
  ) => {
    setQueue((prev) => {
      const newItems = files
        .filter((f) => !prev.some((p) => p.id === f.fs_id))
        .map((file) => {
          const subpath = preserveHierarchy ? extractFileSubpath(file) : undefined;
          return {
            id: file.fs_id,
            file,
            status: "pending" as QueueStatus,
            progress: 0,
            speed: 0,
            downloaded: 0,
            total: file.size || 0,
            params: { ...params, fs_id: file.fs_id, direct_link: file.direct_link, path: file.path },
            downloadDir,
            subpath: subpath || undefined,
            linkRetries: 0,
          };
        });
      return [...prev, ...newItems];
    });
  }, []);

  const removeFromQueue = useCallback(async (id: string) => {
    const item = queueRef.current.find(i => i.id === id);
    if (!item) return;

    notifiedStartedRef.current.delete(id);
    notifiedCompleteRef.current.delete(id);
    notifiedErrorRef.current.delete(id);
    retrying403Ref.current.delete(id);

    if (item.status === "downloading" && item.gid) {
      try {
        await cancelDownload(item.gid);
      } catch (e) {
        console.error("Failed to cancel download:", e);
      }
    }

    setQueue(prev => prev.filter(i => i.id !== id));
  }, []);

  const updateItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const startItem = useCallback(async (id: string) => {
    const item = queueRef.current.find(i => i.id === id);
    if (!item || item.status !== "pending") return;

    updateItem(id, { status: "fetching_link", error: undefined });

    try {
      let linkResult = await getDownloadLink(item.params);

      // Auto-refetch on 403 during initial link request if pre-filled direct_link was expired
      if ((!linkResult.ok || !linkResult.download_link) && item.params.direct_link && isForbiddenError(linkResult.error_message)) {
        if ((item.linkRetries || 0) < 1) {
          console.log(`[Queue] 403 on getDownloadLink for ${item.file.name}, auto-refetching with clean params...`);
          const cleanParams = { ...item.params, direct_link: undefined };
          updateItem(id, { linkRetries: 1, params: cleanParams });
          linkResult = await getDownloadLink(cleanParams);
        }
      }

      if (!linkResult.ok || !linkResult.download_link) {
        throw new Error(linkResult.error_message || "Failed to get download link");
      }

      updateItem(id, { status: "downloading" });
      await startAria2();
      const gid = await addDownload(
        linkResult.download_link,
        item.downloadDir,
        item.file.name,
        item.subpath
      );

      updateItem(id, { gid });

      if (!notifiedStartedRef.current.has(id)) {
        notifiedStartedRef.current.add(id);
        notifyDownloadStarted(item.file.name);
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      updateItem(id, {
        status: "error",
        error: errMessage,
        speed: 0,
      });

      if (!notifiedErrorRef.current.has(id)) {
        notifiedErrorRef.current.add(id);
        notifyDownloadError(item.file.name, errMessage);
      }
    }
  }, []);

  const retryItem = useCallback((id: string) => {
    notifiedStartedRef.current.delete(id);
    notifiedCompleteRef.current.delete(id);
    notifiedErrorRef.current.delete(id);
    retrying403Ref.current.delete(id);

    setQueue(prev =>
      prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: "pending" as QueueStatus,
            error: undefined,
            progress: 0,
            downloaded: 0,
            speed: 0,
            gid: undefined,
            linkRetries: 0,
            params: { ...item.params, direct_link: undefined },
          };
        }
        return item;
      })
    );
    setIsProcessing(true);
  }, []);

  // Queue Processor
  useEffect(() => {
    if (!isProcessing) return;

    const currentQueue = queue;
    const activeCount = currentQueue.filter(i => i.status === "downloading" || i.status === "fetching_link").length;
    const pendingCount = currentQueue.filter(i => i.status === "pending").length;
    
    // Auto-reset isProcessing when all items finish or nothing is pending/active
    if (activeCount === 0 && pendingCount === 0) {
      setIsProcessing(false);
      return;
    }

    if (activeCount < maxConcurrent) {
      const nextItem = currentQueue.find(i => i.status === "pending");
      if (nextItem) {
        startItem(nextItem.id);
      }
    }
  }, [queue, isProcessing, maxConcurrent, startItem]);

  // Polling Loop for active items (concurrent IPC requests via Promise.allSettled)
  useEffect(() => {
    const interval = setInterval(async () => {
      const activeItems = queueRef.current.filter(i => i.status === "downloading" && i.gid);
      if (activeItems.length === 0) return;

      await Promise.allSettled(
        activeItems.map(async (item) => {
          if (!item.gid) return;

          try {
            const status = await getDownloadStatus(item.gid);

            updateItem(item.id, {
              progress: status.progress,
              speed: status.speed,
              downloaded: status.downloaded,
              total: status.total_size,
              filePath: status.file_path || item.filePath,
            });

            if (status.status === "complete") {
              updateItem(item.id, { 
                status: "completed", 
                progress: 100, 
                speed: 0,
                filePath: status.file_path || item.filePath 
              });

              if (!notifiedCompleteRef.current.has(item.id)) {
                notifiedCompleteRef.current.add(item.id);
                notifyDownloadComplete(item.file.name);
              }
            } else if (status.status === "error" || status.status === "removed") {
              // 1. Auto-refetch direct link on HTTP 403 Forbidden
              const is403 = isForbiddenError(status.error_message);
              const retries = item.linkRetries || 0;

              if (status.status === "error" && is403 && retries < 1 && !retrying403Ref.current.has(item.id)) {
                retrying403Ref.current.add(item.id);
                console.log(`[Queue] 403 Forbidden detected for ${item.file.name}. Auto-refetching fresh download link (attempt 1/1)...`);

                updateItem(item.id, {
                  status: "fetching_link",
                  linkRetries: retries + 1,
                  error: "Link expired (HTTP 403). Auto-refetching fresh link...",
                  speed: 0,
                  gid: undefined,
                });

                try {
                  const cleanParams = { ...item.params, direct_link: undefined };
                  const linkResult = await getDownloadLink(cleanParams);

                  if (!linkResult.ok || !linkResult.download_link) {
                    throw new Error(linkResult.error_message || "Failed to auto-refetch download link");
                  }

                  await startAria2();
                  const newGid = await addDownload(
                    linkResult.download_link,
                    item.downloadDir,
                    item.file.name,
                    item.subpath
                  );

                  updateItem(item.id, {
                    gid: newGid,
                    status: "downloading",
                    error: undefined,
                    params: { ...cleanParams, direct_link: linkResult.download_link },
                  });
                  retrying403Ref.current.delete(item.id);
                  return;
                } catch (refetchErr) {
                  retrying403Ref.current.delete(item.id);
                  const errText = refetchErr instanceof Error ? refetchErr.message : "Failed to auto-refetch download link";
                  updateItem(item.id, {
                    status: "error",
                    error: errText,
                    speed: 0,
                  });

                  if (!notifiedErrorRef.current.has(item.id)) {
                    notifiedErrorRef.current.add(item.id);
                    notifyDownloadError(item.file.name, errText);
                  }
                  return;
                }
              }

              // Normal error or cancelled
              const errMsg = status.error_message || (status.status === "removed" ? "Cancelled" : "Download failed");
              updateItem(item.id, { 
                status: status.status === "error" ? "error" : "cancelled", 
                error: errMsg,
                speed: 0,
              });

              if (status.status === "error" && !notifiedErrorRef.current.has(item.id)) {
                notifiedErrorRef.current.add(item.id);
                notifyDownloadError(item.file.name, errMsg);
              }
            }
          } catch (e) {
            console.error(`Polling error for ${item.id}:`, e);
          }
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    queue,
    addToQueue,
    startQueue: () => setIsProcessing(true),
    pauseQueue: () => setIsProcessing(false),
    removeFromQueue,
    retryItem,
    isProcessing,
    clearCompleted: () => setQueue(q => q.filter(i => i.status !== "completed")),
    clearAll: () => setQueue(q => q.filter(i => i.status === "downloading" || i.status === "fetching_link")),
    setMaxConcurrent,
    maxConcurrent,
  };
}