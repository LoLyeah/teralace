<p align="center">
  <img src="assets/logo.png" alt="TeraLace Logo" width="130" />
</p>

<h1 align="center">TeraLace</h1>

<p align="center">
  <strong>Fast, resilient, multiplatform TeraBox downloader powered by Tauri v2 &amp; Rust.</strong><br>
  Engineered for <strong>Windows</strong>, <strong>macOS</strong>, and <strong>Android</strong> with zero external dependencies.
</p>

<p align="center">
  <a href="https://github.com/LoLyeah/teralace/releases/latest"><img src="https://img.shields.io/github/v/release/LoLyeah/teralace?style=for-the-badge&color=0284c7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Android-38bdf8?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-orange?style=for-the-badge" alt="Backend" />
  <img src="https://img.shields.io/badge/Frontend-React%2018%20%2B%20Tailwind-61dafb?style=for-the-badge" alt="Frontend" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=for-the-badge" alt="License" />
</p>

---

## 📥 Downloads

Pre-compiled, release-ready packages for all platforms are available on the **[GitHub Releases Page](https://github.com/LoLyeah/teralace/releases/latest)**:

| Platform | Type | Format | Architecture | Download Link |
|:---|:---|:---|:---|:---|
| **Windows** | **Portable (Zero-Install)** | Standalone `.exe` / `.zip` | x86_64 | [**TeraLace_portable.exe**](https://github.com/LoLyeah/teralace/releases/latest) &bull; [`.zip`](https://github.com/LoLyeah/teralace/releases/latest) |
| **Windows** | Standard Installer | Setup `.exe` / `.msi` | x86_64 | [Setup `.exe`](https://github.com/LoLyeah/teralace/releases/latest) &bull; [MSI Installer](https://github.com/LoLyeah/teralace/releases/latest) |
| **macOS** | Universal Bundle | `.dmg` / `.app.tar.gz` | Apple Silicon (`M1–M4`) & Intel (`x64`) | [**Universal `.dmg`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Android** | Signed Package | `.apk` | ARM64 (`arm64-v8a`) | [**TeraLace.apk**](https://github.com/LoLyeah/teralace/releases/latest) |

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

### 📱 Modern Multiplatform Experience
* **Desktop & Mobile Optimized:** Responsive layout with desktop controls (folder opener, window controls, background downloads) and dedicated touch-friendly tabs on Android.
* **One-Tap In-App Login:** Native sign-in popup that auto-captures and saves your TeraBox `ndus` session cookie without requiring browser DevTools.
* **In-App Diagnostic Log Viewer:** Integrated real-time ring buffer logger in Settings to view errors, trace requests, and diagnose network issues directly inside the app.
* **In-App Media Streaming:** Instant video and audio player preview before or during download.
* **Android 17 Material You Vector Branding & Tonal Themes:** Pure geometric circle & piercing arrow branding engineered with safe-zone compliance, seamless dynamic monochrome theming, and 6 selectable Material 3 tonal color palettes (Glacier Sky, Warm Sand, Mineral Sage, Dusty Lavender, Terracotta Clay, and Frosted Pearl).
* **Private Downloads & Speed Unlock:** Personal `ndus` session cookie support to bypass guest bandwidth limits and fetch private shared folders.

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

# Android Signed Release APK
npm run tauri android build --apk --target aarch64 --ci
```

---

## ⚙️ Configuration & Tips

### 1. Personal Session (`ndus` Cookie)
TeraBox blocks anonymous downloads for shared folders or large files (`31045: user not exists`). To enable high-speed downloads:
* **Option A (One-Tap In-App):** Open **Settings** &rarr; **TeraBox Cookie** &rarr; click **Sign In to TeraBox**. Log in once and TeraLace will automatically capture and save your session cookie!
* **Option B (Manual):** Open [TeraBox Web](https://www.terabox.app/), log in, copy your `ndus` cookie from DevTools or using our mobile bookmarklet, and paste it into **Settings** &rarr; **TeraBox Cookie**.

### 2. Custom API Pool & Self-Hosted Cloudflare Worker
You can add or prioritize custom endpoints in **Settings** &rarr; **API Pool & Balancer**:
* Deploy your own free Cloudflare Worker using [`cloudflare-worker/worker.js`](./cloudflare-worker/README.md).
* Add your worker URL (e.g. `https://my-worker.workers.dev/`) as a custom endpoint.
* TeraLace continuously monitors endpoint reachability and displays live online/offline latency badges.

---

## 📄 License & Acknowledgments

* **License:** Distributed under the **GNU General Public License v3.0 (GPL-3.0)**.
* **Core Inspirations:**
  * Fetch engine patterns inspired by [abdul97233/TeraBox-Downloader-Bot](https://github.com/abdul97233/TeraBox-Downloader-Bot).
  * UI foundation inspired by [aruxyz/trauso](https://github.com/aruxyz/trauso).
