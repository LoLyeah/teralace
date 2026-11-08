const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

// 1. Determine Version and Tag
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

let currentTag = process.env.GITHUB_REF_NAME || `v${pkg.version}`;
currentTag = currentTag.replace(/^refs\/tags\//, '');
const version = currentTag.replace(/^v/, '');

console.log(`[generate_changelog] Current tag: ${currentTag} (version: ${version})`);

// 2. Determine Previous Tag
let prevTag = '';
try {
  // Try git describe first using ~1 (cross-platform compatible without cmd caret escaping)
  prevTag = exec(`git describe --tags --abbrev=0 "${currentTag}~1" 2>nul`);
} catch (e) {
  prevTag = '';
}

if (!prevTag) {
  // Fallback: list tags sorted by version, pick the one right before current
  const allTags = exec('git tag --sort=-v:refname').split('\n').map(t => t.trim()).filter(Boolean);
  const curIdx = allTags.indexOf(currentTag);
  if (curIdx >= 0 && curIdx < allTags.length - 1) {
    prevTag = allTags[curIdx + 1];
  } else if (allTags.length > 0 && allTags[0] !== currentTag) {
    prevTag = allTags[0];
  }
}

// v1.1.2 was never released; roll its commits into v1.2.0
if (prevTag === 'v1.1.2' || prevTag === '1.1.2') {
  prevTag = 'v1.1.1';
}

console.log(`[generate_changelog] Previous tag: ${prevTag || '(initial release / all history)'}`);

// 3. Fetch Commits
let logRange = prevTag ? `${prevTag}..HEAD` : 'HEAD';
let rawLogs = exec(`git log ${logRange} --pretty=format:"%H|%h|%s"`);
let commits = [];

if (rawLogs) {
  commits = rawLogs.split('\n').map(line => {
    const parts = line.split('|');
    return {
      hash: parts[0],
      short: parts[1],
      message: parts.slice(2).join('|').trim()
    };
  }).filter(c => c.message && !c.message.startsWith('Merge '));
}

// 4. Categorize commits
const categories = {
  features: { title: '🚀 Features & Improvements', items: [] },
  fixes: { title: '🐛 Bug Fixes', items: [] },
  ci: { title: '🛠️ Build, CI & Platform Packaging', items: [] },
  docs: { title: '📝 Documentation', items: [] },
  others: { title: '📋 Other Changes', items: [] }
};

for (const commit of commits) {
  const msg = commit.message;
  const link = `([${commit.short}](https://github.com/LoLyeah/teralace/commit/${commit.hash}))`;
  const entry = `* ${msg} ${link}`;

  if (/^feat(\(.*\))?:/i.test(msg)) {
    categories.features.items.push(entry);
  } else if (/^fix(\(.*\))?:/i.test(msg) || /^perf(\(.*\))?:/i.test(msg)) {
    categories.fixes.items.push(entry);
  } else if (/^(ci|chore|build|refactor|test)(\(.*\))?:/i.test(msg)) {
    categories.ci.items.push(entry);
  } else if (/^docs?(\(.*\))?:/i.test(msg) || /readme/i.test(msg)) {
    categories.docs.items.push(entry);
  } else {
    categories.others.items.push(entry);
  }
}

// 5. Build Markdown Body
let md = [];
md.push(`## 🚀 TeraLace v${version}`);
md.push(``);
md.push(`Fast, multi-threaded TeraBox file downloader for Windows, macOS, Linux, and Android built with Tauri v2 and Rust.`);
md.push(``);

// What's Changed
md.push(`### 📄 What's Changed`);
let hasEntries = false;
for (const key of ['features', 'fixes', 'ci', 'docs', 'others']) {
  const cat = categories[key];
  if (cat.items.length > 0) {
    hasEntries = true;
    md.push(`\n#### ${cat.title}`);
    for (const item of cat.items) {
      md.push(item);
    }
  }
}

if (!hasEntries) {
  md.push(`* Routine performance and stability enhancements across all platforms.`);
}

if (prevTag) {
  md.push(``);
  md.push(`**Full Changelog**: https://github.com/LoLyeah/teralace/compare/${prevTag}...${currentTag}`);
}

md.push(``);
md.push(`### 📦 Download Packages`);
md.push(`| Platform | Format | Filename | Description |`);
md.push(`|:---|:---|:---|:---|`);
md.push(`| **Windows** | Setup Installer | \`TeraLace_${version}_x64-setup.exe\` | Recommended standard installer (x64) |`);
md.push(`| **Windows** | Portable Zip | \`TeraLace_${version}_x64_portable.zip\` | Standalone portable archive (No install) |`);
md.push(`| **macOS** | Universal DMG | \`TeraLace_${version}_universal.dmg\` | Apple Silicon (M1/M2/M3/M4) + Intel |`);
md.push(`| **Linux** | AppImage | \`TeraLace_${version}_amd64.AppImage\` | Portable standalone AppImage (x86_64) |`);
md.push(`| **Linux** | Debian / Ubuntu | \`TeraLace_${version}_amd64.deb\` | Lightweight native package (.deb) |`);
md.push(`| **Android** | Universal APK | \`TeraLace_${version}_universal.apk\` | Versioned signed APK for all Android devices |`);

const markdownContent = md.join('\n');

// 6. Write to RELEASE_NOTES.md
const outPath = path.resolve(__dirname, '../RELEASE_NOTES.md');
fs.writeFileSync(outPath, markdownContent + '\n', 'utf8');
console.log(`[generate_changelog] Generated ${outPath}`);

// 7. Output to GitHub Actions environment if present
if (process.env.GITHUB_OUTPUT) {
  try {
    const delimiter = `DELIMITER_${Date.now()}`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `body<<${delimiter}\n${markdownContent}\n${delimiter}\n`, 'utf8');
    console.log('[generate_changelog] Exported body to $GITHUB_OUTPUT');
  } catch (err) {
    console.error('Failed to write to $GITHUB_OUTPUT', err);
  }
}
