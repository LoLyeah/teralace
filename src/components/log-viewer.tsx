import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  Copy, Check, Trash2, RefreshCw, Bug, 
  Search, Terminal, ArrowDown, Play, Pause
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { LogEntry } from "../lib/types";
import { 
  getAppLogs, clearAppLogs, setDebugLogMode, getDebugLogMode 
} from "../lib/api";

interface LogViewerProps {
  className?: string;
}

export function LogViewer({ className }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isDebugMode, setIsDebugMode] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(false);
  const [isLoggingActive, setIsLoggingActive] = useState<boolean>(() => {
    try {
      return localStorage.getItem("teralace_live_logs") === "true";
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef<boolean>(true);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    try {
      const entries = await getAppLogs(filterLevel === "ALL" ? undefined : filterLevel);
      if (isMountedRef.current) {
        setLogs(entries);
      }
    } catch (e) {
      console.error("Failed to load logs:", e);
    }
  }, [filterLevel]);

  // Initial debug mode check & conditional polling
  useEffect(() => {
    isMountedRef.current = true;
    getDebugLogMode().then(mode => {
      if (isMountedRef.current) setIsDebugMode(mode);
    }).catch(() => {});

    if (isLoggingActive) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 2000);
      return () => {
        isMountedRef.current = false;
        clearInterval(interval);
      };
    }
  }, [fetchLogs, isLoggingActive]);

  // Scroll to bottom on new logs if autoScroll (Follow) is explicitly enabled
  useEffect(() => {
    if (autoScroll && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleToggleLogging = () => {
    const nextState = !isLoggingActive;
    setIsLoggingActive(nextState);
    try {
      localStorage.setItem("teralace_live_logs", String(nextState));
    } catch {}
    if (nextState) {
      fetchLogs();
    }
  };

  const handleToggleDebug = async () => {
    const nextMode = !isDebugMode;
    setIsDebugMode(nextMode);
    try {
      await setDebugLogMode(nextMode);
      await fetchLogs();
    } catch (e) {
      console.error("Failed to set debug mode:", e);
    }
  };

  const handleClear = async () => {
    try {
      await clearAppLogs();
      setLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
  };

  const handleCopy = async () => {
    if (logs.length === 0) return;
    const formatted = logs.map(e => 
      `[${e.timestamp}] [${e.level}] [${e.target}] ${e.message}`
    ).join("\n");

    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy logs:", e);
    }
  };

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        e => e.message.toLowerCase().includes(q) || 
             e.target.toLowerCase().includes(q) || 
             e.level.toLowerCase().includes(q)
      );
    }
    return result;
  }, [logs, searchQuery]);

  return (
    <div className={cn("space-y-3 flex flex-col h-full", className)}>
      {/* Top Banner & Debug Mode Toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3 bg-muted/20 border border-border/60 rounded-xl shrink-0">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary shrink-0" />
            <h4 className="font-semibold text-xs text-foreground">Diagnostics & App Logs</h4>
            {isDebugMode && (
              <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.2 rounded font-mono font-medium">
                DEBUG MODE ON
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            View real-time engine activity, network responses, and CDN status codes.
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant={isLoggingActive ? "default" : "outline"}
            className={cn(
              "h-7 text-[11px] gap-1 px-2.5",
              isLoggingActive && "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
            onClick={handleToggleLogging}
            title={isLoggingActive ? "Pause live auto-refresh" : "Stream live logs"}
          >
            {isLoggingActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
            <span>{isLoggingActive ? "Auto-Refresh On" : "Auto-Refresh Off"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant={isDebugMode ? "default" : "outline"}
            disabled={!isLoggingActive}
            className={cn(
              "h-7 text-[11px] gap-1 px-2.5",
              isDebugMode && "bg-purple-600 hover:bg-purple-700 text-white"
            )}
            onClick={handleToggleDebug}
            title="Toggle verbose debug logging"
          >
            <Bug className="h-3.5 w-3.5" />
            <span>{isDebugMode ? "Verbose" : "Standard"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1 px-2.5"
            onClick={handleCopy}
            disabled={logs.length === 0}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? "Copied" : "Copy Logs"}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            disabled={!isLoggingActive}
            onClick={async () => {
              setIsRefreshing(true);
              await fetchLogs();
              setTimeout(() => setIsRefreshing(false), 400);
            }}
            title="Refresh logs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")} />
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            title="Clear all recorded logs"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Level Filters */}
        <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40 text-[11px]">
          {["ALL", "ERROR", "WARN", "INFO", "DEBUG"].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setFilterLevel(lvl)}
              className={cn(
                "px-2 py-0.5 rounded-md font-medium transition-colors",
                filterLevel === lvl
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* Search input and auto-scroll */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-[160px] justify-end">
          <div className="relative flex-1 sm:w-44">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="h-7 text-[11px] pl-7 pr-2 font-mono"
            />
          </div>

          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "h-7 px-2 rounded-md border text-[11px] flex items-center gap-1 transition-colors",
              autoScroll
                ? "bg-primary/10 border-primary/30 text-primary font-medium"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            )}
            title="Auto-scroll to latest log entries"
          >
            <ArrowDown className="h-3 w-3" />
            <span className="hidden sm:inline">Follow</span>
          </button>
        </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 min-h-[220px] max-h-[380px] bg-zinc-950 text-zinc-200 border border-border/80 rounded-xl p-3 font-mono text-[11px] leading-relaxed overflow-y-auto select-text shadow-inner">
        {!isLoggingActive ? (
          <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-zinc-500 space-y-2 select-none">
            <Terminal className="h-8 w-8 opacity-30 text-zinc-400" />
            <p className="text-xs font-semibold text-zinc-300">Live Auto-Refresh is Paused</p>
            <p className="text-[11px] text-zinc-500 max-w-sm text-center leading-relaxed">
              System diagnostics are continuously recorded in the background buffer. Live UI polling is paused to save battery and resources. Click below to view live logs.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 mt-2 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200"
              onClick={handleToggleLogging}
            >
              <Play className="h-3 w-3 text-emerald-400" />
              <span>Resume Live Stream</span>
            </Button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-zinc-500 space-y-1.5 select-none">
            <Terminal className="h-6 w-6 opacity-40" />
            <p className="text-xs">No log entries found</p>
            <p className="text-[10px]">
              {searchQuery ? "Try clearing your search query" : "Network and download diagnostics will stream here"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((entry, idx) => {
              const isErr = entry.level === "ERROR";
              const isWarn = entry.level === "WARN";
              const isInfo = entry.level === "INFO";
              const isDebug = entry.level === "DEBUG";

              return (
                <div 
                  key={`${entry.timestamp_ms}-${idx}`} 
                  className={cn(
                    "flex items-start gap-1.5 py-0.5 rounded px-1 transition-colors font-mono",
                    isErr && "bg-rose-950/30 text-rose-200",
                    isWarn && "bg-amber-950/20 text-amber-200",
                    !isErr && !isWarn && "hover:bg-zinc-900/60"
                  )}
                >
                  <span className="text-zinc-500 shrink-0 text-[10px] select-none">
                    {entry.timestamp}
                  </span>

                  <span className={cn(
                    "px-1 py-0.1 text-[9px] rounded font-bold shrink-0 uppercase tracking-wide",
                    isErr && "bg-rose-500/20 text-rose-400 border border-rose-500/30",
                    isWarn && "bg-amber-500/20 text-amber-400 border border-amber-500/30",
                    isInfo && "bg-sky-500/20 text-sky-400 border border-sky-500/30",
                    isDebug && "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  )}>
                    {entry.level}
                  </span>

                  <span className="text-zinc-400 text-[10px] shrink-0 font-medium">
                    [{entry.target.replace("teralace_lib::", "")}]
                  </span>

                  <span className="break-all flex-1 text-zinc-200">
                    {entry.message}
                  </span>
                </div>
              );
            })}
            <div ref={consoleBottomRef} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 shrink-0">
        <span>
          {isLoggingActive ? `Displaying ${filteredLogs.length} of ${logs.length} entries` : "Live logging is paused"}
        </span>
        <span className="font-mono text-[10px]">
          Status: {isLoggingActive ? (isDebugMode ? "VERBOSE" : "ACTIVE") : "OFF"}
        </span>
      </div>
    </div>
  );
}
