<p align="center">
  <img src="assets/logo.png" alt="TeraLace Logo" width="140" style="border-radius: 28px;" />
</p>

<h1 align="center">TeraLace</h1>

<p align="center">
  <strong>Fast, resilient, multiplatform TeraBox downloader powered by Tauri v2 &amp; Rust.</strong><br>
  Available on <strong>Windows</strong>, <strong>macOS</strong>, and <strong>Android</strong>.
</p>

<p align="center">
  <a href="https://github.com/LoLyeah/teralace/releases/latest"><img src="https://img.shields.io/github/v/release/LoLyeah/teralace?style=for-the-badge&color=0284c7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Android-38bdf8?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-orange?style=for-the-badge" alt="Backend" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=for-the-badge" alt="License" />
</p>

---

## 📥 Downloads

Pre-built binaries are available on the **[GitHub Releases Page](https://github.com/LoLyeah/teralace/releases/latest)**:

| Platform | Distribution | Format | Architecture | Download |
|:---|:---|:---|:---|:---|
| **Windows** | **Portable (Zero-Install)** | Standalone `.exe` / `.zip` | x86_64 | [**TeraLace_portable.exe**](https://github.com/LoLyeah/teralace/releases/latest) &bull; [`.zip`](https://github.com/LoLyeah/teralace/releases/latest) |
| **Windows** | Setup Installer | Setup `.exe` / `.msi` | x86_64 | [Setup `.exe`](https://github.com/LoLyeah/teralace/releases/latest) &bull; [MSI](https://github.com/LoLyeah/teralace/releases/latest) |
| **macOS** | Universal Bundle | `.dmg` / `.app.tar.gz` | Apple Silicon (`M1–M4`) & Intel (`x64`) | [**Universal `.dmg`**](https://github.com/LoLyeah/teralace/releases/latest) |
| **Android** | Signed Package | `.apk` | ARM64 (`arm64-v8a`) | [**TeraLace.apk**](https://github.com/LoLyeah/teralace/releases/latest) |

---

## ✨ Highlights

* **Cross-Platform Native:** Native desktop experience on Windows & macOS (tray icon, file pickers, bandwidth limits) + touch-optimized mobile UI for Android.
* **Pure Rust Chunk Downloader:** Multi-stream HTTP Range requests with concurrent segment downloads, auto-retry, and instant pause/resume. Zero external `aria2c` dependencies.
* **Resilient Fetch Engine:** Automatic round-robin load balancer across API pools with a 120s circuit breaker for rate-limited (429) nodes.
* **Universal Link Parsing:** Supports 50+ TeraBox mirrors (`1024terabox.com`, `terabox.app`, `terasharelink.com`, `nephobox.com`, `4funbox.com`, etc.).
* **Private & Fast Downloads:** Direct scraper fallback and personal `ndus` session cookie support to bypass anonymous speed limits and download private folders.
* **Media Stream:** Preview and stream video files directly before or during download.

---

## 🛠️ Development

```bash
# Clone & install dependencies
git clone https://github.com/LoLyeah/teralace.git && cd teralace
npm install

# Dev server & hot-reload desktop app
npm run dev          # Web preview (Vite)
npm run tauri dev    # Native desktop app

# Production builds
npm run tauri build                                    # Windows (.exe / .msi)
npm run tauri build -- --target universal-apple-darwin      # macOS Universal DMG
npm run tauri android build --apk --target aarch64 --ci     # Android Release APK
```

---

## ⚙️ Configuration

* **Custom API Endpoints:** Add self-hosted endpoints in **Settings &rarr; API Pool** using the [abdul97233](https://github.com/abdul97233/TeraBox-Downloader-Bot) schema.
* **Personal Session (`ndus`):** To download private files or bypass bandwidth caps, paste your `ndus` cookie from [terabox.com](https://www.terabox.app/) (DevTools &rarr; Application &rarr; Cookies) into **Settings &rarr; TeraBox Cookie**.

---

## 📄 Credits & License

* Fetch engine inspired by [abdul97233/TeraBox-Downloader-Bot](https://github.com/abdul97233/TeraBox-Downloader-Bot).
* UI base derived from [aruxyz/trauso](https://github.com/aruxyz/trauso).
* Licensed under **GPL-3.0**.
