# Changelog

All notable changes to the **Teralace** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.8] - 2026-11-24

### 🚀 Download Queue Improvements (Issue [#4](https://github.com/LoLyeah/teralace/issues/4))
* **Auto-refetch Direct Link on HTTP 403 Forbidden**:
  * Automatically detects expired CDN links or HTTP 403 Forbidden responses in the download polling loop.
  * Automatically requests a fresh download link via `get_download_link` (with expired parameters cleared) and seamlessly resumes downloading without requiring manual user intervention.
  * Tracks retry attempts per task (`linkRetries: 0 -> 1`) to prevent infinite retry loops on genuinely invalid files.
* **Streamlined Desktop Notifications**:
  * Restricts desktop notifications to essential lifecycle events: **Download Started**, **Download Completed**, and **Download Failed / Error**.
  * Eliminates periodic progress toast notifications on desktop platforms (Windows, macOS, Linux) to keep the OS notification center clean and uncluttered.
  * Restricts high-frequency progress tracking exclusively to the in-app UI and Android background service channels.
* **Persistent Download Queue**:
  * Automatically saves active and pending queue items (file metadata, target path, download parameters) to local storage (`localStorage` & Tauri store).
  * Automatically restores queue items into the `pending` state on application startup and auto-resumes processing.
  * Immediately removes items from persistent storage once completed or cancelled.
  * Strips stale direct download links during persistence to guarantee fresh CDN links upon task resumption.

### 🙏 Acknowledgments & Community Thanks
* Heartfelt thanks to GitHub user **[@hariimurti](https://github.com/hariimurti)** for opening [Issue #4](https://github.com/LoLyeah/teralace/issues/4) and providing such a clear, well-structured proposal for these download queue and notification improvements!
