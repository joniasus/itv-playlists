const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PLAYLIST_DIR = __dirname;
const CHANNEL_API_URL = 'https://spectator-api.salomtv.uz/v1/tv/channel';
const GROUP_TITLE = 'SalomTV UZ 🇺🇿';

const PROVIDER_SOURCES = [
  { file: 'Cinerama_UZ.m3u8',  group: 'Cinerama UZ 🇺🇿' },
  { file: 'Sarkor_TV.m3u8',    group: 'Sarkor TV UZ 🇺🇿' },
  { file: 'tvcom_uz.m3u8',     group: 'TVcom UZ 🇺🇿' },
  { file: 'zorplay_uz.m3u8',   group: "ZO'R PLAY UZ 🇺🇿" },
  { file: 'telecomtv_uz.m3u8', group: 'TelecomTV UZ 🇺🇿' },
  { file: 'radio_uz.m3u8',     group: 'Radio UZ 🇺🇿' },
  { file: 'itv_uz.m3u8',       group: 'iTV UZ 🇺🇿' },
  { file: 'mediabay_uz.m3u8',  group: 'Mediabay UZ 🇺🇿' }
];

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
  ['2b25b899-0b24-42e3-baa5-57332c8f86e9', 0],
  ['42f8a6fe-4759-43a0-8f9a-1bc0c03be64d', 1],
  ['862b68e6-7f59-4dc6-839e-1cfe32cf8fc2', 2],
  ['0318abfe-909c-4c15-ad73-a2eb176abbe8', 3],
  ['9ac059cb-8461-4ad9-a2a1-870cd0e17ab3', 4],
  ['8c396b35-03ae-4781-8acf-f0544b8b27bb', 5],
  ['0d99c22c-fec7-4b86-b341-d1e2aa3160e2', 6]
]);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').trim();
}

function normalizeTitle(value) {
  const map = {
    'А':'a','В':'b','Е':'e','К':'k','М':'m','Н':'h','О':'o','Р':'p','С':'c','Т':'t','Х':'x','У':'y',
    'а':'a','в':'b','е':'e','к':'k','м':'m','н':'h','о':'o','р':'p','с':'c','т':'t','х':'x','у':'y'
  };
  return String(value ?? '').split('').map((ch) => map[ch] || ch).join('')
    .toLowerCase().replace(/[ʻʼ‘’'`´"]/g, '').replace(/[^a-z0-9]+/g, '');
}

const SPECIAL_RANK_BY_TITLE = new Map(
  SPECIAL_CHANNEL_ORDER.map((title, index) => [normalizeTitle(title), index])
);

function getSpecialRank(title) {
  const key = normalizeTitle(title);
  return SPECIAL_RANK_BY_TITLE.has(key) ? SPECIAL_RANK_BY_TITLE.get(key) : -1;
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

function getBestCategoryRank(item) {
  const ids = Array.isArray(item.category_ids) ? item.category_ids : [];
  let rank = 999;
  for (const id of ids) {
    const key = cleanText(id);
    if (CATEGORY_RANK_BY_ID.has(key)) {
      rank = Math.min(rank, CATEGORY_RANK_BY_ID.get(key));
    }
  }
  return rank;
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

function findArray(node, checker, visited = new Set()) {
  if (!node || typeof node !== 'object' || visited.has(node)) return null;
  visited.add(node);
  if (Array.isArray(node)) {
    if (node.filter(checker).length > 0) return node;
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
  return !!item && typeof item === 'object' &&
    typeof item.title_uz === 'string' && typeof item.url === 'string';
}

function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/, '');
  }
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim().replace(/^::ffff:/, '');
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

async function buildPlaylist(clientIp) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'X-Forwarded-For': clientIp
  };
  const res = await httpGet(CHANNEL_API_URL, headers);
  if (res.statusCode !== 200) throw new Error(`Upstream HTTP ${res.statusCode}`);

  const json = JSON.parse(res.body);
  const channels = findArray(json, looksLikeChannel);
  if (!channels || !channels.length) throw new Error('Channel array not found');

  const valid = [];
  const seen = new Set();

  for (const item of channels) {
    if (item.status === false) continue;
    const title = remapTitle(item.title_uz);
    const image = cleanText(item.image);
    const url = cleanText(item.url);
    if (!title || !url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    const specialRank = getSpecialRank(title);
    const categoryRank = specialRank !== -1 ? 999 : getBestCategoryRank(item);
    seen.add(url);
    valid.push({ title, image, url, specialRank, categoryRank });
  }

  valid.sort((a, b) => {
    const aS = a.specialRank !== -1, bS = b.specialRank !== -1;
    if (aS && bS) return a.specialRank - b.specialRank;
    if (aS) return -1;
    if (bS) return 1;
    if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
    return a.title.localeCompare(b.title, 'uz');
  });

  const groupTitle = `${GROUP_TITLE} (${valid.length})`;
  const lines = ['#EXTM3U'];
  for (const item of valid) {
    lines.push(
      `#EXTINF:-1 group-title="${escapeAttr(groupTitle)}"` +
      (item.image ? ` tvg-logo="${escapeAttr(item.image)}"` : '') +
      `, ${item.title}`
    );
    lines.push(item.url);
  }
  return { body: lines.join('\n') + '\n', count: valid.length };
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

function parseM3U(text) {
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
      if (next.startsWith('#EXTINF:')) { lastJ = j - 1; break; }
      if (next) block.push(next);
      if (isUrlLine(next)) { url = next; lastJ = j; break; }
      lastJ = j;
    }
    if (url) entries.push({ url, block });
    i = lastJ;
  }
  return entries;
}

function stampGroupTitleWithCount(entries, baseTitle) {
  const titleWithCount = `${baseTitle} (${entries.length} ta)`;
  for (const entry of entries) {
    entry.block[0] = replaceOrInsertGroupTitle(entry.block[0], titleWithCount);
  }
}

async function buildMergedPlaylist(clientIp) {
  const playlists = [];
  const skipped = [];

  for (const { file, group } of PROVIDER_SOURCES) {
    const fullPath = path.join(PLAYLIST_DIR, file);
    if (!fs.existsSync(fullPath)) { skipped.push(file); continue; }
    const entries = parseM3U(fs.readFileSync(fullPath, 'utf8'));
    if (!entries.length) { skipped.push(file); continue; }
    stampGroupTitleWithCount(entries, group);
    playlists.push({ group, entries });
  }

  const salomtv = await buildPlaylist(clientIp);
  const salomEntries = parseM3U(salomtv.body);
  stampGroupTitleWithCount(salomEntries, GROUP_TITLE);
  playlists.push({ group: GROUP_TITLE, entries: salomEntries });

  const out = ['#EXTM3U'];
  for (const p of playlists) for (const e of p.entries) out.push(...e.block);
  const body = out.join('\n').trimEnd() + '\n';
  const total = playlists.reduce((s, p) => s + p.entries.length, 0);
  return { body, total, playlists, skipped };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientIp = extractClientIp(req);
  const ts = new Date().toISOString();

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
    return;
  }

  if (url.pathname === '/all' || url.pathname === '/all.m3u8') {
    try {
      const { body, total, playlists } = await buildMergedPlaylist(clientIp);
      const summary = playlists.map((p) => `${p.group}:${p.entries.length}`).join(', ');
      console.log(`${ts} ${clientIp} ALL -> ${total} channels [${summary}]`);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (err) {
      console.error(`${ts} ${clientIp} ALL ERROR: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${err.message}\n`);
    }
    return;
  }

  if (url.pathname === '/salomtv' || url.pathname === '/salomtv.m3u8') {
    try {
      const { body, count } = await buildPlaylist(clientIp);
      console.log(`${ts} ${clientIp} -> ${count} channels`);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (err) {
      console.error(`${ts} ${clientIp} ERROR: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${err.message}\n`);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found. Endpoints: /salomtv.m3u8 and /all.m3u8\n');
});

server.listen(PORT, HOST, () => {
  console.log(`SalomTV playlist server listening on http://${HOST}:${PORT}`);
  console.log(`Endpoint: GET /salomtv.m3u8`);
});
