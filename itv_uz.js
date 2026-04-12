const https = require('https');
const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const TARGET_GROUP = 'group-title="Itv.uz (🇺🇿)"';

const OUTPUT_FILE = 'iTV_UZ.m3u8';
const ITV_GROUP_BASE = 'iTV UZ 🇺🇿';

const ALLOWED_IDS = "1286,1014,1012,1004,1010,1009,4000,4001,1015,1209,1011,1006,1496,1285,1497,1204,4007,4008,1494,1486,1488,1001,1002,1003,1005,1007,1008,1013,1016,1019,1020,1024,1025,1048,1050,1053,1056,1205,1206,1210,1212,1213,1214,1216,1217,1220,1221,1251,1253,1259,1265,1282,1283,1284,1290,1291,1408,1457,1458,1459,1460,1461,1462,1463,1464,1465,1466,1467,1468,1469,1470,1472,1485,1489,1490,1491,1492,1495,1499,4012,1211,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023";

const API_SCAN_IDS = "1,3,4,5,6,7,8,9,10,11,12,13,14,17,18,20,22,23,28,30,32,35,37,38,52,56,61,75,77,78,79,81,83,84,96,105,112,121,129,130,132,133,135,137,138,139,142,143,144,148,150,156,175,218,220,231,234,235,244,245,246,247,248,249,250,251,252,253,254,255,257,258,259,262,266,267,268,269,270,271,272,273,275,276,277,278,279,280,281,282,283,287,290,292,293";

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

function parseIds(raw) {
  const arr = String(raw)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));

  return Array.from(new Set(arr));
}

const ALLOWED_ID_LIST = parseIds(ALLOWED_IDS);
const ALLOWED_ID_SET = new Set(ALLOWED_ID_LIST);

const API_SCAN_ID_LIST = parseIds(API_SCAN_IDS);

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

function getNameFromExtinf(extinfLine) {
  const idx = String(extinfLine).lastIndexOf(',');
  if (idx === -1) return cleanText(extinfLine);
  return cleanText(extinfLine.slice(idx + 1));
}

function replaceOrInsertGroupTitle(extinfLine, newGroupTitle) {
  const safeTitle = escapeAttr(newGroupTitle);
  const line = String(extinfLine).trim();

  if (/group-title="[^"]*"/i.test(line)) {
    return line.replace(/group-title="[^"]*"/ig, `group-title="${safeTitle}"`);
  }

  return line.replace(/^#EXTINF:-1\b/i, `#EXTINF:-1 group-title="${safeTitle}"`);
}

function applyGroupTitleCount(entries, baseTitle) {
  const titled = `${baseTitle} (${entries.length} ta)`;

  for (const entry of entries) {
    entry.extinf = replaceOrInsertGroupTitle(entry.extinf, titled);
  }

  return entries;
}

function parseSourceM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const map = new Map();

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

    const streamNumber = extractStreamNumber(url);

    if (!ALLOWED_ID_SET.has(streamNumber)) {
      i = lastJ;
      continue;
    }

    if (!map.has(streamNumber)) {
      map.set(streamNumber, {
        sourceType: 'source',
        title: getNameFromExtinf(extinf),
        extinf,
        url,
        streamNumber
      });
    }

    i = lastJ;
  }

  return map;
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
    const posterUrl = cleanText(files.posterUrl);
    const streamUrl = cleanText(files.streamUrl);
    const streamNumber = extractStreamNumber(streamUrl);

    if (!title || !streamUrl || !Number.isFinite(streamNumber) || streamNumber === Number.MAX_SAFE_INTEGER) {
      return null;
    }

    if (!ALLOWED_ID_SET.has(streamNumber)) {
      return null;
    }

    return {
      sourceType: 'api',
      channelId,
      title,
      url: streamUrl,
      streamNumber,
      extinf:
        `#EXTINF:-1 group-title="${ITV_GROUP_BASE}"` +
        (posterUrl ? ` tvg-logo="${escapeAttr(posterUrl)}"` : '') +
        `, ${title}`
    };
  } catch {
    return null;
  }
}

async function buildApiEntries() {
  const map = new Map();

  for (let idx = 0; idx < API_SCAN_ID_LIST.length; idx++) {
    const channelId = API_SCAN_ID_LIST[idx];
    const item = await fetchApiChannel(channelId);

    if (item && !map.has(item.streamNumber)) {
      map.set(item.streamNumber, item);
    }

    console.log(`API текширилди: ${idx + 1}/${API_SCAN_ID_LIST.length}`);
  }

  return map;
}

function mergeAndOrder(sourceMap, apiMap) {
  const ordered = [];
  const missing = [];
  const sourceIds = [];
  const apiIds = [];

  for (const streamId of ALLOWED_ID_LIST) {
    if (sourceMap.has(streamId)) {
      ordered.push(sourceMap.get(streamId));
      sourceIds.push(streamId);
      continue;
    }

    if (apiMap.has(streamId)) {
      ordered.push(apiMap.get(streamId));
      apiIds.push(streamId);
      continue;
    }

    missing.push(streamId);
  }

  return { ordered, missing, sourceIds, apiIds };
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

  console.log('2) Source дан TARGET_GROUP + ALLOWED_IDS фильтрланяпти...');
  const sourceMap = parseSourceM3U(sourceText);

  console.log('3) iTV API фақат API_SCAN_IDS бўйича текшириляпти...');
  const apiMap = await buildApiEntries();

  console.log('4) Source биринчи, API резерв қилиб бирлаштириляпти...');
  const { ordered, missing, sourceIds, apiIds } = mergeAndOrder(sourceMap, apiMap);

  applyGroupTitleCount(ordered, ITV_GROUP_BASE);

  console.log('5) iTV_UZ.m3u8 тайёрланяпти...');
  const m3uText = buildM3U(ordered);

  fs.writeFileSync(OUTPUT_FILE, m3uText, 'utf8');

  console.log(`Якуний файл: ${OUTPUT_FILE}`);
  console.log(`ALLOWED IDS: ${ALLOWED_ID_LIST.length} та`);
  console.log(`API SCAN IDS: ${API_SCAN_ID_LIST.length} та`);
  console.log(`SOURCE topilgan: ${sourceMap.size} та`);
  console.log(`API topilgan: ${apiMap.size} та`);
  console.log(`FINAL iTV: ${ordered.length} та`);
  console.log(`SOURCE дан олинган: ${sourceIds.length} та`);
  console.log(`API дан олинган: ${apiIds.length} та`);

  if (apiIds.length > 0) {
    console.log('API орқали тўлдирилган stream IDлар:');
    console.log(apiIds.join(','));
  }

  if (missing.length > 0) {
    console.log(`TOPILMAGAN stream ID: ${missing.length} та`);
    console.log(missing.join(','));
  } else {
    console.log('Барча ALLOWED_IDS топилди');
  }
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
