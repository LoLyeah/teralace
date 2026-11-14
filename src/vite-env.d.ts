/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  AndroidLogin?: {
    openLoginDialog: () => void;
    closeLoginDialog?: () => void;
  };
  AndroidClipboard?: {
    readText: () => string;
    hasText: () => boolean;
  };
  AndroidOpener?: {
    openFolder: (path: string) => void;
    openFile: (path: string) => void;
    scanFile: (path: string) => void;
    areNotificationsEnabled: () => boolean;
    openNotificationSettings: () => void;
  };
  AndroidTheme?: {
    getMonetColors: () => string;
  };
  onTeraboxCookieCaptured?: (cookie: string) => void;
  onTeraboxLoginDismissed?: () => void;
}
