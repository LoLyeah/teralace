const fs = require('fs');
const path = require('path');

function getTargetVersion() {
  let v = process.argv[2] || process.env.APP_VERSION || process.env.GITHUB_REF_NAME;
  if (!v) {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    v = pkg.version;
  }
  // Strip leading 'v' or 'refs/tags/v'
  v = v.replace(/^refs\/tags\//, '').replace(/^v/, '');
  return v.trim();
}

const version = getTargetVersion();

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version format: "${version}". Expected X.Y.Z`);
  process.exit(1);
}

console.log(`[sync_version] Synchronizing project version to: ${version}`);

// 1. Update package.json
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`  ✓ Updated package.json -> ${version}`);

// 2. Update src-tauri/tauri.conf.json
const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
console.log(`  ✓ Updated src-tauri/tauri.conf.json -> ${version}`);

// 3. Update src-tauri/Cargo.toml
const cargoPath = path.resolve(__dirname, '../src-tauri/Cargo.toml');
let cargoContent = fs.readFileSync(cargoPath, 'utf8');
const packageSectionRegex = /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m;
if (packageSectionRegex.test(cargoContent)) {
  cargoContent = cargoContent.replace(packageSectionRegex, `$1${version}$2`);
  fs.writeFileSync(cargoPath, cargoContent, 'utf8');
  console.log(`  ✓ Updated src-tauri/Cargo.toml -> ${version}`);
} else {
  console.warn(`  ⚠ Could not find [package] version in src-tauri/Cargo.toml`);
}

// 4. Export to GITHUB_ENV and GITHUB_OUTPUT if present
if (process.env.GITHUB_ENV) {
  try {
    fs.appendFileSync(process.env.GITHUB_ENV, `APP_VERSION=${version}\n`, 'utf8');
    console.log(`  ✓ Exported APP_VERSION=${version} to $GITHUB_ENV`);
  } catch (err) {
    console.error('Failed to write to $GITHUB_ENV', err);
  }
}

if (process.env.GITHUB_OUTPUT) {
  try {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`, 'utf8');
    console.log(`  ✓ Exported version=${version} to $GITHUB_OUTPUT`);
  } catch (err) {
    console.error('Failed to write to $GITHUB_OUTPUT', err);
  }
}

console.log('[sync_version] Completed successfully.');
