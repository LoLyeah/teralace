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

  if (!mainActivity.includes('AndroidClipboard') || !mainActivity.includes('AndroidLogin')) {
    const bridgeMethods = `
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    try {
      class TeralaceClipboard(private val act: android.app.Activity) {
        @android.webkit.JavascriptInterface
        fun readText(): String {
          return try {
            val cm = act.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
            val clip = cm?.primaryClip
            if (clip != null && clip.itemCount > 0) {
              clip.getItemAt(0)?.text?.toString() ?: ""
            } else ""
          } catch (e: Exception) { "" }
        }
      }
      webView.addJavascriptInterface(TeralaceClipboard(this), "AndroidClipboard")
    } catch (e: Exception) {}

    try {
      class TeraboxLoginBridge(private val act: android.app.Activity, private val mainView: android.webkit.WebView) {
        private var pollHandler: android.os.Handler? = null
        private var pollRunnable: Runnable? = null
        private val captured = java.util.concurrent.atomic.AtomicBoolean(false)

        @android.webkit.JavascriptInterface
        fun openLoginDialog() {
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
                settings.userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
              }

              val cm = android.webkit.CookieManager.getInstance()
              cm.setAcceptCookie(true)
              cm.setAcceptThirdPartyCookies(webView, true)

              fun checkCookie(): Boolean {
                try {
                  val c1 = cm.getCookie("https://www.terabox.app") ?: ""
                  val c2 = cm.getCookie("https://www.terabox.com") ?: ""
                  val c3 = cm.getCookie("https://terabox.app") ?: ""
                  val c4 = cm.getCookie("https://terabox.com") ?: ""
                  val all = "$c1; $c2; $c3; $c4"
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
                  if (!uriStr.startsWith("http://") && !uriStr.startsWith("https://")) {
                    return true
                  }
                  return false
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
              pollHandler?.postDelayed(pollRunnable!!, 1000)

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
      webView.addJavascriptInterface(TeraboxLoginBridge(this, webView), "AndroidLogin")
    } catch (e: Exception) {}
  }
`;
    const lastBraceIdx = mainActivity.lastIndexOf('}');
    if (lastBraceIdx !== -1) {
      mainActivity = mainActivity.slice(0, lastBraceIdx) + bridgeMethods + '\n}\n';
      console.log('Injected AndroidClipboard and AndroidLogin JavascriptInterfaces into MainActivity.kt');
    }
  }
  fs.writeFileSync(mainActivityPath, mainActivity, 'utf8');
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
