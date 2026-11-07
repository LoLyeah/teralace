import { useState, useMemo, useEffect, useRef } from "react";
import {
  Folder,
  FolderOpen,
  FolderDown,
  FileDown,
  Video,
  Image,
  FileArchive,
  Music,
  FileText,
  Check,
  Play,
  Search,
  CheckSquare,
  Square,
  Film,
  ChevronRight,
  ArrowLeft,
  Home,
  Loader2,
  Copy,
  MoreHorizontal
} from "lucide-react";
import { cn } from "../lib/utils";
import type { TeraboxFileInfo } from "../lib/types";
import { formatBytes } from "../lib/api";
import { Input } from "./ui/input";

interface FileListProps {
  files: TeraboxFileInfo[];
  selectedFiles: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onPreview?: (file: TeraboxFileInfo) => void;
  onOpenFolder?: (folder: TeraboxFileInfo) => void;
  currentPath?: string;
  onNavigatePath?: (path: string) => void;
  isLoadingFolder?: boolean;
  onDownloadFolder?: (folder: TeraboxFileInfo) => void;
  onSelectFolder?: (folder: TeraboxFileInfo) => void;
  onDownloadFile?: (file: TeraboxFileInfo) => void;
}

export function FileList({
  files,
  selectedFiles,
  onSelectionChange,
  onPreview,
  onOpenFolder,
  currentPath,
  onNavigatePath,
  isLoadingFolder = false,
  onDownloadFolder,
  onSelectFolder,
  onDownloadFile,
}: FileListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  // Floating Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: TeraboxFileInfo;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleOpenContextMenu = (clientX: number, clientY: number, file: TeraboxFileInfo) => {
    const x = Math.min(clientX, window.innerWidth - 240);
    const y = Math.min(clientY, window.innerHeight - 260);
    setContextMenu({ x, y, file });
    setCopied(false);
  };

  // Parse path segments for breadcrumbs
  const breadcrumbSegments = useMemo(() => {
    if (!currentPath || !currentPath.trim() || currentPath === "/") {
      return [];
    }
    const clean = currentPath.startsWith("/") ? currentPath.slice(1) : currentPath;
    const parts = clean.split("/").filter(Boolean);
    let accum = "";
    return parts.map((part) => {
      accum += `/${part}`;
      return { name: part, path: accum };
    });
  }, [currentPath]);

  const parentPath = useMemo(() => {
    if (breadcrumbSegments.length <= 1) return "";
    return breadcrumbSegments[breadcrumbSegments.length - 2].path;
  }, [breadcrumbSegments]);

  // Group counts by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: files.length };
    files.forEach(f => {
      const cat = f.is_dir ? "folder" : (f.file_type || "file");
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [files]);

  // Filtered files
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const matchesSearch = !searchQuery.trim() || f.name.toLowerCase().includes(searchQuery.toLowerCase());
      const cat = f.is_dir ? "folder" : (f.file_type || "file");
      const matchesCategory = activeCategory === "all" || cat === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [files, searchQuery, activeCategory]);

  const categories = [
    { id: "all", label: "All", count: categoryCounts.all },
    ...(categoryCounts.folder ? [{ id: "folder", label: "Folders", count: categoryCounts.folder }] : []),
    ...(categoryCounts.video ? [{ id: "video", label: "Videos", count: categoryCounts.video }] : []),
    ...(categoryCounts.image ? [{ id: "image", label: "Images", count: categoryCounts.image }] : []),
    ...(categoryCounts.archive ? [{ id: "archive", label: "Archives", count: categoryCounts.archive }] : []),
    ...(categoryCounts.audio ? [{ id: "audio", label: "Audio", count: categoryCounts.audio }] : []),
    ...(categoryCounts.document ? [{ id: "document", label: "Documents", count: categoryCounts.document }] : []),
  ];

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Folder Navigation & Breadcrumb Bar */}
      {(breadcrumbSegments.length > 0 || onNavigatePath) && (
        <div className="flex items-center gap-1.5 p-1.5 px-2 bg-muted/40 rounded-xl border border-border/50 text-xs shrink-0 overflow-hidden">
          {breadcrumbSegments.length > 0 && onNavigatePath && (
            <button
              type="button"
              onClick={() => onNavigatePath(parentPath)}
              disabled={isLoadingFolder}
              className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors shrink-0 disabled:opacity-50"
              title="Go up one folder level"
              aria-label="Go up one level"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigatePath?.("")}
            disabled={isLoadingFolder}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors shrink-0 font-medium",
              breadcrumbSegments.length === 0
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Root folder"
          >
            <Home className="h-3 w-3" />
            <span>Root</span>
          </button>

          {breadcrumbSegments.map((seg, idx) => {
            const isLast = idx === breadcrumbSegments.length - 1;
            return (
              <div key={seg.path} className="flex items-center gap-1 min-w-0 shrink">
                <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <button
                  type="button"
                  onClick={() => onNavigatePath?.(seg.path)}
                  disabled={isLoadingFolder || isLast}
                  className={cn(
                    "truncate px-1.5 py-0.5 rounded-md transition-colors text-xs font-medium max-w-[120px]",
                    isLast
                      ? "text-primary bg-primary/10 font-semibold cursor-default"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={seg.name}
                >
                  {seg.name}
                </button>
              </div>
            );
          })}

          {isLoadingFolder && (
            <div className="ml-auto flex items-center gap-1.5 text-muted-foreground text-[11px] shrink-0 pr-1">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="hidden sm:inline">Loading...</span>
            </div>
          )}
        </div>
      )}

      {/* Search & Filter Bar (shown if file list is large or categories exist) */}
      {(files.length > 4 || categories.length > 2) && (
        <div className="space-y-2 pb-1 shrink-0">
          {files.length > 6 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search files and folders..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-8 text-xs pl-8 pr-3 bg-muted/30 focus-visible:ring-1"
                aria-label="Filter loaded files"
              />
            </div>
          )}

          {categories.length > 2 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]" role="tablist" aria-label="Filter files by type">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full transition-all duration-150 active:scale-95 shrink-0 font-medium",
                    activeCategory === cat.id
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cat.label} <span className="opacity-75 text-[10px] tabular-nums">({cat.count})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* File List Items */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-0.5" role="list" aria-label="Files list">
        {files.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-xs space-y-2">
            <p>This folder is empty</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs space-y-2">
            <p>No files match your search</p>
            {(searchQuery || activeCategory !== "all") && (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setActiveCategory("all"); }}
                className="text-primary hover:underline text-[11px] font-medium"
              >
                Reset filter
              </button>
            )}
          </div>
        ) : (
          filteredFiles.map((file) => (
            <FileItem
              key={file.fs_id}
              file={file}
              selectedFiles={selectedFiles}
              onSelectionChange={onSelectionChange}
              onPreview={onPreview}
              onOpenFolder={onOpenFolder}
              onOpenContextMenu={handleOpenContextMenu}
            />
          ))
        )}
      </div>

      {/* Floating Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 min-w-[210px] max-w-[280px] p-1.5 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-md text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-100 select-none text-xs"
          role="menu"
          aria-label="Item Actions"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-2 py-1.5 border-b border-border/50 mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold truncate text-[11px] text-foreground">
              {contextMenu.file.name}
            </span>
            <span className={cn(
              "text-[9px] px-1.5 py-0.2 rounded font-mono font-medium uppercase shrink-0",
              contextMenu.file.is_dir ? "bg-amber-500/15 text-amber-500" : "bg-primary/10 text-primary"
            )}>
              {contextMenu.file.is_dir ? "Folder" : contextMenu.file.file_type || "File"}
            </span>
          </div>

          {/* Folder Actions */}
          {contextMenu.file.is_dir ? (
            <>
              {onDownloadFolder && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onDownloadFolder(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-primary/15 hover:text-primary transition-colors text-xs font-medium group"
                >
                  <FolderDown className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground group-hover:text-primary font-medium">Download All in Folder</div>
                    <div className="text-[10px] text-muted-foreground">Queue all files recursively</div>
                  </div>
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenFolder?.(contextMenu.file);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-amber-500/15 hover:text-amber-500 transition-colors text-xs font-medium group"
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
                <div className="flex-1 min-w-0">
                  <div className="text-foreground group-hover:text-amber-500 font-medium">Open Folder</div>
                  <div className="text-[10px] text-muted-foreground">Browse folder contents</div>
                </div>
              </button>

              {onSelectFolder && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectFolder(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
                >
                  <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Select Files in Folder</span>
                </button>
              )}

              <div className="my-1 border-t border-border/50" />

              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  const p = contextMenu.file.path || contextMenu.file.name;
                  await navigator.clipboard.writeText(p);
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                    setContextMenu(null);
                  }, 600);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied Path!" : "Copy Folder Path"}</span>
              </button>
            </>
          ) : (
            /* File Actions */
            <>
              {onDownloadFile && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onDownloadFile(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-primary/15 hover:text-primary transition-colors text-xs font-medium group"
                >
                  <FileDown className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
                  <span>Download This File</span>
                </button>
              )}

              {(contextMenu.file.file_type === 'video' || contextMenu.file.file_type === 'audio') && contextMenu.file.direct_link && onPreview && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onPreview(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-primary/15 hover:text-primary transition-colors text-xs"
                >
                  <Play className="h-3.5 w-3.5 fill-current text-primary" />
                  <span>Stream Preview</span>
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const newSelected = new Set(selectedFiles);
                  if (selectedFiles.has(contextMenu.file.fs_id)) {
                    newSelected.delete(contextMenu.file.fs_id);
                  } else {
                    newSelected.add(contextMenu.file.fs_id);
                  }
                  onSelectionChange(newSelected);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span>{selectedFiles.has(contextMenu.file.fs_id) ? "Deselect File" : "Select File"}</span>
              </button>

              <div className="my-1 border-t border-border/50" />

              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await navigator.clipboard.writeText(contextMenu.file.name);
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                    setContextMenu(null);
                  }, 600);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied Name!" : "Copy File Name"}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface FileItemProps {
  file: TeraboxFileInfo;
  selectedFiles: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onPreview?: (file: TeraboxFileInfo) => void;
  onOpenFolder?: (folder: TeraboxFileInfo) => void;
  onOpenContextMenu?: (x: number, y: number, file: TeraboxFileInfo) => void;
}

function FileItem({
  file,
  selectedFiles,
  onSelectionChange,
  onPreview,
  onOpenFolder,
  onOpenContextMenu,
}: FileItemProps) {
  const isSelected = selectedFiles.has(file.fs_id);
  const [thumbError, setThumbError] = useState(false);

  const handleClick = () => {
    if (file.is_dir) {
      onOpenFolder?.(file);
      return;
    }
    const newSelected = new Set(selectedFiles);
    if (isSelected) {
      newSelected.delete(file.fs_id);
    } else {
      newSelected.add(file.fs_id);
    }
    onSelectionChange(newSelected);
  };

  const getFileBadge = () => {
    const ext = file.name.split('.').pop()?.toUpperCase() || "";
    if (file.is_dir) return null;
    return (
      <span className={cn(
        "text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold uppercase tracking-wider shrink-0",
        file.file_type === 'video' ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" :
        file.file_type === 'image' ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
        file.file_type === 'archive' ? "bg-purple-500/10 text-purple-500 border border-purple-500/20" :
        file.file_type === 'audio' ? "bg-rose-500/10 text-rose-500 border border-rose-500/20" :
        "bg-muted text-muted-foreground"
      )}>
        {ext.length <= 4 ? ext : file.file_type}
      </span>
    );
  };

  const renderIconOrThumb = () => {
    if (file.thumb && !thumbError) {
      return (
        <div className="w-8 h-8 rounded bg-muted/60 overflow-hidden shrink-0 relative group-hover:ring-1 group-hover:ring-primary/40 transition-all">
          <img
            src={file.thumb}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
            loading="lazy"
          />
          {file.file_type === 'video' && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center" aria-hidden="true">
              <Film className="h-3 w-3 text-white/90" />
            </div>
          )}
        </div>
      );
    }

    if (file.is_dir) {
      return (
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 text-amber-500 group-hover:scale-105 transition-transform" aria-hidden="true">
          <Folder className="h-4 w-4 fill-amber-500/30 text-amber-500" />
        </div>
      );
    }

    switch (file.file_type) {
      case "video":
        return (
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 text-blue-500" aria-hidden="true">
            <Video className="h-4 w-4" />
          </div>
        );
      case "image":
        return (
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 text-emerald-500" aria-hidden="true">
            <Image className="h-4 w-4" />
          </div>
        );
      case "archive":
        return (
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 text-purple-500" aria-hidden="true">
            <FileArchive className="h-4 w-4" />
          </div>
        );
      case "audio":
        return (
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0 text-rose-500" aria-hidden="true">
            <Music className="h-4 w-4" />
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground" aria-hidden="true">
            <FileText className="h-4 w-4" />
          </div>
        );
    }
  };

  const hasStreamPreview = (file.file_type === "video" || file.file_type === "audio") && file.direct_link && onPreview;

  return (
    <div
      role="listitem"
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu?.(e.clientX, e.clientY, file);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          handleClick();
        }
      }}
      tabIndex={0}
      className={cn(
        "flex items-center gap-2.5 p-2 sm:p-2.5 min-h-[48px] rounded-xl border transition-all text-xs group cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        file.is_dir
          ? "bg-card/60 hover:bg-amber-500/5 border-border/60 hover:border-amber-500/30"
          : isSelected
          ? "bg-primary/10 border-primary/40 shadow-sm"
          : "bg-card/50 hover:bg-accent/40 border-border/60 hover:border-border"
      )}
    >
      {/* Checkbox button (files only) */}
      {!file.is_dir && (
        <div
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select ${file.name}`}
          className={cn(
            "flex items-center justify-center w-4 h-4 rounded border transition-all duration-150 ease-out-expo shrink-0",
            isSelected
              ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/20 scale-100"
              : "border-muted-foreground/30 group-hover:border-primary/60 bg-background/50 hover:scale-105"
          )}
        >
          <Check className={cn(
            "h-2.5 w-2.5 stroke-[3] transition-all duration-150 ease-out-expo",
            isSelected ? "scale-100 opacity-100" : "scale-50 opacity-0"
          )} />
        </div>
      )}

      {/* Visual Icon / Thumbnail */}
      {renderIconOrThumb()}

      {/* Name & Details */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "font-medium truncate text-foreground text-xs leading-snug",
            file.is_dir && "group-hover:text-amber-500 transition-colors"
          )}>
            {file.name}
          </span>
          {getFileBadge()}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          {!file.is_dir && file.size ? (
            <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
          ) : (
            <span className="text-amber-500/90 font-medium">Folder</span>
          )}
        </div>
      </div>

      {/* Folder Open Action Badge */}
      {file.is_dir && (
        <div className="flex items-center gap-1 text-[11px] text-amber-500/80 group-hover:text-amber-500 font-medium px-2 py-0.5 rounded-lg bg-amber-500/10 group-hover:bg-amber-500/20 transition-all shrink-0">
          <span>Open</span>
          <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      )}

      {/* Instant Video/Audio Stream Preview Button */}
      {hasStreamPreview && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(file);
          }}
          className="p-1.5 hover:bg-primary/15 text-muted-foreground hover:text-primary rounded-lg transition-colors shrink-0 opacity-80 group-hover:opacity-100 min-h-[32px] min-w-[32px] flex items-center justify-center"
          title={`Preview ${file.name}`}
          aria-label={`Instant media stream preview for ${file.name}`}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      )}

      {/* More Options / Context Menu Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onOpenContextMenu?.(rect.left, rect.bottom + 4, file);
        }}
        className="p-1 hover:bg-muted text-muted-foreground/60 hover:text-foreground rounded-lg transition-colors shrink-0 opacity-70 group-hover:opacity-100 min-h-[28px] min-w-[28px] flex items-center justify-center"
        title="More options"
        aria-label={`Options for ${file.name}`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SelectAllButton({
  files,
  selectedFiles,
  onSelectionChange,
}: FileListProps) {
  const selectableFiles = files.filter(f => !f.is_dir);
  const allIds = selectableFiles.map((file) => file.fs_id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedFiles.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  };

  return (
    <button
      type="button"
      onClick={toggleSelectAll}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150 active:scale-95 border",
        allSelected
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-muted/40 hover:bg-muted border-transparent text-muted-foreground hover:text-foreground"
      )}
      aria-label={allSelected ? "Deselect all files" : "Select all files"}
    >
      {allSelected ? (
        <>
          <CheckSquare className="h-3.5 w-3.5 text-primary transition-transform duration-150 scale-100" aria-hidden="true" />
          <span>Deselect All</span>
        </>
      ) : (
        <>
          <Square className="h-3.5 w-3.5 opacity-60 transition-transform duration-150 scale-100" aria-hidden="true" />
          <span>Select All</span>
        </>
      )}
    </button>
  );
}
