const { writeFile } = require('node:fs/promises');

const API_BASE = 'https://uztel.server-api.lfstrm.tv';

const CONFIG = {
  session: 'MTc3NjE2Mjk3M3xHd3dBR0RZNVpHVXhPRGxrWkRFMU5qQXpPREExT1RaaU1tRmxNUT09fJBN_csUH-xGN6yMyhZ4YgrciHSLxELVyS4iJqgGCYiT',
  tvAssetToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX3R5cGUiOjMsInB1cmNoYXNlZF9jaGFubmVsX3BhY2thZ2VzIjpbIjY1NGI3MTQyMTNmN2ViY2IxYzVhOTNiMCJdLCJyZWdpb24iOiIiLCJkZXZpY2VfdHlwZSI6InBob25lIiwibmV0d29ya19hZmZpbGlhdGlvbl9zdGF0dXMiOjIsImxvY2FsZSI6InJ1IiwicHJvZmlsZV90eXBlIjoyLCJwcm9maWxlX3Jlc3RyaWN0aW9uX3ZhbHVlIjozfQ.evKrh9T9ftaP6vYu8WSbwaXvdzeCtdofmDp9DtgjJKc',
  deviceUuid: 'fa233b6c-47a8-4f6a-a5c1-7f3202cf5c71',
  appVersion: '3.8.14',
  appHash: 'd5ac77e8',
  appBuildDate: '1763989338000',
  whitelabel: 'uztel',
  concurrency: 8,
  enable50fps: true,
  quality: '1080p',
  groupTitle: 'TelecomTV 🇺🇿',
  pinnedChannels: [
    'ZOR TV HD',
    'Sevimli TV',
    'Milliy TV',
    'Mening Yurtim',
    'Sport UZ',
    'Futbol TV HD',
    'QIZIQTV',
    'Kinoteatr',
    'UzReport HD',
    'Navo',
    'Biz Cinema',
    'Makon TV',
    'Dunyo bo`ylab HD',
    'Taraqqiyot TV',
    "O'zbekiston24 HD",
    'Ozbekiston',
    'Ozbekiston 24',
    'Toshkent',
    'Yoshlar HD',
    'Madaniyat va Marifat',
    'Mahalla',
    "O'zbekiston Tarixi HD",
    'Dasturxon-TV',
    'LUX TV HD',
    'MYDAYTV',
    'Renessans TV',
    'RETROTV',
    'Nurafshon TV',
    'Fargona MTRK HD',
    'Surxandaryo MTRK HD',
    'Xorazm MTRK HD',
    'Qaraqalpaqstan MTRK',
    'Aqlvoy',
    'Bolajon',
    'English Class',
    'TelecomTV',
    'Futbol TV',
    'ZOR TV',
  ],
};

function commonParams(cfg) {
  return {
    session: cfg.session,
    'app.version': cfg.appVersion,
    'app.hash': cfg.appHash,
    'app.buildDate': cfg.appBuildDate,
    'app.id': 'sequoia',
    'app.buildType': 'portal',
    'app.whitelabel': cfg.whitelabel,
    'app.hostname': '',
    'app.env': '',
    'device.type': 'phone',
    'device.brand': 'android',
    'device.model': 'none',
    'device.uuid': cfg.deviceUuid,
    'device.drm': 'wvm',
  };
}

function buildUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return `${API_BASE}${path}?${qs}`;
}

async function api(path, params) {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru',
      Origin: 'https://telecomtv.uz',
      Referer: 'https://telecomtv.uz/',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}`);
  }

  return res.json();
}

async function getChannels(cfg) {
  return api('/tv/v2/channels', { ...commonParams(cfg), 'tv-asset-token': cfg.tvAssetToken });
}

async function getMedias(cfg) {
  return api('/tv/v2/medias', { ...commonParams(cfg), 'tv-asset-token': cfg.tvAssetToken });
}

async function getPlayback(mediaId, cfg) {
  const enable50fps = cfg.enable50fps ? 'true' : 'false';
  return api(`/playback-info-media/${mediaId}`, { ...commonParams(cfg), enable50fps });
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;

  async function next() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = { error: err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, next));
  return results;
}

function pickStreamUrl(playback, quality = 'Auto') {
  const langs = playback?.languages || [];
  const defaultLang = langs.find((l) => l.default) || langs[0];
  if (!defaultLang) return null;

  const rends = defaultLang.renditions || [];
  const ladder = ['1080p', '720p', '540p', '360p'];
  let chosen = null;

  if (quality === 'Auto') {
    chosen = rends.find((r) => r.id === 'Auto' || r.default);
  } else {
    chosen = rends.find((r) => r.id === quality);
    if (!chosen) {
      const startIdx = ladder.indexOf(quality);
      if (startIdx >= 0) {
        for (let i = startIdx + 1; i < ladder.length; i++) {
          chosen = rends.find((r) => r.id === ladder[i]);
          if (chosen) break;
        }
      }
      if (!chosen) {
        chosen = rends.find((r) => r.id === 'Auto' || r.default) || rends[0];
      }
    }
  }

  if (!chosen?.url) return null;
  return { url: chosen.url.replace(/^http:\/\//, 'https://'), quality: chosen.id };
}

function escapeM3u(s) {
  return String(s).replace(/[",]/g, ' ').trim();
}

const NAME_OVERRIDES = {
  'ZOR TV HD': "ZO'R TV HD",
  'ZOR TV': "ZO'R TV",
  Ozbekiston: "O'zbekiston",
  'Ozbekiston 24': "O'zbekiston 24",
  'Fargona MTRK HD': "Farg'ona MTRK HD",
};

function toM3U(entries, groupTitle) {
  const lines = ['#EXTM3U'];

  for (const e of entries) {
    const group = groupTitle || e.genre || 'TV';
    const name = NAME_OVERRIDES[e.title] || e.title;
    lines.push(`#EXTINF:-1 group-title="${escapeM3u(group)}",${name}`);
    lines.push(e.url);
  }

  return lines.join('\n') + '\n';
}

async function main() {
  const cfg = CONFIG;

  console.log("[1/3] Kanallar ro'yxati yuklanmoqda...");
  const { channels, genres } = await getChannels(cfg);
  console.log(`      ${channels.length} kanal topildi`);

  console.log("[2/3] Media ID'lar yuklanmoqda...");
  const { medias } = await getMedias(cfg);
  console.log(`      ${medias.length} media topildi`);

  const mediaByChannel = new Map();
  for (const m of medias) {
    if (!m.isLocked) {
      mediaByChannel.set(m.channelId, m);
    }
  }

  const genreById = new Map((genres || []).map((g) => [g.id, g.title]));

  const jobs = channels
    .map((ch) => {
      const media = mediaByChannel.get(ch.id);
      if (!media) return null;

      const genreId = ch.relevantGenres?.[0]?.genreId;
      return {
        id: ch.id,
        title: ch.title,
        keyNumber: ch.keyNumber,
        logo: ch.logoUrl,
        genre: genreById.get(genreId) || '',
        mediaId: media.id,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.keyNumber || 0) - (b.keyNumber || 0));

  console.log(`[3/3] ${jobs.length} kanal uchun stream URL'lar olinmoqda (concurrency=${cfg.concurrency})...`);

  const entries = [];
  const failed = [];
  let done = 0;

  const requestedQuality = cfg.quality || 'Auto';

  await mapLimit(jobs, cfg.concurrency, async (job) => {
    try {
      const playback = await getPlayback(job.mediaId, cfg);
      const picked = pickStreamUrl(playback, requestedQuality);
      if (!picked) {
        throw new Error('no stream URL in response');
      }

      entries.push({
        ...job,
        url: picked.url,
        quality: picked.quality,
        pbsId: playback.pbsId,
        expires: playback.expires,
      });
    } catch (err) {
      failed.push({ ...job, error: err.message });
    } finally {
      done++;
      process.stdout.write(`\r      ${done}/${jobs.length}`);
    }
  });

  process.stdout.write('\n');

  const pins = (cfg.pinnedChannels || []).map((s) => s.trim().toLowerCase());
  const pinIndex = (e) => pins.indexOf(e.title.trim().toLowerCase());

  entries.sort((a, b) => {
    const ia = pinIndex(a);
    const ib = pinIndex(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return (a.keyNumber || 0) - (b.keyNumber || 0);
  });

  const m3uPath = 'telecomtv_uz.m3u8';
  await writeFile(m3uPath, toM3U(entries, cfg.groupTitle), 'utf8');

  console.log(`\nTayyor (so'ralgan sifat: ${requestedQuality}):`);
  console.log(`  ${m3uPath} — ${entries.length} kanal`);

  const byQuality = entries.reduce((acc, e) => {
    acc[e.quality] = (acc[e.quality] || 0) + 1;
    return acc;
  }, {});

  console.log("\nSifat bo'yicha taqsimot:");
  Object.entries(byQuality).forEach(([q, n]) => console.log(`  ${q.padEnd(8)} ${n}`));

  if (failed.length) {
    console.log(`\nXato: ${failed.length} kanal:`);
    failed.forEach((f) => console.log(`  ${f.title}: ${f.error}`));
  }

  const firstExpires = entries[0]?.expires;
  if (firstExpires) {
    console.log(`\nMuddati: ${new Date(firstExpires * 1000).toISOString()}`);
  }
}

main().catch((err) => {
  console.error('Xato:', err.message);
  process.exit(1);
});
