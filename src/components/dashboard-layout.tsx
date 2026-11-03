import { open } from "@tauri-apps/plugin-dialog";
import { useState, useCallback, useEffect, useMemo } from "react";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { 
  Loader2, Link, FileDown, Trash2, Play, Pause, FolderOpen, 
  Settings, X, ListX, Gauge, ShieldCheck, Plus, Server, Key,
  Clipboard, AlertCircle, CheckCircle2, Film, RefreshCw, Zap,
  Layers, HardDrive, Info, ExternalLink, ArrowDown
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FileList, SelectAllButton } from "./file-list";
import { ThemeToggle } from "./theme-toggle";
import { 
  getTeraboxInfo, formatBytes, formatSpeed, formatEta, stopAria2, setBandwidthLimit, 
  getBandwidthLimit, getEndpointStats, saveApiEndpoints, openDownloadDir 
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
  const [settingsTab, setSettingsTab] = useState<'general' | 'api' | 'cookie' | 'about'>('general');
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

  const {
    queue,
    addToQueue,
    startQueue,
    pauseQueue,
    removeFromQueue,
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

  // Selected files count & total size
  const { selectedCount, selectedSize } = useMemo(() => {
    if (!teraboxInfo) return { selectedCount: 0, selectedSize: 0 };
    const selected = teraboxInfo.list.filter(f => selectedFiles.has(f.fs_id) && !f.is_dir);
    const size = selected.reduce((acc, f) => acc + (f.size || 0), 0);
    return { selectedCount: selected.length, selectedSize: size };
  }, [teraboxInfo, selectedFiles]);

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

    try {
      const info = await getTeraboxInfo(url);
      if (info.ok) {
        setTeraboxInfo(info);
      } else {
        setError(info.error_message || "Failed to fetch file info. Please check the URL.");
      }
    } catch (err: any) {
      setError(typeof err === "string" ? err : err.message || JSON.stringify(err));
    } finally {
      setIsFetching(false);
    }
  }, [url]);

  const handleDownloadSelected = () => {
    if (!teraboxInfo) return;
    const filesToDownload = teraboxInfo.list.filter(f => selectedFiles.has(f.fs_id) && !f.is_dir);
    
    addToQueue(filesToDownload, {
      shareid: teraboxInfo.shareid,
      uk: teraboxInfo.uk,
      sign: teraboxInfo.sign,
      timestamp: teraboxInfo.timestamp,
      mode: downloadMode,
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

  const healthyCount = endpointStats.filter(e => e.healthy).length;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden select-none">
      
      {/* Impeccable Header Bar */}
      <header className="glass-panel border-b border-border/60 px-4 md:px-6 py-2.5 flex items-center justify-between shrink-0 z-30">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-3">
          <div className="relative group cursor-default">
            <img 
              src="/logo.svg" 
              alt="TeraLace Logo" 
              className="w-8 h-8 rounded-xl object-contain drop-shadow-[0_2px_8px_rgba(2,132,199,0.35)] transition-transform duration-300 group-hover:scale-105"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base md:text-lg tracking-tight bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 bg-clip-text text-transparent">
                TeraLace
              </span>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full font-mono font-medium">
                v1.0.15
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live Telemetry & API Pool Status Widget */}
        <div className="flex items-center gap-2.5">
          {/* Live Global Download Speed Indicator */}
          {totalSpeed > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-primary/10 text-primary border border-primary/25 animate-pulse shadow-sm shadow-primary/10">
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>{formatSpeed(totalSpeed)}</span>
            </div>
          )}

          {/* Endpoint Health Pill */}
          <div 
            onClick={() => { setShowSettings(true); setSettingsTab('api'); }}
            className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-muted/40 hover:bg-muted/80 cursor-pointer transition-all border border-border/60 hover:border-border"
            title="Click to inspect API endpoints"
          >
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                healthyCount > 0 ? "bg-emerald-400" : "bg-amber-400"
              )} />
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                healthyCount > 0 ? "bg-emerald-500" : "bg-amber-500"
              )} />
            </span>
            <span className="text-muted-foreground text-[11px]">API Pool:</span>
            <span className={healthyCount > 0 ? "text-emerald-500 font-semibold" : "text-amber-500 font-semibold"}>
              {healthyCount} Active
            </span>
          </div>
        </div>

        {/* Right Action Icons Group */}
        <div className="flex items-center gap-1.5">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => openDownloadDir(downloadDir || undefined)} 
            title="Open Download Folder"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>

          <ThemeToggle />

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowSettings(true)} 
            title="Settings & Config"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden border-b bg-card/60 backdrop-blur-sm text-xs font-medium shrink-0">
        <button
          onClick={() => setMobileTab('source')}
          className={cn(
            "flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-all",
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
          onClick={() => setMobileTab('queue')}
          className={cn(
            "flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-all",
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
          "col-span-12 md:col-span-5 lg:col-span-4 flex flex-col gap-3 md:gap-4 overflow-hidden",
          mobileTab !== 'source' && "hidden md:flex"
        )}>
          {/* Link Fetcher Card */}
          <Card className="shrink-0 border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-3 px-3.5 md:px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
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
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetch()}
                  />
                  <div className="absolute right-1 top-1 flex items-center gap-0.5">
                    {url ? (
                      <button 
                        onClick={() => setUrl("")}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                        title="Clear"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button 
                        onClick={handlePasteClipboard}
                        className="p-1.5 text-muted-foreground hover:text-primary rounded-md transition-colors"
                        title="Paste from clipboard"
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
                <div className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 flex items-start gap-2 animate-in fade-in duration-200">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1 whitespace-pre-line leading-relaxed text-[11px]">
                    {error}
                  </div>
                  <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* File Explorer Card */}
          <Card className="flex-1 flex flex-col overflow-hidden border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            <CardHeader className="py-2.5 px-3.5 md:px-4 border-b border-border/60 flex flex-row items-center justify-between shrink-0 bg-muted/20">
              <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                <span>Files {teraboxInfo && `(${teraboxInfo.list.length})`}</span>
              </CardTitle>
              {teraboxInfo && (
                <SelectAllButton 
                  files={teraboxInfo.list} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                />
              )}
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-2.5 md:p-3">
              {teraboxInfo ? (
                <FileList 
                  files={teraboxInfo.list} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                  onPreview={handlePreviewFile}
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
            <div className="p-3 border-t border-border/60 bg-muted/20 shrink-0">
              <Button 
                className="w-full h-9 font-medium shadow-sm transition-all" 
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
          "col-span-12 md:col-span-7 lg:col-span-8 flex flex-col overflow-hidden",
          mobileTab !== 'queue' && "hidden md:flex"
        )}>
          <Card className="h-full flex flex-col overflow-hidden border border-border/70 shadow-sm bg-card/70 backdrop-blur-sm">
            {/* Queue Header */}
            <CardHeader className="py-2.5 px-3.5 md:px-4 border-b border-border/60 flex flex-row items-center justify-between bg-muted/20 shrink-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
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
                  className="h-7 w-7 text-muted-foreground hover:text-emerald-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={clearAll} 
                  title="Clear All Tasks" 
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
                      onOpenFolder={() => openDownloadDir(item.downloadDir || undefined)}
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
              <div className="p-2.5 px-4 bg-muted/30 border-t border-border/60 text-[11px] text-muted-foreground flex items-center justify-between shrink-0 font-medium">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-background border border-border/80 rounded-2xl overflow-hidden w-full max-w-[820px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-3.5 px-4 border-b bg-card">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <Film className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-xs truncate">{previewMediaName}</span>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.2 rounded font-mono">
                  Live Stream
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setPreviewMediaUrl(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="bg-black flex items-center justify-center min-h-[320px] max-h-[75vh]">
              <video 
                src={previewMediaUrl} 
                controls 
                autoPlay 
                className="max-h-[75vh] w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-background border border-border/80 rounded-2xl shadow-2xl w-full max-w-[580px] max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5 bg-card/60">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" /> Settings & API Routing
              </h2>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={() => setShowSettings(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-border/60 bg-muted/20 px-5 gap-2 text-xs shrink-0">
              <button
                onClick={() => setSettingsTab('general')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-all flex items-center gap-1.5",
                  settingsTab === 'general' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <HardDrive className="h-3.5 w-3.5" /> General
              </button>
              <button
                onClick={() => setSettingsTab('api')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-all flex items-center gap-1.5",
                  settingsTab === 'api' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Server className="h-3.5 w-3.5" /> API Pool & Balancer
              </button>
              <button
                onClick={() => setSettingsTab('cookie')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-all flex items-center gap-1.5",
                  settingsTab === 'cookie' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Key className="h-3.5 w-3.5" /> TeraBox Cookie
              </button>
              <button
                onClick={() => setSettingsTab('about')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-all flex items-center gap-1.5",
                  settingsTab === 'about' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Info className="h-3.5 w-3.5" /> About
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              
              {/* TAB 1: GENERAL */}
              {settingsTab === 'general' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground">Download Destination</label>
                    <div className="flex gap-2">
                      <Input 
                        value={downloadDir} 
                        onChange={e => setDownloadDir(e.target.value)} 
                        placeholder="Default: Downloads/TeraBox"
                        className="flex-1 text-xs h-9 font-mono"
                      />
                      <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleBrowse}>
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Destination folder for downloaded files and parts.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground">Download Concurrency</label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer hover:bg-accent/40 transition-all text-center",
                        maxConcurrent === 1 ? "border-primary bg-primary/5 shadow-sm" : "border-border/60"
                      )}>
                        <input
                          type="radio"
                          className="hidden"
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
                          checked={maxConcurrent > 1}
                          onChange={() => setMaxConcurrent(3)}
                        />
                        <span className="font-semibold text-xs text-foreground">Parallel (Recommended)</span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">Up to 3 concurrent downloads</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-primary" /> Bandwidth Cap
                    </label>
                    <select
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
                </div>
              )}

              {/* TAB 2: API POOL (abdul97233 engine) */}
              {settingsTab === 'api' && (
                <div className="space-y-4">
                  <div className="p-3 bg-muted/30 rounded-xl text-xs space-y-1 border border-border/60">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-500" />
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
                        onClick={refreshStats}
                        className="text-[11px] text-primary hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" /> Refresh
                      </button>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {apiEndpoints.map(ep => {
                        const stat = endpointStats.find(s => s.id === ep.id);
                        const isCircuitOpen = stat?.circuit_open;
                        return (
                          <div 
                            key={ep.id} 
                            className="p-2.5 border border-border/60 rounded-xl flex items-center justify-between bg-card text-xs hover:border-border transition-colors"
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  !ep.enabled ? "bg-muted-foreground" :
                                  isCircuitOpen ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                                )} />
                                <span className="font-semibold truncate">{ep.name}</span>
                                {stat && stat.avg_latency_ms > 0 && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {stat.avg_latency_ms}ms
                                  </span>
                                )}
                                {isCircuitOpen && (
                                  <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded font-mono">
                                    Cooldown: {stat?.circuit_remaining_s}s
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate font-mono mt-0.5 opacity-80">
                                {ep.url}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant={ep.enabled ? "outline" : "ghost"} 
                                size="sm" 
                                className="h-7 text-[10px] px-2.5"
                                onClick={() => handleToggleEndpoint(ep.id)}
                              >
                                {ep.enabled ? "Active" : "Disabled"}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDeleteEndpoint(ep.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add New Endpoint */}
                  <div className="border-t border-border/60 pt-3 space-y-2">
                    <label className="font-semibold text-xs text-foreground">Add Custom Endpoint</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input 
                        placeholder="Provider Name (e.g. My NTM API)"
                        value={newEpName}
                        onChange={e => setNewEpName(e.target.value)}
                        className="text-xs h-8"
                      />
                      <Input 
                        placeholder="Auth Token (Optional)"
                        value={newEpToken}
                        onChange={e => setNewEpToken(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="Base URL: https://your-api.ntmterabox.me/"
                        value={newEpUrl}
                        onChange={e => setNewEpUrl(e.target.value)}
                        className="flex-1 text-xs h-8 font-mono"
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
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="font-medium text-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-primary" /> Personal TeraBox Session Cookie (<code className="text-xs font-mono">ndus</code>)
                    </label>
                    <div className="relative">
                      <Input 
                        value={teraboxCookie}
                        onChange={e => setTeraboxCookie(e.target.value)}
                        placeholder="ndus=Yxxxxxx... or raw token"
                        className="font-mono text-xs h-9 pr-8"
                      />
                      {teraboxCookie && (
                        <button 
                          onClick={() => setTeraboxCookie("")}
                          className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Optional: Paste your personal TeraBox session cookie. When remote endpoints fail, the direct scraper uses this cookie to bypass anonymous speed throttles and download private folders or files larger than 4GB.
                    </p>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-xl text-[11px] text-muted-foreground space-y-1.5 border border-border/60">
                    <p className="font-semibold text-foreground">How to get your ndus cookie:</p>
                    <p>1. Open <a href="https://www.terabox.app/" target="_blank" rel="noreferrer" className="text-primary hover:underline">terabox.app</a> in your browser and sign in.</p>
                    <p>2. Press <code>F12</code> (Inspect) &rarr; <strong>Application / Storage</strong> &rarr; <strong>Cookies</strong>.</p>
                    <p>3. Copy the value of the <code>ndus</code> cookie and paste it above.</p>
                  </div>
                </div>
              )}

              {/* TAB 4: ABOUT */}
              {settingsTab === 'about' && (
                <div className="space-y-4 py-1">
                  <div className="flex items-center gap-3 p-3 bg-muted/20 border border-border/60 rounded-xl">
                    <img src="/logo.svg" alt="TeraLace" className="w-10 h-10 rounded-xl" />
                    <div>
                      <h3 className="font-bold text-sm text-foreground">TeraLace</h3>
                      <p className="text-[11px] text-muted-foreground">Fast, resilient multiplatform TeraBox downloader</p>
                      <p className="text-[10px] text-primary font-mono font-medium mt-0.5">Version 1.0.15 (GPL-3.0)</p>
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
            <div className="flex justify-end p-3.5 px-5 border-t border-border/60 bg-muted/20 gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveSettings}>Save Changes</Button>
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
  onOpenFolder,
  onPreview
}: { 
  item: QueueItem, 
  isActive: boolean, 
  onRemove: () => void,
  onOpenFolder?: () => void,
  onPreview?: () => void
}) {
  const isVideo = item.file.file_type === 'video' || item.file.file_type === 'audio';

  return (
    <div className={cn(
      "p-3 md:p-3.5 flex items-center gap-3 transition-colors group select-none",
      isActive ? "bg-primary/5" : "hover:bg-accent/30",
      item.status === 'completed' && "opacity-90 bg-muted/10"
    )}>
      {/* Status Accent Bar */}
      <div className={cn(
        "w-1 h-10 rounded-full shrink-0 transition-colors",
        item.status === 'completed' ? "bg-emerald-500" :
        item.status === 'error' ? "bg-destructive" :
        isActive ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
      )} />
      
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
                className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFolder();
                }}
                title="Open Destination Folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            )}

            {isVideo && item.params.direct_link && onPreview && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                title="Instant Media Preview"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
              </Button>
            )}

            <span className={cn(
              "text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ml-1",
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
                className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Cancel Task"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        
        {/* Sleek Gradient Progress Bar */}
        <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full transition-all duration-300",
              item.status === 'error' ? "bg-destructive" : 
              item.status === 'completed' ? "bg-emerald-500" : 
              "bg-gradient-to-r from-sky-500 to-indigo-500"
            )}
            style={{ width: `${Math.min(item.progress, 100)}%` }}
          />
        </div>
        
        {/* Telemetry Row */}
        <div className="flex justify-between items-center mt-1 text-[11px] text-muted-foreground font-mono">
          <span>{formatBytes(item.downloaded)} / {formatBytes(item.total)}</span>
          
          <div className="flex items-center gap-2">
            {isActive && item.speed > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground/75">
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
          <p className="text-[10px] text-destructive mt-1 truncate" title={item.error}>
            {item.error}
          </p>
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
