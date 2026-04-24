const fs = require('fs');

const CHANNEL_API = 'https://api.spec.uzd.udevs.io/v1/tv/channel';
const CATEGORY_API = 'https://api.spec.uzd.udevs.io/v1/tv/category';

const OUTPUT_FILE = 'uzdigital_tv.m3u8';
const CONCURRENCY = 5;
const GROUP_TITLE = 'UzDigital TV 🇺🇿';

// Yuqorida ko'rinishi kerak bo'lgan kanallar (shu tartibda)
const PRIORITY = [
	'Zor TV HD',
	'Sevimli',
	'Milliy',
	'MY 5',
	'Sport UZ',
	'FutbolTV',
	'Setanta Sports 1',
	'Setanta Sports 2',
	'Makon TV',
	'QIZIQ TV',
	'CINEMA HD',
	'KINOTEATR HD',
	'ITV Cinema',
	'Dunyo Boylab',
	'FTV F',
	'Biz TV',
	'Biz Music',
	'TTV Musiqa',
	'NAVO',
	'Uzreport'
];

const AUTHORIZATION = '';

function escapeAttr(s = '') {
  return String(s).replace(/"/g, '&quot;').trim();
}

function pickString(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

function makeHeaders() {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'uz-UZ,uz;q=0.9,ru;q=0.8,en;q=0.7',
    origin: 'https://uzdtv.uz',
    referer: 'https://uzdtv.uz/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144 Safari/537.36'
  };
  if (AUTHORIZATION.trim()) headers.authorization = AUTHORIZATION.trim();
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET', headers: makeHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function looksLikeChannel(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const id = obj.id || obj.uuid;
  const title = obj.title_uz || obj.title_ru || obj.title_en || obj.title || obj.name_uz || obj.name_ru || obj.name;
  return typeof id === 'string' && typeof title === 'string';
}

function findChannelArray(root) {
  let best = [], bestCount = 0;
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      const count = node.filter(looksLikeChannel).length;
      if (count > bestCount) { best = node; bestCount = count; }
      for (const item of node.slice(0, 5)) walk(item);
      return;
    }
    if (typeof node === 'object') for (const v of Object.values(node)) walk(v);
  }
  walk(root);
  return best;
}

function normalizeStreamUrl(value = '') {
  let url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  url = url.replace(/\/embed\.html(?=\?|$)/i, '/video.m3u8');
  return url;
}

function findStreamUrl(root) {
  const keys = ['channel_stream_all', 'url', 'test_stream', 'channel_stream_ios', 'channel_stream', 'stream_all', 'stream_url', 'hls'];
  let found = '';
  function walk(node) {
    if (found || !node || typeof node !== 'object') return;
    if (!Array.isArray(node)) {
      for (const key of keys) {
        const value = node[key];
        if (typeof value === 'string') {
          const fixedUrl = normalizeStreamUrl(value);
          if (fixedUrl && /\.m3u8(\?|$)/i.test(fixedUrl)) { found = fixedUrl; return; }
        }
      }
    }
    for (const v of Object.values(node)) { walk(v); if (found) return; }
  }
  walk(root);
  return found;
}

async function getChannels() {
  const json = await fetchJson(CHANNEL_API);
  const arr = findChannelArray(json);
  return arr.map(item => ({
    id: pickString(item.id, item.uuid),
    name: pickString(item.title_uz, item.title_ru, item.title_en, item.title, item.name_uz, item.name_ru, item.name),
    titles: [item.title_uz, item.title_ru, item.title_en, item.title].filter(Boolean),
    logo: pickString(item.image, item.logo, item.icon, item.picture),
    flusonic_id: item.flusonic_id || '',
    category_ids: item.category_ids || []
  })).filter(ch => ch.id && ch.name);
}

async function getCategoryMap() {
  try {
    const json = await fetchJson(CATEGORY_API);
    const arr = findChannelArray(json);
    const map = {};
    for (const c of arr) {
      const id = c.id || c.uuid;
      const name = pickString(c.title_uz, c.title_ru, c.title_en, c.title, c.name);
      if (id && name) {
        map[id] = name;
        map['{' + id + '}'] = name;
      }
    }
    return map;
  } catch (e) { return {}; }
}

async function getStream(ch) {
  const detailUrl = `${CHANNEL_API}/${encodeURIComponent(ch.id)}`;
  const json = await fetchJson(detailUrl);
  return { ...ch, url: findStreamUrl(json) };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { ...items[i], url: '', error: e.message || String(e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function buildM3U(channels) {
  const lines = [];
  for (const ch of channels) {
    lines.push(`#EXTINF:-1 tvg-logo="${escapeAttr(ch.logo)}" group-title="${escapeAttr(GROUP_TITLE)}",${ch.name}`);
    lines.push(ch.url);
  }
  return lines;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/['ʻʼ`\s]/g, '').trim();
}

function matchPriority(ch, priorityName) {
  const p = norm(priorityName);
  return ch.titles.some(t => norm(t) === p) || norm(ch.name) === p;
}

function orderChannels(channels, catMap) {
  const used = new Set();

  const ownGroup = ch => (ch.category_ids || []).map(id => catMap[id]).filter(Boolean)[0] || '';

  // 1. Priority kanallar (berilgan tartibda) — o'z kategoriyasi bilan
  const priority = [];
  for (const pn of PRIORITY) {
    const ch = channels.find(c => !used.has(c.id) && matchPriority(c, pn));
    if (ch) { priority.push({ ...ch, _group: ownGroup(ch) }); used.add(ch.id); }
    else console.log('Priority topilmadi:', pn);
  }

  // 2. Qolganlari: avval o'zbek (lotin) keyin rus (kirill)
  const rest = channels.filter(c => !used.has(c.id));
  const isCyrillic = s => /[Ѐ-ӿ]/.test(s);
  const uzbek = rest.filter(c => !isCyrillic(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  const russian = rest.filter(c => isCyrillic(c.name)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return [...priority, ...uzbek, ...russian];
}

(async () => {
  console.log('Kanallar va kategoriyalar olinmoqda...');
  const [channels, catMap] = await Promise.all([getChannels(), getCategoryMap()]);
  console.log('Topildi:', channels.length, 'ta kanal,', Object.keys(catMap).length / 2, 'ta kategoriya');

  const details = await mapLimit(channels, CONCURRENCY, async (ch, i) => {
    process.stdout.write(`\r[${i + 1}/${channels.length}]`);
    return getStream(ch);
  });
  console.log('');

  const ok = details.filter(ch => ch.url && /^https?:\/\/.+\.m3u8/i.test(ch.url));
  const bad = details.filter(ch => !ch.url);

  const ordered = orderChannels(ok, catMap);
  const m3u = ['#EXTM3U', ...buildM3U(ordered)].join('\n') + '\n';
  fs.writeFileSync(OUTPUT_FILE, m3u, 'utf8');

  console.log('Saqlandi:', OUTPUT_FILE);
  console.log('Stream topildi:', ok.length, '/ topilmadi:', bad.length);
  if (bad.length) {
    console.log('Topilmadi:');
    bad.forEach(ch => console.log(' -', ch.name, ch.error ? '('+ch.error+')' : ''));
  }
})();
