<p align="center">
  <img src="assets/logo.png" alt="TeraLace Logo" width="160" style="border-radius: 36px; box-shadow: 0 10px 30px rgba(0,0,0,0.4);" />
</p>

<h1 align="center">TeraLace</h1>

<p align="center">
  <strong>Fast, Modern &amp; Resilient Multiplatform TeraBox Downloader</strong><br>
  Built with <strong>Tauri v2</strong> &bull; <strong>Rust</strong> &bull; <strong>React</strong> &bull; <strong>Tailwind CSS</strong>
</p>

<p align="center">
  <a href="https://github.com/LoLyeah/teralace/releases"><img src="https://img.shields.io/github/v/release/LoLyeah/teralace?style=for-the-badge&color=0284c7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Android-38bdf8?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-orange?style=for-the-badge" alt="Backend" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=for-the-badge" alt="License" />
</p>

---

## 📥 Downloads & Installation

Pre-built binaries are available for desktop and mobile directly on the **[Releases Page](https://github.com/LoLyeah/teralace/releases)**:

| Platform | Format | Architecture | Download Link |
|:---|:---|:---|:---|
| **Windows (Installer)** | Setup `.exe` / `.msi` | x86_64 | [Latest Windows Installer](https://github.com/LoLyeah/teralace/releases/latest) |
| **Windows (Portable)** | Standalone `.exe` / `.zip` | x86_64 | [Latest Windows Portable](https://github.com/LoLyeah/teralace/releases/latest) |
| **macOS** | Universal `.dmg` / `.app.tar.gz` | Apple Silicon (`aarch64`) & Intel (`x64`) | [Latest macOS Release](https://github.com/LoLyeah/teralace/releases/latest) |
| **Android** | Signed Package `.apk` | ARM64 (`arm64-v8a`) | [Latest Android APK](https://github.com/LoLyeah/teralace/releases/latest) |

---

## ✨ Features & Architecture Upgrades

### 1. 🌐 True Multiplatform Support (Windows, macOS, Android)
- **Desktop (Windows & macOS):** Native windows, file pickers, bandwidth regulation, system tray minimization, and desktop notifications.
- **Mobile (Android):** Adaptive touch-first layout with bottom navigation tabs, Scoped Storage integration, and background download service.
- **Lightweight & Fast:** Single-digit MB RAM idle usage and compact ~15–20 MB application footprint.

### 2. 🛡️ Resilient Fetch Engine
- **Health-Aware Load Balancer:** Automatically rotates requests round-robin across an active pool of API endpoints.
- **120s Circuit Breaker:** Detects rate limits (HTTP 429) and unresponsive nodes (5+ consecutive failures) and temporarily cooldowns them for 120 seconds to prevent cascading bottlenecks.
- **Comprehensive Domain Normalizer:** Seamlessly parses 50+ TeraBox domains and mirror formats (`1024terabox.com`, `terabox.app`, `terasharelink.com`, `nephobox.com`, `4funbox.com`, `mirrobox.com`, etc.).
- **Direct TeraBox Scraper & Session Cookie (`ndus`):** When remote APIs are busy or unavailable, the built-in direct scraper resolves links directly with optional `ndus` cookie support to bypass anonymous download speed throttles.

### 3. ⚡ Embedded Pure Rust Chunk Downloader
- **Zero External CLI Dependencies:** Eliminates reliance on external `aria2c` binaries that are restricted on Android due to SELinux `W^X` policies.
- **Parallel HTTP Range Requests:** Splits files into multiple concurrent streams for maximum download throughput with isolated chunk segments and atomic merge.
- **Graceful Controls:** Full Pause, Resume, Cancel, native file reveal, and real-time speed monitoring.
- **In-App Media Stream:** Preview video files immediately before or during download.

---

## 🚀 Quick Start (Development)

### Prerequisites
1. **Node.js**: v20 or later (`node -v`)
2. **Rust & Cargo**: Latest stable toolchain (`rustup`)
3. For Android builds: **Android Studio**, Android SDK (API 34), NDK (26+), and Java JDK 17.

### Running Frontend (Dev Server)
```bash
npm install
npm run dev
```

### Running with Tauri Desktop (Hot Reload)
```bash
npm run tauri dev
```

### Building for Production

#### Windows
```bash
npm run tauri build
# Output: src-tauri/target/release/teralace.exe (or .msi)
```

#### macOS (Universal Binary: Apple Silicon + Intel)
```bash
npm run tauri build -- --target universal-apple-darwin
# Output: src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

#### Android (Release APK)
```bash
# 1. Initialize Android target (first time)
npm run tauri android init --ci

# 2. Build Release APK
npm run tauri android build --apk --target aarch64 --ci
# Output: src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk
```

---

## ⚙️ Configuration & Settings

### Managing API Endpoints (Settings &rarr; API Pool)
You can configure custom or self-hosted API endpoints compatible with the [abdul97233](https://github.com/abdul97233/TeraBox-Downloader-Bot) schema:
- **Base URL:** `https://your-api.ntmterabox.me/`
- **Auth Token:** Optional `token_id.secret`
- Each endpoint shows live circuit breaker health, failure counts, and cooldown countdowns.

### Personal TeraBox Session Cookie (`ndus`)
To download private folders or bypass anonymous bandwidth throttles:
1. Open [terabox.com](https://www.terabox.app/) in your browser and log in.
2. Open DevTools (`F12`) &rarr; **Application** &rarr; **Cookies** &rarr; copy the value of `ndus`.
3. Paste it in **Settings &rarr; TeraBox Cookie**.

---

## Thanks to
[abdul197233/Terabox Downloader](https://github.com/abdul97233/TeraBox-Downloader-Bot) for the Terabox fetch engine
If you want to use the Telegram Bot version, please visit abdul197233 version!

---

## 📄 License
GNU General Public License v3.0 (GPL-3.0).
