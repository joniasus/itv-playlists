const https = require('https');
const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const TARGET_GROUP = 'group-title="Itv.uz (🇺🇿)"';
const OUTPUT_FILE = 'itv_uz_only.m3u';

// Айнан шу тартибда чиқади:
const PRIORITY_STREAMS = [
  1286, 1014, 1012, 1004, 1010, 1009, 4000, 4001, 1015, 1209,
  1011, 1006, 1496, 1285, 1497, 1204, 4007, 4008, 1494, 1486, 1488
];

// Тез индекс олиш учун map
const PRIORITY_INDEX = new Map(
  PRIORITY_STREAMS.map((num, idx) => [num, idx])
);

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const code = res.statusCode || 0;

      if (code >= 300 && code < 400 && res.headers.location) {
        if (redirects >= 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        resolve(download(res.headers.location, redirects + 1));
        return;
      }

      if (code !== 200) {
        reject(new Error(`HTTP ${code}`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function isUrlLine(line) {
  return /^https?:\/\//i.test(String(line).trim());
}

function getChannelName(extinfLine) {
  const idx = extinfLine.lastIndexOf(',');
  if (idx === -1) return extinfLine.trim();
  return extinfLine.slice(idx + 1).trim();
}

// URL дан .../<raqam>/index.m3u8 ни олади
function extractStreamNumber(url) {
  if (!url) return Number.MAX_SAFE_INTEGER;

  const m = String(url).match(/\/(\d+)\/index\.m3u8(?:\?|$)/i);
  if (!m) return Number.MAX_SAFE_INTEGER;

  return parseInt(m[1], 10);
}

function getPriorityIndex(streamNumber) {
  return PRIORITY_INDEX.has(streamNumber)
    ? PRIORITY_INDEX.get(streamNumber)
    : Number.MAX_SAFE_INTEGER;
}

function extractEntries(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.startsWith('#EXTINF:')) continue;
    if (!line.includes(TARGET_GROUP)) continue;

    const block = [line];
    let url = '';
    let lastJ = i;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];

      if (next.startsWith('#EXTINF:')) {
        lastJ = j - 1;
        break;
      }

      if (next.trim() !== '') {
        block.push(next);
      }

      if (isUrlLine(next)) {
        url = next.trim();
        lastJ = j;
        break;
      }

      lastJ = j;
    }

    const streamNumber = extractStreamNumber(url);

    entries.push({
      name: getChannelName(line),
      block,
      url,
      streamNumber,
      priorityIndex: getPriorityIndex(streamNumber)
    });

    i = lastJ;
  }

  return entries;
}

function buildSortedM3U(text) {
  const entries = extractEntries(text);

  entries.sort((a, b) => {
    // 1) Аввал PRIORITY_STREAMS ичидагилар
    if (a.priorityIndex !== b.priorityIndex) {
      return a.priorityIndex - b.priorityIndex;
    }

    const aInPriority = a.priorityIndex !== Number.MAX_SAFE_INTEGER;
    const bInPriority = b.priorityIndex !== Number.MAX_SAFE_INTEGER;

    // 2) Иккаласи ҳам priority да бўлса, массив тартиби етарли
    if (aInPriority && bInPriority) {
      return 0;
    }

    // 3) Қолганлари stream number бўйича
    if (a.streamNumber !== b.streamNumber) {
      return a.streamNumber - b.streamNumber;
    }

    // 4) Охирида ном бўйича
    return a.name.localeCompare(b.name, ['uz', 'ru', 'en'], {
      sensitivity: 'base',
      numeric: true
    });
  });

  const out = ['#EXTM3U'];
  for (const entry of entries) {
    out.push(...entry.block);
  }

  return out.join('\n').trimEnd() + '\n';
}

async function main() {
  const text = await download(SOURCE_URL);
  const filteredSorted = buildSortedM3U(text);

  fs.writeFileSync(OUTPUT_FILE, filteredSorted, 'utf8');

  const count = (filteredSorted.match(/^#EXTINF:/gm) || []).length;
  console.log(`Saved ${OUTPUT_FILE} with ${count} channels (priority sorted).`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
