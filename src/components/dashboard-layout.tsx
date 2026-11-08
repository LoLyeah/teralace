import { open } from "@tauri-apps/plugin-dialog";
import { useState, useCallback, useEffect, useMemo } from "react";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { 
  Loader2, Link, FileDown, Trash2, Play, Pause, FolderOpen, 
  Settings, X, ListX, Gauge, ShieldCheck, Plus, Server, Key,
  Clipboard, AlertCircle, CheckCircle2, Film, RefreshCw, Zap,
  Layers, HardDrive, Info, ExternalLink, ArrowDown, Terminal,
  Sparkles, AlertTriangle, Check
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
  getBandwidthLimit, getEndpointStats, pingEndpointHealth, saveApiEndpoints, openDownloadDir, saveTeraboxCookie, openTeraboxLogin
} from "../lib/api";
import { loadSettings, saveSettings, DEFAULT_ENDPOINTS } from "../lib/settings";
import { 
  TeraboxInfo, TeraboxFileInfo, BANDWIDTH_PRESETS, 
  ApiEndpointConfig, EndpointHealthInfo 
} from "../lib/types";
import { useDownloadQueue, QueueItem } from "../hooks/use-download-queue";
import { cn } from "../lib/utils";

const SUPPORTED_MIRRORS = [
  "terabox.app",
  "1024terabox.com",
  "terasharelink.com",
  "4funbox.com",
  "mirrobox.com"
];

export function DashboardLayout() {
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teraboxInfo, setTeraboxInfo] = useState<TeraboxInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloadDir, setDownloadDir] = useState("");
  const [downloadMode, setDownloadMode] = useState(2);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'api' | 'cookie' | 'logs' | 'about'>('general');
  const { palette, setPalette } = useTheme();
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

    listen<string>("terabox-cookie-captured", (event) => {
      if (event.payload) {
        setTeraboxCookie(event.payload);
        setCookieCapturedSuccess(true);
        setIsLoggingIn(false);
        setTimeout(() => setCookieCapturedSuccess(false), 6000);
      }
    }).then(fn => { unlistenCookie = fn; }).catch(() => {});

    listen<EndpointHealthInfo[]>("endpoint-health-updated", (event) => {
      if (event.payload) {
        setEndpointStats(event.payload);
      }
    }).then(fn => { unlistenHealth = fn; }).catch(() => {});

    return () => {
      if (unlistenCookie) unlistenCookie();
      if (unlistenHealth) unlistenHealth();
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
    try {
      await openTeraboxLogin();
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

  // Auto-Update Check
  useEffect(() => {
    const initUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          const yes = await confirm(
            `Update to version ${update.version} is available!\n\n${update.body || ''}`,
            { title: 'Update Available', kind: 'info' }
          );
          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (e) {
        // Silently catch in mobile/offline
      }
    };
    initUpdate();
  }, []);

  // Graceful Exit Handler (Desktop)
  useEffect(() => {
    const setupExitHandler = async () => {
      try {
        const appWindow = getCurrentWindow();
        const unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          const yes = await confirm(
            "Are you sure you want to quit?\nActive downloads will be stopped.",
            { title: 'Quit TeraLace', kind: 'warning', okLabel: 'Quit', cancelLabel: 'Cancel' }
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
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setUrl(text.trim());
      }
    } catch (e) {
      // Clipboard access denied or unsupported
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

  const handleDownloadFolder = useCallback(async (folder: TeraboxFileInfo) => {
    if (!teraboxInfo) return;
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
  }, [teraboxInfo, currentPath, url, downloadMode, downloadDir, addToQueue, startQueue]);

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

  const handleDownloadFile = useCallback((file: TeraboxFileInfo) => {
    if (!teraboxInfo || file.is_dir) return;
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
  }, [teraboxInfo, downloadMode, downloadDir, addToQueue, startQueue]);

  const handleDownloadSelected = () => {
    if (!teraboxInfo) return;
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
              alt="TeraLace Logo" 
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain transition-transform duration-200 group-hover:scale-105 drop-shadow-sm"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-sm sm:text-base md:text-lg tracking-tight text-foreground">
                TeraLace
              </span>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-mono font-medium">
                v1.1.2
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live Telemetry & API Pool Status Widget */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Live Global Download Speed Indicator */}
          {totalSpeed > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/25 animate-pulse shadow-sm shadow-primary/10 animate-in fade-in zoom-in-95 duration-200">
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
            aria-label={`API Pool: ${healthyCount > 0 ? `${healthyCount} active endpoints` : 'All endpoints offline (using Direct Scraper)'}. Click to configure.`}
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all border focus:outline-none focus:ring-1 focus:ring-ring",
              healthyCount > 0 
                ? "bg-muted/40 hover:bg-muted/80 border-border/60 hover:border-border" 
                : "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
            )}
            title={healthyCount > 0 ? "Click to inspect API endpoints" : "All remote endpoints are offline. TeraLace is using direct scraping with your session cookie."}
          >
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                healthyCount > 0 ? "bg-emerald-400" : "bg-destructive"
              )} />
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                healthyCount > 0 ? "bg-emerald-500" : "bg-destructive"
              )} />
            </span>
            <span className={cn("text-[11px]", healthyCount > 0 ? "text-muted-foreground" : "text-destructive font-medium")}>API Pool:</span>
            {healthyCount > 0 ? (
              <span className="text-emerald-500 font-semibold">{healthyCount} Active</span>
            ) : (
              <span className="font-semibold text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Offline (Direct Scraper)
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
            <div className="p-3 pb-[calc(0.75rem+var(--sab))] md:pb-3 border-t border-border/60 bg-muted/20 shrink-0">
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
                  onClick={isProcessing ? pauseQueue : startQueue}
                  disabled={queue.length === 0}
                  className="h-7 text-xs px-2.5 border-border/70"
                  aria-label={isProcessing ? "Pause download queue" : "Start download queue"}
                >
                  {isProcessing ? (
                    <><Pause className="mr-1.5 h-3 w-3 fill-current" /> Pause</>
                  ) : (
                    <><Play className="mr-1.5 h-3 w-3 fill-current" /> Start</>
                  )}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={clearCompleted} 
                  title="Clear Completed" 
                  aria-label="Clear completed downloads"
                  className="h-7 w-7 text-muted-foreground hover:text-emerald-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={clearAll} 
                  title="Clear All Tasks" 
                  aria-label="Clear all tasks"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
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
                      onRemove={() => removeFromQueue(item.id)}
                      onRetry={() => retryItem(item.id)}
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
                {totalSpeed > 0 && (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
            className="bg-background border border-border/80 rounded-2xl overflow-hidden w-full max-w-[820px] max-h-[90dvh] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200">
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            className="bg-background border border-border/80 rounded-2xl shadow-2xl w-full max-w-[580px] max-h-[92dvh] sm:max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden"
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
                  "py-2.5 px-2 font-medium border-b-2 transition-all flex items-center gap-1.5 focus:outline-none shrink-0",
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
                  "py-2.5 px-2 font-medium border-b-2 transition-all flex items-center gap-1.5 focus:outline-none shrink-0",
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
                  "py-2.5 px-2 font-medium border-b-2 transition-all flex items-center gap-1.5 focus:outline-none shrink-0",
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
                  "py-2.5 px-2 font-medium border-b-2 transition-all flex items-center gap-1.5 focus:outline-none shrink-0",
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
                  "py-2.5 px-2 font-medium border-b-2 transition-all flex items-center gap-1.5 focus:outline-none shrink-0",
                  settingsTab === 'about' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" /> About
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              
              {/* TAB 1: GENERAL */}
              {settingsTab === 'general' && (
                <div 
                  role="tabpanel" 
                  id="panel-general" 
                  aria-labelledby="tab-general" 
                  tabIndex={0} 
                  className="space-y-4 focus:outline-none animate-in fade-in-50 duration-200 slide-in-from-bottom-1"
                >
                  <div className="space-y-1.5">
                    <label htmlFor="settings-download-dir" className="font-medium text-foreground">Download Destination</label>
                    <div className="flex gap-2">
                      <Input 
                        id="settings-download-dir"
                        value={downloadDir} 
                        onChange={e => setDownloadDir(e.target.value)} 
                        placeholder="Default: Downloads/TeraBox"
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
                      Destination folder for downloaded files and parts.
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

                  {/* Theme Accent Color Palette */}
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <span className="font-medium text-foreground block text-xs">Accent Color Palette (Android 17)</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                            style={{ backgroundColor: p.color }}
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-[11px] text-foreground truncate">{p.name}</span>
                            <span className="text-[9px] text-muted-foreground truncate">{p.label}</span>
                          </div>
                        </button>
                      ))}
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
                  className="space-y-4 focus:outline-none animate-in fade-in-50 duration-200 slide-in-from-bottom-1"
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

                    {/* All Endpoints Offline Warning Banner */}
                    {healthyCount === 0 && apiEndpoints.length > 0 && (
                      <div className="p-2.5 bg-destructive/10 border border-destructive/25 rounded-xl flex items-start gap-2 text-xs text-destructive">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div className="leading-relaxed">
                          <p className="font-semibold">All Remote API Endpoints Are Offline</p>
                          <p className="text-[11px] opacity-90">
                            Public API pools are currently unreachable. TeraLace automatically falls back to its <strong>Direct TeraBox Scraper</strong>. Ensure you have your session cookie configured in the <strong>TeraBox Cookie</strong> tab for uninterrupted downloads.
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

                  {/* Self-Host Cloudflare Worker Resolver Banner */}
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <Server className="h-3.5 w-3.5 text-primary" /> Self-Host Your Cloudflare Worker
                      </div>
                      <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">100% Free & Private</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Deploy our ready-to-use Cloudflare Worker in under 2 minutes for a dedicated, uninterrupted private resolver.
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <a 
                        href="https://dash.cloudflare.com/" 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                      >
                        <ExternalLink className="h-3 w-3" /> Cloudflare Dashboard
                      </a>
                      <span className="text-muted-foreground text-[10px]">•</span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        See cloudflare-worker/README.md
                      </span>
                    </div>
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
                  className="space-y-3.5 focus:outline-none animate-in fade-in-50 duration-200 slide-in-from-bottom-1"
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
                      Opens a secure login window. Once signed in via Google, Email, or Phone, TeraLace automatically extracts your session token and saves it without needing DevTools.
                    </p>
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
                            const text = await navigator.clipboard.readText();
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
                  <div className="p-3 bg-muted/30 rounded-xl text-[11px] text-muted-foreground space-y-2 border border-border/60">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-foreground">Android & Mobile Extraction Helper:</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-primary hover:text-primary"
                        onClick={() => {
                          const snippet = `javascript:(function(){var m=document.cookie.match(/ndus=([^;]+)/);if(m){navigator.clipboard.writeText(m[1]);alert('ndus copied to clipboard!')}else{alert('ndus cookie not found, please sign in first.')}})();`;
                          navigator.clipboard.writeText(snippet);
                          setCopiedBookmarklet(true);
                          setTimeout(() => setCopiedBookmarklet(false), 3000);
                        }}
                      >
                        {copiedBookmarklet ? <Check className="h-3 w-3 mr-1 text-emerald-400" /> : <Clipboard className="h-3 w-3 mr-1" />}
                        {copiedBookmarklet ? "Copied Script!" : "Copy Helper Bookmarklet"}
                      </Button>
                    </div>
                    <p>
                      On Android, open <strong>terabox.app</strong> in Chrome or Kiwi Browser. You can paste the helper bookmarklet into the address bar to copy your <code className="font-mono text-primary font-bold">ndus</code> token directly to clipboard, then tap <strong>Paste</strong> above.
                    </p>
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
                  className="space-y-4 focus:outline-none animate-in fade-in-50 duration-200 slide-in-from-bottom-1"
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
                  className="space-y-4 py-1 focus:outline-none animate-in fade-in-50 duration-200 slide-in-from-bottom-1"
                >
                  <div className="flex items-center gap-3 p-3 bg-muted/20 border border-border/60 rounded-xl">
                    <img src="/logo.svg" alt="TeraLace" className="w-10 h-10 object-contain drop-shadow-sm" />
                    <div>
                      <h3 className="font-bold text-sm text-foreground">TeraLace</h3>
                      <p className="text-[11px] text-muted-foreground">Fast, resilient multiplatform TeraBox downloader</p>
                      <p className="text-[10px] text-primary font-mono font-medium mt-0.5">Version 1.1.2 (GPL-3.0)</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                    <p>Built with <strong>Tauri v2</strong>, <strong>Rust</strong>, and <strong>React 18</strong> with an embedded multi-stream HTTP range downloader engine.</p>
                    <div className="flex items-center gap-2 pt-1">
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
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="flex justify-end p-3.5 px-4 sm:px-5 pb-[calc(0.875rem+var(--sab))] border-t border-border/60 bg-muted/20 gap-2 shrink-0">
              <Button variant="outline" size="sm" className="h-9 px-3.5" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button size="sm" className="h-9 px-4" onClick={handleSaveSettings}>Save Changes</Button>
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
  onOpenFolder,
  onPreview,
  onOpenCookieSettings
}: { 
  item: QueueItem, 
  isActive: boolean, 
  onRemove: () => void,
  onRetry?: () => void,
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

            {item.status !== 'completed' && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 sm:h-6 sm:w-6 text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Cancel Task"
                aria-label={`Cancel download task for ${item.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
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
            {isActive && item.speed > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground/80">
                  ETA: {formatEta(item.total, item.downloaded, item.speed)}
                </span>
                <span className="text-primary font-semibold">
                  {formatSpeed(item.speed)}
                </span>
              </>
            )}
          </div>
        </div>
        
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
