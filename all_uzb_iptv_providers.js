const fs = require('fs');
const https = require('https');
const http = require('http');

const FINAL_OUTPUT_FILE = 'all_uzb_iptv_providers.m3u8';

const SOURCES = [
  { file: 'Cinerama_UZ.m3u8',  group: 'Cinerama UZ 🇺🇿' },
  { file: 'Sarkor_TV.m3u8',    group: 'Sarkor TV UZ 🇺🇿' },
  { file: 'tvcom_uz.m3u8',     group: 'TVcom UZ 🇺🇿' },
  { file: 'zorplay_uz.m3u8',   group: "ZO'R PLAY UZ 🇺🇿" },
  { file: 'telecomtv_uz.m3u8', group: 'TelecomTV UZ 🇺🇿' },
  { file: 'radio_uz.m3u8',     group: 'Radio UZ 🇺🇿' },
  { file: 'itv_uz.m3u8',       group: 'iTV UZ 🇺🇿' },
  { url:  'https://salomtv.odatly.uz/playlists.m3u8', group: 'SalomTV UZ 🇺🇿' }
];

function fetchRemoteText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, {
      headers: { Accept: 'application/vnd.apple.mpegurl, text/plain, */*' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(20000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .trim();
}

function isUrlLine(line) {
  return /^https?:\/\//i.test(String(line).trim());
}

function replaceOrInsertGroupTitle(extinfLine, newGroupTitle) {
  const safeTitle = escapeAttr(newGroupTitle);
  const line = String(extinfLine).trim();

  if (/group-title="[^"]*"/i.test(line)) {
    return line.replace(/group-title="[^"]*"/ig, `group-title="${safeTitle}"`);
  }

  return line.replace(/^#EXTINF:-1\b/i, `#EXTINF:-1 group-title="${safeTitle}"`);
}

function readLocalTextIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

function parseGenericM3U(text, sourceName) {
  const lines = String(text).split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;

    const block = [line];
    let url = '';
    let lastJ = i;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();

      if (next.startsWith('#EXTINF:')) {
        lastJ = j - 1;
        break;
      }

      if (next) block.push(next);

      if (isUrlLine(next)) {
        url = next;
        lastJ = j;
        break;
      }

      lastJ = j;
    }

    if (url) {
      entries.push({ sourceName, url, block });
    }

    i = lastJ;
  }

  return entries;
}

function applyGroupTitleCount(entries, baseTitle) {
  const titleWithCount = `${baseTitle} (${entries.length} ta)`;

  for (const entry of entries) {
    entry.block[0] = replaceOrInsertGroupTitle(entry.block[0], titleWithCount);
  }

  return entries;
}

function mergePlaylistBlocksInOrder(playlists) {
  const out = ['#EXTM3U'];

  for (const playlist of playlists) {
    for (const entry of playlist) {
      out.push(...entry.block);
    }
  }

  return out.join('\n').trimEnd() + '\n';
}

async function main() {
  const parsedPlaylists = [];
  const skippedFiles = [];

  for (let i = 0; i < SOURCES.length; i++) {
    const { file, url, group } = SOURCES[i];
    const label = file || url;
    console.log(`${i + 1}) ${label} текшириляпти...`);

    let text = null;
    try {
      if (url) {
        text = await fetchRemoteText(url);
      } else if (file) {
        text = readLocalTextIfExists(file);
      }
    } catch (err) {
      console.log(`   ⚠️ Yuklab olinmadi (${err.message}), skip: ${label}`);
      skippedFiles.push(label);
      continue;
    }

    if (text === null || text === '') {
      console.log(`   ⚠️ Topilmadi, skip qilindi: ${label}`);
      skippedFiles.push(label);
      continue;
    }

    const entries = parseGenericM3U(text, label);

    if (entries.length === 0) {
      console.log(`   ⚠️ Kanal topilmadi, skip qilindi: ${label}`);
      skippedFiles.push(label);
      continue;
    }

    applyGroupTitleCount(entries, group);

    parsedPlaylists.push({
      file: label,
      group,
      entries
    });

    console.log(`   ✅ ${entries.length} ta kanal topildi`);
  }

  if (parsedPlaylists.length === 0) {
    console.error('Build failed: birorta ham yaroqli playlist topilmadi');
    process.exit(1);
  }

  console.log(`${SOURCES.length + 1}) Ҳаммаси битта файлга merge қилиняпти...`);

  const finalMergedText = mergePlaylistBlocksInOrder(
    parsedPlaylists.map((x) => x.entries)
  );

  fs.writeFileSync(FINAL_OUTPUT_FILE, finalMergedText, 'utf8');

  const finalCount = (finalMergedText.match(/^#EXTINF:/gm) || []).length;

  console.log(`\nЯкуний файл: ${FINAL_OUTPUT_FILE}`);

  for (const item of parsedPlaylists) {
    console.log(`${item.group}: ${item.entries.length} ta`);
  }

  if (skippedFiles.length > 0) {
    console.log('\nSkip қилинган файллар:');
    for (const file of skippedFiles) {
      console.log(`- ${file}`);
    }
  }

  console.log(`\nЯкуний каналлар сони: ${finalCount} ta`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
