const https = require('https');
const fs = require('fs');
const readline = require('readline');

const CHANNEL_API_URL = 'https://spectator-api.salomtv.uz/v1/tv/channel';
const OUTPUT_FILE = 'salomtv_uz.m3u8';
const GROUP_TITLE = 'SalomTV UZ 🇺🇿';

const SPECIAL_CHANNEL_ORDER = [
  "Zo'r TV FHD",
  'Milliy TV HD',
  'Sevimli TV HD',
  'Mening Yurtim HD',
  'Sport ТV HD',
  'Futbol TV HD',
  'Setanta 1 HD',
  'Setanta 2 HD',
  'ITV Cinema',
  'ITV Music',
  'Kinoteatr',
  'Biz Cinema',
  'Biz Music',
  'BizTV',
  'QIZIQTV',
  'UzReport',
  'Dunyo bo‘ylab HD',
  'Makon TV',
  'TTV_Musiqa',
  'NAVO'
];

const CATEGORY_RANK_BY_ID = new Map([
  ['2b25b899-0b24-42e3-baa5-57332c8f86e9', 0], // Sport
  ['42f8a6fe-4759-43a0-8f9a-1bc0c03be64d', 1], // Milliy
  ['862b68e6-7f59-4dc6-839e-1cfe32cf8fc2', 2], // Kino
  ['0318abfe-909c-4c15-ad73-a2eb176abbe8', 3], // Yangiliklar
  ['9ac059cb-8461-4ad9-a2a1-870cd0e17ab3', 4], // Xorijiy TV
  ['8c396b35-03ae-4781-8acf-f0544b8b27bb', 5], // Hujjatli TV
  ['0d99c22c-fec7-4b86-b341-d1e2aa3160e2', 6]  // Ko'ngilochar
]);

function waitForEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || process.env.GITHUB_ACTIONS) {
      resolve();
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('\nEnter босилса чиқади...', () => {
      rl.close();
      resolve();
    });
  });
}

function remapTitle(title) {
  const raw = cleanText(title);
  const n = normalizeTitle(raw);

  if (n === normalizeTitle('Setanta 1')) return 'Setanta 1 HD';
  if (n === normalizeTitle('Setanta 2')) return 'Setanta 2 HD';
  if (n === normalizeTitle("Zo'r tv")) return "Zo'r TV FHD";
  if (n === normalizeTitle('Sport ТV')) return 'Sport ТV HD';
  if (n === normalizeTitle('Milliy TV')) return 'Milliy TV HD';
  if (n === normalizeTitle('Mening Yurtim')) return 'Mening Yurtim HD';
  if (n === normalizeTitle('Futbol TV')) return 'Futbol TV HD';

  return raw;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .trim();
}

function normalizeTitle(value) {
  const map = {
    'А':'a','В':'b','Е':'e','К':'k','М':'m','Н':'h','О':'o','Р':'p','С':'c','Т':'t','Х':'x','У':'y',
    'а':'a','в':'b','е':'e','к':'k','м':'m','н':'h','о':'o','р':'p','с':'c','т':'t','х':'x','у':'y'
  };

  return String(value ?? '')
    .split('')
    .map((ch) => map[ch] || ch)
    .join('')
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´"]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const SPECIAL_RANK_BY_TITLE = new Map(
  SPECIAL_CHANNEL_ORDER.map((title, index) => [normalizeTitle(title), index])
);

function getSpecialRank(title) {
  const key = normalizeTitle(title);
  return SPECIAL_RANK_BY_TITLE.has(key) ? SPECIAL_RANK_BY_TITLE.get(key) : -1;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/json, text/plain, */*'
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: data
          });
        });
      }
    );

    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);
  });
}

function findArray(node, checker, visited = new Set()) {
  if (!node || typeof node !== 'object') return null;
  if (visited.has(node)) return null;
  visited.add(node);

  if (Array.isArray(node)) {
    const good = node.filter(checker);
    if (good.length > 0) return node;

    for (const item of node) {
      const found = findArray(item, checker, visited);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(node)) {
    const found = findArray(node[key], checker, visited);
    if (found) return found;
  }

  return null;
}

function looksLikeChannel(item) {
  return !!item &&
    typeof item === 'object' &&
    typeof item.title_uz === 'string' &&
    typeof item.url === 'string';
}

function getChannelCategoryIds(item) {
  if (Array.isArray(item.category_ids)) {
    return item.category_ids.map((x) => cleanText(x)).filter(Boolean);
  }
  return [];
}

function getBestCategoryRank(item) {
  const ids = getChannelCategoryIds(item);
  let rank = 999;

  for (const id of ids) {
    if (CATEGORY_RANK_BY_ID.has(id)) {
      rank = Math.min(rank, CATEGORY_RANK_BY_ID.get(id));
    }
  }

  return rank;
}

async function loadJson(url) {
  const res = await httpGet(url);

  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode}`);
  }

  return JSON.parse(res.body);
}

async function main() {
  console.log('Channel JSON юкланяпти...');

  const channelJson = await loadJson(CHANNEL_API_URL);
  const channels = findArray(channelJson, looksLikeChannel);

  if (!channels || !channels.length) {
    console.log('JSON preview:', JSON.stringify(channelJson, null, 2).slice(0, 2000));
    throw new Error('Channel massivi topilmadi');
  }

  const valid = [];
  const seen = new Set();

  for (const item of channels) {
    const status = item.status !== false;
    const title = remapTitle(item.title_uz);
    const image = cleanText(item.image);
    const url = cleanText(item.url);

    if (!status) continue;
    if (!title || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;

    const specialRank = getSpecialRank(title);
    const categoryRank = specialRank !== -1 ? 999 : getBestCategoryRank(item);

    seen.add(url);
    valid.push({
      title,
      image,
      url,
      specialRank,
      categoryRank
    });
  }

  valid.sort((a, b) => {
    const aIsSpecial = a.specialRank !== -1;
    const bIsSpecial = b.specialRank !== -1;

    if (aIsSpecial && bIsSpecial) {
      return a.specialRank - b.specialRank;
    }

    if (aIsSpecial) return -1;
    if (bIsSpecial) return 1;

    if (a.categoryRank !== b.categoryRank) {
      return a.categoryRank - b.categoryRank;
    }

    return a.title.localeCompare(b.title, 'uz');
  });

  const lines = ['#EXTM3U'];

  for (const item of valid) {
    lines.push(
      `#EXTINF:-1 group-title="${escapeAttr(GROUP_TITLE)}"` +
      (item.image ? ` tvg-logo="${escapeAttr(item.image)}"` : '') +
      `, ${item.title}`
    );
    lines.push(item.url);
  }

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf8');

  console.log(`Tayyor: ${OUTPUT_FILE}`);
  console.log(`Qo‘shildi: ${valid.length} ta kanal`);
}

main()
  .catch((err) => {
    console.error('XATO:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await waitForEnter();
    process.exit(process.exitCode || 0);
  });