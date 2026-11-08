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
  filePath?: string;
}

export function useDownloadQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const addToQueue = useCallback((
    files: TeraboxFileInfo[], 
    params: Omit<DownloadParams, "fs_id">,
    downloadDir?: string
  ) => {
    setQueue((prev) => {
      const newItems = files
        .filter((f) => !prev.some((p) => p.id === f.fs_id))
        .map((file) => ({
          id: file.fs_id,
          file,
          status: "pending" as QueueStatus,
          progress: 0,
          speed: 0,
          downloaded: 0,
          total: file.size || 0,
          params: { ...params, fs_id: file.fs_id, direct_link: file.direct_link, path: file.path },
          downloadDir
        }));
      return [...prev, ...newItems];
    });
  }, []);

  const removeFromQueue = useCallback(async (id: string) => {
    const item = queueRef.current.find(i => i.id === id);
    if (!item) return;

    if (item.status === 'downloading' && item.gid) {
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
    if (!item || item.status !== 'pending') return;

    updateItem(id, { status: "fetching_link" });

    try {
      const linkResult = await getDownloadLink(item.params);

      if (!linkResult.ok || !linkResult.download_link) {
        throw new Error(linkResult.error_message || "Failed to get download link");
      }

      updateItem(id, { status: "downloading" });
      await startAria2();
      const gid = await addDownload(
        linkResult.download_link,
        item.downloadDir,
        item.file.name
      );

      updateItem(id, { gid });
    } catch (err) {
      updateItem(id, {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  const retryItem = useCallback((id: string) => {
    updateItem(id, {
      status: "pending",
      error: undefined,
      progress: 0,
      downloaded: 0,
      speed: 0,
    });
    setIsProcessing(true);
  }, []);

  // Queue Processor
  useEffect(() => {
    if (!isProcessing) return;

    const currentQueue = queue;
    const activeCount = currentQueue.filter(i => i.status === 'downloading' || i.status === 'fetching_link').length;
    const pendingCount = currentQueue.filter(i => i.status === 'pending').length;
    
    // Auto-reset isProcessing when all items finish or nothing is pending/active
    if (activeCount === 0 && pendingCount === 0) {
      setIsProcessing(false);
      return;
    }

    if (activeCount < maxConcurrent) {
      const nextItem = currentQueue.find(i => i.status === 'pending');
      if (nextItem) {
        startItem(nextItem.id);
      }
    }
  }, [queue, isProcessing, maxConcurrent, startItem]);

  // Polling Loop for active items (concurrent IPC requests via Promise.allSettled)
  useEffect(() => {
    const interval = setInterval(async () => {
      const activeItems = queueRef.current.filter(i => i.status === 'downloading' && i.gid);
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
            } else if (status.status === "error" || status.status === "removed") {
              updateItem(item.id, { 
                status: status.status === "error" ? "error" : "cancelled", 
                error: status.error_message || (status.status === "removed" ? "Cancelled" : "Download failed"),
                speed: 0,
              });
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
    maxConcurrent
  };
}
