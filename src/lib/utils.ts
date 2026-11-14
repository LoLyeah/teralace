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
 