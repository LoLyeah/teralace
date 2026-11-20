import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Detects whether the application is running on an Android device or WebView
 */
export const isAndroid = typeof navigator !== "undefined" && (
  /android/i.test(navigator.userAgent) ||
  (typeof window !== "undefined" && Boolean(
    (window as any).AndroidLogin ||
    (window as any).AndroidClipboard ||
    (window as any).AndroidOpener ||
    (window as any).AndroidTheme
  ))
);

/**
 * Extracts relative directory hierarchy from a file's source path.
 * e.g., "/Root_Folder/Sub_Folder/file.ext" -> "Root_Folder/Sub_Folder"
 *       "/file.ext" -> ""
 */
export function extractFileSubpath(file: { path?: string | null; name: string }): string {
  if (!file.path) return "";
  const normalized = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return normalized.substring(0, lastSlash);
}
 