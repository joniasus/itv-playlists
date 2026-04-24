const fs = require('fs');

const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '12f25454147029c30c9f4c1e49e2cefd502cfbc5';

const CHANNEL_LIST_URL =
  `https://uzbeeline.platform24.tv/v2/channels/channel_list` +
  `?access_token=${encodeURIComponent(ACCESS_TOKEN)}` +
  `&channels_version=2&format=json&includes=current_schedules`;

const OUTPUT_FILE = 'uzbeeline_tv.m3u8';
const GROUP_TITLE = 'UzBeeline TV 🇺🇿';
const CONCURRENCY = 8;

const CHANNEL_ORDER = [4783, 3302, 4399, 688, 679, 7065, 8749, 8443];

const CHANNEL_ORDER_MAP = new Map(
  CHANNEL_ORDER.map((id, index) => [Number(id), index])
);

function normalizeLogo(url = '') {
  return String(url).replace(/^http:\/\//i, 'https://');
}

function escapeAttr(s = '') {
  return String(s).replace(/"/g, '&quot;').trim();
}

function makeStreamInfoUrl(num) {
  return `https://uzbeeline.platform24.tv/v2/channels/${num}/stream?access_token=${encodeURIComponent(ACCESS_TOKEN)}&force_https=true&format=json`;
}

function sortByChannelOrder(a, b) {
  const aNum = Number(a.num);
  const bNum = Number(b.num);

  const aIn = CHANNEL_ORDER_MAP.has(aNum);
  const bIn = CHANNEL_ORDER_MAP.has(bNum);

  if (aIn && bIn) {
    return CHANNEL_ORDER_MAP.get(aNum) - CHANNEL_ORDER_MAP.get(bNum);
  }

  if (aIn) return -1;
  if (bIn) return 1;

  return 0;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0',
      referer: 'https://beeline.tv/',
      origin: 'https://beeline.tv',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;

      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { ok: false, error: err.message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runner())
  );

  return results;
}

function pickUrlFromStreamJson(json) {
  return (
    json?.hls_mbr ||
    json?.stream?.hls_mbr ||
    json?.result?.hls_mbr ||
    json?.data?.hls_mbr ||
    json?.hls ||
    json?.stream?.hls ||
    json?.url ||
    null
  );
}

function buildEntry(ch, url) {
  const name = ch.name || `Channel ${ch.num}`;
  const logo = normalizeLogo(ch?.cover?.full || '');
  const num = ch.num;

  return [
    `#EXTINF:-1 tvg-id="${num}" tvg-logo="${escapeAttr(logo)}" group-title="${GROUP_TITLE}",${name}`,
    url,
  ].join('\n');
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error('ACCESS_TOKEN topilmadi');
  }

  console.log("Kanal ro'yxati olinmoqda...");
  const json = await fetchJson(CHANNEL_LIST_URL);

  const channels = Array.isArray(json)
    ? json
    : json.channels || json.items || json.results || [];

  if (!Array.isArray(channels) || !channels.length) {
    throw new Error("Kanal ro'yxati topilmadi");
  }

  const sourceChannels = channels
    .filter(ch => ch && ch.num && ch.name)
    .sort(sortByChannelOrder);

  console.log(`Jami kanal: ${sourceChannels.length}`);
  console.log("Har bir kanal uchun /stream olinmoqda...");

  const stats = {
    ok: 0,
    forbidden: 0,
    no_url: 0,
    other: 0
  };

  let done = 0;

  const results = await mapLimit(sourceChannels, CONCURRENCY, async (ch) => {
    try {
      const streamJson = await fetchJson(makeStreamInfoUrl(ch.num));
      const url = pickUrlFromStreamJson(streamJson);

      if (!url) {
        stats.no_url++;
        return {
          ok: false,
          num: ch.num,
          name: ch.name,
          reason: 'No hls_mbr',
        };
      }

      stats.ok++;
      return {
        ok: true,
        sortNum: Number(ch.num),
        entry: buildEntry(ch, String(url).replace(/^http:\/\//i, 'https://'))
      };
    } catch (err) {
      const reason = String(err.message || err);

      if (reason.includes('HTTP 403')) {
        stats.forbidden++;
      } else {
        stats.other++;
      }

      return {
        ok: false,
        num: ch.num,
        name: ch.name,
        reason
      };
    } finally {
      done++;
      process.stdout.write(`\r${done}/${sourceChannels.length}`);
    }
  });

  process.stdout.write('\n');

  const rows = results
    .filter(x => x && x.ok)
    .map(x => x.entry);

  const failed = results.filter(x => x && !x.ok);

  fs.writeFileSync(
    OUTPUT_FILE,
    '#EXTM3U\n' + rows.join('\n') + '\n',
    'utf8'
  );

  console.log(`\nSaqlandi: ${OUTPUT_FILE}`);
  console.log(`Ishlagan: ${stats.ok}`);
  console.log(`403 skip: ${stats.forbidden}`);
  console.log(`No hls_mbr: ${stats.no_url}`);
  console.log(`Boshqa xato: ${stats.other}`);

  if (failed.length) {
    console.log('\nBirinchi 10 ta ishlamagan kanal:');
    failed.slice(0, 10).forEach(f => {
      console.log(`- ${f.num} | ${f.name} -> ${f.reason}`);
    });
  }
}

main().catch(err => {
  console.error('Xato:', err.message);
  process.exit(1);
});