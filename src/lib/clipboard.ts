/**
 * Cross-platform clipboard text reader supporting Desktop and Android WebView
 */
export async function readClipboardText(): Promise<string> {
  // 1. Android Native JavascriptInterface bridge (injected into MainActivity)
  if (
    typeof window !== "undefined" &&
    (window as any).AndroidClipboard &&
    typeof (window as any).AndroidClipboard.readText === "function"
  ) {
    try {
      const text = (window as any).AndroidClipboard.readText();
      if (text && typeof text === "string" && text.trim()) {
        return text.trim();
      }
    } catch (e) {
      console.warn("Android native clipboard bridge read failed:", e);
    }
  }

  // 2. Standard Web Async Clipboard API (Desktop & modern browsers)
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.readText === "function"
  ) {
    try {
      const text = await navigator.clipboard.readText();
      if (text && typeof text === "string" && text.trim()) {
        return text.trim();
      }
    } catch (e) {
      console.warn("Web Clipboard API readText failed:", e);
    }
  }

  return "";
}
