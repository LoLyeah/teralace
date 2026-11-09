<p align="center">
  <img src="assets/logo.png" alt="Teralace Logo" width="110" />
</p>

<h1 align="center">Teralace</h1>

<p align="center">
  <strong>Fast, resilient, multiplatform TeraBox downloader powered by Tauri v2 &amp; Rust.</strong><br>
  Built for <strong>Windows</strong>, <strong>macOS</strong>, <strong>Linux</strong>, and <strong>Android</strong> with zero external dependencies.
</p>

<p align="center">
  <a href="https://github.com/LoLyeah/teralace/releases/latest"><img src="https://img.shields.io/github/v/release/LoLyeah/teralace?style=flat-square&color=0284c7" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Platforms-Win%20%7C%20Mac%20%7C%20Linux%20%7C%20Android-38bdf8?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-orange?style=flat-square" alt="Backend" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square" alt="License" />
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="Teralace Interface" width="750" />
</p>

---

## 📥 Downloads

Grab the latest build for your device from **[GitHub Releases](https://github.com/LoLyeah/teralace/releases/latest)**:

| Platform | Format | Description |
|:---|:---|:---|
| **Windows** | Setup `.exe` / Portable `.zip` | Standard installer or standalone x64 zip |
| **macOS** | Universal `.dmg` | Native Apple Silicon (M1–M4) & Intel |
| **Linux** | `.AppImage` / Native `.deb` | Portable AppImage or Ubuntu/Debian package |
| **Android** | Signed `.apk` | Universal ARM64/x86_64 package |

---

## ✨ Features

- **⚡ Multi-Stream Rust Engine:** Concurrent HTTP Range chunking, auto-stitch, byte-accurate pause/resume, and speed limiters. Zero external binaries required.
- **🛡️ Resilient Resolution:** Dynamic API pool with round-robin balancing, active health checks, circuit breaker, and recursive folder expansion across 50+ domain mirrors.
- **🔑 1-Tap In-App Login:** Native sign-in dialog on Desktop and Android. Automatically captures `HttpOnly` `ndus` session cookies directly without DevTools.
- **📱 Android Background Power:** Ongoing foreground download notifications, partial CPU WakeLock, system clipboard bridge, and clean exit controls.
- **🎨 Material You Dynamic Theming:** Android 12+ Monet wallpaper palette extraction, system accent synchronization, and custom tonal themes.
- **🛠️ Self-Hosted Resolver:** Plug-and-play [Cloudflare Worker script](./cloudflare-worker/) for 100% private extraction uptime (free 100k req/day).
- **🎬 In-App Player & Diagnostics:** Built-in media streaming player and real-time diagnostic log viewer.

---

## ⚙️ Quick Setup

### Personal Session (`ndus` Cookie)
TeraBox requires login to download shared folders and uncapped streams.
- **1-Tap Sign In (Recommended):** Open **Settings** &rarr; **TeraBox Cookie** &rarr; tap **Sign In with TeraBox**. Authenticate via Google, Email, or SMS to auto-save your cookie.
- **Manual Input:** Paste your `ndus` cookie from browser DevTools (<kbd>F12</kbd> &rarr; Application &rarr; Cookies) or mobile Cookie-Editor.

### Private Cloudflare Worker Resolver *(Optional)*
If public APIs are slow or down, host your own free resolver in 2 minutes:
1. Create a Worker at [dash.cloudflare.com](https://dash.cloudflare.com/) and paste [`cloudflare-worker/worker.js`](./cloudflare-worker/worker.js).
2. Copy your worker URL, open Teralace **Settings** &rarr; **API Pool**, and add it.
*(See [`cloudflare-worker/README.md`](./cloudflare-worker/README.md) for full guide & auth variables).*

---

## 🛠️ Build from Source

```bash
git clone https://github.com/LoLyeah/teralace.git && cd teralace
npm install

# Development
npm run dev           # Web preview
npm run tauri dev     # Desktop dev with hot reload

# Production Build
npm run tauri build                                     # Windows / Linux
npm run tauri build -- --target universal-apple-darwin  # macOS
npm run tauri android build --apk --target aarch64 --ci  # Android APK
```

---

## 📄 License
Distributed under [GPL-3.0](LICENSE). Inspired by [abdul97233/TeraBox-Downloader-Bot](https://github.com/abdul97233/TeraBox-Downloader-Bot) and [aruxyz/trauso](https://github.com/aruxyz/trauso).
