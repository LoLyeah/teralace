const fs = require('fs');
const path = require('path');

// 1. Android Manifest Permissions & Application Attributes Injection
const manifestPath = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/AndroidManifest.xml');

if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');
  const permissions = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />',
    '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
    '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'
  ].join('\n');

  if (!content.includes('android.permission.INTERNET')) {
    content = content.replace('<application', `${permissions}\n    <application`);
    console.log('Successfully injected Android permissions into AndroidManifest.xml');
  } else if (!content.includes('android.permission.WRITE_EXTERNAL_STORAGE')) {
    const storagePerms = [
      '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
      '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'
    ].join('\n');
    content = content.replace('<application', `${storagePerms}\n    <application`);
    console.log('Injected storage permissions into AndroidManifest.xml');
  }

  // Ensure cleartext HTTP traffic (for CDN redirects) and legacy external storage are allowed on <application>
  if (!content.includes('android:usesCleartextTraffic')) {
    content = content.replace(
      '<application',
      '<application android:usesCleartextTraffic="true" android:requestLegacyExternalStorage="true"'
    );
    console.log('Added usesCleartextTraffic and requestLegacyExternalStorage to <application>');
  }

  // Inject FileProvider into AndroidManifest.xml for opening downloaded files
  if (!content.includes('androidx.core.content.FileProvider')) {
    const providerXml = `        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="com.teralace.downloader.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>\n    </application>`;
    content = content.replace('</application>', providerXml);
    console.log('Injected FileProvider into AndroidManifest.xml');
  }

  fs.writeFileSync(manifestPath, content, 'utf8');
} else {
  console.log('Warning: AndroidManifest.xml not found at', manifestPath);
}

// 2. Android Adaptive Icon Background Color & XML Definitions
const resDir = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/res');
if (fs.existsSync(resDir)) {
  const valuesDir = path.join(resDir, 'values');
  if (fs.existsSync(valuesDir)) {
    // 2a. Update or create colors.xml with ic_launcher_background
    const colorsXmlPath = path.join(valuesDir, 'colors.xml');
    if (fs.existsSync(colorsXmlPath)) {
      let colorsXml = fs.readFileSync(colorsXmlPath, 'utf8');
      if (colorsXml.includes('ic_launcher_background')) {
        colorsXml = colorsXml.replace(/(<color name="ic_launcher_background">)[^<]+(<\/color>)/g, '$1#0a101d$2');
      } else {
        colorsXml = colorsXml.replace('</resources>', '    <color name="ic_launcher_background">#0a101d</color>\n</resources>');
      }
      fs.writeFileSync(colorsXmlPath, colorsXml, 'utf8');
      console.log('Updated colors.xml ic_launcher_background to #0a101d');
    } else {
      const newColorsXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0a101d</color>\n</resources>\n`;
      fs.writeFileSync(colorsXmlPath, newColorsXml, 'utf8');
      console.log('Created colors.xml with ic_launcher_background #0a101d');
    }

    // 2b. Remove redundant values/ic_launcher_background.xml to avoid duplicate resource collision with colors.xml
    const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
    if (fs.existsSync(bgXmlPath)) {
      try {
        fs.unlinkSync(bgXmlPath);
        console.log('Removed redundant values/ic_launcher_background.xml to avoid AAPT duplicate resource collision with colors.xml');
      } catch (e) {
        console.warn('Could not remove values/ic_launcher_background.xml:', e.message);
      }
    }
  }

  // 2c. Check drawable/ic_launcher_background.xml
  const drawableDir = path.join(resDir, 'drawable');
  if (fs.existsSync(drawableDir)) {
    const drawBgPath = path.join(drawableDir, 'ic_launcher_background.xml');
    if (fs.existsSync(drawBgPath)) {
      let drawBg = fs.readFileSync(drawBgPath, 'utf8');
      drawBg = drawBg.replace(/#(?:FFFFFF|ffffff|[0-9a-fA-F]{6})/g, '#0a101d');
      fs.writeFileSync(drawBgPath, drawBg, 'utf8');
      console.log('Updated drawable/ic_launcher_background.xml to #0a101d');
    }
  }

  // 3. Synchronize COMPLETE Android icon suite into app resource directory
  // Copies ic_launcher.png (legacy squircle), ic_launcher_round.png (round), and ic_launcher_foreground.png (adaptive)
  const iconsAndroidDir = path.resolve(__dirname, '../src-tauri/icons/android');
  if (fs.existsSync(iconsAndroidDir)) {
    const densities = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
    const iconTargets = ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'];

    densities.forEach(d => {
      const targetDir = path.join(resDir, d);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      iconTargets.forEach(iconName => {
        const srcPath = path.join(iconsAndroidDir, d, iconName);
        const targetPath = path.join(targetDir, iconName);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, targetPath);
        }
      });
    });
    console.log('Synchronized complete Android icon suite (standard, round, foreground) into app resource directory');
  }

  // 4. Ensure Adaptive Icons in mipmap-anydpi-v26 support Material You dynamic theming (monochrome)
  const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
  if (!fs.existsSync(anydpiDir)) {
    fs.mkdirSync(anydpiDir, { recursive: true });
  }
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');
  console.log('Created mipmap-anydpi-v26 adaptive and monochrome icons for Material You');

  // 4b. Create xml/file_paths.xml for FileProvider so Android can open downloaded files securely
  const xmlDir = path.join(resDir, 'xml');
  if (!fs.existsSync(xmlDir)) {
    fs.mkdirSync(xmlDir, { recursive: true });
  }
  const filePathsXml = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="external_files" path="." />
    <external-path name="download_files" path="Download" />
    <files-path name="internal_files" path="." />
    <root-path name="root" path="." />
</paths>
`;
  fs.writeFileSync(path.join(xmlDir, 'file_paths.xml'), filePathsXml, 'utf8');
  console.log('Created res/xml/file_paths.xml for FileProvider');
}

// 5. Update Android compileSdk and targetSdk to API 35 (Android 15 / Latest)
const gradleFiles = [
  path.resolve(__dirname, '../src-tauri/gen/android/app/build.gradle.kts'),
  path.resolve(__dirname, '../src-tauri/gen/android/app/build.gradle')
];

gradleFiles.forEach(gradlePath => {
  if (fs.existsSync(gradlePath)) {
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    let modified = false;

    // Update compileSdk
    if (/compileSdk\s*=\s*\d+/.test(gradle)) {
      gradle = gradle.replace(/compileSdk\s*=\s*\d+/g, 'compileSdk = 35');
      modified = true;
    } else if (/compileSdkVersion\s*\d+/.test(gradle)) {
      gradle = gradle.replace(/compileSdkVersion\s*\d+/g, 'compileSdkVersion 35');
      modified = true;
    }

    // Update targetSdk
    if (/targetSdk\s*=\s*\d+/.test(gradle)) {
      gradle = gradle.replace(/targetSdk\s*=\s*\d+/g, 'targetSdk = 35');
      modified = true;
    } else if (/targetSdkVersion\s*\d+/.test(gradle)) {
      gradle = gradle.replace(/targetSdkVersion\s*\d+/g, 'targetSdkVersion 35');
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(gradlePath, gradle, 'utf8');
      console.log(`Updated compileSdk and targetSdk to 35 in ${path.basename(gradlePath)}`);
    }
  }
});

// 5b. Ensure gradle-wrapper uses resilient mirror to prevent GitHub 504 Gateway Timeout
const wrapperPropsPath = path.resolve(__dirname, '../src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties');
if (fs.existsSync(wrapperPropsPath)) {
  let props = fs.readFileSync(wrapperPropsPath, 'utf8');
  props = props.replace(
    /distributionUrl=.*/g,
    'distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-8.9-bin.zip'
  );
  fs.writeFileSync(wrapperPropsPath, props, 'utf8');
  console.log('Updated gradle-wrapper.properties to use high-speed CDN mirror');
}

// 6. Relax StrictMode, acquire Partial WakeLock, and attach AndroidClipboard in MainActivity.kt
const mainActivityPath = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/java/com/teralace/downloader/MainActivity.kt');
if (fs.existsSync(mainActivityPath)) {
  let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
  if (!mainActivity.includes('StrictMode')) {
    if (mainActivity.includes('super.onCreate(savedInstanceState)')) {
      mainActivity = mainActivity.replace(
        'super.onCreate(savedInstanceState)',
        `super.onCreate(savedInstanceState)\n    try {\n      val builder = android.os.StrictMode.VmPolicy.Builder()\n      android.os.StrictMode.setVmPolicy(builder.build())\n    } catch (e: Exception) {}\n    try {\n      val pm = getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager\n      val wakeLock = pm?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Teralace::WakeLock")\n      wakeLock?.acquire(4 * 3600 * 1000L)\n    } catch (e: Exception) {}`
      );
      console.log('Injected StrictMode.VmPolicy relaxation and Partial WakeLock into MainActivity.kt');
    }
  }

  const bridgeMethods = `
  // --- TERALACE_BRIDGES_START ---
  public class TeralaceClipboard(private val act: android.app.Activity) {
    @android.webkit.JavascriptInterface
    public fun readText(): String {
      return try {
        val future = java.util.concurrent.FutureTask<String> {
          try {
            val cm = act.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
            if (cm != null && cm.hasPrimaryClip()) {
              val clip = cm.primaryClip
              if (clip != null && clip.itemCount > 0) {
                val item = clip.getItemAt(0)
                val text = item?.coerceToText(act)?.toString()
                if (!text.isNullOrBlank()) {
                  text.trim()
                } else {
                  item?.text?.toString()?.trim() ?: ""
                }
              } else ""
            } else ""
          } catch (e: Exception) { "" }
        }
        act.runOnUiThread(future)
        future.get(1500, java.util.concurrent.TimeUnit.MILLISECONDS) ?: ""
      } catch (e: Exception) { "" }
    }

    @android.webkit.JavascriptInterface
    public fun hasText(): Boolean {
      return try {
        val future = java.util.concurrent.FutureTask<Boolean> {
          try {
            val cm = act.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
            cm?.hasPrimaryClip() == true
          } catch (e: Exception) { false }
        }
        act.runOnUiThread(future)
        future.get(500, java.util.concurrent.TimeUnit.MILLISECONDS) ?: false
      } catch (e: Exception) { false }
    }
  }

  public class TeralaceOpener(private val act: android.app.Activity) {
    @android.webkit.JavascriptInterface
    public fun openFolder(folderPath: String) {
      act.runOnUiThread {
        try {
          // 1. Try DocumentsProvider directly for primary:Download/Teralace
          val uri = android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload%2FTeralace")
          val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "vnd.android.document/root")
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
          }
          act.startActivity(intent)
        } catch (e1: Exception) {
          try {
            // 2. Try DocumentsProvider primary:Download
            val uri = android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload")
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
              setDataAndType(uri, "vnd.android.document/root")
              flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            act.startActivity(intent)
          } catch (e2: Exception) {
            try {
              // 3. Try DownloadManager ACTION_VIEW_DOWNLOADS
              val dmIntent = android.content.Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
              }
              act.startActivity(dmIntent)
            } catch (e3: Exception) {
              try {
                // 4. Fallback: Generic GET_CONTENT file browser
                val fallback = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
                  type = "*/*"
                  addCategory(android.content.Intent.CATEGORY_OPENABLE)
                  flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                }
                act.startActivity(fallback)
              } catch (e4: Exception) {
                android.widget.Toast.makeText(act, "Cannot open file manager", android.widget.Toast.LENGTH_SHORT).show()
              }
            }
          }
        }
      }
    }

    @android.webkit.JavascriptInterface
    public fun openFile(filePath: String) {
      act.runOnUiThread {
        try {
          val cleanPath = when {
            filePath.startsWith("file://") -> filePath.removePrefix("file://")
            filePath.startsWith("file:") -> filePath.removePrefix("file:")
            else -> filePath
          }
          var file = java.io.File(cleanPath)
          if (!file.exists()) {
            val candidates = listOf(
              java.io.File("/storage/emulated/0/Download/Teralace", cleanPath),
              java.io.File("/storage/emulated/0/Download", cleanPath),
              java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "Teralace/" + cleanPath),
              java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), cleanPath)
            )
            for (candidate in candidates) {
              if (candidate.exists()) {
                file = candidate
                break
              }
            }
          }

          if (!file.exists()) {
            android.widget.Toast.makeText(act, "File not found: " + java.io.File(cleanPath).name, android.widget.Toast.LENGTH_SHORT).show()
            return@runOnUiThread
          }

          // Index with MediaScanner so Android Gallery/Music/Video apps find it
          try {
            android.media.MediaScannerConnection.scanFile(
              act.applicationContext,
              arrayOf(file.absolutePath),
              null,
              null
            )
          } catch (e: Exception) {}

          val uri: android.net.Uri = try {
            androidx.core.content.FileProvider.getUriForFile(
              act,
              act.packageName + ".fileprovider",
              file
            )
          } catch (e: Exception) {
            android.net.Uri.fromFile(file)
          }

          val ext = file.extension.lowercase()
          val mimeType = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: when (ext) {
              "mp4", "mkv", "avi", "mov", "flv", "webm", "ts" -> "video/*"
              "mp3", "m4a", "flac", "wav", "aac", "ogg" -> "audio/*"
              "jpg", "jpeg", "png", "gif", "webp", "bmp" -> "image/*"
              "pdf" -> "application/pdf"
              "apk" -> "application/vnd.android.package-archive"
              "zip", "rar", "7z", "tar", "gz" -> "application/zip"
              "txt", "log", "json", "xml" -> "text/plain"
              else -> "*/*"
            }

          val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mimeType)
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
          }
          val chooser = android.content.Intent.createChooser(intent, "Open " + file.name)
          chooser.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
          act.startActivity(chooser)
        } catch (ex: Exception) {
          try {
            android.widget.Toast.makeText(act, "Cannot open file: " + ex.message, android.widget.Toast.LENGTH_LONG).show()
          } catch (e: Exception) {}
        }
      }
    }

    @android.webkit.JavascriptInterface
    public fun scanFile(filePath: String) {
      try {
        val cleanPath = when {
          filePath.startsWith("file://") -> filePath.removePrefix("file://")
          filePath.startsWith("file:") -> filePath.removePrefix("file:")
          else -> filePath
        }
        val file = java.io.File(cleanPath)
        android.media.MediaScannerConnection.scanFile(
          act.applicationContext,
          arrayOf(file.absolutePath),
          null,
          null
        )
      } catch (e: Exception) {}
    }

    @android.webkit.JavascriptInterface
    public fun areNotificationsEnabled(): Boolean {
      return try {
        val nm = act.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
        nm?.areNotificationsEnabled() ?: false
      } catch (e: Exception) {
        true
      }
    }

    @android.webkit.JavascriptInterface
    public fun openNotificationSettings() {
      act.runOnUiThread {
        try {
          val intent = android.content.Intent().apply {
            action = android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS
            putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, act.packageName)
            flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
          }
          act.startActivity(intent)
        } catch (e1: Exception) {
          try {
            val intent = android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
              data = android.net.Uri.fromParts("package", act.packageName, null)
              flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            }
            act.startActivity(intent)
          } catch (e2: Exception) {
            try {
              android.widget.Toast.makeText(act, "Unable to open notification settings", android.widget.Toast.LENGTH_SHORT).show()
            } catch (e3: Exception) {}
          }
        }
      }
    }
  }

  public class TeraboxLoginBridge(private val act: android.app.Activity, private val mainView: android.webkit.WebView) {
    private var pollHandler: android.os.Handler? = null
    private var pollRunnable: Runnable? = null
    private val captured = java.util.concurrent.atomic.AtomicBoolean(false)

    @android.webkit.JavascriptInterface
    public fun openLoginDialog() {
      act.runOnUiThread {
        try {
          captured.set(false)
          val dialog = android.app.Dialog(act, android.R.style.Theme_DeviceDefault_Light_NoActionBar_Fullscreen)
          val root = android.widget.LinearLayout(act).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
              android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
              android.widget.LinearLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.parseColor("#0a101d"))
          }

          val density = act.resources.displayMetrics.density
          val header = android.widget.LinearLayout(act).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
              android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
              (48 * density).toInt()
            )
            setBackgroundColor(android.graphics.Color.parseColor("#0f172a"))
            setPadding((16 * density).toInt(), 0, (12 * density).toInt(), 0)
            gravity = android.view.Gravity.CENTER_VERTICAL
          }

          val title = android.widget.TextView(act).apply {
            text = "Sign In to TeraBox"
            setTextColor(android.graphics.Color.WHITE)
            textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f)
          }
          header.addView(title)

          fun stopPoll() {
            pollRunnable?.let { pollHandler?.removeCallbacks(it) }
            pollRunnable = null
            pollHandler = null
          }

          val closeBtn = android.widget.TextView(act).apply {
            text = "✕ Cancel"
            setTextColor(android.graphics.Color.parseColor("#94a3b8"))
            textSize = 13f
            setPadding((8 * density).toInt(), (6 * density).toInt(), (8 * density).toInt(), (6 * density).toInt())
            setOnClickListener {
              stopPoll()
              dialog.dismiss()
            }
          }
          header.addView(closeBtn)
          root.addView(header)

          val webView = android.webkit.WebView(act).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
              android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
              0,
              1.0f
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.javaScriptCanOpenWindowsAutomatically = true
            // Use desktop user-agent to ensure clean web login UI and prevent mobile app/intent redirects
            settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
          }

          val cm = android.webkit.CookieManager.getInstance()
          cm.setAcceptCookie(true)
          cm.setAcceptThirdPartyCookies(webView, true)

          fun checkCookie(): Boolean {
            try {
              cm.flush()
              val domains = listOf(
                "https://www.terabox.app",
                "https://www.terabox.com",
                "https://terabox.app",
                "https://terabox.com",
                "https://www.1024tera.com",
                "https://1024tera.com",
                "https://www.teraboxshare.com",
                "https://teraboxshare.com",
                "https://www.dubox.com",
                "https://dubox.com"
              )
              val all = domains.joinToString("; ") { cm.getCookie(it) ?: "" }
              val parts = all.split(";")
              for (part in parts) {
                val p = part.trim()
                if (p.startsWith("ndus=")) {
                  val token = p.substring(5).trim()
                  if (token.isNotEmpty() && token != "null" && token != "undefined") {
                    if (captured.compareAndSet(false, true)) {
                      stopPoll()
                      dialog.dismiss()
                      val escaped = token.replace("\\\\", "\\\\\\\\").replace("'", "\\\\'")
                      mainView.post {
                        mainView.evaluateJavascript("window.onTeraboxCookieCaptured && window.onTeraboxCookieCaptured('$escaped')", null)
                      }
                      return true
                    }
                  }
                }
              }
            } catch (e: Exception) {}
            return false
          }

          webView.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(v: android.webkit.WebView?, u: String?) {
              super.onPageFinished(v, u)
              checkCookie()
            }

            override fun shouldOverrideUrlLoading(v: android.webkit.WebView?, req: android.webkit.WebResourceRequest?): Boolean {
              if (checkCookie()) return true
              val uriStr = req?.url?.toString() ?: ""
              if (uriStr.startsWith("http://") || uriStr.startsWith("https://")) {
                v?.loadUrl(uriStr)
                return true
              }
              return true
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(v: android.webkit.WebView?, url: String?): Boolean {
              if (checkCookie()) return true
              if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                v?.loadUrl(url)
                return true
              }
              return true
            }
          }

          dialog.setOnKeyListener { _, keyCode, event ->
            if (keyCode == android.view.KeyEvent.KEYCODE_BACK && event.action == android.view.KeyEvent.ACTION_UP) {
              if (webView.canGoBack()) {
                webView.goBack()
                true
              } else {
                false
              }
            } else {
              false
            }
          }

          root.addView(webView)
          dialog.setContentView(root)
          dialog.setOnDismissListener {
            stopPoll()
            if (!captured.get()) {
              mainView.post {
                mainView.evaluateJavascript("window.onTeraboxLoginDismissed && window.onTeraboxLoginDismissed()", null)
              }
            }
          }

          pollHandler = android.os.Handler(android.os.Looper.getMainLooper())
          pollRunnable = object : Runnable {
            override fun run() {
              if (!checkCookie() && dialog.isShowing) {
                pollHandler?.postDelayed(this, 500)
              }
            }
          }
          pollHandler?.postDelayed(pollRunnable!!, 800)

          webView.loadUrl("https://www.terabox.app/login")
          dialog.show()
        } catch (ex: Exception) {
          mainView.post {
            mainView.evaluateJavascript("window.onTeraboxLoginDismissed && window.onTeraboxLoginDismissed()", null)
          }
        }
      }
    }
  }

  public class TeralaceTheme(private val act: android.app.Activity) {
    @android.webkit.JavascriptInterface
    public fun getMonetColors(): String {
      return try {
        var accent500 = 0
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
          try { accent500 = act.getColor(android.R.color.system_accent1_500) } catch (e: Throwable) {}
          if (accent500 == 0 || accent500 == -16777216) {
            try { accent500 = act.getColor(android.R.color.system_accent1_600) } catch (e: Throwable) {}
          }
          if (accent500 == 0 || accent500 == -16777216) {
            try { accent500 = act.getColor(android.R.color.system_accent1_400) } catch (e: Throwable) {}
          }
        }

        if (accent500 == 0 || accent500 == -16777216) {
          val tv = android.util.TypedValue()
          if (act.theme.resolveAttribute(android.R.attr.colorAccent, tv, true)) {
            accent500 = tv.data
          }
        }
        if (accent500 == 0 || accent500 == -16777216) {
          val tv = android.util.TypedValue()
          if (act.theme.resolveAttribute(android.R.attr.colorPrimary, tv, true)) {
            accent500 = tv.data
          }
        }

        if (accent500 == 0) return ""

        val ar = (accent500 shr 16) and 0xff
        val ag = (accent500 shr 8) and 0xff
        val ab = accent500 and 0xff

        var a2r = ar
        var a2g = ag
        var a2b = ab
        var bdr = 0
        var bdg = 0
        var bdb = 0
        var cdr = 0
        var cdg = 0
        var cdb = 0
        var blr = 0
        var blg = 0
        var blb = 0

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
          try {
            val accent200 = act.getColor(android.R.color.system_accent1_200)
            a2r = (accent200 shr 16) and 0xff
            a2g = (accent200 shr 8) and 0xff
            a2b = accent200 and 0xff
          } catch (e: Throwable) {}

          try {
            val bgDark = act.getColor(android.R.color.system_neutral1_900)
            bdr = (bgDark shr 16) and 0xff
            bdg = (bgDark shr 8) and 0xff
            bdb = bgDark and 0xff
          } catch (e: Throwable) {}

          try {
            val cardDark = act.getColor(android.R.color.system_neutral1_800)
            cdr = (cardDark shr 16) and 0xff
            cdg = (cardDark shr 8) and 0xff
            cdb = cardDark and 0xff
          } catch (e: Throwable) {}

          try {
            val bgLight = act.getColor(android.R.color.system_neutral1_100)
            blr = (bgLight shr 16) and 0xff
            blg = (bgLight shr 8) and 0xff
            blb = bgLight and 0xff
          } catch (e: Throwable) {}
        }

        "{\"r\":$ar,\"g\":$ag,\"b\":$ab,\"primaryDark\":{\"r\":$a2r,\"g\":$a2g,\"b\":$a2b},\"bgDark\":{\"r\":$bdr,\"g\":$bdg,\"b\":$bdb},\"cardDark\":{\"r\":$cdr,\"g\":$cdg,\"b\":$cdb},\"bgLight\":{\"r\":$blr,\"g\":$blg,\"b\":$blb}}"
      } catch (e: Exception) { "" }
    }
  }

  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    try {
      webView.addJavascriptInterface(TeralaceClipboard(this), "AndroidClipboard")
    } catch (e: Exception) {}

    try {
      webView.addJavascriptInterface(TeralaceOpener(this), "AndroidOpener")
    } catch (e: Exception) {}

    try {
      webView.addJavascriptInterface(TeraboxLoginBridge(this, webView), "AndroidLogin")
    } catch (e: Exception) {}

    try {
      webView.addJavascriptInterface(TeralaceTheme(this), "AndroidTheme")
    } catch (e: Exception) {}
  }
`;

  if (mainActivity.includes('// --- TERALACE_BRIDGES_START ---')) {
    const onStartIdx = mainActivity.indexOf('// --- TERALACE_BRIDGES_START ---');
    mainActivity = mainActivity.slice(0, onStartIdx) + bridgeMethods.trimStart() + '\n}\n';
    console.log('Updated existing Teralace bridges in MainActivity.kt');
  } else if (mainActivity.includes('override fun onWebViewCreate')) {
    const onWebIdx = mainActivity.indexOf('override fun onWebViewCreate');
    mainActivity = mainActivity.slice(0, onWebIdx) + bridgeMethods.trimStart() + '\n}\n';
    console.log('Updated existing onWebViewCreate with public bridge classes and JavascriptInterfaces');
  } else {
    const lastBraceIdx = mainActivity.lastIndexOf('}');
    if (lastBraceIdx !== -1) {
      mainActivity = mainActivity.slice(0, lastBraceIdx) + bridgeMethods + '\n}\n';
      console.log('Injected public bridge classes and JavascriptInterfaces into MainActivity.kt');
    }
  }
  fs.writeFileSync(mainActivityPath, mainActivity, 'utf8');

  // 6b. Inject ProGuard rules for JavascriptInterface reflection retention
  const proguardPath = path.resolve(__dirname, '../src-tauri/gen/android/app/proguard-rules.pro');
  const proguardRules = `
# Preserve JavascriptInterface bridges for Teralace
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.teralace.downloader.MainActivity { *; }
-keep class com.teralace.downloader.MainActivity$* { *; }
-keepclassmembers class com.teralace.downloader.MainActivity$* { *; }
`;
  if (fs.existsSync(proguardPath)) {
    let pg = fs.readFileSync(proguardPath, 'utf8');
    if (!pg.includes('JavascriptInterface')) {
      pg += '\n' + proguardRules;
      fs.writeFileSync(proguardPath, pg, 'utf8');
      console.log('Injected JavascriptInterface retention rules into proguard-rules.pro');
    }
  } else if (fs.existsSync(path.dirname(proguardPath))) {
    fs.writeFileSync(proguardPath, proguardRules, 'utf8');
    console.log('Created proguard-rules.pro with JavascriptInterface retention rules');
  }
}

// 7. Enhance OpenerPlugin.kt in cargo registry to support opening files, folders, and triggering Android MediaScanner
const os = require('os');
function findCargoFiles(dir, targetName) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(findCargoFiles(fullPath, targetName));
      } else if (entry === targetName) {
        results.push(fullPath);
      }
    }
  } catch (err) {}
  return results;
}

const cargoRegistryDir = path.join(os.homedir(), '.cargo', 'registry', 'src');
const openerPluginPaths = findCargoFiles(cargoRegistryDir, 'OpenerPlugin.kt');

if (openerPluginPaths.length > 0) {
  const enhancedOpener = `// Enhanced OpenerPlugin for TeraLace (Supports Web URLs, Folders, Files, and MediaScanner)
package app.tauri.opener

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class OpenArgs {
  lateinit var url: String
  var with: String? = null
}

@TauriPlugin
class OpenerPlugin(private val activity: Activity) : Plugin(activity) {
    init {
        try {
            val builder = android.os.StrictMode.VmPolicy.Builder()
            android.os.StrictMode.setVmPolicy(builder.build())
        } catch (e: Exception) {}
    }

    @Command
    fun open(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenArgs::class.java)

            if (args.with == "inAppBrowser") {
                val builder = CustomTabsIntent.Builder()
                val intent = builder.build()
                intent.launchUrl(activity, args.url.toUri())
            } else if (args.url.startsWith("folder:")) {
                // Open Folder in Android Files / Download Manager
                var opened = false

                // 1. Try DocumentsProvider primary:Download/Teralace
                try {
                    val uri = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload%2FTeralace")
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "vnd.android.document/root")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                    }
                    activity.startActivity(intent)
                    opened = true
                } catch (e: Exception) {}

                // 1b. Try DocumentsProvider primary:Download
                if (!opened) {
                    try {
                        val uri = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload")
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, "vnd.android.document/root")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        }
                        activity.startActivity(intent)
                        opened = true
                    } catch (e: Exception) {}
                }

                // 2. Try DownloadManager ACTION_VIEW_DOWNLOADS
                if (!opened) {
                    try {
                        val intent = Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        activity.startActivity(intent)
                        opened = true
                    } catch (e: Exception) {}
                }

                // 3. Fallback: Generic GET_CONTENT file browser
                if (!opened) {
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    activity.startActivity(intent)
                }
            } else if (args.url.startsWith("file:") || args.url.startsWith("/")) {
                val rawPath = if (args.url.startsWith("file://")) {
                    args.url.removePrefix("file://")
                } else if (args.url.startsWith("file:")) {
                    args.url.removePrefix("file:")
                } else {
                    args.url
                }

                val file = File(rawPath)

                // Trigger MediaScanner so Gallery/Video/Music players immediately index the downloaded file
                try {
                    android.media.MediaScannerConnection.scanFile(
                        activity.applicationContext,
                        arrayOf(file.absolutePath),
                        null,
                        null
                    )
                } catch (e: Exception) {}

                val uri: Uri = try {
                    FileProvider.getUriForFile(
                        activity,
                        activity.packageName + ".fileprovider",
                        file
                    )
                } catch (e: Exception) {
                    Uri.fromFile(file)
                }

                val ext = file.extension.lowercase()
                val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                    ?: when (ext) {
                        "mp4", "mkv", "avi", "mov", "flv", "webm", "ts" -> "video/*"
                        "mp3", "m4a", "flac", "wav", "aac", "ogg" -> "audio/*"
                        "jpg", "jpeg", "png", "gif", "webp", "bmp" -> "image/*"
                        "pdf" -> "application/pdf"
                        "apk" -> "application/vnd.android.package-archive"
                        "zip", "rar", "7z", "tar", "gz" -> "application/zip"
                        "txt", "log", "json", "xml" -> "text/plain"
                        else -> "*/*"
                    }

                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mimeType)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                activity.startActivity(intent)
            } else if (args.url.startsWith("scan:")) {
                // Refresh Android MediaScanner to update gallery after file deletion or modification
                val scanPath = args.url.removePrefix("scan:").trim()
                try {
                    android.media.MediaScannerConnection.scanFile(
                        activity.applicationContext,
                        arrayOf(scanPath),
                        null,
                        null
                    )
                } catch (e: Exception) {}
            } else {
                val intent = Intent(Intent.ACTION_VIEW, args.url.toUri())
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.applicationContext?.startActivity(intent)
            }
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }
}
`;

  openerPluginPaths.forEach(pluginPath => {
    try {
      fs.writeFileSync(pluginPath, enhancedOpener, 'utf8');
      console.log(`Successfully patched ${pluginPath} with file, folder, and MediaScanner support.`);
    } catch (e) {
      console.warn(`Could not patch ${pluginPath}:`, e.message);
    }
  });
} else {
  console.log('Notice: OpenerPlugin.kt not found in cargo registry (will be patched when downloaded during build)');
}
