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
* **Dynamic API Pool Load Balancer:** Round-robin balancing across multiple endpoints with automatic failover and a 120s circuit breaker for rate-limited (429) nodes.
* **WAP Direct Scraper Fallback:** High-speed mobile WAP scraper generating direct pre-signed download tokens when API pools are unavailable.
* **Deep Pagination:** Full pagination support for large folders and shares containing more than 20, 50, or 100+ files.
* **Recursive Folder Expansion:** Automatic recursive traversal into shared subdirectories.
* **50+ Domain Mirrors:** Universal regex normalizer resolving all TeraBox domains (`1024terabox.com`, `terabox.app`, `terasharelink.com`, `nephobox.com`, `4funbox.com`, `mirrobox.com`, etc.).

### 📱 Modern Multiplatform Experience
* **Desktop & Mobile Optimized:** Responsive layout with desktop controls (folder opener, window controls, background downloads) and dedicated touch-friendly tabs on Android.
* **In-App Media Streaming:** Instant video and audio player preview before or during download.
* **Android Adaptive Icons:** Engineered with safe-zone compliance, pure vector glyphs, and seamless theme-matched dark launcher integration.
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
To download private links, avoid CAPTCHAs, or unlock maximum download speeds:
1. Open [TeraBox Web](https://www.terabox.app/) in your browser and log in.
2. Open Developer Tools (`F12` or `Ctrl + Shift + I`) &rarr; **Application** &rarr; **Cookies**.
3. Copy the value of the `ndus` cookie.
4. In TeraLace, navigate to **Settings** &rarr; **TeraBox Cookie**, paste your cookie, and click **Save**.

### 2. Custom API Pool
You can add or prioritize custom endpoints in **Settings** &rarr; **API Pool** following the [abdul97233](https://github.com/abdul97233/TeraBox-Downloader-Bot) schema. The active balancer tracks response health and status codes in real time.

---

## 📄 License & Acknowledgments

* **License:** Distributed under the **GNU General Public License v3.0 (GPL-3.0)**.
* **Core Inspirations:**
  * Fetch engine patterns inspired by [abdul97233/TeraBox-Downloader-Bot](https://github.com/abdul97233/TeraBox-Downloader-Bot).
  * UI foundation inspired by [aruxyz/trauso](https://github.com/aruxyz/trauso).
