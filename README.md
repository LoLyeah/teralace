# TeraLace (Multiplatform TeraBox Downloader)

A high-speed, modern, and resilient TeraBox file downloader built with **Tauri v2** (Rust + React + Vite + Tailwind CSS).
Engineered to run natively across **Windows**, **macOS**, and **Android** from a single unified codebase.

---

## ✨ Features & Architecture Upgrades

### 1. 🌐 Multiplatform Support (Windows, macOS, Android)
- **Desktop (Windows & macOS):** Native windows, file pickers, bandwidth regulation, and system notifications.
- **Mobile (Android):** Adaptive touch-first layout with bottom navigation tabs, Scoped Storage integration, and foreground download service.
- **Lightweight:** Single-digit MB memory usage and ~15–20 MB application size.

### 2. 🛡️ Resilient Fetch Engine (Inspired by abdul97233/TeraBox-Downloader-Bot)
- **Health-Aware Load Balancer:** Automatically rotates requests round-robin across an active pool of API endpoints.
- **120s Circuit Breaker:** Detects rate limits (HTTP 429) and unresponsive nodes (5+ consecutive failures) and temporarily disables them for 120 seconds to prevent cascading failures.
- **Comprehensive Domain Normalizer:** Seamlessly parses 50+ TeraBox domains and mirrors (`1024terabox.com`, `terabox.app`, `terasharelink.com`, `nephobox.com`, `4funbox.com`, `mirrobox.com`, etc.).
- **Direct TeraBox Scraper & Session Cookie (`ndus`):** When remote APIs are busy or unavailable, the built-in direct scraper resolves links directly with optional `ndus` cookie support to bypass anonymous download speed throttles.

### 3. ⚡ Embedded Pure Rust Chunk Downloader
- **Zero External CLI Dependencies:** Eliminates reliance on external `aria2c` binaries that are restricted on Android due to SELinux `W^X` policies.
- **Parallel HTTP Range Requests:** Splits files into multiple concurrent streams for maximum download throughput.
- **Graceful Controls:** Full Pause, Resume, Cancel, and real-time speed monitoring.

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
npm run tauri android init

# 2. Build Release APK
npm run tauri android build -- --apk
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

## 📄 License
MIT License.
