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
    }

    // 2b. Update or create ic_launcher_background.xml in values/
    const bgXmlPath = path.join(valuesDir, 'ic_launcher_background.xml');
    if (fs.existsSync(bgXmlPath)) {
      let bgXml = fs.readFileSync(bgXmlPath, 'utf8');
      bgXml = bgXml.replace(/#(?:FFFFFF|ffffff|[0-9a-fA-F]{6})/g, '#0a101d');
      fs.writeFileSync(bgXmlPath, bgXml, 'utf8');
      console.log('Updated values/ic_launcher_background.xml to #0a101d');
    } else {
      const newBgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0a101d</color>\n</resources>\n`;
      fs.writeFileSync(bgXmlPath, newBgXml, 'utf8');
      console.log('Created values/ic_launcher_background.xml with brand theme #0a101d');
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
