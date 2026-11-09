import { open } from "@tauri-apps/plugin-dialog";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { 
  Loader2, Link, FileDown, Trash2, Play, Pause, FolderOpen, 
  Settings, X, ListX, Gauge, ShieldCheck, Plus, Server, Key,
  Clipboard, AlertCircle, CheckCircle2, Film, RefreshCw, Zap,
  Layers, HardDrive, Info, ExternalLink, ArrowDown, Terminal,
  Sparkles, AlertTriangle, Check, Bookmark, Smartphone,
  Sun, Moon, Monitor, ChevronDown, ChevronUp, Code2, Power
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FileList, SelectAllButton } from "./file-list";
import { ThemeToggle } from "./theme-toggle";
import { useTheme, THEME_PALETTES } from "./theme-provider";
import { LogViewer } from "./log-viewer";
import { 
  getTeraboxInfo, getFolderContents, getFolderFilesRecursive, formatBytes, formatSpeed, formatEta, stopAria2, setBandwidthLimit, 
  getBandwidthLimit, getEndpointStats, pingEndpointHealth, saveApiEndpoints, openDownloadDir, openFile, deleteFileFromDisk, checkForUpdates, saveTeraboxCookie, openTeraboxLogin, exitApp
} from "../lib/api";
import { 
  updateDownloadNotification, notifyDownloadComplete, clearDownloadNotification, ensureNotificationPermission 
} from "../lib/notifications";
import { readClipboardText } from "../lib/clipboard";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadSettings, saveSettings, DEFAULT_ENDPOINTS } from "../lib/settings";
import { 
  TeraboxInfo, TeraboxFileInfo, BANDWIDTH_PRESETS, 
  ApiEndpointConfig, EndpointHealthInfo, UpdateCheckResult 
} from "../lib/types";
import { useDownloadQueue, QueueItem } from "../hooks/use-download-queue";
import { cn } from "../lib/utils";
import workerScript from "../../cloudflare-worker/worker.js?raw";

declare const __APP_VERSION__: string;
const defaultAppVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.2.1";

const SUPPORTED_MIRRORS = [
  "terabox.app",
  "1024terabox.com",
  "terasharelink.com",
  "4funbox.com",
  "mirrobox.com"
];

export function DashboardLayout() {
  const [currentAppVersion, setCurrentAppVersion] = useState(defaultAppVersion);

  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(m => m.getVersion())
      .then(v => {
        if (v) setCurrentAppVersion(v);
      })
      .catch(() => {});

    // Proactively request notification permission on app launch (Android 13+)
    const notifTimer = setTimeout(() => {
      ensureNotificationPermission().catch(err => {
        console.warn("Initial notification permission request failed:", err);
      });
    }, 600);

    return () => clearTimeout(notifTimer);
  }, []);

  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teraboxInfo, setTeraboxInfo] = useState<TeraboxInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloadDir, setDownloadDir] = useState("");
  const [downloadMode, setDownloadMode] = useState(2);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'api' | 'cookie' | 'logs' | 'about'>('general');
  const { theme, setTheme, palette, setPalette, materialYou, setMaterialYou } = useTheme();
  const settingsBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settingsBodyRef.current) {
      settingsBodyRef.current.scrollTop = 0;
    }
  }, [settingsTab]);
  const [mobileTab, setMobileTab] = useState<'source' | 'queue'>('source');
  const [maxOverallLimit, setMaxOverallLimit] = useState(0);
  const [maxDownloadLimit, setMaxDownloadLimit] = useState(0);

  // Video/Audio Preview Modal
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);
  const [previewMediaName, setPreviewMediaName] = useState<string | null>(null);

  // API Pool & Session Settings (abdul97233 engine)
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpointConfig[]>(DEFAULT_ENDPOINTS);
  const [endpointStats, setEndpointStats] = useState<EndpointHealthInfo[]>([]);
  const [teraboxCookie, setTeraboxCookie] = useState("");
  const [newEpName, setNewEpName] = useState("");
  const [newEpUrl, setNewEpUrl] = useState("");
  const [newEpToken, setNewEpToken] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isPingingEndpoints, setIsPingingEndpoints] = useState(false);
  const [cookieCapturedSuccess, setCookieCapturedSuccess] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [showWorkerGuide, setShowWorkerGuide] = useState(false);
  const [copiedWorkerScript, setCopiedWorkerScript] = useState(false);

  // Subfolder & Path Navigation
  const [currentPath, setCurrentPath] = useState<string>("");
  const [folderCache, setFolderCache] = useState<Record<string, TeraboxFileInfo[]>>({});
  const [isLoadingFolder, setIsLoadingFolder] = useState<boolean>(false);
  const [isQueuingFolder, setIsQueuingFolder] = useState<string | null>(null);

  const {
    queue,
    addToQueue,
    startQueue,
    pauseQueue,
    removeFromQueue,
    retryItem,
    isProcessing,
    clearCompleted,
    clearAll,
    setMaxConcurrent,
    maxConcurrent
  } = useDownloadQueue();

  // Aggregate active queue download speed
  const totalSpeed = useMemo(() => {
    return queue
      .filter(item => item.status === 'downloading')
      .reduce((sum, item) => sum + (item.speed || 0), 0);
  }, [queue]);

  const activeDownloadingCount = useMemo(() => {
    return queue.filter(item => item.status === 'downloading').length;
  }, [queue]);

  const hasActiveOrPending = useMemo(() => {
    return queue.some(item => item.status === 'downloading' || item.status === 'fetching_link' || item.status === 'pending');
  }, [queue]);

  const handleOpenFile = useCallback(async (item: QueueItem) => {
    try {
      const targetPath = item.filePath || (item.downloadDir ? `${item.downloadDir}/${item.file.name}` : item.file.name);
      await openFile(targetPath);
    } catch (e) {
      console.error("Failed to open file, falling back to opening folder:", e);
      try {
        await openDownloadDir(item.downloadDir || undefined);
      } catch (err) {
        console.error("Failed to open destination folder:", err);
      }
    }
  }, []);

  // Update Checker State (Manual, no auto-update)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleCheckForUpdates = useCallback(async () => {
    setIsCheckingUpdate(true);
    setUpdateError(null);
    setUpdateResult(null);
    try {
      const res = await checkForUpdates();
      setUpdateResult(res);
    } catch (err) {
      console.error("Update check failed:", err);
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  }, []);

  // Delete Confirmation State
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    type: 'single' | 'completed' | 'all';
    item?: QueueItem;
  } | null>(null);
  const [deleteFromStorage, setDeleteFromStorage] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmation) return;
    setIsDeleting(true);
    try {
      if (deleteConfirmation.type === 'single' && deleteConfirmation.item) {
        const item = deleteConfirmation.item;
        if (deleteFromStorage) {
          const targetPath = item.filePath || (item.downloadDir ? `${item.downloadDir}/${item.file.name}` : undefined);
          if (targetPath) {
            try {
              await deleteFileFromDisk(targetPath);
            } catch (err) {
              console.error("Failed to delete file from disk:", err);
            }
          }
        }
        await removeFromQueue(item.id);
      } else if (deleteConfirmation.type === 'completed') {
        const completedItems = queue.filter(i => i.status === 'completed');
        if (deleteFromStorage) {
          for (const item of completedItems) {
            const targetPath = item.filePath || (item.downloadDir ? `${item.downloadDir}/${item.file.name}` : undefined);
            if (targetPath) {
              try {
                await deleteFileFromDisk(targetPath);
              } catch (err) {
                console.error("Failed to delete file from disk:", err);
              }
            }
          }
        }
        clearCompleted();
      } else if (deleteConfirmation.type === 'all') {
        clearAll();
      }
    } finally {
      setIsDeleting(false);
      setDeleteConfirmation(null);
    }
  }, [deleteConfirmation, deleteFromStorage, queue, removeFromQueue, clearCompleted, clearAll]);

  // Currently visible files based on active directory path
  const currentFiles = useMemo(() => {
    if (currentPath && folderCache[currentPath]) {
      return folderCache[currentPath];
    }
    return teraboxInfo?.list || [];
  }, [currentPath, folderCache, teraboxInfo]);

  // Selected files count & total size
  const { selectedCount, selectedSize } = useMemo(() => {
    if (!teraboxInfo) return { selectedCount: 0, selectedSize: 0 };
    const allKnown = Object.values(folderCache).flat();
    const source = allKnown.length > 0 ? allKnown : teraboxInfo.list;
    const selected = source.filter((f, idx, arr) => 
      selectedFiles.has(f.fs_id) && !f.is_dir && arr.findIndex(x => x.fs_id === f.fs_id) === idx
    );
    const size = selected.reduce((acc, f) => acc + (f.size || 0), 0);
    return { selectedCount: selected.length, selectedSize: size };
  }, [teraboxInfo, selectedFiles, folderCache]);

  // Load Settings
  useEffect(() => {
    loadSettings().then(async settings => {
      setDownloadDir(settings.downloadDir);
      setDownloadMode(settings.downloadMode);
      setMaxConcurrent(settings.maxConcurrent);
      if (settings.apiEndpoints && settings.apiEndpoints.length > 0) {
        setApiEndpoints(settings.apiEndpoints);
      }
      if (settings.teraboxCookie) {
        setTeraboxCookie(settings.teraboxCookie);
        saveTeraboxCookie(settings.teraboxCookie).catch(() => {});
      }
      try {
        const [overallLimit, downloadLimit] = await getBandwidthLimit();
        setMaxOverallLimit(overallLimit);
        setMaxDownloadLimit(downloadLimit);
      } catch (e) {
        // Desktop / mobile fallback
      }
    });
  }, [setMaxConcurrent]);

  // Periodic Endpoint Health Poll
  const refreshStats = useCallback(async () => {
    try {
      const stats = await getEndpointStats();
      setEndpointStats(stats);
    } catch (e) {
      // Ignored if backend busy
    }
  }, []);

  // Listen for auto-captured cookies and background health updates
  useEffect(() => {
    let unlistenCookie: (() => void) | undefined;
    let unlistenHealth: (() => void) | undefined;
    let unlistenLoginClosed: (() => void) | undefined;

    // Android native login callback bridge
    if (typeof window !== "undefined") {
      (window as any).onTeraboxCookieCaptured = (cookie: string) => {
        if (cookie) {
          setTeraboxCookie(cookie);
          setCookieCapturedSuccess(true);
          setIsLoggingIn(false);
          saveTeraboxCookie(cookie).catch(() => {});
          setTimeout(() => setCookieCapturedSuccess(false), 6000);
        }
      };
      (window as any).onTeraboxLoginDismissed = () => {
        setIsLoggingIn(false);
      };
    }

    listen<string>("terabox-cookie-captured", (event) => {
      if (event.payload) {
        setTeraboxCookie(event.payload);
        setCookieCapturedSuccess(true);
        setIsLoggingIn(false);
        saveTeraboxCookie(event.payload).catch(() => {});
        setTimeout(() => setCookieCapturedSuccess(false), 6000);
      }
    }).then(fn => { unlistenCookie = fn; }).catch(() => {});

    listen<EndpointHealthInfo[]>("endpoint-health-updated", (event) => {
      if (event.payload) {
        setEndpointStats(event.payload);
      }
    }).then(fn => { unlistenHealth = fn; }).catch(() => {});

    listen("terabox-login-closed", () => {
      setIsLoggingIn(false);
    }).then(fn => { unlistenLoginClosed = fn; }).catch(() => {});

    return () => {
      if (unlistenCookie) unlistenCookie();
      if (unlistenHealth) unlistenHealth();
      if (unlistenLoginClosed) unlistenLoginClosed();
      if (typeof window !== "undefined") {
        delete (window as any).onTeraboxCookieCaptured;
        delete (window as any).onTeraboxLoginDismissed;
      }
    };
  }, []);

  const handlePingEndpoints = async () => {
    setIsPingingEndpoints(true);
    try {
      const stats = await pingEndpointHealth();
      setEndpointStats(stats);
    } catch (e) {
      console.error("Failed to ping endpoints:", e);
    } finally {
      setIsPingingEndpoints(false);
    }
  };

  const handleOpenLogin = async () => {
    setIsLoggingIn(true);

    // On Android, launch native in-app login dialog with CookieManager auto-capture
    if (
      typeof window !== "undefined" &&
      (window as any).AndroidLogin &&
      typeof (window as any).AndroidLogin.openLoginDialog === "function"
    ) {
      try {
        (window as any).AndroidLogin.openLoginDialog();
      } catch (e) {
        console.error("Failed to open Android login dialog:", e);
        setIsLoggingIn(false);
      }
      return;
    }

    // On Desktop, launch WebviewWindow popup
    try {
      const res = await openTeraboxLogin();
      if (res === "opened_external") {
        // External browser was launched on mobile fallback, don't keep spinning waiting for in-app webview
        setIsLoggingIn(false);
      }
    } catch (e) {
      console.error("Failed to open TeraBox login:", e);
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    refreshStats();
    const interval = setInterval(refreshStats, 10000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  const handleSaveSettings = async () => {
    try {
      await setBandwidthLimit(maxOverallLimit, maxDownloadLimit);
    } catch (e) {}

    await saveSettings({
      downloadDir,
      downloadMode,
      maxConcurrent,
      maxOverallDownloadLimitKbPerSec: maxOverallLimit,
      maxDownloadLimitKbPerSec: maxDownloadLimit,
      apiEndpoints,
      teraboxCookie,
    });

    try {
      await saveTeraboxCookie(teraboxCookie);
    } catch (e) {
      console.error("Failed to save TeraBox cookie to backend:", e);
    }

    try {
      await saveApiEndpoints(apiEndpoints);
    } catch (e) {}

    setShowSettings(false);
  };

  const handleAddEndpoint = () => {
    if (!newEpName.trim() || !newEpUrl.trim()) return;
    const newEp: ApiEndpointConfig = {
      id: `custom-${Date.now()}`,
      name: newEpName.trim(),
      url: newEpUrl.trim(),
      token: newEpToken.trim() ? newEpToken.trim() : null,
      enabled: true,
    };
    const updated = [...apiEndpoints, newEp];
    setApiEndpoints(updated);
    setNewEpName("");
    setNewEpUrl("");
    setNewEpToken("");
  };

  const handleToggleEndpoint = (id: string) => {
    setApiEndpoints(prev =>
      prev.map(ep => (ep.id === id ? { ...ep, enabled: !ep.enabled } : ep))
    );
  };

  const handleDeleteEndpoint = (id: string) => {
    setApiEndpoints(prev => prev.filter(ep => ep.id !== id));
  };

  // Graceful Exit Handler (Desktop)
  useEffect(() => {
    const setupExitHandler = async () => {
      try {
        const appWindow = getCurrentWindow();
        const unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          const yes = await confirm(
            "Are you sure you want to quit?\nActive downloads will be stopped.",
            { title: 'Quit Teralace', kind: 'warning', okLabel: 'Quit', cancelLabel: 'Cancel' }
          );
          
          if (yes) {
            try {
              await stopAria2();
            } catch (e) {}
            await exit(0);
          }
        });
        return unlisten;
      } catch (e) {
        return () => {};
      }
    };

    const unlistenPromise = setupExitHandler();
    return () => {
      unlistenPromise.then(unlisten => unlisten && unlisten());
    };
  }, []);

  // Explicit Application Quit Handler (Mobile & Desktop)
  const handleQuitApp = useCallback(async () => {
    const yes = await confirm(
      "Are you sure you want to quit Teralace completely?\nActive downloads will be stopped and all background tasks terminated.",
      { title: 'Quit Teralace', kind: 'warning', okLabel: 'Quit Completely', cancelLabel: 'Cancel' }
    );
    if (yes) {
      try {
        await clearDownloadNotification();
      } catch {}
      try {
        await stopAria2();
      } catch {}
      try {
        await exitApp();
      } catch (e) {
        console.error("Backend exitApp failed, falling back to process exit:", e);
        try {
          await exit(0);
        } catch {}
      }
    }
  }, []);

  // Android / Mobile Background Ongoing Notification & Wake Management
  const prevActiveCountRef = useRef(0);
  useEffect(() => {
    if (activeDownloadingCount > 0) {
      const activeItems = queue.filter(item => item.status === 'downloading');
      const totalDownloaded = activeItems.reduce((acc, item) => acc + (item.downloaded || 0), 0);
      const totalBytes = activeItems.reduce((acc, item) => acc + (item.total || 0), 0);
      const progress = totalBytes > 0 ? (totalDownloaded / totalBytes) * 100 : 0;

      updateDownloadNotification(activeDownloadingCount, totalSpeed, progress);
    } else {
      if (prevActiveCountRef.current > 0) {
        const completedItems = queue.filter(item => item.status === 'completed');
        const lastFinished = completedItems.length > 0 ? completedItems[completedItems.length - 1].file.name : undefined;
        notifyDownloadComplete(lastFinished);
      } else {
        clearDownloadNotification();
      }
    }
    prevActiveCountRef.current = activeDownloadingCount;
  }, [activeDownloadingCount, totalSpeed, queue]);

  // Dismiss active modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewMediaUrl) {
          setPreviewMediaUrl(null);
        } else if (showSettings) {
          setShowSettings(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMediaUrl, showSettings]);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: downloadDir || undefined,
      });
      
      if (selected && typeof selected === "string") {
        setDownloadDir(selected);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await readClipboardText();
      if (text && text.trim()) {
        setUrl(text.trim());
      } else {
        const input = document.getElementById("share-link-input") as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }
    } catch (e) {
      console.warn("Failed to read clipboard:", e);
    }
  };

  const handleFetch = useCallback(async () => {
    if (!url.trim()) return;
    setIsFetching(true);
    setError(null);
    setTeraboxInfo(null);
    setSelectedFiles(new Set());
    setFolderCache({});

    try {
      let initialPath = "";
      try {
        const u = new URL(url.startsWith("http") ? url : `https://${url}`);
        initialPath = u.searchParams.get("path") || "";
      } catch {}

      const info = await getTeraboxInfo(url);
      if (info.ok) {
        setTeraboxInfo(info);
        setCurrentPath(initialPath);
        setFolderCache({ [initialPath]: info.list });
      } else {
        setError(info.error_message || "Failed to fetch file info. Please check the URL.");
      }
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || JSON.stringify(err));
    } finally {
      setIsFetching(false);
    }
  }, [url]);

  const handleOpenFolder = useCallback(async (folder: TeraboxFileInfo) => {
    if (!teraboxInfo) return;
    const targetPath = folder.path || (currentPath ? `${currentPath}/${folder.name}` : `/${folder.name}`);

    if (folderCache[targetPath]) {
      setCurrentPath(targetPath);
      return;
    }

    setIsLoadingFolder(true);
    try {
      const files = await getFolderContents(teraboxInfo.surl || url, targetPath);
      setFolderCache(prev => ({ ...prev, [targetPath]: files }));
      setCurrentPath(targetPath);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || "Failed to open folder");
    } finally {
      setIsLoadingFolder(false);
    }
  }, [teraboxInfo, currentPath, folderCache, url]);

  const handleNavigatePath = useCallback(async (targetPath: string) => {
    if (!teraboxInfo) return;
    if (targetPath === currentPath) return;

    if (folderCache[targetPath]) {
      setCurrentPath(targetPath);
      return;
    }

    setIsLoadingFolder(true);
    try {
      const files = await getFolderContents(teraboxInfo.surl || url, targetPath);
      setFolderCache(prev => ({ ...prev, [targetPath]: files }));
      setCurrentPath(targetPath);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || "Failed to navigate to folder");
    } finally {
      setIsLoadingFolder(false);
    }
  }, [teraboxInfo, currentPath, folderCache, url]);

  const [hasDismissedGuestPrompt, setHasDismissedGuestPrompt] = useState(false);

  const checkSignInBeforeDownload = useCallback(async (): Promise<boolean> => {
    if (teraboxCookie && teraboxCookie.trim()) {
      return true;
    }
    if (hasDismissedGuestPrompt) {
      return true;
    }

    try {
      const proceed = await confirm(
        "You are downloading without signing in to TeraBox.\n\n• TeraBox restricts anonymous downloads for large files (>20MB) or may return HTTP 403 Forbidden.\n• Signing in unlocks full original file sizes and maximum download speed.\n\nWould you like to sign in now, or continue as guest?",
        {
          title: "Sign-In Recommended",
          kind: "info",
          okLabel: "Sign In Now",
          cancelLabel: "Continue as Guest",
        }
      );

      if (proceed) {
        setSettingsTab("cookie");
        setShowSettings(true);
        return false;
      } else {
        setHasDismissedGuestPrompt(true);
        return true;
      }
    } catch {
      return true;
    }
  }, [teraboxCookie, hasDismissedGuestPrompt]);

  const handleDownloadFolder = useCallback(async (folder: TeraboxFileInfo) => {
    if (!teraboxInfo) return;
    const canProceed = await checkSignInBeforeDownload();
    if (!canProceed) return;

    const targetPath = folder.path || (currentPath ? `${currentPath}/${folder.name}` : `/${folder.name}`);
    setIsQueuingFolder(folder.name);

    try {
      const files = await getFolderFilesRecursive(teraboxInfo.surl || url, targetPath);
      if (files.length === 0) {
        setError(`Folder "${folder.name}" is empty or has no downloadable files.`);
        return;
      }

      addToQueue(files, {
        shareid: teraboxInfo.shareid,
        uk: teraboxInfo.uk,
        sign: teraboxInfo.sign,
        timestamp: teraboxInfo.timestamp,
        mode: downloadMode,
        surl: teraboxInfo.surl || undefined,
      }, downloadDir || undefined);

      startQueue();
      setMobileTab('queue');
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || `Failed to queue folder "${folder.name}"`);
    } finally {
      setIsQueuingFolder(null);
    }
  }, [teraboxInfo, currentPath, url, downloadMode, downloadDir, addToQueue, startQueue, checkSignInBeforeDownload]);

  const handleSelectFolder = useCallback(async (folder: TeraboxFileInfo) => {
    if (!teraboxInfo) return;
    const targetPath = folder.path || (currentPath ? `${currentPath}/${folder.name}` : `/${folder.name}`);
    setIsLoadingFolder(true);
    try {
      const files = await getFolderContents(teraboxInfo.surl || url, targetPath);
      setFolderCache(prev => ({ ...prev, [targetPath]: files }));
      setSelectedFiles(prev => {
        const next = new Set(prev);
        files.filter(f => !f.is_dir).forEach(f => next.add(f.fs_id));
        return next;
      });
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || `Failed to select files in "${folder.name}"`);
    } finally {
      setIsLoadingFolder(false);
    }
  }, [teraboxInfo, currentPath, url]);

  const handleDownloadFile = useCallback(async (file: TeraboxFileInfo) => {
    if (!teraboxInfo || file.is_dir) return;
    const canProceed = await checkSignInBeforeDownload();
    if (!canProceed) return;

    addToQueue([file], {
      shareid: teraboxInfo.shareid,
      uk: teraboxInfo.uk,
      sign: teraboxInfo.sign,
      timestamp: teraboxInfo.timestamp,
      mode: downloadMode,
      surl: teraboxInfo.surl || undefined,
    }, downloadDir || undefined);
    startQueue();
    setMobileTab('queue');
  }, [teraboxInfo, downloadMode, downloadDir, addToQueue, startQueue, checkSignInBeforeDownload]);

  const handleDownloadSelected = async () => {
    if (!teraboxInfo) return;
    const canProceed = await checkSignInBeforeDownload();
    if (!canProceed) return;

    const allKnown = Object.values(folderCache).flat();
    const source = allKnown.length > 0 ? allKnown : teraboxInfo.list;
    const filesToDownload = source.filter((f, idx, arr) => 
      selectedFiles.has(f.fs_id) && !f.is_dir && arr.findIndex(x => x.fs_id === f.fs_id) === idx
    );
    
    addToQueue(filesToDownload, {
      shareid: teraboxInfo.shareid,
      uk: teraboxInfo.uk,
      sign: teraboxInfo.sign,
      timestamp: teraboxInfo.timestamp,
      mode: downloadMode,
      surl: teraboxInfo.surl || undefined,
    }, downloadDir || undefined);
    
    startQueue();
    setSelectedFiles(new Set());
    setMobileTab('queue');
  };

  const handlePreviewFile = (file: TeraboxFileInfo) => {
    if (file.direct_link) {
      setPreviewMediaUrl(file.direct_link);
      setPreviewMediaName(file.name);
    }
  };

  const healthyCount = endpointStats.filter(e => e.healthy && !e.is_offline && !e.circuit_open).length;

  return (
    <div className="h-screen h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden select-none">
      
      {/* Impeccable Header Bar */}
      <header className="glass-panel border-b border-border/60 px-3 sm:px-4 md:px-6 py-2.5 pt-[calc(0.625rem+var(--sat))] flex items-center justify-between shrink-0 z-30">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="relative group cursor-default">
            <img 
              src="/logo.svg" 
              alt="Teralace Logo" 
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain transition-transform duration-200 group-hover:scale-105 drop-shadow-sm"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-sm sm:text-base md:text-lg tracking-tight text-foreground">
                Teralace
              </span>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-mono font-medium">
                v{currentAppVersion}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live Telemetry & API Pool Status Widget */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Live Global Download Speed Indicator */}
          {(activeDownloadingCount > 0 || totalSpeed > 0) && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/25 shadow-sm shadow-primary/10 transition-opacity duration-200">
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>{formatSpeed(totalSpeed)}</span>
            </div>
          )}

          {/* Endpoint Health Pill */}
          <div 
            role="button"
            tabIndex={0}
            onClick={() => { setShowSettings(true); setSettingsTab('api'); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowSettings(true);
                setSettingsTab('api');
              }
            }}
            aria-label={`Resolver Mode: ${healthyCount > 0 ? `API Pool (${healthyCount} active)` : `Direct Scraper (${teraboxCookie ? 'Cookie' : 'Guest'})`}. Click to configure.`}
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all border focus:outline-none focus:ring-1 focus:ring-ring",
              healthyCount > 0 
                ? "bg-muted/40 hover:bg-muted/80 border-border/60 hover:border-border text-foreground" 
                : "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
            )}
            title={healthyCount > 0 
              ? `API Pool active with ${healthyCount} healthy endpoint(s). Click to configure.` 
              : `Direct TeraBox resolver active (${teraboxCookie ? 'Cookie session' : 'Guest mode'}). Click to configure.`
            }
          >
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                healthyCount > 0 ? "bg-emerald-500" : "bg-amber-400"
              )} />
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">Resolver:</span>
            {healthyCount > 0 ? (
              <span className="text-emerald-500 font-semibold">{healthyCount} API Active</span>
            ) : (
              <span className="font-semibold text-amber-500 flex items-center gap-1">
                Direct Scraper ({teraboxCookie ? 'Cookie' : 'Guest'})
              </span>
            )}
          </div>
        </div>

        {/* Right Action Icons Group */}
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => openDownloadDir(downloadDir || undefined)} 
            title="Open Download Folder"
            aria-label="Open download folder"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>

          <ThemeToggle />

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowSettings(true)} 
            title="Settings & Config"
            aria-label="Settings and configuration"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={handleQuitApp} 
            title="Quit Teralace Completely"
            aria-label="Quit Teralace completely"
          >
            <Power className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div role="tablist" aria-label="Views" className="flex md:hidden border-b bg-card/60 backdrop-blur-sm text-xs font-medium shrink-0">
        <button
          role="tab"
          aria-selected={mobileTab === 'source'}
          onClick={() => setMobileTab('source')}
          className={cn(
            "flex-1 py-3 min-h-[44px] flex items-center justify-center gap-1.5 border-b-2 transition-all",
            mobileTab === 'source'
              ? "border-primary text-primary font-semibold bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Explorer</span>
          {teraboxInfo && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.2 rounded-full font-mono">
              {teraboxInfo.list.length}
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={mobileTab === 'queue'}
          onClick={() => setMobileTab('queue')}
          className={cn(
            "flex-1 py-3 min-h-[44px] flex items-center justify-center gap-1.5 border-b-2 transition-all",
            mobileTab === 'queue'
              ? "border-primary text-primary font-semibold bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <FileDown className="h-3.5 w-3.5" />
          <span>Queue</span>
          {queue.length > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.2 rounded-full font-mono font-bold">
              {activeDownloadingCount > 0 ? `${activeDownloadingCount}/${queue.length}` : queue.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Layout */}
      <main className="flex-1 grid grid-cols-12 gap-3 md:gap-5 p-3 md:p-5 overflow-hidden">
        
        {/* Left Column: Source Input & File Explorer */}
        <div className={cn(
          "col-span-12 md:col-span-5 lg:col-span-4 flex flex-col gap-3 md:gap-4 overflow-hidden animate-in fade-in duration-200",
          mobileTab !== 'source' && "hidden md:flex"
        )}>
          {/* Link Fetcher Card */}
          <Card className="shrink-0 border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-3.5 md:px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Link className="h-3.5 w-3.5 text-primary" /> Share Link
                </CardTitle>
                {teraboxInfo?.resolved_by && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                    via {teraboxInfo.resolved_by}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-3.5 md:px-4 pb-3 space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input 
                    id="share-link-input"
                    placeholder="Paste TeraBox link..." 
                    className="text-xs pr-14 pl-3 h-9 bg-background/60 focus-visible:ring-1"
                    value={url}
                    aria-label="TeraBox share link"
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetch()}
                  />
                  <div className="absolute right-1 top-1 flex items-center gap-0.5">
                    {url ? (
                      <button 
                        onClick={() => setUrl("")}
                        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md transition-colors active:scale-95"
                        title="Clear"
                        aria-label="Clear link input"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button 
                        onClick={handlePasteClipboard}
                        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-primary rounded-md transition-colors active:scale-95"
                        title="Paste from clipboard"
                        aria-label="Paste link from clipboard"
                      >
                        <Clipboard className="h-3.5 w-3.5" />
                      </button>
                    )}

                  </div>
                </div>
                <Button 
                  onClick={handleFetch} 
                  disabled={isFetching || !url.trim()} 
                  size="sm" 
                  className="h-9 px-3.5 font-medium shadow-sm transition-all"
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Fetch"
                  )}
                </Button>
              </div>

              {/* Supported Domains Bar */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/75 truncate pt-0.5">
                <span className="shrink-0 font-medium">Supports:</span>
                <span className="truncate font-mono opacity-80">{SUPPORTED_MIRRORS.join(" • ")}</span>
              </div>

              {/* Error Alert Box */}
              {error && (
                <div role="alert" className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 flex items-start gap-2 animate-in fade-in duration-200">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 whitespace-pre-line leading-relaxed text-[11px]">
                    {error}
                  </div>
                  <button 
                    onClick={() => setError(null)} 
                    aria-label="Dismiss error message"
                    className="opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* File Explorer Card */}
          <Card className="flex-1 flex flex-col overflow-hidden border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            <CardHeader className="py-2.5 px-3.5 md:px-4 border-b border-border/60 flex flex-row items-center justify-between shrink-0 bg-muted/20">
              <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>Files {teraboxInfo && `(${currentFiles.length})`}</span>
              </CardTitle>
              {teraboxInfo && (
                <SelectAllButton 
                  files={currentFiles} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                />
              )}
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-2.5 md:p-3 flex flex-col">
              {isQueuingFolder && (
                <div className="mb-2 p-2 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-2 text-xs text-primary animate-in fade-in duration-150 shrink-0">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span className="truncate">Scanning and queuing all files in <strong className="font-semibold">{isQueuingFolder}</strong>...</span>
                </div>
              )}
              {teraboxInfo ? (
                <FileList 
                  files={currentFiles} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                  onPreview={handlePreviewFile}
                  onOpenFolder={handleOpenFolder}
                  currentPath={currentPath}
                  onNavigatePath={handleNavigatePath}
                  isLoadingFolder={isLoadingFolder}
                  onDownloadFolder={handleDownloadFolder}
                  onSelectFolder={handleSelectFolder}
                  onDownloadFile={handleDownloadFile}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 p-6 text-center select-none">
                  <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-3">
                    <FolderOpen className="h-6 w-6 opacity-60" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">No files loaded</p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[220px]">
                    Paste a TeraBox share link above and click Fetch to browse contents
                  </p>
                </div>
              )}
            </CardContent>

            {/* Sticky Action Footer */}
            <div className="p-3 pb-[calc(0.75rem+var(--sab))] md:pb-3 border-t border-border/60 bg-muted/20 shrink-0 space-y-2">
              {!teraboxCookie && teraboxInfo && (
                <div className="flex items-center justify-between text-[11px] text-amber-500/95 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg animate-in fade-in duration-150">
                  <div className="flex items-center gap-1.5 truncate">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="truncate">Guest mode: files &gt;20MB require TeraBox sign-in</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab('cookie');
                      setShowSettings(true);
                    }}
                    className="shrink-0 font-semibold text-primary hover:underline ml-2"
                  >
                    Sign In
                  </button>
                </div>
              )}
              <Button 
                className="w-full h-10 sm:h-9 font-medium shadow-sm transition-all" 
                onClick={handleDownloadSelected}
                disabled={selectedCount === 0}
              >
                <FileDown className="mr-2 h-4 w-4" />
                {selectedCount > 0 ? (
                  <span>Download Selected ({selectedCount} • {formatBytes(selectedSize)})</span>
                ) : (
                  <span>Select Files to Download</span>
                )}
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Download Queue & Telemetry */}
        <div className={cn(
          "col-span-12 md:col-span-7 lg:col-span-8 flex flex-col overflow-hidden animate-in fade-in duration-200",
          mobileTab !== 'queue' && "hidden md:flex"
        )}>
          <Card className="h-full flex flex-col overflow-hidden border border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            {/* Queue Header */}
            <CardHeader className="py-2.5 px-3.5 md:px-4 border-b border-border/60 flex flex-row items-center justify-between bg-muted/20 shrink-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileDown className="h-3.5 w-3.5 text-primary" /> Download Queue
                </CardTitle>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-mono font-bold">
                  {queue.length}
                </span>
                <span className="text-[11px] text-muted-foreground hidden sm:inline font-mono">
                  ({maxConcurrent === 1 ? 'Sequential' : `Parallel: ${maxConcurrent}`})
                </span>
              </div>

              {/* Queue Controls */}
              <div className="flex items-center gap-1.5">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={hasActiveOrPending && isProcessing ? pauseQueue : startQueue}
                  disabled={queue.length === 0 || (!hasActiveOrPending && queue.every(i => i.status === 'completed'))}
                  className="h-7 text-xs px-2.5 border-border/70"
                  aria-label={
                    hasActiveOrPending
                      ? (isProcessing ? "Pause download queue" : "Resume download queue")
                      : "Start download queue"
                  }
                >
                  {hasActiveOrPending && isProcessing ? (
                    <><Pause className="mr-1.5 h-3 w-3 fill-current" /> Pause</>
                  ) : hasActiveOrPending && !isProcessing ? (
                    <><Play className="mr-1.5 h-3 w-3 fill-current" /> Resume</>
                  ) : (
                    <><Play className="mr-1.5 h-3 w-3 fill-current" /> Start</>
                  )}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => {
                    const completedCount = queue.filter(i => i.status === 'completed').length;
                    if (completedCount === 0) return;
                    setDeleteConfirmation({ type: 'completed' });
                    setDeleteFromStorage(true);
                  }} 
                  disabled={queue.filter(i => i.status === 'completed').length === 0}
                  title="Clear Completed" 
                  aria-label="Clear completed downloads"
                  className="h-7 w-7 text-muted-foreground hover:text-emerald-500 transition-colors disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => {
                    if (queue.length === 0) return;
                    setDeleteConfirmation({ type: 'all' });
                    setDeleteFromStorage(false);
                  }} 
                  disabled={queue.length === 0}
                  title="Clear All Tasks" 
                  aria-label="Clear all tasks"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                >
                  <ListX className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>

            {/* Queue List Content */}
            <CardContent className="flex-1 overflow-y-auto p-0">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-40 p-6 text-center select-none">
                  <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                    <FileDown className="h-7 w-7 opacity-60" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Queue is empty</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                    Select items from the explorer to begin high-speed chunked multi-stream downloads
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {queue.map(item => (
                    <QueueItemRow 
                      key={item.id} 
                      item={item} 
                      isActive={item.status === 'downloading' || item.status === 'fetching_link'}
                      onRemove={() => {
                        setDeleteConfirmation({ type: 'single', item });
                        setDeleteFromStorage(item.status === 'completed');
                      }}
                      onRetry={() => retryItem(item.id)}
                      onOpenFile={() => handleOpenFile(item)}
                      onOpenFolder={() => openDownloadDir(item.downloadDir || undefined)}
                      onOpenCookieSettings={() => {
                        setShowSettings(true);
                        setSettingsTab('cookie');
                      }}
                      onPreview={() => {
                        if (item.params.direct_link) {
                          setPreviewMediaUrl(item.params.direct_link);
                          setPreviewMediaName(item.file.name);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </CardContent>

            {/* Queue Telemetry Footer */}
            {queue.length > 0 && (
              <div className="p-2.5 px-3 sm:px-4 pb-[calc(0.625rem+var(--sab))] md:pb-2.5 bg-muted/30 border-t border-border/60 text-[11px] text-muted-foreground flex items-center justify-between shrink-0 font-medium">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{queue.filter(i => i.status === 'completed').length} Completed</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowDown className="h-3.5 w-3.5 text-primary" />
                    <span>{queue.filter(i => i.status === 'downloading').length} Downloading</span>
                  </span>
                  <span>{queue.filter(i => i.status === 'pending').length} Pending</span>
                </div>
                {(activeDownloadingCount > 0 || totalSpeed > 0) && (
                  <span className="font-mono text-primary font-semibold">
                    Total: {formatSpeed(totalSpeed)}
                  </span>
                )}
              </div>
            )}
          </Card>
        </div>

      </main>

      {/* Video/Audio Stream Preview Modal */}
      {previewMediaUrl && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewMediaUrl(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200"
        >
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
            tabIndex={-1}
            className="bg-background border border-border/80 rounded-2xl overflow-hidden w-full max-w-[820px] max-h-[90dvh] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 outline-none focus:outline-none"
          >
            <div className="flex items-center justify-between p-3 sm:p-3.5 px-3.5 sm:px-4 border-b bg-card">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <Film className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <span id="preview-modal-title" className="font-medium text-xs truncate">{previewMediaName}</span>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.2 rounded font-mono shrink-0">
                  Live Stream
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setPreviewMediaUrl(null)}
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="bg-black flex items-center justify-center min-h-[220px] sm:min-h-[320px] max-h-[75dvh]">
              <video 
                src={previewMediaUrl} 
                controls 
                autoPlay 
                className="max-h-[75dvh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200"
        >
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            tabIndex={-1}
            className="bg-background border border-border/80 rounded-2xl shadow-2xl w-full max-w-[580px] h-[580px] max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 outline-none focus:outline-none"
          >
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 sm:px-5 py-3.5 bg-card/60">
              <h2 id="settings-modal-title" className="text-sm font-semibold flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" aria-hidden="true" /> Settings & API Routing
              </h2>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Modal Navigation Tabs */}
            <div role="tablist" aria-label="Settings categories" className="flex border-b border-border/60 bg-muted/20 px-3 sm:px-5 gap-1 sm:gap-2 text-xs shrink-0 overflow-x-auto no-scrollbar">
              <button
                role="tab"
                id="tab-general"
                aria-controls="panel-general"
                aria-selected={settingsTab === 'general'}
                onClick={() => setSettingsTab('general')}
                className={cn(
                  "py-2.5 px-2 font-medium border-b-2 transition-colors duration-150 flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'general' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" /> General
              </button>
              <button
                role="tab"
                id="tab-api"
                aria-controls="panel-api"
                aria-selected={settingsTab === 'api'}
                onClick={() => setSettingsTab('api')}
                className={cn(
                  "py-2.5 px-2 font-medium border-b-2 transition-colors duration-150 flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'api' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Server className="h-3.5 w-3.5" aria-hidden="true" /> API Pool & Balancer
              </button>
              <button
                role="tab"
                id="tab-cookie"
                aria-controls="panel-cookie"
                aria-selected={settingsTab === 'cookie'}
                onClick={() => setSettingsTab('cookie')}
                className={cn(
                  "py-2.5 px-2 font-medium border-b-2 transition-colors duration-150 flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'cookie' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Key className="h-3.5 w-3.5" aria-hidden="true" /> TeraBox Cookie
              </button>
              <button
                role="tab"
                id="tab-logs"
                aria-controls="panel-logs"
                aria-selected={settingsTab === 'logs'}
                onClick={() => setSettingsTab('logs')}
                className={cn(
                  "py-2.5 px-2 font-medium border-b-2 transition-colors duration-150 flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'logs' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" /> Logs & Debug
              </button>
              <button
                role="tab"
                id="tab-about"
                aria-controls="panel-about"
                aria-selected={settingsTab === 'about'}
                onClick={() => setSettingsTab('about')}
                className={cn(
                  "py-2.5 px-2 font-medium border-b-2 transition-colors duration-150 flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'about' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" /> About
              </button>
            </div>

            {/* Modal Body */}
            <div ref={settingsBodyRef} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              
              {/* TAB 1: GENERAL */}
              {settingsTab === 'general' && (
                <div 
                  role="tabpanel" 
                  id="panel-general" 
                  aria-labelledby="tab-general" 
                  tabIndex={0} 
                  className="space-y-4 focus:outline-none animate-in fade-in duration-150"
                >
                  <div className="space-y-1.5">
                    <label htmlFor="settings-download-dir" className="font-medium text-foreground">Download Destination</label>
                    <div className="flex gap-2">
                      <Input 
                        id="settings-download-dir"
                        value={downloadDir} 
                        onChange={e => setDownloadDir(e.target.value)} 
                        placeholder="Default: Downloads/Teralace"
                        className="flex-1 text-xs h-9 font-mono"
                      />
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-9 w-9 shrink-0" 
                        onClick={handleBrowse}
                        aria-label="Browse destination folder"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Destination folder for downloaded files and parts (Default: Downloads/Teralace).
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="font-medium text-foreground block">Download Concurrency</span>
                    <div className="grid grid-cols-2 gap-3">
                      <label className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer hover:bg-accent/40 transition-all text-center",
                        maxConcurrent === 1 ? "border-primary bg-primary/5 shadow-sm" : "border-border/60"
                      )}>
                        <input
                          type="radio"
                          className="hidden"
                          name="concurrency-mode"
                          checked={maxConcurrent === 1}
                          onChange={() => setMaxConcurrent(1)}
                        />
                        <span className="font-semibold text-xs text-foreground">Sequential</span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">1 file at a time</span>
                      </label>
                      <label className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer hover:bg-accent/40 transition-all text-center",
                        maxConcurrent > 1 ? "border-primary bg-primary/5 shadow-sm" : "border-border/60"
                      )}>
                        <input
                          type="radio"
                          className="hidden"
                          name="concurrency-mode"
                          checked={maxConcurrent > 1}
                          onChange={() => setMaxConcurrent(3)}
                        />
                        <span className="font-semibold text-xs text-foreground">Parallel (Recommended)</span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">Up to 3 concurrent downloads</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="settings-bandwidth-limit" className="font-medium text-foreground flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Bandwidth Cap
                    </label>
                    <select
                      id="settings-bandwidth-limit"
                      className="w-full h-9 p-2 rounded-lg border border-border/80 bg-background text-xs"
                      value={maxOverallLimit}
                      onChange={e => setMaxOverallLimit(Number(e.target.value))}
                    >
                      {BANDWIDTH_PRESETS.map(preset => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Theme Mode & Styling */}
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <div className="space-y-1.5">
                      <span className="font-medium text-foreground block text-xs">Visual Theme</span>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setTheme('light')}
                          className={cn(
                            "flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-colors duration-150 hover:bg-accent/40",
                            theme === 'light' ? "border-primary bg-primary/10 shadow-sm text-primary font-semibold" : "border-border/60 text-muted-foreground"
                          )}
                          title="Set Light Theme"
                          aria-label="Set Light Theme"
                        >
                          <Sun className="h-4 w-4 mb-1 text-amber-500" />
                          <span className="text-xs">Light</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTheme('dark')}
                          className={cn(
                            "flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-colors duration-150 hover:bg-accent/40",
                            theme === 'dark' ? "border-primary bg-primary/10 shadow-sm text-primary font-semibold" : "border-border/60 text-muted-foreground"
                          )}
                          title="Set Dark Theme"
                          aria-label="Set Dark Theme"
                        >
                          <Moon className="h-4 w-4 mb-1 text-primary" />
                          <span className="text-xs">Dark</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTheme('system')}
                          className={cn(
                            "flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-colors duration-150 hover:bg-accent/40",
                            theme === 'system' ? "border-primary bg-primary/10 shadow-sm text-primary font-semibold" : "border-border/60 text-muted-foreground"
                          )}
                          title="Set System Default Theme"
                          aria-label="Set System Default Theme"
                        >
                          <Monitor className="h-4 w-4 mb-1 text-muted-foreground" />
                          <span className="text-xs">System</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-card/60">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                            Material You
                            {materialYou && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {materialYou 
                              ? "Using Material 3 tonal surface hierarchy and organic pill geometry." 
                              : "Using classic crisp high-contrast mode with standard borders."}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={materialYou}
                        onClick={() => setMaterialYou(!materialYou)}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          materialYou ? "bg-primary" : "bg-muted-foreground/30"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                            materialYou ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground block text-xs">Accent Color Palette</span>
                        {palette === 'dynamic' && (
                          <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 animate-in fade-in duration-150">
                            <Sparkles className="h-2.5 w-2.5 text-primary" /> Dynamic Monet Active
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {THEME_PALETTES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPalette(p.id)}
                            className={cn(
                              "flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all hover:bg-accent/40",
                              palette === p.id 
                                ? "border-primary bg-primary/10 shadow-sm" 
                                : "border-border/60"
                            )}
                          >
                            <span 
                              className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm shrink-0" 
                              style={{ background: p.color }}
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-[11px] text-foreground truncate flex items-center gap-1">
                                {p.name}
                                {p.isDynamic && <Sparkles className="h-2.5 w-2.5 text-primary shrink-0" />}
                              </span>
                              <span className="text-[9px] text-muted-foreground truncate">{p.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {palette === 'dynamic' && (
                        <p className="text-[10.5px] text-muted-foreground leading-relaxed bg-muted/30 p-2.5 rounded-lg border border-border/40 animate-in fade-in duration-150">
                          🎨 <strong>Material You Dynamic:</strong> Automatically extracts dynamic tones from your device&apos;s wallpaper on Android 12+ (Monet engine) or system accent color on Windows 11/macOS, harmonizing buttons, surfaces, and borders.
                        </p>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 2: API POOL (abdul97233 engine) */}
              {settingsTab === 'api' && (
                <div 
                  role="tabpanel" 
                  id="panel-api" 
                  aria-labelledby="tab-api" 
                  tabIndex={0} 
                  className="space-y-4 focus:outline-none animate-in fade-in duration-150"
                >
                  <div className="p-3 bg-muted/30 rounded-xl text-xs space-y-1 border border-border/60">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                      Dynamic Round-Robin Balancer & Circuit Breaker
                    </p>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      Requests rotate automatically across active endpoints. If an API returns errors consecutively, 
                      the circuit breaker trips and auto-cools for 120 seconds.
                    </p>
                  </div>

                  {/* Endpoints List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
                        Configured Endpoints ({apiEndpoints.length})
                      </label>
                      <button 
                        onClick={handlePingEndpoints}
                        disabled={isPingingEndpoints}
                        aria-label="Refresh and probe API endpoint status"
                        className="text-[11px] text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={cn("h-3 w-3", isPingingEndpoints && "animate-spin")} />
                        {isPingingEndpoints ? "Probing..." : "Ping Status"}
                      </button>
                    </div>

                    {/* Direct Scraper Active (Yellow Mode) Info Banner */}
                    {healthyCount === 0 && apiEndpoints.length > 0 && (
                      <div className="p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                        <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                        <div className="leading-relaxed">
                          <p className="font-semibold text-foreground">Direct Scraper Active (Yellow Mode)</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Remote API endpoints are currently offline or disabled. Teralace is actively resolving links using its built-in <strong>Direct Scraper</strong> ({teraboxCookie ? "authenticated with session cookie" : "guest mode"}).
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {apiEndpoints.map(ep => {
                        const stat = endpointStats.find(s => s.id === ep.id);
                        const isCircuitOpen = stat?.circuit_open;
                        const isOffline = stat?.is_offline;
                        return (
                          <div 
                            key={ep.id} 
                            className="p-2.5 border border-border/60 rounded-xl flex items-center justify-between bg-card text-xs hover:border-border transition-colors"
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  !ep.enabled ? "bg-muted-foreground" :
                                  isOffline ? "bg-destructive animate-pulse" :
                                  isCircuitOpen ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                                )} />
                                <span className="font-semibold truncate">{ep.name}</span>
                                {isOffline && (
                                  <span className="text-[10px] text-destructive bg-destructive/10 border border-destructive/20 px-1.5 py-0.5 rounded font-mono">
                                    Offline ({stat?.last_error || "unreachable"})
                                  </span>
                                )}
                                {isCircuitOpen && !isOffline && (
                                  <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded font-mono">
                                    Cooldown: {stat?.circuit_remaining_s}s
                                  </span>
                                )}
                                {!isOffline && !isCircuitOpen && stat && stat.avg_latency_ms > 0 && (
                                  <span className="text-[10px] text-emerald-500 font-mono">
                                    {stat.avg_latency_ms}ms
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate font-mono mt-0.5 opacity-80">
                                {ep.url}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant={ep.enabled ? (isOffline ? "destructive" : "outline") : "ghost"} 
                                size="sm" 
                                className="h-7 text-[10px] px-2.5"
                                onClick={() => handleToggleEndpoint(ep.id)}
                              >
                                {!ep.enabled ? "Disabled" : isOffline ? "Offline" : "Active"}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDeleteEndpoint(ep.id)}
                                aria-label={`Delete endpoint ${ep.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Self-Host Cloudflare Worker Resolver Card */}
                  <div className="p-3.5 bg-gradient-to-r from-primary/10 via-primary/5 to-muted/20 border border-primary/20 rounded-xl space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                        <Server className="h-4 w-4 text-primary shrink-0" />
                        <span>Self-Host Cloudflare Worker Resolver</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-7 text-xs px-2.5 font-medium shrink-0"
                          onClick={() => {
                            try {
                              navigator.clipboard.writeText(workerScript);
                              setCopiedWorkerScript(true);
                              setTimeout(() => setCopiedWorkerScript(false), 3000);
                            } catch (e) {
                              console.error("Clipboard write error:", e);
                            }
                          }}
                        >
                          {copiedWorkerScript ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                              Copied worker.js!
                            </>
                          ) : (
                            <>
                              <Code2 className="h-3.5 w-3.5 mr-1 text-primary" />
                              Copy worker.js Script
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => setShowWorkerGuide(!showWorkerGuide)}
                        >
                          <span>{showWorkerGuide ? "Hide Guide" : "Setup Guide"}</span>
                          {showWorkerGuide ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                        </Button>
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Deploy our ready-to-use Cloudflare Worker for a private, uninterrupted TeraBox resolver (100% free with 100,000 requests/day).
                    </p>

                    {showWorkerGuide && (
                      <div className="space-y-2.5 pt-2 border-t border-border/50 text-[11px] animate-in fade-in duration-200">
                        <div className="space-y-2 bg-background/60 p-3 rounded-lg border border-border/50">
                          <div className="flex items-start gap-2">
                            <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">1</span>
                            <div>
                              <strong className="text-foreground">Create Worker on Cloudflare:</strong>
                              <p className="text-muted-foreground leading-normal mt-0.5">
                                Log in to <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">dash.cloudflare.com <ExternalLink className="h-2.5 w-2.5" /></a>. Navigate to <strong>Compute (Workers)</strong> &rarr; <strong>Workers & Pages</strong> &rarr; <strong>Create Application</strong> &rarr; <strong>Create Worker</strong>. Name it <code className="font-mono text-primary">teralace-resolver</code> and tap <strong>Deploy</strong>.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">2</span>
                            <div>
                              <strong className="text-foreground">Paste worker.js Script:</strong>
                              <p className="text-muted-foreground leading-normal mt-0.5">
                                In Cloudflare, tap <strong>Edit Code</strong> (Quick Edit). Tap <strong>Copy worker.js Script</strong> above in Teralace, paste it into the editor (replacing all existing sample code), and tap <strong>Deploy</strong> in the top-right.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">3</span>
                            <div>
                              <strong className="text-foreground">Connect to Teralace:</strong>
                              <p className="text-muted-foreground leading-normal mt-0.5">
                                Copy your worker URL (e.g. <code className="font-mono text-primary font-semibold">https://teralace-resolver.YOUR_SUBDOMAIN.workers.dev/</code>). Paste it into the <strong>Base URL</strong> input below, enter a provider name (e.g. <code className="font-mono text-foreground font-semibold">My Cloudflare Worker</code>), and tap <strong>+ Add</strong>!
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 bg-muted/40 rounded-lg text-[10.5px] text-muted-foreground space-y-1 border border-border/40">
                          <p className="font-semibold text-foreground">💡 Optional Settings (Worker Settings &rarr; Variables and Secrets):</p>
                          <ul className="list-disc list-inside space-y-0.5 pl-1 leading-relaxed">
                            <li><code className="font-mono text-primary">AUTH_TOKEN</code>: Password-protect your worker (enter the same passphrase in Teralace's <em>Auth Token</em> field below).</li>
                            <li><code className="font-mono text-primary">TERABOX_COOKIE</code>: Pre-configure your <code className="font-mono text-primary">ndus</code> session cookie on Cloudflare so all queries automatically authenticate.</li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Add New Endpoint */}
                  <div className="border-t border-border/60 pt-3 space-y-2">
                    <label htmlFor="settings-new-ep-name" className="font-semibold text-xs text-foreground block">Add Custom Endpoint</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input 
                        id="settings-new-ep-name"
                        placeholder="Provider Name (e.g. My Worker API)"
                        value={newEpName}
                        onChange={e => setNewEpName(e.target.value)}
                        className="text-xs h-8"
                        aria-label="Provider Name"
                      />
                      <Input 
                        placeholder="Auth Token (Optional)"
                        value={newEpToken}
                        onChange={e => setNewEpToken(e.target.value)}
                        className="text-xs h-8"
                        aria-label="Auth Token"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="Base URL: https://my-worker.workers.dev/"
                        value={newEpUrl}
                        onChange={e => setNewEpUrl(e.target.value)}
                        className="flex-1 text-xs h-8 font-mono"
                        aria-label="Base URL"
                      />
                      <Button size="sm" className="h-8 px-3" onClick={handleAddEndpoint} disabled={!newEpName || !newEpUrl}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add
                      </Button>
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 3: TERA BOX COOKIE */}
              {settingsTab === 'cookie' && (
                <div 
                  role="tabpanel" 
                  id="panel-cookie" 
                  aria-labelledby="tab-cookie" 
                  tabIndex={0} 
                  className="space-y-3.5 focus:outline-none animate-in fade-in duration-150"
                >
                  {/* Auto-Captured Success Notification */}
                  {cookieCapturedSuccess && (
                    <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center gap-2.5 text-xs text-emerald-400 animate-in fade-in zoom-in-95 duration-200">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div>
                        <p className="font-semibold text-emerald-400">TeraBox Session Cookie Captured Successfully!</p>
                        <p className="text-[11px] opacity-90">Your <code className="font-mono font-bold">ndus</code> token was automatically detected and saved.</p>
                      </div>
                    </div>
                  )}

                  {/* One-Tap Sign In with TeraBox */}
                  <div className="p-3.5 bg-gradient-to-r from-primary/10 via-primary/5 to-muted/20 border border-primary/20 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-amber-400" /> One-Tap Sign In (Auto-Capture)
                      </span>
                      <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-medium">
                        Recommended
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Opens a secure login window. Once signed in via Google, Email, or Phone, Teralace automatically extracts your session token and saves it without needing DevTools.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button 
                        onClick={handleOpenLogin} 
                        disabled={isLoggingIn}
                        className="w-full sm:w-auto h-8 px-4 text-xs font-semibold flex items-center gap-2 shadow-sm"
                      >
                        {isLoggingIn ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Waiting for login... (Log in in the popup)
                          </>
                        ) : (
                          <>
                            <Key className="h-3.5 w-3.5" />
                            Sign In with TeraBox
                          </>
                        )}
                      </Button>
                      {isLoggingIn && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setIsLoggingIn(false)}
                          title="Cancel waiting for login"
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Manual Cookie Input with Paste */}
                  <div className="space-y-1.5">
                    <label htmlFor="settings-terabox-cookie" className="font-medium text-xs text-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Personal TeraBox Session Cookie (<code className="text-xs font-mono">ndus</code>)
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input 
                          id="settings-terabox-cookie"
                          value={teraboxCookie}
                          onChange={e => setTeraboxCookie(e.target.value)}
                          placeholder="ndus=Yxxxxxx... or raw token"
                          className="font-mono text-xs h-9 pr-8"
                        />
                        {teraboxCookie && (
                          <button 
                            onClick={() => setTeraboxCookie("")}
                            aria-label="Clear cookie value"
                            className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 text-xs shrink-0"
                        onClick={async () => {
                          try {
                            const text = await readClipboardText();
                            if (text) {
                              const m = text.match(/(?:^|;\s*)ndus=([^;\s]+)/) || text.match(/^([A-Za-z0-9_-]{20,})$/);
                              const val = m ? (m[1] || m[0]) : text.trim();
                              setTeraboxCookie(val);
                            }
                          } catch (e) {
                            console.error("Clipboard read error:", e);
                          }
                        }}
                      >
                        <Clipboard className="h-3.5 w-3.5 mr-1" /> Paste
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Optional: Paste your personal TeraBox session cookie (<code className="font-mono text-primary font-bold">ndus</code>). 
                      When remote API endpoints fail or when downloading shared folders/large files, TeraBox actively blocks anonymous requests (<span className="text-destructive font-mono font-medium">31045: user not exists</span>). 
                      Your session cookie provides authenticated access, bypasses guest throttles, and downloads private folders directly.
                    </p>
                  </div>

                  {/* Android & Mobile Extraction Helper */}
                  <div className="p-3.5 bg-muted/30 rounded-xl text-xs text-muted-foreground space-y-3 border border-border/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                        <Smartphone className="h-4 w-4 text-primary shrink-0" />
                        <span>Android & Mobile Extraction Guide</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs px-2.5 font-medium shrink-0"
                        onClick={() => {
                          const snippet = `javascript:(function(){try{var o=document.getElementById('tl-box');if(o)o.remove();var f=function(){var m=document.cookie.match(/(?:^|;\\s*)ndus=([^;]+)/);if(m&&m[1])return m[1].trim();try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i),v=localStorage.getItem(k);if(k==='ndus'&&v)return v.trim();if(v&&v.indexOf('ndus')!==-1){var lm=v.match(/ndus["']?\\s*[:=]\\s*["']?([^"',;}\\s]+)/);if(lm&&lm[1])return lm[1].trim();}}}catch(e){}try{for(var j=0;j<sessionStorage.length;j++){var sk=sessionStorage.key(j),sv=sessionStorage.getItem(sk);if(sk==='ndus'&&sv)return sv.trim();if(sv&&sv.indexOf('ndus')!==-1){var sm=sv.match(/ndus["']?\\s*[:=]\\s*["']?([^"',;}\\s]+)/);if(sm&&sm[1])return sm[1].trim();}}}catch(e){}return null;};var t=f(),b=document.createElement('div');b.id='tl-box';b.style.cssText='position:fixed;top:16px;left:16px;right:16px;z-index:2147483647;background:#0f172a;color:#f8fafc;padding:16px;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,0.6);font-family:sans-serif;font-size:13px;border:1px solid #334155;';if(t){var c=false;try{var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();c=document.execCommand('copy');document.body.removeChild(a);}catch(e){}b.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong style="color:#38bdf8;font-size:14px;">TeraBox ndus Found!</strong><button id="tl-c" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">✕</button></div><p style="margin:0 0 8px;color:#94a3b8;font-size:11px;">'+(c?'Copied to clipboard automatically!':'Tap to copy:')+'</p><input id="tl-v" type="text" readonly value="'+t+'" style="width:100%;box-sizing:border-box;padding:8px;background:#1e293b;border:1px solid #475569;border-radius:6px;color:#f8fafc;font-family:monospace;font-size:11px;margin-bottom:10px;"><div style="display:flex;gap:8px;"><button id="tl-b" style="flex:1;padding:8px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">'+(c?'Copied! Tap to Copy Again':'Copy ndus Token')+'</button><button id="tl-d" style="padding:8px 12px;background:#334155;color:#f8fafc;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Done</button></div>';}else{b.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong style="color:#f87171;font-size:14px;">ndus Cookie Protected (HttpOnly)</strong><button id="tl-c" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">✕</button></div><p style="margin:0 0 10px;color:#cbd5e1;font-size:11px;line-height:1.5;">TeraBox marks your session cookie as <strong style="color:#f87171;">HttpOnly</strong> on this domain, so browsers block JavaScript from reading it.<br><br>👉 <strong>Guaranteed Android Method:</strong><br>1. Open Play Store & install <strong>Kiwi Browser</strong>.<br>2. In Kiwi, install the <strong>Cookie-Editor</strong> Chrome extension.<br>3. Log in to TeraBox & copy the <code>ndus</code> cookie from Cookie-Editor.</p><button id="tl-d" style="width:100%;padding:8px;background:#334155;color:#f8fafc;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Close</button>';}document.body.appendChild(b);var cl=function(){b.remove();};var cb=document.getElementById('tl-c'),db=document.getElementById('tl-d'),bb=document.getElementById('tl-b'),vi=document.getElementById('tl-v');if(cb)cb.onclick=cl;if(db)db.onclick=cl;if(vi)vi.onclick=function(){vi.select();};if(bb&&t){bb.onclick=function(){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t);}else if(vi){vi.select();document.execCommand('copy');}bb.innerText='Copied to Clipboard!';bb.style.background='#059669';};}}catch(err){alert('Teralace Helper Error: '+err.message);}})();void(0);`;
                          navigator.clipboard.writeText(snippet);
                          setCopiedBookmarklet(true);
                          setTimeout(() => setCopiedBookmarklet(false), 3000);
                        }}
                      >
                        {copiedBookmarklet ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Bookmark className="h-3.5 w-3.5 mr-1 text-primary" />}
                        {copiedBookmarklet ? "Copied Script!" : "Copy Helper Bookmarklet"}
                      </Button>
                    </div>

                    {/* Method 1: Guaranteed (Kiwi Browser) */}
                    <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-primary text-[11px]">
                        <span>⭐ Method 1: Kiwi Browser + Cookie-Editor (100% Guaranteed on Android)</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        TeraBox sets the <code className="font-mono text-primary font-bold">ndus</code> session cookie as <strong className="text-foreground">HttpOnly</strong> on most domains, which mobile browsers strictly hide from JavaScript. Because <strong>Kiwi Browser</strong> supports desktop Chrome extensions, it can read HttpOnly cookies without restrictions:
                      </p>
                      <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-muted-foreground pl-1">
                        <li>Install <strong>Kiwi Browser</strong> from Google Play Store.</li>
                        <li>In Kiwi, visit Chrome Web Store and install the <strong>Cookie-Editor</strong> extension.</li>
                        <li>Open <strong>terabox.app</strong>, sign in to your account, and tap <kbd className="px-1 py-0.2 rounded bg-muted font-sans text-[10px]">⋮</kbd> &rarr; <strong>Cookie-Editor</strong>.</li>
                        <li>Tap the <code className="font-mono text-primary font-bold">ndus</code> row, copy its value, and tap <strong>Paste</strong> above!</li>
                      </ol>
                    </div>

                    {/* Method 2: Chrome Bookmarklet Overlay */}
                    <div className="space-y-2 text-[11px] bg-background/60 p-2.5 rounded-lg border border-border/50">
                      <div className="font-semibold text-foreground text-[11px] flex items-center justify-between">
                        <span>Method 2: Chrome Mobile Bookmarklet (In-Page Overlay)</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-normal">
                        To run the script in standard Chrome Mobile without it being stripped, add it as a bookmark:
                      </p>

                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-start gap-2">
                          <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">1</span>
                          <div>
                            <strong className="text-foreground">Save Bookmark:</strong>
                            <p className="text-muted-foreground leading-normal">
                              Tap <strong>Copy Helper Bookmarklet</strong> above. In Chrome Mobile, bookmark any page (<kbd className="px-1 py-0.2 rounded bg-muted font-sans text-[10px]">⋮</kbd> &rarr; <kbd className="px-1 py-0.2 rounded bg-muted font-sans text-[10px]">★</kbd>), tap <strong>Edit</strong>, change the name to <code className="font-mono text-primary font-bold">ndus</code>, clear the URL field, paste the copied script, and save.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">2</span>
                          <div>
                            <strong className="text-foreground">Trigger on TeraBox:</strong>
                            <p className="text-muted-foreground leading-normal">
                              Open <strong>terabox.app</strong> in Chrome and log in. Tap the address bar, type <code className="font-mono text-primary font-bold">ndus</code>, and tap the autocomplete suggestion with the <strong className="text-foreground">★ Star / Bookmark</strong> icon.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] shrink-0 mt-0.5">3</span>
                          <div>
                            <strong className="text-foreground">In-Page Floating Card:</strong>
                            <p className="text-muted-foreground leading-normal">
                              An interactive floating card will appear directly on top of the TeraBox page displaying your token with a 1-tap copy button. If your domain enforces HttpOnly, the card will inform you to use Method 1.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: LOGS & DIAGNOSTICS */}
              {settingsTab === 'logs' && (
                <div 
                  role="tabpanel" 
                  id="panel-logs" 
                  aria-labelledby="tab-logs" 
                  tabIndex={0} 
                  className="space-y-4 focus:outline-none animate-in fade-in duration-150"
                >
                  <LogViewer />
                </div>
              )}

              {/* TAB 5: ABOUT */}
              {settingsTab === 'about' && (
                <div 
                  role="tabpanel" 
                  id="panel-about" 
                  aria-labelledby="tab-about" 
                  tabIndex={0} 
                  className="space-y-4 py-1 focus:outline-none animate-in fade-in duration-150"
                >
                  <div className="flex items-center gap-3 p-3 bg-muted/20 border border-border/60 rounded-xl">
                    <img src="/logo.svg" alt="Teralace" className="w-10 h-10 object-contain drop-shadow-sm" />
                    <div>
                      <h3 className="font-bold text-sm text-foreground">Teralace</h3>
                      <p className="text-[11px] text-muted-foreground">Fast, resilient multiplatform TeraBox downloader</p>
                      <p className="text-[10px] text-primary font-mono font-medium mt-0.5">Version {currentAppVersion} (GPL-3.0)</p>
                    </div>
                  </div>

                  <div className="space-y-3 text-[11px] text-muted-foreground leading-relaxed">
                    <p>Built with <strong>Tauri v2</strong>, <strong>Rust</strong>, and <strong>React 18</strong> with an embedded multi-stream HTTP range downloader engine.</p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <a 
                        href="https://github.com/LoLyeah/teralace" 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                      >
                        GitHub Repository <ExternalLink className="h-3 w-3" />
                      </a>
                      <span>•</span>
                      <a 
                        href="https://github.com/LoLyeah/teralace/releases" 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                      >
                        Release Notes <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>

                    {/* Manual Update Checker */}
                    <div className="p-3 bg-muted/30 border border-border/70 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Update Checker
                          </h4>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Check for newly published releases on GitHub.
                          </p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={handleCheckForUpdates}
                          disabled={isCheckingUpdate}
                          className="h-7 text-xs px-2.5 gap-1.5 border-border/70 shrink-0"
                        >
                          {isCheckingUpdate ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {isCheckingUpdate ? "Checking..." : "Check for Updates"}
                        </Button>
                      </div>

                      {updateResult && (
                        <div className={cn(
                          "p-2.5 rounded-lg border text-xs animate-in fade-in duration-200",
                          updateResult.update_available 
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                            : "bg-primary/5 border-primary/20 text-foreground"
                        )}>
                          {updateResult.update_available ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                  <CheckCircle2 className="h-4 w-4 shrink-0" /> Update available: v{updateResult.latest_version}
                                </span>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-6 text-[10px] px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium gap-1"
                                  onClick={() => {
                                    openUrl(updateResult.release_url).catch(() => window.open(updateResult.release_url, '_blank'));
                                  }}
                                >
                                  View Release <ExternalLink className="h-2.5 w-2.5" />
                                </Button>
                              </div>
                              {updateResult.release_name && (
                                <p className="text-[11px] font-medium text-foreground">{updateResult.release_name}</p>
                              )}
                              {updateResult.release_notes && (
                                <p className="text-[10px] text-muted-foreground line-clamp-3 whitespace-pre-line font-mono bg-background/50 p-2 rounded">
                                  {updateResult.release_notes}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>You are running the latest version of Teralace (v{updateResult.current_version}).</span>
                            </div>
                          )}
                        </div>
                      )}

                      {updateError && (
                        <div className="p-2 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center gap-2 animate-in fade-in duration-200">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">Failed to check updates: {updateError}</span>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center p-3.5 px-4 sm:px-5 pb-[calc(0.875rem+var(--sab))] border-t border-border/60 bg-muted/20 gap-2 shrink-0">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-9 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 hover:border-destructive flex items-center gap-1.5 transition-colors" 
                onClick={handleQuitApp}
                title="Completely terminate Teralace"
              >
                <Power className="h-3.5 w-3.5" />
                <span>Quit App</span>
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 px-3.5" onClick={() => setShowSettings(false)}>Cancel</Button>
                <Button size="sm" className="h-9 px-4" onClick={handleSaveSettings}>Save Changes</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirmation(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            tabIndex={-1}
            className="bg-card border border-border/80 rounded-2xl p-4 sm:p-5 max-w-sm sm:max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-150 space-y-4 outline-none focus:outline-none"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/15 text-destructive flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 id="delete-dialog-title" className="font-bold text-sm text-foreground">
                  {deleteConfirmation.type === 'single' ? 'Delete Download Task' :
                   deleteConfirmation.type === 'completed' ? 'Clear Completed Downloads' :
                   'Clear All Queue Tasks'}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {deleteConfirmation.type === 'single' ? deleteConfirmation.item?.file.name :
                   deleteConfirmation.type === 'completed' ? `${queue.filter(i => i.status === 'completed').length} completed item(s)` :
                   'All tasks in the download queue'}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {deleteConfirmation.type === 'single' 
                ? 'Are you sure you want to remove this item from the download queue?'
                : deleteConfirmation.type === 'completed'
                ? 'Are you sure you want to clear all completed downloads from the queue?'
                : 'Are you sure you want to stop and remove all tasks from the download queue?'}
            </p>

            {(deleteConfirmation.type === 'single' || deleteConfirmation.type === 'completed') && (
              <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border/60 bg-muted/20 cursor-pointer text-xs select-none hover:bg-muted/30 transition-colors">
                <input 
                  type="checkbox"
                  checked={deleteFromStorage}
                  onChange={e => setDeleteFromStorage(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                />
                <span className="font-medium text-foreground">
                  Also permanently delete downloaded file(s) from device storage
                </span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 text-xs px-3.5" 
                onClick={() => setDeleteConfirmation(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                className="h-8 text-xs px-4 gap-1.5"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueItemRow({ 
  item, 
  isActive, 
  onRemove,
  onRetry,
  onOpenFile,
  onOpenFolder,
  onPreview,
  onOpenCookieSettings
}: { 
  item: QueueItem, 
  isActive: boolean, 
  onRemove: () => void,
  onRetry?: () => void,
  onOpenFile?: () => void,
  onOpenFolder?: () => void,
  onPreview?: () => void,
  onOpenCookieSettings?: () => void
}) {
  const isVideo = item.file.file_type === 'video' || item.file.file_type === 'audio';

  return (
    <div className={cn(
      "p-3 md:p-3.5 min-h-[52px] flex items-center gap-3 transition-colors group select-none animate-in fade-in slide-in-from-top-1 duration-200",
      isActive ? "bg-primary/5" : "hover:bg-accent/30",
      item.status === 'completed' && "opacity-90 bg-muted/10"
    )}>
      <div className="flex-1 min-w-0">
        {/* Name & Quick Controls */}
        <div className="flex justify-between items-center mb-1.5">
          <span className="font-medium text-xs truncate pr-2 text-foreground" title={item.file.name}>
            {item.file.name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {item.status === 'completed' && onOpenFile && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 sm:h-6 sm:w-6 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFile();
                }}
                title={isVideo ? "Play / Open File" : "Open File"}
                aria-label={`Open file ${item.file.name}`}
              >
                {isVideo ? <Play className="h-3.5 w-3.5 fill-current" /> : <ExternalLink className="h-3.5 w-3.5" />}
              </Button>
            )}

            {item.status === 'completed' && onOpenFolder && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFolder();
                }}
                title="Open Destination Folder"
                aria-label={`Open destination folder for ${item.file.name}`}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            )}

            {isVideo && item.params.direct_link && onPreview && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                title="Instant Media Preview"
                aria-label={`Preview media stream for ${item.file.name}`}
              >
                <Play className="h-3.5 w-3.5 fill-current" />
              </Button>
            )}

            {item.status === 'error' && onRetry && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                title="Retry Download"
                aria-label={`Retry download for ${item.file.name}`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}

            <span className={cn(
              "text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ml-1 tabular-nums transition-colors duration-200",
              item.status === 'completed' ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
              item.status === 'error' ? "bg-destructive/10 text-destructive border border-destructive/20" :
              isActive ? "bg-primary/10 text-primary border border-primary/20" :
              "bg-muted text-muted-foreground"
            )}>
              {getStatusBadgeText(item)}
            </span>

            <Button 
              variant="ghost" 
              size="icon" 
              className={cn(
                "h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground transition-colors ml-0.5",
                item.status === 'completed' ? "hover:text-destructive hover:bg-destructive/10" : "hover:text-destructive"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title={item.status === 'completed' ? "Delete task and file" : "Cancel Task"}
              aria-label={`${item.status === 'completed' ? 'Delete task and file' : 'Cancel download task'} for ${item.file.name}`}
            >
              {item.status === 'completed' ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        
        {/* Solid Progress Bar (No generic AI gradient text or bars) */}
        <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
          <div 
            className={cn(
              "h-full transition-all duration-300 ease-out-expo relative overflow-hidden",
              item.status === 'error' ? "bg-destructive" : 
              item.status === 'completed' ? "bg-emerald-500" : 
              "bg-primary"
            )}
            style={{ width: `${Math.min(item.progress, 100)}%` }}
          >
            {isActive && item.status === 'downloading' && (
              <div 
                className="absolute inset-0 bg-white/20 animate-progress-sheen pointer-events-none" 
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        
        {/* Telemetry Row with tabular numbers */}
        <div className="flex justify-between items-center mt-1 text-[11px] text-muted-foreground font-mono tabular-nums">
          <span>{formatBytes(item.downloaded)} / {formatBytes(item.total)}</span>
          
          <div className="flex items-center gap-2">
            {isActive && (
              <>
                {item.speed > 0 && (
                  <span className="text-[10px] text-muted-foreground/80">
                    ETA: {formatEta(item.total, item.downloaded, item.speed)}
                  </span>
                )}
                <span className="text-primary font-semibold min-w-[55px] text-right">
                  {formatSpeed(item.speed)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Completed destination path reminder */}
        {item.status === 'completed' && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1 truncate">
            <span>Saved to:</span>
            <span 
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenFolder) onOpenFolder();
              }}
              className="text-foreground/90 font-mono underline hover:text-primary cursor-pointer truncate max-w-[280px]"
              title="Click to open destination folder"
            >
              {item.filePath ? item.filePath : (item.downloadDir ? `${item.downloadDir}/${item.file.name}` : `Download/Teralace/${item.file.name}`)}
            </span>
          </div>
        )}
        
        {/* Error Detail Message */}
        {item.error && (
          <div className="mt-1 space-y-1">
            <p className="text-[10px] text-destructive break-words leading-tight" title={item.error}>
              {item.error}
            </p>
            {(item.error.toLowerCase().includes("cookie") || item.error.toLowerCase().includes("user not exists") || item.error.includes("403")) && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-medium">
                  Cookie Required
                </span>
                {onOpenCookieSettings && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCookieSettings();
                    }}
                    className="text-[9px] text-primary hover:underline font-semibold flex items-center gap-0.5"
                  >
                    <span>Add ndus Cookie</span>
                    <span>&rarr;</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusBadgeText(item: QueueItem) {
  switch (item.status) {
    case 'pending': return 'Waiting';
    case 'fetching_link': return 'Connecting';
    case 'downloading': return `${item.progress.toFixed(1)}%`;
    case 'completed': return 'Complete';
    case 'error': return 'Failed';
    case 'cancelled': return 'Cancelled';
  }
}
