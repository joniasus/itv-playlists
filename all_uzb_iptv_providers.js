const https = require('https');
const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const TARGET_GROUP = 'group-title="Itv.uz (🇺🇿)"';

const OUTPUT_FILE = 'itv_uz_only.m3u';
const FINAL_OUTPUT_FILE = 'all_uzb_iptv_providers.m3u8';

// Бу ерга GitHub raw URL'ларни қўйинг
const CINERAMA_URL = 'https://raw.githubusercontent.com/joniasus/itv-playlists/refs/heads/main/Cinerama_UZ.m3u8';
const SARKOR_URL = 'https://raw.githubusercontent.com/joniasus/itv-playlists/refs/heads/main/Sarkor_TV.m3u8';

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

function parseSourceM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.startsWith('#EXTINF:')) continue;
    if (!line.includes(TARGET_GROUP)) continue;

    const extinf = line
      .trim()
      .replace(/group-title="Itv\.uz \(🇺🇿\)"/g, 'group-title="iTV UZ 🇺🇿"');

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
        `#EXTINF:-1 group-title="iTV UZ 🇺🇿"` +
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

  let skippedApiDuplicates = 0;
  let addedApiOnly = 0;

  for (const entry of apiEntries) {
    if (sourceStreamSet.has(entry.streamNumber)) {
      skippedApiDuplicates++;
      continue;
    }

    merged.push(entry);
    addedApiOnly++;
  }

  return {
    merged,
    skippedApiDuplicates,
    addedApiOnly
  };
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    // Радиолар доим энг пастда
    if (a.isRadio !== b.isRadio) {
      return a.isRadio ? 1 : -1;
    }

    // Аввал priority list ичидагилар
    if (a.priorityIndex !== b.priorityIndex) {
      return a.priorityIndex - b.priorityIndex;
    }

    const aInPriority = a.priorityIndex !== Number.MAX_SAFE_INTEGER;
    const bInPriority = b.priorityIndex !== Number.MAX_SAFE_INTEGER;

    // Иккаласи ҳам priority да бўлса, list тартиби сақланади
    if (aInPriority && bInPriority) {
      return 0;
    }

    // Қолганлари stream рақами бўйича
    if (a.streamNumber !== b.streamNumber) {
      return a.streamNumber - b.streamNumber;
    }

    // Охирида ном бўйича
    return a.title.localeCompare(b.title, ['uz', 'ru', 'en'], {
      sensitivity: 'base',
      numeric: true
    });
  });

  return entries;
}

function buildOutput(entries) {
  const out = ['#EXTM3U'];

  for (const entry of entries) {
    out.push(entry.extinf);
    out.push(`#EXTVLCOPT:http-user-agent=${USER_AGENT}`);
    out.push(entry.url);
  }

  return out.join('\n').trimEnd() + '\n';
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
  console.log('1) GitHub M3U юкланяпти...');
  const sourceText = await downloadText(SOURCE_URL);

  console.log('2) GitHub M3U дан фильтрланяпти...');
  const sourceEntries = parseSourceM3U(sourceText);
  console.log(`GitHub рўйхат: ${sourceEntries.length} та`);

  console.log('3) API channelId=1..300 текшириляпти...');
  const apiEntries = await buildApiEntries();
  console.log(`API рўйхат: ${apiEntries.length} та`);

  console.log('4) Икки рўйхат бирлаштириляпти...');
  const { merged, skippedApiDuplicates, addedApiOnly } = mergeEntries(sourceEntries, apiEntries);

  console.log(`API дубликат рад қилинди: ${skippedApiDuplicates} та`);
  console.log(`API-only қўшилди: ${addedApiOnly} та`);

  console.log('5) Умумий тартибланяпти...');
  sortEntries(merged);

  console.log('6) OUTPUT_FILE ясаляпти...');
  const output = buildOutput(merged);
  fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

  console.log(`Тайёр: ${OUTPUT_FILE}`);
  console.log(`Жами: ${merged.length} та`);
  console.log(`Priority: ${PRIORITY_STREAMS.join(', ')}`);

  console.log('7) Cinerama_UZ.m3u8 юкланяпти...');
  const cineramaText = await downloadText(CINERAMA_URL);
  const cineramaEntries = parseGenericM3U(cineramaText, 'Cinerama_UZ.m3u8');
  console.log(`Cinerama_UZ: ${cineramaEntries.length} та`);

  console.log('8) Sarkor_TV.m3u8 юкланяпти...');
  const sarkorText = await downloadText(SARKOR_URL);
  const sarkorEntries = parseGenericM3U(sarkorText, 'Sarkor_TV.m3u8');
  console.log(`Sarkor_TV: ${sarkorEntries.length} та`);

  console.log('9) OUTPUT_FILE ўқиляпти...');
  const outputText = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const outputEntries = parseGenericM3U(outputText, OUTPUT_FILE);
  console.log(`${OUTPUT_FILE}: ${outputEntries.length} та`);

  console.log('10) 3 та рўйхат 1→2→3 тартибда бирлаштириляпти...');
  const finalMergedText = mergePlaylistBlocksInOrder([
    cineramaEntries,
    sarkorEntries,
    outputEntries
  ]);

  fs.writeFileSync(FINAL_OUTPUT_FILE, finalMergedText, 'utf8');

  const finalCount = (finalMergedText.match(/^#EXTINF:/gm) || []).length;
  console.log(`Якуний файл: ${FINAL_OUTPUT_FILE}`);
  console.log(`Якуний каналлар сони: ${finalCount}`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});