const fs = require("fs");
const readline = require("readline");

const LIST_URL =
  "https://mw.tvcom.uz/tvmiddleware/api/channel/list/?authkey=be63bab060b589cde497073ecd7a1766d193e308e5aa5e67c8a74abedbae987d1a19891c0608937184fdf8d42c7dece35cd923e34f6a76a4ea9c313ee7a53bc3&client_id=1&api_key=56JNSqNT&compact=1&device=android";

const FREE_FILE = "tvcom_uz.m3u8";
const GROUP_TITLE_FREE = "TVcom UZ 🇺🇿";

const FREE_FLAG_VALUE = 1;
const REMOVE_DUPLICATE_URLS = true;
const SKIP_EMPTY_URL = true;

const RESOLVE_CONCURRENCY = 4;
const RESOLVE_TIMEOUT_MS = 10000;
const RESOLVE_RETRIES = 2;
const RESOLVE_RETRY_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttr(value) {
  return String(value ?? "").replace(/"/g, "'");
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirst(...values) {
  for (const v of values) {
    const s = cleanText(v);
    if (s) return s;
  }
  return "";
}

function getChannels(json) {
  if (Array.isArray(json?.channels)) return json.channels;
  if (Array.isArray(json)) return json;
  return null;
}

function getChannelId(ch, index) {
  return pickFirst(ch.id, ch.cid, ch.channel_id, `${index + 1}`);
}

function getChannelName(ch, index) {
  return pickFirst(ch.name, ch.title, ch.channel_name, `Channel ${index + 1}`);
}

function getChannelLogo(ch) {
  return pickFirst(ch.icon, ch.icon_image, ch.logo, ch.image, ch.poster);
}

function getChannelUrl(ch) {
  return pickFirst(ch.url, ch.stream_url, ch.stream, ch.hls, ch.play_url);
}

function getSubscriptionFlag(ch) {
  if (ch.has_subscription !== undefined && ch.has_subscription !== null) {
    return toNumber(ch.has_subscription);
  }
  if (ch.subscription !== undefined && ch.subscription !== null) {
    return toNumber(ch.subscription);
  }
  if (ch.is_free !== undefined && ch.is_free !== null) {
    return toNumber(ch.is_free) === 1 ? FREE_FLAG_VALUE : 999;
  }
  return NaN;
}

function buildExtinf({ id, name, logo, groupTitle }) {
  const attrs = [
    `tvg-id="${escapeAttr(id)}"`,
    `group-title="${escapeAttr(groupTitle)}"`,
  ];

  if (logo) {
    attrs.push(`tvg-logo="${escapeAttr(logo)}"`);
  }

  return `#EXTINF:-1 ${attrs.join(" ")},${cleanText(name)}`;
}

function buildItem({ id, name, logo, url, groupTitle }) {
  return `${buildExtinf({ id, name, logo, groupTitle })}\n${cleanText(url)}`;
}

function saveM3U(filePath, items) {
  const lines = ["#EXTM3U", ...items];
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

function waitForEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || process.env.GITHUB_ACTIONS === "true") {
      resolve();
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("\nChiqish uchun Enter bosing...", () => {
      rl.close();
      resolve();
    });
  });
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json,text/plain,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return await res.json();
}

async function resolveStreamUrlOnce(apiUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc && /^https?:\/\//i.test(loc)) return loc;
    }

    if (res.type === "opaqueredirect") {
      return "__retry_with_follow__";
    }

    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWithFollow(apiUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
    });
    if (res.url && /\.m3u8(\?|$)/i.test(res.url)) return res.url;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveStreamUrl(apiUrl) {
  for (let attempt = 0; attempt <= RESOLVE_RETRIES; attempt++) {
    try {
      const result = await resolveStreamUrlOnce(apiUrl);
      if (result === "__retry_with_follow__") {
        const followed = await resolveWithFollow(apiUrl);
        if (followed) return followed;
      } else if (result) {
        return result;
      }
    } catch {
      // fall through to retry
    }
    if (attempt < RESOLVE_RETRIES) await sleep(RESOLVE_RETRY_DELAY_MS * (attempt + 1));
  }
  return null;
}

async function resolveAll(items) {
  const shared = { index: 0 };
  const counters = { done: 0, resolved: 0, failed: 0 };

  async function worker() {
    while (true) {
      const i = shared.index++;
      if (i >= items.length) return;

      const item = items[i];
      try {
        const stream = await resolveStreamUrl(item.url);
        if (stream) {
          item.url = stream;
          counters.resolved++;
          console.log(`[RESOLVED] ${item.name}`);
        } else {
          item.url = null;
          counters.failed++;
          console.log(`[NO_STREAM] ${item.name}`);
        }
      } catch (err) {
        item.url = null;
        counters.failed++;
        console.log(`[ERROR] ${item.name} -> ${err.message}`);
      }
      counters.done++;
    }
  }

  const workers = [];
  for (let i = 0; i < RESOLVE_CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);
  return counters;
}

async function main() {
  console.log("TVCOM kanal ro'yxati olinmoqda...\n");

  const json = await fetchJson(LIST_URL);
  const channels = getChannels(json);

  if (!channels) {
    throw new Error("channels massiv topilmadi");
  }

  const selected = [];
  const seenUrls = new Set();

  let paidSkipped = 0;
  let skippedNoUrl = 0;
  let skippedDup = 0;
  let unknownFlag = 0;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];

    const id = getChannelId(ch, i);
    const name = getChannelName(ch, i);
    const logo = getChannelLogo(ch);
    const url = getChannelUrl(ch);
    const flag = getSubscriptionFlag(ch);

    if (!url && SKIP_EMPTY_URL) {
      skippedNoUrl++;
      console.log(`[SKIP:NO_URL] ${name}`);
      continue;
    }

    if (url && REMOVE_DUPLICATE_URLS && seenUrls.has(url)) {
      skippedDup++;
      console.log(`[SKIP:DUP] ${name}`);
      continue;
    }

    if (url) seenUrls.add(url);

    if (Number.isNaN(flag)) {
      unknownFlag++;
      console.log(`[UNKNOWN SKIP] ${name}`);
      continue;
    }

    if (flag !== FREE_FLAG_VALUE) {
      paidSkipped++;
      console.log(`[PULLIK SKIP] ${name} | flag=${flag}`);
      continue;
    }

    selected.push({ id, name, logo, url });
    console.log(`[BEPUL] ${name} | flag=${flag}`);
  }

  console.log(`\nResolving ${selected.length} stream URLs...`);
  const counters = await resolveAll(selected);

  const freeItems = [];
  const seenStreamUrls = new Set();
  let emittedFree = 0;
  let streamDupSkipped = 0;

  for (const item of selected) {
    if (!item.url) continue;

    if (seenStreamUrls.has(item.url)) {
      streamDupSkipped++;
      console.log(`[SKIP:STREAM_DUP] ${item.name}`);
      continue;
    }
    seenStreamUrls.add(item.url);

    freeItems.push(
      buildItem({
        id: item.id,
        name: item.name,
        logo: item.logo,
        url: item.url,
        groupTitle: GROUP_TITLE_FREE,
      })
    );
    emittedFree++;
  }

  saveM3U(FREE_FILE, freeItems);

  console.log("\nTayyor.");
  console.log(`BEPUL FILE    : ${emittedFree} ta -> ${FREE_FILE}`);
  console.log(`PULLIK SKIP   : ${paidSkipped} ta`);
  console.log(`NO_URL SKIP   : ${skippedNoUrl} ta`);
  console.log(`DUP_URL SKIP  : ${skippedDup} ta`);
  console.log(`STREAM_DUP    : ${streamDupSkipped} ta`);
  console.log(`UNKNOWN FLAG  : ${unknownFlag} ta`);
  console.log(`RESOLVED      : ${counters.resolved} ta`);
  console.log(`RESOLVE FAIL  : ${counters.failed} ta`);
}

main()
  .catch((err) => {
    console.error("\nXato:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.GITHUB_ACTIONS !== "true") {
      await waitForEnter();
    }
  });