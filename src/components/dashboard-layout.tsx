import { open } from "@tauri-apps/plugin-dialog";
import { useState, useCallback, useEffect } from "react";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { 
  Loader2, Link, FileDown, Trash2, Play, Pause, FolderOpen, 
  Settings, X, ListX, Gauge, ShieldCheck, Plus, Activity, Server, Key
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { FileList, SelectAllButton } from "./file-list";
import { 
  getTeraboxInfo, formatBytes, stopAria2, setBandwidthLimit, 
  getBandwidthLimit, getEndpointStats, saveApiEndpoints, openDownloadDir 
} from "../lib/api";
import { loadSettings, saveSettings, DEFAULT_ENDPOINTS } from "../lib/settings";
import { 
  TeraboxInfo, TeraboxFileInfo, BANDWIDTH_PRESETS, 
  ApiEndpointConfig, EndpointHealthInfo 
} from "../lib/types";
import { useDownloadQueue, QueueItem } from "../hooks/use-download-queue";
import { cn } from "../lib/utils";

export function DashboardLayout() {
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teraboxInfo, setTeraboxInfo] = useState<TeraboxInfo | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloadDir, setDownloadDir] = useState("");
  const [downloadMode, setDownloadMode] = useState(2);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'api' | 'cookie'>('general');
  const [mobileTab, setMobileTab] = useState<'source' | 'queue'>('source');
  const [maxOverallLimit, setMaxOverallLimit] = useState(0);
  const [maxDownloadLimit, setMaxDownloadLimit] = useState(0);

  // Video Preview Modal
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
        setError(info.error_message || "Failed to fetch file info");
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="border-b px-4 md:px-6 py-3 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-2.5">
          <img 
            src="/logo.svg" 
            alt="TeraLace Logo" 
            className="w-8 h-8 rounded-lg shadow-sm object-contain"
          />
          <div>
            <h1 className="font-bold text-lg md:text-xl leading-tight tracking-tight flex items-center gap-1.5">
              TeraLace <span className="text-primary font-medium text-xs md:text-sm bg-primary/10 px-2 py-0.5 rounded-full">Multiplatform</span>
            </h1>
          </div>
        </div>

        {/* Center: Endpoint Health Status Pill */}
        <div 
          onClick={() => { setShowSettings(true); setSettingsTab('api'); }}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted cursor-pointer transition-colors border"
          title="Click to manage API endpoints"
        >
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>API Pool:</span>
          <span className={healthyCount > 0 ? "text-green-500 font-semibold" : "text-amber-500 font-semibold"}>
            {healthyCount} Active
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => openDownloadDir(downloadDir || undefined)} 
            title="Open Download Folder"
          >
            <FolderOpen className="h-5 w-5 text-muted-foreground hover:text-foreground" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} title="Settings">
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden border-b bg-card text-sm">
        <button
          onClick={() => setMobileTab('source')}
          className={cn(
            "flex-1 py-2.5 font-medium text-center border-b-2 transition-colors",
            mobileTab === 'source' ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
        >
          Fetch & Files {teraboxInfo && `(${teraboxInfo.list.length})`}
        </button>
        <button
          onClick={() => setMobileTab('queue')}
          className={cn(
            "flex-1 py-2.5 font-medium text-center border-b-2 transition-colors",
            mobileTab === 'queue' ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
        >
          Queue ({queue.length})
        </button>
      </div>

      {/* Main Content Grid */}
      <main className="flex-1 grid grid-cols-12 gap-4 md:gap-6 p-4 md:p-6 overflow-hidden">
        
        {/* Left Column: Source & File List */}
        <div className={cn(
          "col-span-12 md:col-span-5 lg:col-span-4 flex flex-col gap-4 overflow-hidden",
          mobileTab !== 'source' && "hidden md:flex"
        )}>
          {/* Fetch Card */}
          <Card className="shrink-0 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  TeraBox Link
                </CardTitle>
                {teraboxInfo?.resolved_by && (
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    via {teraboxInfo.resolved_by}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="https://1024terabox.com/s/..." 
                    className="pl-9 text-sm"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFetch()}
                  />
                </div>
                <Button onClick={handleFetch} disabled={isFetching || !url.trim()} size="sm" className="px-4">
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                </Button>
              </div>
              {error && (
                <div className="mt-2 text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20 whitespace-pre-line">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* File List Card */}
          <Card className="flex-1 flex flex-col overflow-hidden shadow-sm">
            <CardHeader className="py-2.5 px-4 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Files {teraboxInfo && `(${teraboxInfo.list.length})`}
              </CardTitle>
              {teraboxInfo && (
                <SelectAllButton 
                  files={teraboxInfo.list} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                />
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-2">
              {teraboxInfo ? (
                <FileList 
                  files={teraboxInfo.list} 
                  selectedFiles={selectedFiles} 
                  onSelectionChange={setSelectedFiles} 
                  onPreview={handlePreviewFile}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 p-6 text-center">
                  <FolderOpen className="h-10 w-10 mb-2 opacity-60" />
                  <p className="text-sm font-medium">No files loaded</p>
                  <p className="text-xs">Paste a TeraBox link above and tap Fetch</p>
                </div>
              )}
            </CardContent>
            <div className="p-3 border-t bg-muted/20">
              <Button 
                className="w-full" 
                onClick={handleDownloadSelected}
                disabled={selectedFiles.size === 0}
              >
                <FileDown className="mr-2 h-4 w-4" />
                Download Selected ({selectedFiles.size})
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Download Queue */}
        <div className={cn(
          "col-span-12 md:col-span-7 lg:col-span-8 flex flex-col overflow-hidden",
          mobileTab !== 'queue' && "hidden md:flex"
        )}>
          <Card className="h-full flex flex-col overflow-hidden border shadow-sm">
            <CardHeader className="py-2.5 px-4 border-b flex flex-row items-center justify-between bg-muted/10">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider">
                  Download Queue
                </CardTitle>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                  {queue.length}
                </span>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  ({maxConcurrent === 1 ? 'Sequential' : `Parallel: ${maxConcurrent}`})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={isProcessing ? pauseQueue : startQueue}
                  disabled={queue.length === 0}
                  className="mr-1 h-8 text-xs"
                >
                  {isProcessing ? (
                    <><Pause className="mr-1.5 h-3.5 w-3.5" /> Pause</>
                  ) : (
                    <><Play className="mr-1.5 h-3.5 w-3.5" /> Start</>
                  )}
                </Button>
                <Button variant="ghost" size="icon" onClick={clearCompleted} title="Clear Completed" className="h-8 w-8">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-green-600" />
                </Button>
                <Button variant="ghost" size="icon" onClick={clearAll} title="Clear All" className="h-8 w-8">
                  <ListX className="h-4 w-4 text-muted-foreground hover:text-red-600" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-40 p-6 text-center">
                  <FileDown className="h-12 w-12 mb-3" />
                  <p className="text-base font-medium">Queue is empty</p>
                  <p className="text-xs">Select files to start high-speed chunked downloads</p>
                </div>
              ) : (
                <div className="divide-y">
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
            {/* Footer Stats */}
            {queue.length > 0 && (
              <div className="p-2.5 px-4 bg-muted/20 border-t text-xs text-muted-foreground flex justify-between">
                <span>{queue.filter(i => i.status === 'completed').length} Completed</span>
                <span>{queue.filter(i => i.status === 'downloading').length} Downloading</span>
                <span>{queue.filter(i => i.status === 'pending').length} Pending</span>
              </div>
            )}
          </Card>
        </div>

      </main>

      {/* Video Stream Preview Modal */}
      {previewMediaUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-background border rounded-xl overflow-hidden w-full max-w-[800px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-3 px-4 border-b bg-card">
              <span className="font-medium text-xs truncate max-w-[600px]">{previewMediaName}</span>
              <Button variant="ghost" size="icon" onClick={() => setPreviewMediaUrl(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="bg-black flex items-center justify-center min-h-[300px] max-h-[70vh]">
              <video 
                src={previewMediaUrl} 
                controls 
                autoPlay 
                className="max-h-[70vh] w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border rounded-xl shadow-xl w-full max-w-[560px] max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" /> Settings & API Routing
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b bg-muted/30 px-6 gap-2 text-sm">
              <button
                onClick={() => setSettingsTab('general')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-colors",
                  settingsTab === 'general' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                General
              </button>
              <button
                onClick={() => setSettingsTab('api')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5",
                  settingsTab === 'api' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Server className="h-3.5 w-3.5" /> API Pool & Balancer
              </button>
              <button
                onClick={() => setSettingsTab('cookie')}
                className={cn(
                  "py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5",
                  settingsTab === 'cookie' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Key className="h-3.5 w-3.5" /> TeraBox Cookie
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
              
              {/* TAB 1: GENERAL */}
              {settingsTab === 'general' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="font-medium">Download Destination</label>
                    <div className="flex gap-2">
                      <Input 
                        value={downloadDir} 
                        onChange={e => setDownloadDir(e.target.value)} 
                        placeholder="Default: Downloads/TeraBox"
                        className="flex-1 text-xs"
                      />
                      <Button variant="outline" size="icon" onClick={handleBrowse}>
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Target folder for downloaded files.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium">Parallel Downloads</label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer hover:bg-accent transition-all text-center",
                        maxConcurrent === 1 && "border-primary bg-primary/5"
                      )}>
                        <input
                          type="radio"
                          className="hidden"
                          checked={maxConcurrent === 1}
                          onChange={() => setMaxConcurrent(1)}
                        />
                        <span className="font-medium">Sequential</span>
                        <span className="text-[11px] text-muted-foreground">1 file at a time</span>
                      </label>
                      <label className={cn(
                        "flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer hover:bg-accent transition-all text-center",
                        maxConcurrent > 1 && "border-primary bg-primary/5"
                      )}>
                        <input
                          type="radio"
                          className="hidden"
                          checked={maxConcurrent > 1}
                          onChange={() => setMaxConcurrent(3)}
                        />
                        <span className="font-medium">Parallel</span>
                        <span className="text-[11px] text-muted-foreground">Up to 3 concurrent files</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium flex items-center gap-2">
                      <Gauge className="h-4 w-4" /> Bandwidth Cap
                    </label>
                    <select
                      className="w-full p-2 rounded-lg border bg-background hover:bg-accent transition-all text-xs"
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
                  <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1 border">
                    <p className="font-medium text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-green-500" />
                      Dynamic Load Balancer & Circuit Breaker
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      Requests rotate round-robin across healthy endpoints. If an API returns errors 5 times, 
                      the circuit breaker trips and auto-cools for 120 seconds.
                    </p>
                  </div>

                  {/* Endpoints List */}
                  <div className="space-y-2">
                    <label className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
                      Configured Endpoints ({apiEndpoints.length})
                    </label>
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {apiEndpoints.map(ep => {
                        const stat = endpointStats.find(s => s.id === ep.id);
                        const isCircuitOpen = stat?.circuit_open;
                        return (
                          <div 
                            key={ep.id} 
                            className="p-2.5 border rounded-lg flex items-center justify-between bg-card text-xs"
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  !ep.enabled ? "bg-muted-foreground" :
                                  isCircuitOpen ? "bg-amber-500 animate-pulse" : "bg-green-500"
                                )} />
                                <span className="font-medium truncate">{ep.name}</span>
                                {isCircuitOpen && (
                                  <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded">
                                    Cooldown: {stat?.circuit_remaining_s}s
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
                                {ep.url}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant={ep.enabled ? "outline" : "ghost"} 
                                size="sm" 
                                className="h-7 text-[10px] px-2"
                                onClick={() => handleToggleEndpoint(ep.id)}
                              >
                                {ep.enabled ? "Active" : "Disabled"}
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-muted-foreground hover:text-red-500"
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
                  <div className="border-t pt-3 space-y-2">
                    <label className="font-medium text-xs">Add Custom API Endpoint</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input 
                        placeholder="Provider Name (e.g. My NTM API)"
                        value={newEpName}
                        onChange={e => setNewEpName(e.target.value)}
                        className="text-xs"
                      />
                      <Input 
                        placeholder="Auth Token / Secret (Optional)"
                        value={newEpToken}
                        onChange={e => setNewEpToken(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="Base URL: https://your-api.ntmterabox.me/"
                        value={newEpUrl}
                        onChange={e => setNewEpUrl(e.target.value)}
                        className="flex-1 text-xs"
                      />
                      <Button size="sm" onClick={handleAddEndpoint} disabled={!newEpName || !newEpUrl}>
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
                    <label className="font-medium flex items-center gap-1.5">
                      <Key className="h-4 w-4 text-primary" /> Personal TeraBox Session Cookie (<code className="text-xs">ndus</code>)
                    </label>
                    <Input 
                      value={teraboxCookie}
                      onChange={e => setTeraboxCookie(e.target.value)}
                      placeholder="ndus=Yxxxxxx..."
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Optional: Paste your personal TeraBox session cookie. When remote endpoints fail, the direct scraper uses this cookie to bypass anonymous speed throttles and download private folders or files larger than 4GB.
                    </p>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg text-[11px] text-muted-foreground space-y-1 border">
                    <p className="font-semibold text-foreground">How to get your ndus cookie:</p>
                    <p>1. Open terabox.com in your browser and sign in.</p>
                    <p>2. Press F12 (Inspect) &rarr; Application / Storage &rarr; Cookies &rarr; terabox.com.</p>
                    <p>3. Copy the value of the <code>ndus</code> cookie and paste it above.</p>
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="flex justify-end p-4 border-t bg-muted/10 gap-2">
              <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button onClick={handleSaveSettings}>Save Settings</Button>
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
  const isVideo = item.file.file_type === 'video';

  return (
    <div className={cn(
      "p-3 md:p-4 flex items-center gap-3 transition-colors group",
      isActive ? "bg-primary/5" : "hover:bg-accent/40",
      item.status === 'completed' && "opacity-85 bg-muted/20"
    )}>
      <div className={cn(
        "w-1.5 h-10 rounded-full shrink-0",
        item.status === 'completed' ? "bg-green-500" :
        item.status === 'error' ? "bg-red-500" :
        isActive ? "bg-primary animate-pulse" : "bg-muted"
      )} />
      
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1">
          <span className="font-medium text-xs md:text-sm truncate pr-2">{item.file.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.status === 'completed' && onOpenFolder && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFolder();
                }}
                title="Open Folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            )}

            {isVideo && item.params.direct_link && onPreview && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                title="Preview Video"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}

            <span className="text-[11px] font-mono text-muted-foreground ml-1">
              {getStatusText(item)}
            </span>

            {item.status !== 'completed' && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-muted-foreground hover:text-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full transition-all duration-300",
              item.status === 'error' ? "bg-red-500" : 
              item.status === 'completed' ? "bg-green-500" : "bg-primary"
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        
        <div className="flex justify-between mt-1 text-[11px] text-muted-foreground">
          <span>{formatBytes(item.downloaded)} / {formatBytes(item.total)}</span>
          {isActive && <span className="font-mono text-primary font-medium">{formatBytes(item.speed)}/s</span>}
        </div>
        
        {item.error && (
          <p className="text-[11px] text-red-500 mt-1 truncate">{item.error}</p>
        )}
      </div>
    </div>
  );
}

function getStatusText(item: QueueItem) {
  switch (item.status) {
    case 'pending': return 'Waiting';
    case 'fetching_link': return 'Connecting...';
    case 'downloading': return `${item.progress.toFixed(1)}%`;
    case 'completed': return 'Completed';
    case 'error': return 'Failed';
    case 'cancelled': return 'Cancelled';
  }
}
