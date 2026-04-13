const fs = require('fs');

const FINAL_OUTPUT_FILE = 'all_uzb_iptv_providers.m3u8';

const CINERAMA_SOURCE = 'Cinerama_UZ.m3u8';
const SARKOR_SOURCE = 'Sarkor_TV.m3u8';
const TVCOM_SOURCE = 'tvcom.uz.m3u8';
const ZORPLAY_SOURCE = 'zorplay_uz.m3u8';
const TELECOMTV_SOURCE = 'telecomtv_uz.m3u8';
const ITV_SOURCE = 'itv_uz.m3u8';

const CINERAMA_GROUP_BASE = 'Cinerama UZ 🇺🇿';
const SARKOR_GROUP_BASE = 'Sarkor TV 🇺🇿';
const TVCOM_GROUP_BASE = 'TVcom.UZ 🇺🇿';
const ZORPLAY_GROUP_BASE = "ZO'R PLAY 🇺🇿";
const TELECOMTV_GROUP_BASE = 'TelecomTV UZ 🇺🇿';
const ITV_GROUP_BASE = 'iTV UZ 🇺🇿';

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
  let line = String(extinfLine).trim();

  if (/group-title="[^"]*"/i.test(line)) {
    return line.replace(/group-title="[^"]*"/ig, `group-title="${safeTitle}"`);
  }

  return line.replace(/^#EXTINF:-1\b/i, `#EXTINF:-1 group-title="${safeTitle}"`);
}

function applyGroupTitleCountToBlockEntries(entries, baseTitle) {
  const count = entries.length;
  const titled = `${baseTitle} (${count} ta)`;

  for (const entry of entries) {
    if (entry.block && entry.block.length > 0) {
      entry.block[0] = replaceOrInsertGroupTitle(entry.block[0], titled);
    }
  }

  return entries;
}

function readLocalText(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
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

      if (next) {
        block.push(next);
      }

      if (isUrlLine(next)) {
        url = next;
        lastJ = j;
        break;
      }

      lastJ = j;
    }

    if (!url) {
      i = lastJ;
      continue;
    }

    entries.push({
      sourceName,
      url,
      block
    });

    i = lastJ;
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
  console.log('1) Cinerama_UZ.m3u8 юкланяпти...');
  const cineramaText = readLocalText(CINERAMA_SOURCE);
  const cineramaEntries = parseGenericM3U(cineramaText, CINERAMA_SOURCE);
  applyGroupTitleCountToBlockEntries(cineramaEntries, CINERAMA_GROUP_BASE);

  console.log('2) Sarkor_TV.m3u8 юкланяпти...');
  const sarkorText = readLocalText(SARKOR_SOURCE);
  const sarkorEntries = parseGenericM3U(sarkorText, SARKOR_SOURCE);
  applyGroupTitleCountToBlockEntries(sarkorEntries, SARKOR_GROUP_BASE);

  console.log('3) tvcom.uz.m3u8 юкланяпти...');
  const tvcomText = readLocalText(TVCOM_SOURCE);
  const tvcomEntries = parseGenericM3U(tvcomText, TVCOM_SOURCE);
  applyGroupTitleCountToBlockEntries(tvcomEntries, TVCOM_GROUP_BASE);

  console.log("4) zorplay_uz.m3u8 юкланяпти...");
  const zorplayText = readLocalText(ZORPLAY_SOURCE);
  const zorplayEntries = parseGenericM3U(zorplayText, ZORPLAY_SOURCE);
  applyGroupTitleCountToBlockEntries(zorplayEntries, ZORPLAY_GROUP_BASE);

  console.log("5) telecomtv_uz.m3u8 юкланяпти...");
  const telecomtvText = readLocalText(TELECOMTV_SOURCE);
  const telecomtvEntries = parseGenericM3U(telecomtvText, TELECOMTV_SOURCE);
  applyGroupTitleCountToBlockEntries(telecomtvEntries, TELECOMTV_GROUP_BASE);

  console.log("6) itv_uz.m3u8 юкланяпти...");
  const itvText = readLocalText(ITV_SOURCE);
  const itvEntries = parseGenericM3U(itvText, ITV_SOURCE);
  applyGroupTitleCountToBlockEntries(itvEntries, ITV_GROUP_BASE);

  console.log('7) Ҳаммаси битта файлга merge қилиняпти...');
  const finalMergedText = mergePlaylistBlocksInOrder([
    cineramaEntries,
    sarkorEntries,
    tvcomEntries,
    zorplayEntries,
    telecomtvEntries,
    itvEntries
  ]);

  fs.writeFileSync(FINAL_OUTPUT_FILE, finalMergedText, 'utf8');

  const finalCount = (finalMergedText.match(/^#EXTINF:/gm) || []).length;

  console.log(`Якуний файл: ${FINAL_OUTPUT_FILE}`);
  console.log(`Cinerama: ${cineramaEntries.length} ta`);
  console.log(`Sarkor: ${sarkorEntries.length} ta`);
  console.log(`TVcom: ${tvcomEntries.length} ta`);
  console.log(`ZO'R PLAY: ${zorplayEntries.length} ta`);
  console.log(`TelecomTV: ${telecomtvEntries.length} ta`);
  console.log(`iTV: ${itvEntries.length} ta`);
  console.log(`Якуний каналлар сони: ${finalCount} ta`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
