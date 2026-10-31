const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '../src-tauri/gen/android/app/src/main/AndroidManifest.xml');

if (fs.existsSync(manifestPath)) {
  let content = fs.readFileSync(manifestPath, 'utf8');
  const permissions = [
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '    <uses-permission android:name="android.permission.WAKE_LOCK" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />',
    '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
  ].join('\n');

  if (!content.includes('android.permission.INTERNET')) {
    content = content.replace('<application', `${permissions}\n    <application`);
    fs.writeFileSync(manifestPath, content, 'utf8');
    console.log('Successfully injected Android permissions into AndroidManifest.xml');
  } else {
    console.log('Permissions already present in AndroidManifest.xml');
  }
} else {
  console.log('Warning: AndroidManifest.xml not found at', manifestPath);
}

const gradlePath = path.resolve(__dirname, '../src-tauri/gen/android/app/build.gradle.kts');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  if (!gradle.includes('signingConfigs.getByName("debug")')) {
    gradle = gradle.replace(
      'getByName("release") {',
      'getByName("release") {\n            signingConfig = signingConfigs.getByName("debug")'
    );
    fs.writeFileSync(gradlePath, gradle, 'utf8');
    console.log('Configured debug signingConfig for release APK in build.gradle.kts');
  }
}
