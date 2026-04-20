const fs = require("fs");
const readline = require("readline");

const LIST_URL =
  "https://mw.tvcom.uz/tvmiddleware/api/channel/list/?authkey=be63bab060b589cde497073ecd7a1766d193e308e5aa5e67c8a74abedbae987d1a19891c0608937184fdf8d42c7dece35cd923e34f6a76a4ea9c313ee7a53bc3&client_id=1&api_key=56JNSqNT&compact=1&device=android";

const FREE_FILE = "tvcom_uz.m3u8";
const GROUP_TITLE_FREE = "TVcom UZ 🇺🇿";

const FREE_FLAG_VALUE = 1;
const REMOVE_DUPLICATE_URLS = true;
const SKIP_EMPTY_URL = true;

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

async function main() {
  console.log("TVCOM kanal ro'yxati olinmoqda...\n");

  const json = await fetchJson(LIST_URL);
  const rawChannels = getChannels(json);

  if (!rawChannels) {
    throw new Error("channels massiv topilmadi");
  }

  const channels = rawChannels.filter(
    (ch) => getSubscriptionFlag(ch) === FREE_FLAG_VALUE
  );

  const PRIORITY_IDS = [48, 65, 63, 59, 52, 58, 275, 294, 170, 317, 318, 319, 328, 329];
  
  const UZ_NAME_PATTERN = new RegExp(
    [
      "O'z", "Uzb", "\\bUZ\\b", "Milliy", "MTRK", "\\bTTV\\b", "\\bBiZ\\b",
      "Toshkent", "Yoshlar", "Bolajon", "Sevimli", "Mahalla", "FUTBOL TV",
      "NAVO", "Dunyo Boylab", "Mening Yurtim", "Uzreport", "\\bFTV\\b",
      "LUX TV", "Kinoteatr", "TARAQQIYOT", "Dasturxon", "AQLVOY",
      "Nurafshon", "RENESSANS", "Ruxsor", "8[- ]?TV", "MUZTV",
      "Jizzax", "Andijon", "Buxoro", "Fargona", "Namangan", "Navoiy",
      "Qaraqalpaqstan", "Qashqadaryo", "Samarqand", "Sirdaryo",
      "Surxondaryo", "Xorazm", "Denov", "Nasaf", "Amudaryo", "Vodiy",
      "Ellikqala", "Muloqot", "Istiqlol", "MYDAYTV", "\\bITV\\b",
      "MAKON", "Qiziq", "Shifo", "mimi TV", "Star Cinema", "Madaniyat",
      "S-Ikbol", "S-Music", "Gold UZ", "TVCOM", "Biz Cinema", "ZOR TV",
    ].join("|"),
    "i"
  );

  const HAS_CYRILLIC = /[\u0400-\u04FF]/;

  const isUzbekChannel = (name) => {
    const n = cleanText(name);
    if (UZ_NAME_PATTERN.test(n)) return true;
    return false;
  };

  const isRussianChannel = (name) => {
    const n = cleanText(name);
    if (isUzbekChannel(n)) return false;
    return HAS_CYRILLIC.test(n);
  };

  const priorityIndex = (id) => {
    const idx = PRIORITY_IDS.indexOf(id);
    return idx === -1 ? PRIORITY_IDS.length : idx;
  };

  const groupRank = (ch, id) => {
    if (PRIORITY_IDS.includes(id)) return 0;
    const name = getChannelName(ch, 0);
    if (isUzbekChannel(name)) return 1;
    if (isRussianChannel(name)) return 2;
    return 3;
  };

  channels.sort((a, b) => {
    const aId = toNumber(pickFirst(a.id, a.cid, a.channel_id), Number.MAX_SAFE_INTEGER);
    const bId = toNumber(pickFirst(b.id, b.cid, b.channel_id), Number.MAX_SAFE_INTEGER);

    const aGroup = groupRank(a, aId);
    const bGroup = groupRank(b, bId);
    if (aGroup !== bGroup) return aGroup - bGroup;

    if (aGroup === 0) return priorityIndex(aId) - priorityIndex(bId);
    return aId - bId;
  });

  const freeItems = [];
  const seenUrls = new Set();

  let freeCount = 0;
  const paidSkipped = rawChannels.length - channels.length;
  let skippedNoUrl = 0;
  let skippedDup = 0;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];

    const id = getChannelId(ch, i);
    const name = getChannelName(ch, i);
    const logo = getChannelLogo(ch);
    const url = getChannelUrl(ch);

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

    if (url) {
      seenUrls.add(url);
    }

    const freeItem = buildItem({
      id,
      name,
      logo,
      url,
      groupTitle: GROUP_TITLE_FREE,
    });

    freeItems.push(freeItem);
    freeCount++;
    console.log(`[BEPUL] ${name}`);
  }

  saveM3U(FREE_FILE, freeItems);

  console.log("\nTayyor.");
  console.log(`BEPUL FILE    : ${freeCount} ta -> ${FREE_FILE}`);
  console.log(`PULLIK SKIP   : ${paidSkipped} ta`);
  console.log(`NO_URL SKIP   : ${skippedNoUrl} ta`);
  console.log(`DUP_URL SKIP  : ${skippedDup} ta`);
  console.log(`UNIQUE URL    : ${seenUrls.size} ta`);
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
