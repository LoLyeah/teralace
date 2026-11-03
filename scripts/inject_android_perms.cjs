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

  fs.writeFileSync(manifestPath, content, 'utf8');
} else {
  console.log('Warning: AndroidManifest.xml not found at', manifestPath);
}

// 2. Android Adaptive Icon Background Color (#0a101d instead of default white #ffffff)
const resValuesDir = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/res/values');
if (fs.existsSync(resValuesDir)) {
  const bgXmlPath = path.join(resValuesDir, 'ic_launcher_background.xml');
  if (fs.existsSync(bgXmlPath)) {
    let bgXml = fs.readFileSync(bgXmlPath, 'utf8');
    bgXml = bgXml.replace(/#(?:FFFFFF|ffffff|[0-9a-fA-F]{6})/g, '#0a101d');
    fs.writeFileSync(bgXmlPath, bgXml, 'utf8');
    console.log('Updated ic_launcher_background.xml to match brand theme #0a101d');
  } else {
    // Create it if it doesn't exist
    const newBgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0a101d</color>\n</resources>\n`;
    fs.writeFileSync(bgXmlPath, newBgXml, 'utf8');
    console.log('Created ic_launcher_background.xml with brand theme #0a101d');
  }

  const colorsXmlPath = path.join(resValuesDir, 'colors.xml');
  if (fs.existsSync(colorsXmlPath)) {
    let colorsXml = fs.readFileSync(colorsXmlPath, 'utf8');
    if (colorsXml.includes('ic_launcher_background')) {
      colorsXml = colorsXml.replace(/(<color name="ic_launcher_background">)[^<]+(<\/color>)/, '$1#0a101d$2');
      fs.writeFileSync(colorsXmlPath, colorsXml, 'utf8');
      console.log('Updated colors.xml ic_launcher_background to #0a101d');
    }
  }

  // Synchronize custom adaptive foreground icons if present in src-tauri/icons/android
  const iconsAndroidDir = path.resolve(__dirname, '../src-tauri/icons/android');
  const resMipmapDir = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/res');
  if (fs.existsSync(iconsAndroidDir)) {
    const densities = ['mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
    densities.forEach(d => {
      const srcFg = path.join(iconsAndroidDir, d, 'ic_launcher_foreground.png');
      const targetFg = path.join(resMipmapDir, d, 'ic_launcher_foreground.png');
      if (fs.existsSync(srcFg) && fs.existsSync(path.dirname(targetFg))) {
        fs.copyFileSync(srcFg, targetFg);
      }
    });
    console.log('Synchronized adaptive foreground mipmaps into Android app resource directory');
  }
}
