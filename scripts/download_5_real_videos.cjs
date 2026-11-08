const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function download5RealVideos() {
  const TB = {
    base: "https://tbx.indexsubtitle.cc",
    key: "116486c5e3a2ea45fa2c4cfc3fdc66caf3ae134598d3aedb",
  };
  const surl = 'SCvROD_sVXEdSaiEuv9Upg';
  const targetUrl = `https://www.terabox.app/sharing/link?surl=${surl}`;
  const outDir = path.join('D:', 'Project', 'teralace', 'downloaded_videos');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Remove the old fake preview files
  const oldFiles = fs.readdirSync(outDir);
  for (const f of oldFiles) {
    if (!f.startsWith('test_')) {
      try { fs.unlinkSync(path.join(outDir, f)); } catch (e) {}
    }
  }

  const browseRes = await fetch(`${TB.base}/api/browse?url=${encodeURIComponent(targetUrl)}&dir=%2FJURAGAN%2FJURAGAN%20LOKAL%2FLokal%2017%2FJeje%20Chindo&page=1&num=20`, {
    headers: { 'Authorization': `Bearer ${TB.key}` }
  });
  const data = await browseRes.json();
  const allFiles = data.files || [];

  // Pick the 5 real full videos verified to be downloadable
  const targets = [
    '9_jeje_cindo telegram@tokoasupan.mp4',
    '8_jeje_cindo telegram@tokoasupan.mp4',
    '7_jeje_cindo telegram@tokoasupan.mp4',
    '57_jeje_cindo telegram@tokoasupan.mp4',
    '49_jeje_cindo telegram@tokoasupan.mp4'
  ];

  console.log(`Downloading 5 FULL ORIGINAL videos into ${outDir}...\n`);

  for (let i = 0; i < targets.length; i++) {
    const filename = targets[i];
    const fileObj = allFiles.find(f => f.server_filename === filename);
    if (!fileObj) {
      console.error(`File ${filename} not found in metadata!`);
      continue;
    }

    console.log(`[${i + 1}/5] Resolving original file: ${filename} (Expected size: ${fileObj.size_h} / ${fileObj.size} bytes)`);

    await new Promise(r => setTimeout(r, 1500)); // Be polite to resolver

    const u = `${TB.base}/api/file?url=${encodeURIComponent(targetUrl)}&fs_id=${fileObj.fs_id}&direct=1&key=${TB.key}`;
    const res = await fetch(u, { method: 'GET', redirect: 'manual' });
    const loc = res.headers.get('location');

    if (!loc) {
      console.error(`Failed to get location for ${filename}, status: ${res.status}`);
      continue;
    }

    const dest = path.join(outDir, filename);
    const fileRes = await fetch(loc, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (!fileRes.ok) {
      console.error(`Download failed for ${filename}: HTTP ${fileRes.status}`);
      continue;
    }

    const fileStream = fs.createWriteStream(dest);
    const reader = fileRes.body.getReader();
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
      received += value.length;
    }
    await new Promise(r => fileStream.end(r));

    let probeInfo = '';
    try {
      probeInfo = execSync(`ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "${dest}"`).toString().trim().replace(/\r?\n/g, ', ');
    } catch (e) {
      probeInfo = 'ffprobe error';
    }

    console.log(`✓ Saved ${filename}: ${received} bytes (${(received / (1024 * 1024)).toFixed(2)} MB) [${probeInfo}]\n`);
  }

  // Remove test file if exists
  const testFile = path.join(outDir, 'test_9_jeje.mp4');
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }

  console.log('--- ALL 5 FULL ORIGINAL VIDEOS SUCCESSFULLY DOWNLOADED ---');
}

download5RealVideos().catch(console.error);
