<p align="center">
  <img src="assets/logo.png" alt="Teralace Logo" width="130" />
</p>

<h1 align="center">Teralace</h1>

<p align="center">
  <strong>Fast, resilient, multiplatform TeraBox downloader powered by Tauri v2 &amp; Rust.</strong><br>
  Engineered for <strong>Windows</strong>, <strong>macOS</strong>, <strong>Linux</strong>, and <strong>Android</strong> with zero external dependencies.
</p>

<p align="center">
  <a href="https://github.com/LoLyeah/teralace/releases/latest"><img src="https://img.shields.io/github/v/release/LoLyeah/teralace?style=for-the-badge&color=0284c7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-38bdf8?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-orange?style=for-the-badge" alt="Backend" />
  <img src="https://img.shields.io/badge/Frontend-React%2018%20%2B%20Tailwind-61dafb?style=for-the-badge" alt="Frontend" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="Teralace Interface" width="800" />
</p>

---

## 📥 Downloads

Pre-compiled, release-ready packages for all platforms are available on the **[GitHub Releases Page](https://github.com/LoLyeah/teralace/releases/latest)**:

| Platform | Type | Format | Architecture | Download Link |
|:---|:---|:---|:---|:---|
| **Windows** | Standard Installer | Setup `.exe` | x86_64 | [**Setup `.exe`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Windows** | Portable Archive | `.zip` | x86_64 | [**Portable `.zip`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **macOS** | Universal Bundle | `.dmg` | Apple Silicon (`M1–M4`) & Intel (`x64`) | [**Universal `.dmg`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Linux** | Portable AppImage | `.AppImage` | x86_64 (`amd64`) | [**Portable `.AppImage`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Linux** | Debian / Ubuntu Package | `.deb` | x86_64 (`amd64`) | [**Native `.deb`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Android** | Signed Package | `.apk` | Universal (`ARM64` / `x86_64`) | [**Universal `.apk`**](https://github.com/LoLyeah/teralace/releases/latest) |

---

## ✨ Features & Highlights

### ⚡ Pure Rust Multi-Stream Download Engine
* **Concurrent Chunk Downloader:** Multi-threaded HTTP Range streaming that saturates network connections with parallel chunk chunking and auto-stitch.
* **Zero External Dependencies:** Built with pure asynchronous Rust (`tokio` + `reqwest`). No external `aria2c` binaries or Python wrappers required.
* **Instant Pause & Resume:** Full byte-accurate state persistence allowing downloads to pause, resume, or recover gracefully from drops.
* **Bandwidth Throttling:** Built-in speed limiters with customizable presets (512 KB/s, 1 MB/s, 2 MB/s, 5 MB/s, 10 MB/s, or Unlimited).

### 🛡️ Multi-Tier Resilient Resolution
* **Dynamic API Pool Load Balancer:** Round-robin balancing across multiple endpoints with automatic failover, active reachability probing, and a 120s circuit breaker for failing or rate-limited nodes.
* **Self-Hostable Cloudflare Worker:** Free, private serverless reverse-proxy script included in [`cloudflare-worker/`](./cloudflare-worker/README.md) for 100% resolver uptime.
* **WAP Direct Scraper Fallback:** High-speed mobile WAP scraper generating direct pre-signed download tokens when API pools are unavailable.
* **Deep Pagination:** Full pagination support for large folders and shares containing more than 20, 50, or 100+ files.
* **Recursive Folder Expansion:** Automatic recursive traversal into shared subdirectories.
* **50+ Domain Mirrors:** Universal regex normalizer resolving all TeraBox domains (`1024terabox.com`, `terabox.app`, `terasharelink.com`, `nephobox.com`, `4funbox.com`, `mirrobox.com`, etc.).

### 📱 Modern Multiplatform & Android Native Experience
* **One-Tap In-App Login (Desktop & Android):**
  - **Android:** Native fullscreen login dialog with a custom browser identity (bypasses Google's `403: disallowed_useragent` restriction). Automatically extracts the `HttpOnly` `ndus` session cookie via Android's native `CookieManager` the instant you sign in via Google, Email, or SMS—no DevTools or bookmarklets needed!
  - **Desktop:** Dedicated popup webview that listens for session tokens and auto-saves your credentials.
* **Android Background Power & Battery Resilience:**
  - **Ongoing Notification:** High-priority foreground notification keeps download jobs alive even when the app is in the background or the screen is locked.
  - **CPU Partial WakeLock:** Prevents Android deep sleep from terminating active network streams.
  - **Native Clipboard Bridge:** Zero-dependency Android clipboard reader for 1-tap paste of shared links and tokens.
  - **Clean Exit Option:** Header and Settings buttons to stop background workers, release locks, and completely exit the app on demand.
* **Material You Dynamic Theming & Vector Branding:**
  - Dynamic **Monet** wallpaper color extraction on Android 12+ and system accent synchronization on Windows/macOS.
  - Selectable curated palettes: *Dynamic Monet*, *Nordic Rose*, *Emerald*, *Sapphire*, *Amethyst*, and *Amber*.
  - Strict high-contrast Light and Dark mode theming.
* **Resilient Update Checker:** Multi-tier fallback system (HTTP redirect resolution + Fastly Atom feed) preventing GitHub API `403 Forbidden` rate-limit errors on shared networks.
* **In-App Diagnostic Log Viewer:** Integrated real-time ring buffer logger in Settings to view errors, trace requests, and diagnose network issues directly inside the app.
* **In-App Media Streaming:** Instant video and audio player preview before or during download.

---

## 🛠️ Development & Building

### Prerequisites
* **Node.js** v20+ & **npm**
* **Rust** stable (latest)
* **Android SDK & NDK** (for building Android APKs)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/LoLyeah/teralace.git
cd teralace

# Install dependencies
npm install

# Run Vite dev server (browser preview)
npm run dev

# Run Tauri desktop development (hot reload)
npm run tauri dev
```

### Production Compilation

```bash
# Windows Desktop (Installer & Portable)
npm run tauri build

# macOS Universal Binary (Apple Silicon + Intel)
npm run tauri build -- --target universal-apple-darwin

# Linux AppImage & Debian package
npm run tauri build -- --bundles appimage,deb

# Android Signed Release APK
npm run tauri android build --apk --target aarch64 --ci
```

---

## ⚙️ Configuration & Tips

### 1. Personal Session (`ndus` Cookie)
TeraBox restricts anonymous downloads for shared folders or large files (`31045: user not exists`). Providing your personal session cookie unlocks maximum speed and unrestricted private file access.

* **Option A (Recommended — One-Tap In-App Login):**
  1. Open **Settings** &rarr; **TeraBox Cookie**.
  2. Tap **Sign In with TeraBox**.
  3. Sign in using your Google account, Email/Password, or SMS.
  4. Once authenticated, Teralace automatically captures your `ndus` token, saves it, and displays a success notification. Works natively on both Desktop and Android!
* **Option B (Manual Input via Android Kiwi Browser / Cookie-Editor):**
  If you prefer not to use in-app login:
  1. Install **Kiwi Browser** from the Google Play Store (supports Chrome extensions).
  2. Install the **Cookie-Editor** extension from the Chrome Web Store in Kiwi.
  3. Open [terabox.app](https://www.terabox.app/), log in, tap `⋮` &rarr; **Cookie-Editor**, and copy the `ndus` cookie value.
  4. Return to Teralace Settings and tap **Paste**.
* **Option C (Manual Input via Desktop DevTools):**
  Open [TeraBox Web](https://www.terabox.app/) in your desktop browser, log in, press <kbd>F12</kbd> &rarr; **Application** &rarr; **Cookies**, copy the `ndus` value, and paste it into Teralace **Settings** &rarr; **TeraBox Cookie**.

---

### 2. Custom API Pool & Self-Hosted Cloudflare Worker
Teralace features an automatic round-robin balancer and circuit-breaker. When public endpoints are throttled, running your own private Cloudflare Worker gives you 100% uptime and dedicated extraction bandwidth for **free** (100,000 requests/day).

#### 🚀 2-Minute Web Dashboard Setup (No CLI Required):
1. **Create Worker:** Log into the [Cloudflare Dashboard](https://dash.cloudflare.com/) &rarr; navigate to **Compute (Workers)** &rarr; **Workers & Pages** &rarr; **Create Worker**.
2. **Name & Deploy:** Name it `teralace-resolver` and click **Deploy**.
3. **Paste Script:** Click **Edit Code** (Quick Edit), delete the default sample code, and paste the code from [`cloudflare-worker/worker.js`](./cloudflare-worker/worker.js) (or click **Copy worker.js Script** inside Teralace Settings). Click **Deploy**.
4. **Connect in Teralace:** Copy your worker URL (`https://teralace-resolver.<subdomain>.workers.dev/`), open Teralace **Settings** &rarr; **API Pool & Balancer**, paste it into **Base URL**, and click **+ Add**.

#### 🔑 Worker Variables (Settings &rarr; Variables and Secrets):
* `AUTH_TOKEN` *(Optional)*: Password-protect your worker from unauthorized public usage. Enter the same passphrase into Teralace's **Auth Token** field.
* `TERABOX_COOKIE` *(Optional)*: Pre-set your personal `ndus` cookie in the worker. The worker uses this server-side to inspect private shared folders and request direct download links on your behalf.

See [`cloudflare-worker/README.md`](./cloudflare-worker/README.md) for Wrangler CLI deployment and health checks.

---

## 📄 License & Acknowledgments

* **License:** Distributed under the **GNU General Public License v3.0 (GPL-3.0)**.
* **Core Inspirations:**
  * Fetch engine patterns inspired by [abdul97233/TeraBox-Downloader-Bot](https://github.com/abdul97233/TeraBox-Downloader-Bot).
  * UI foundation inspired by [aruxyz/trauso](https://github.com/aruxyz/trauso).
