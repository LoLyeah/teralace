import {
  File,
  Folder,
  Video,
  Image,
  FileArchive,
  Check,
  Play,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { TeraboxFileInfo } from "../lib/types";
import { formatBytes } from "../lib/api";

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
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-xs">
        No files found
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {files.map((file) => (
        <FileItem
          key={file.fs_id}
          file={file}
          selectedFiles={selectedFiles}
          onSelectionChange={onSelectionChange}
          onPreview={onPreview}
        />
      ))}
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

  const toggleSelection = () => {
    const newSelected = new Set(selectedFiles);
    if (isSelected) {
      newSelected.delete(file.fs_id);
    } else {
      newSelected.add(file.fs_id);
    }
    onSelectionChange(newSelected);
  };

  const getFileIcon = () => {
    if (file.is_dir) return <Folder className="h-4 w-4 text-yellow-500 shrink-0" />;

    switch (file.file_type) {
      case "video":
        return <Video className="h-4 w-4 text-blue-500 shrink-0" />;
      case "image":
        return <Image className="h-4 w-4 text-green-500 shrink-0" />;
      case "file":
      case "archive":
        return <FileArchive className="h-4 w-4 text-purple-500 shrink-0" />;
      default:
        return <File className="h-4 w-4 text-gray-500 shrink-0" />;
    }
  };

  const hasStreamPreview = file.file_type === "video" && file.direct_link && onPreview;

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 px-2.5 rounded-lg hover:bg-accent/60 transition-colors text-xs group",
        isSelected && "bg-accent"
      )}
    >
      <button
        onClick={toggleSelection}
        className={cn(
          "flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0",
          isSelected
            ? "bg-primary border-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary"
        )}
      >
        {isSelected && <Check className="h-2.5 w-2.5" />}
      </button>

      <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer" onClick={toggleSelection}>
        {getFileIcon()}
        <span className="flex-1 truncate">{file.name}</span>
        {!file.is_dir && file.size && (
          <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
            {formatBytes(file.size)}
          </span>
        )}
      </div>

      {hasStreamPreview && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview(file);
          }}
          className="p-1 hover:bg-primary/10 hover:text-primary rounded text-muted-foreground transition-colors shrink-0"
          title="Preview video stream"
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
  const allIds = files.map((file) => file.fs_id);
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
      onClick={toggleSelectAll}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors",
        allSelected
          ? "bg-primary text-primary-foreground"
          : "bg-muted/70 hover:bg-muted text-muted-foreground"
      )}
    >
      {allSelected ? "Deselect All" : "Select All"}
    </button>
  );
}
