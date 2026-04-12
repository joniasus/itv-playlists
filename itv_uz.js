const https = require('https');
const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const TARGET_GROUP = 'group-title="Itv.uz (🇺🇿)"';

const OUTPUT_FILE = 'iTV_UZ.m3u8';
const ITV_GROUP_BASE = 'iTV UZ 🇺🇿';

const API_START_ID = 1;
const API_END_ID = 300;

const PRIORITY_STREAMS_RAW =
  '1286,1014,1012,1004,1010,1009,4000,4001,1015,1209,1011,1006,1496,1285,1497,1204,4007,4008,1494,1486,1488';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const API_CONCURRENCY = 12;

function parsePriorityList(raw) {
  return String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));
}

const PRIORITY_STREAMS = parsePriorityList(PRIORITY_STREAMS_RAW);
const PRIORITY_INDEX = new Map(PRIORITY_STREAMS.map((num, idx) => [num, idx]));

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .trim();
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*'
        }
      },
      (res) => {
        const code = res.statusCode || 0;

        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();

          if (redirects >= MAX_REDIRECTS) {
            reject(new Error('Too many redirects'));
            return;
          }

          resolve(httpGet(res.headers.location, redirects + 1));
          return;
        }

        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: code,
            headers: res.headers,
            body: data
          });
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);
  });
}

async function downloadText(url) {
  const res = await httpGet(url);

  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode} for ${url}`);
  }

  return res.body;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isUrlLine(line) {
  return /^https?:\/\//i.test(String(line).trim());
}

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

function getNameFromExtinf(extinfLine) {
  const idx = String(extinfLine).lastIndexOf(',');
  if (idx === -1) return cleanText(extinfLine);
  return cleanText(extinfLine.slice(idx + 1));
}

function isRadioLike(title, description = '') {
  const text = `${cleanText(title)} ${cleanText(description)}`;
  return /\bFM\b|radio|радио/i.test(text);
}

function replaceOrInsertGroupTitle(extinfLine, newGroupTitle) {
  const safeTitle = escapeAttr(newGroupTitle);
  let line = String(extinfLine).trim();

  if (/group-title="[^"]*"/i.test(line)) {
    return line.replace(/group-title="[^"]*"/ig, `group-title="${safeTitle}"`);
  }

  return line.replace(/^#EXTINF:-1\b/i, `#EXTINF:-1 group-title="${safeTitle}"`);
}

function applyGroupTitleCountToExtinfEntries(entries, baseTitle) {
  const count = entries.length;
  const titled = `${baseTitle} (${count} ta)`;

  for (const entry of entries) {
    entry.extinf = replaceOrInsertGroupTitle(entry.extinf, titled);
  }

  return entries;
}

function parseSourceM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.startsWith('#EXTINF:')) continue;
    if (!line.includes(TARGET_GROUP)) continue;

    const extinf = line
      .trim()
      .replace(/group-title="Itv\.uz \(🇺🇿\)"/g, `group-title="${ITV_GROUP_BASE}"`);

    let url = '';
    let lastJ = i;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();

      if (next.startsWith('#EXTINF:')) {
        lastJ = j - 1;
        break;
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

    const title = getNameFromExtinf(extinf);
    const streamNumber = extractStreamNumber(url);

    entries.push({
      sourceType: 'source',
      title,
      extinf,
      url,
      streamNumber,
      priorityIndex: getPriorityIndex(streamNumber),
      isRadio: isRadioLike(title, '')
    });

    i = lastJ;
  }

  return entries;
}

async function fetchApiChannel(channelId) {
  const url = `https://api.itv.uz/v2/cards/channels/show?channelId=${channelId}`;

  try {
    const body = await downloadText(url);
    const json = parseJsonSafe(body);

    if (!json || json.code !== 200 || !json.data) {
      return null;
    }

    const data = json.data;
    const files = data.files || {};

    const title = cleanText(data.channelTitle);
    const description = cleanText(data.channelDescription);
    const posterUrl = cleanText(files.posterUrl);
    const streamUrl = cleanText(files.streamUrl);
    const streamNumber = extractStreamNumber(streamUrl);

    if (!title || !streamUrl || !Number.isFinite(streamNumber) || streamNumber === Number.MAX_SAFE_INTEGER) {
      return null;
    }

    return {
      sourceType: 'api',
      channelId,
      title,
      posterUrl,
      url: streamUrl,
      streamNumber,
      priorityIndex: getPriorityIndex(streamNumber),
      isRadio: isRadioLike(title, description),
      extinf:
        `#EXTINF:-1 group-title="${ITV_GROUP_BASE}"` +
        (posterUrl ? ` tvg-logo="${escapeAttr(posterUrl)}"` : '') +
        `, ${title}`
    };
  } catch {
    return null;
  }
}

async function runParallel(items, worker, limit) {
  let index = 0;

  async function runner() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  }

  const workers = [];
  const count = Math.min(limit, items.length);

  for (let i = 0; i < count; i++) {
    workers.push(runner());
  }

  await Promise.all(workers);
}

async function buildApiEntries() {
  const ids = [];
  for (let i = API_START_ID; i <= API_END_ID; i++) {
    ids.push(i);
  }

  const streamMap = new Map();

  await runParallel(
    ids,
    async (channelId, idx) => {
      const item = await fetchApiChannel(channelId);

      if (item && !streamMap.has(item.streamNumber)) {
        streamMap.set(item.streamNumber, item);
      }

      if ((idx + 1) % 25 === 0 || idx === ids.length - 1) {
        console.log(`API текширилди: ${idx + 1}/${ids.length}`);
      }
    },
    API_CONCURRENCY
  );

  return Array.from(streamMap.values());
}

function mergeEntries(sourceEntries, apiEntries) {
  const sourceStreamSet = new Set();
  const merged = [];

  for (const entry of sourceEntries) {
    merged.push(entry);

    if (
      Number.isFinite(entry.streamNumber) &&
      entry.streamNumber !== Number.MAX_SAFE_INTEGER
    ) {
      sourceStreamSet.add(entry.streamNumber);
    }
  }

  for (const entry of apiEntries) {
    if (sourceStreamSet.has(entry.streamNumber)) {
      continue;
    }

    merged.push(entry);
  }

  return merged;
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    if (a.isRadio !== b.isRadio) {
      return a.isRadio ? 1 : -1;
    }

    if (a.priorityIndex !== b.priorityIndex) {
      return a.priorityIndex - b.priorityIndex;
    }

    const aInPriority = a.priorityIndex !== Number.MAX_SAFE_INTEGER;
    const bInPriority = b.priorityIndex !== Number.MAX_SAFE_INTEGER;

    if (aInPriority && bInPriority) {
      return 0;
    }

    if (a.streamNumber !== b.streamNumber) {
      return a.streamNumber - b.streamNumber;
    }

    return a.title.localeCompare(b.title, ['uz', 'ru', 'en'], {
      sensitivity: 'base',
      numeric: true
    });
  });

  return entries;
}

function buildM3U(entries) {
  const out = ['#EXTM3U'];

  for (const entry of entries) {
    out.push(entry.extinf);
    out.push(`#EXTVLCOPT:http-user-agent=${USER_AGENT}`);
    out.push(entry.url);
  }

  return out.join('\n').trimEnd() + '\n';
}

async function main() {
  console.log('1) iTV source юкланяпти...');
  const sourceText = await downloadText(SOURCE_URL);

  console.log('2) iTV source фильтрланяпти...');
  const sourceEntries = parseSourceM3U(sourceText);

  console.log('3) iTV API channelId=1..300 текшириляпти...');
  const apiEntries = await buildApiEntries();

  console.log('4) iTV source + API бирлаштириляпти...');
  const mergedItv = mergeEntries(sourceEntries, apiEntries);

  console.log('5) iTV умумий тартибланяпти...');
  sortEntries(mergedItv);
  applyGroupTitleCountToExtinfEntries(mergedItv, ITV_GROUP_BASE);

  console.log('6) iTV_UZ.m3u8 тайёрланяпти...');
  const m3uText = buildM3U(mergedItv);

  fs.writeFileSync(OUTPUT_FILE, m3uText, 'utf8');

  console.log(`Якуний файл: ${OUTPUT_FILE}`);
  console.log(`SOURCE: ${sourceEntries.length} та`);
  console.log(`API: ${apiEntries.length} та`);
  console.log(`MERGED iTV: ${mergedItv.length} та`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});