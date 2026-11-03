import { useState, useMemo } from "react";
import {
  Folder,
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
  Film
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
}

export function FileList({
  files,
  selectedFiles,
  onSelectionChange,
  onPreview,
}: FileListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

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

  if (files.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground text-xs">
        No files found in share link
      </div>
    );
  }

  const categories = [
    { id: "all", label: "All", count: categoryCounts.all },
    ...(categoryCounts.video ? [{ id: "video", label: "Videos", count: categoryCounts.video }] : []),
    ...(categoryCounts.image ? [{ id: "image", label: "Images", count: categoryCounts.image }] : []),
    ...(categoryCounts.archive ? [{ id: "archive", label: "Archives", count: categoryCounts.archive }] : []),
    ...(categoryCounts.audio ? [{ id: "audio", label: "Audio", count: categoryCounts.audio }] : []),
    ...(categoryCounts.document ? [{ id: "document", label: "Documents", count: categoryCounts.document }] : []),
  ];

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Search & Filter Bar (shown if file list is large or categories exist) */}
      {(files.length > 4 || categories.length > 2) && (
        <div className="space-y-2 pb-1 shrink-0">
          {files.length > 6 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search files..."
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
                    "px-2.5 py-0.5 rounded-full transition-all shrink-0 font-medium",
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
        {filteredFiles.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs">
            No files match your filter
          </div>
        ) : (
          filteredFiles.map((file) => (
            <FileItem
              key={file.fs_id}
              file={file}
              selectedFiles={selectedFiles}
              onSelectionChange={onSelectionChange}
              onPreview={onPreview}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface FileItemProps {
  file: TeraboxFileInfo;
  selectedFiles: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onPreview?: (file: TeraboxFileInfo) => void;
}

function FileItem({
  file,
  selectedFiles,
  onSelectionChange,
  onPreview,
}: FileItemProps) {
  const isSelected = selectedFiles.has(file.fs_id);
  const [thumbError, setThumbError] = useState(false);

  const toggleSelection = () => {
    if (file.is_dir) return;
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
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 text-amber-500" aria-hidden="true">
          <Folder className="h-4 w-4 fill-amber-500/20" />
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
      onClick={toggleSelection}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          toggleSelection();
        }
      }}
      tabIndex={file.is_dir ? -1 : 0}
      className={cn(
        "flex items-center gap-2.5 p-2 rounded-xl border transition-all text-xs group cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isSelected
          ? "bg-primary/10 border-primary/40 shadow-sm"
          : "bg-card/50 hover:bg-accent/40 border-border/60 hover:border-border"
      )}
    >
      {/* Checkbox button */}
      {!file.is_dir && (
        <div
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select ${file.name}`}
          className={cn(
            "flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0",
            isSelected
              ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/20"
              : "border-muted-foreground/30 group-hover:border-primary/60 bg-background/50"
          )}
        >
          {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
        </div>
      )}

      {/* Visual Icon / Thumbnail */}
      {renderIconOrThumb()}

      {/* Name & Details */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate text-foreground text-xs leading-snug">
            {file.name}
          </span>
          {getFileBadge()}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          {!file.is_dir && file.size ? (
            <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
          ) : (
            <span className="text-amber-500 font-medium">Folder</span>
          )}
        </div>
      </div>

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
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
        allSelected
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-muted/40 hover:bg-muted border-transparent text-muted-foreground hover:text-foreground"
      )}
      aria-label={allSelected ? "Deselect all files" : "Select all files"}
    >
      {allSelected ? (
        <>
          <CheckSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>Deselect All</span>
        </>
      ) : (
        <>
          <Square className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          <span>Select All</span>
        </>
      )}
    </button>
  );
}
