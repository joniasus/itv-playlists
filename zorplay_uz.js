// scan_allowed_channels.js
const fs = require("fs");
const readline = require("readline");

const OUTPUT_JSON = "zorplay_uz.json";
const OUTPUT_M3U = "zorplay_uz.m3u8";


const API_BASE = "https://api-web-zorplay.platform24.tv/v2/channels";

const ACCESS_TOKEN = "cb3585d4aa78502f902b4ae036177ebb5eb7e0c3";
const CHANNEL_LIST_ACCESS_TOKEN = "229c9077145bcf40794ed5847eff9e4620d52fdc";

const ALLOWED_IDS = "5634,8738,8758,8759,8783,8784,4783,679,3301,688,4399,3302,8682,8748,8679,8681,8440,8684,8743,8749,8686,680,684,682,678,8726,676,677,683,4856,5010,5091,7061,8425,8683,8742,8744,8745,2,3,4,40,42,49,59,73,81,83,104,105,114,116,118,120,133,143,147,162,170,175,196,198,213,227,236,281,282,303,389,435,488,491,906,911,982,997,2527,2531,2532,2712,3360,3592,3771,3914,3963,4987,5633,5722,5762,5763,7060,7377,8424,8537,8685,8740,8750";

const GROUP_TITLE = "Zo'r play 🇺🇿";
const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve();
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("\nChiqish uchun Enter bosing...", () => {
      rl.close();
      resolve();
    });
  });
}

function buildStreamUrl(channelId) {
  const url = new URL(`${API_BASE}/${channelId}/stream`);
  url.searchParams.set("access_token", ACCESS_TOKEN);
  url.searchParams.set("format", "json");
  return url.toString();
}

function buildChannelListUrl() {
  const url = new URL(`${API_BASE}/channel_list`);
  url.searchParams.set("access_token", CHANNEL_LIST_ACCESS_TOKEN);
  url.searchParams.set("channels_version", "2");
  url.searchParams.set("format", "json");
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const res = await fetchWithTimeout(url);

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Auth error: HTTP ${res.status}`);
      }

      if (res.status === 429) {
        if (attempt < RETRY_COUNT) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw new Error("Rate limited: HTTP 429");
      }

      if (!res.ok) {
        return null;
      }

      const text = await res.text();
      if (!text || !text.trim()) {
        return null;
      }

      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError || new Error("Unknown request error");
}

function extractHls(data) {
  if (!data || typeof data !== "object") return null;

  const candidates = [
    data.hls,
    data?.stream?.hls,
    data?.data?.hls
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractFallbackName(data, channelId) {
  const candidates = [
    data?.name,
    data?.title,
    data?.channel_name,
    data?.channelTitle,
    data?.channel?.name,
    data?.channel?.title,
    data?.data?.name,
    data?.data?.title
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return `Channel ${channelId}`;
}

function escapeM3uText(text) {
  return String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttr(text) {
  return String(text || "")
    .replace(/"/g, "'")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLogo(url) {
  const s = String(url || "").trim();
  if (!s) return null;
  return s.replace(/^http:\/\//i, "https://");
}

function parseAllowedIds(value) {
  const set = new Set();

  for (const rawPart of String(value || "").split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    if (/^\d+$/.test(part)) {
      const num = Number(part);
      if (Number.isInteger(num) && num > 0 && !set.has(num)) {
        set.add(num);
      }
      continue;
    }

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let start = Number(rangeMatch[1]);
      let end = Number(rangeMatch[2]);

      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;

      if (start > end) {
        [start, end] = [end, start];
      }

      for (let i = start; i <= end; i++) {
        if (i > 0 && !set.has(i)) {
          set.add(i);
        }
      }
    }
  }

  return Array.from(set);
}

function buildChannelMetaMap(listJson) {
  const map = new Map();

  const items = Array.isArray(listJson)
    ? listJson
    : Array.isArray(listJson?.data)
    ? listJson.data
    : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const id = Number(item.id);
    if (!Number.isInteger(id) || id <= 0) continue;

    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : null;

    const logo = normalizeLogo(item?.cover?.full);

    map.set(id, { name, logo });
  }

  return map;
}

async function worker(ids, shared, results, counters, metaMap) {
  while (true) {
    const index = shared.index++;
    if (index >= ids.length) return;

    const channelId = ids[index];
    const url = buildStreamUrl(channelId);

    try {
      const json = await fetchJsonWithRetry(url);
      const hls = extractHls(json);

      if (hls) {
        const meta = metaMap.get(channelId) || {};
        const name = meta.name || extractFallbackName(json, channelId);
        const logo = meta.logo || null;

        results.push({
          channelId,
          name,
          logo,
          hls
        });

        counters.found++;
        console.log(`[FOUND] ${channelId} -> ${name}`);
      } else {
        counters.skipped++;
        console.log(`[SKIP ] ${channelId}`);
      }
    } catch (err) {
      counters.errors++;
      console.log(`[ERROR] ${channelId} -> ${err.message}`);
    }

    counters.done++;
  }
}

async function main() {
  if (!ACCESS_TOKEN) {
    throw new Error("ACCESS_TOKEN is missing");
  }

  const ids = parseAllowedIds(ALLOWED_IDS);
  if (ids.length === 0) {
    throw new Error("No valid channel IDs found");
  }

  const orderMap = new Map(ids.map((id, index) => [id, index]));

  console.log(`Allowed IDs count: ${ids.length}`);
  console.log("Loading channel metadata...");

  const channelListJson = await fetchJsonWithRetry(buildChannelListUrl());
  const metaMap = buildChannelMetaMap(channelListJson);

  console.log(`Metadata loaded: ${metaMap.size}`);

  const results = [];
  const counters = {
    done: 0,
    found: 0,
    skipped: 0,
    errors: 0
  };

  const shared = { index: 0 };
  const workers = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(ids, shared, results, counters, metaMap));
  }

  await Promise.all(workers);

  results.sort((a, b) => {
    const ai = orderMap.has(a.channelId)
      ? orderMap.get(a.channelId)
      : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.channelId)
      ? orderMap.get(b.channelId)
      : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  const seenHls = new Set();
  const uniqueResults = [];

  for (const item of results) {
    if (seenHls.has(item.hls)) continue;
    seenHls.add(item.hls);
    uniqueResults.push(item);
  }

  fs.writeFileSync("zorplay_uz.m3u8", text, "utf8");

  const m3uLines = ["#EXTM3U"];

  for (const item of uniqueResults) {
    const attrs = [
      `tvg-id="${item.channelId}"`,
      `group-title="${escapeAttr(GROUP_TITLE)}"`
    ];

    if (item.logo) {
      attrs.push(`tvg-logo="${escapeAttr(item.logo)}"`);
    }

    m3uLines.push(
      `#EXTINF:-1 ${attrs.join(" ")},${escapeM3uText(item.name)}`
    );
    m3uLines.push(item.hls);
  }

  fs.writeFileSync(OUTPUT_M3U, m3uLines.join("\n"), "utf8");

  console.log("");
  console.log("Done");
  console.log(`Checked : ${counters.done}`);
  console.log(`Found   : ${counters.found}`);
  console.log(`Skipped : ${counters.skipped}`);
  console.log(`Errors  : ${counters.errors}`);
  console.log(`Unique  : ${uniqueResults.length}`);
  console.log(`JSON    : ${OUTPUT_JSON}`);
  console.log(`M3U     : ${OUTPUT_M3U}`);

  await waitForEnter();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  await waitForEnter();
  process.exit(1);
});
