const fs = require("fs");

const AUTHKEY = "be63bab060b589cde497073ecd7a1766d193e308e5aa5e67c8a74abedbae987d1a19891c0608937184fdf8d42c7dece35cd923e34f6a76a4ea9c313ee7a53bc3";
const CLIENT_ID = "1";
const API_KEY = "56JNSqNT";
const DEVICE = "android";

const LIST_URL =
  `https://mw.tvcom.uz/tvmiddleware/api/channel/list/?authkey=${encodeURIComponent(AUTHKEY)}` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&api_key=${encodeURIComponent(API_KEY)}` +
  `&compact=1&device=${encodeURIComponent(DEVICE)}`;

const OUTPUT_FILE = "tvcom_uz.m3u8";
const GROUP_TITLE = "TVcom UZ 🇺🇿";

const CID_ORDER = [48,63,65,59,52,58,84,321,170,330,275,294,319,317,328,329,302,303,274,253,61,295,307,54,51,56,60,64,83,85,131,137,256,276,277,278,279,280,281,282,283,310,284,285,286,287,301,50,305,306,190,309,55,49,311,315,318,320,323,324,67,341,132,7,53,62,134,239,270,292,313,33,300,22,229,24,268,297,298,316,34,251,293,308,17,10,197,200,266,269,304,1,2,4,5,8,236,32,262,41,271,245,235,240,179,185,189,299,183,199,198,129,138,342,19,242,338,15,43,267,173,186,69,191,180,128,196,247,178,181,195,182,222,42,252,174,224,246,228,312,296,226,184];

const CID_ORDER_MAP = new Map(
  CID_ORDER.map((cid, index) => [String(cid), index])
);

function htmlDecode(str = "") {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeName(name = "") {
  return String(name).replace(/[\r\n]+/g, " ").trim();
}

function getCid(ch) {
  return ch?.id ?? ch?.cid ?? ch?.channel_id ?? "NO_CID";
}

function getName(ch) {
  const cid = getCid(ch);
  return safeName(htmlDecode(ch?.name || ch?.title || `Channel ${cid}`));
}

function makeLogoUrl(ch) {
  const icon = ch.icon || ch.logo || "";
  if (!icon) return "";

  if (icon.startsWith("http://") || icon.startsWith("https://")) {
    return icon;
  }

  if (icon.startsWith("/")) {
    return `https://mw.tvcom.uz${icon}`;
  }

  return `https://mw.tvcom.uz/${icon}`;
}

function makeLiveUrl(cid) {
  return (
    `https://mw.tvcom.uz/tvmiddleware/api/channel/url/?cid=${encodeURIComponent(String(cid))}` +
    `&device=${encodeURIComponent(DEVICE)}` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&authkey=${encodeURIComponent(AUTHKEY)}` +
    `&timezone=0`
  );
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": "okhttp/4.9.2",
      referer: "https://tvcom.uz/",
      origin: "https://tvcom.uz",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return await res.json();
}

async function loadChannels() {
  const json = await fetchJson(LIST_URL);

  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.channels)) return json.channels;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results)) return json.results;

  throw new Error("Каналлар рўйхати массив кўринишида топилмади");
}

function sortByCidArray(a, b) {
  const aCid = String(getCid(a));
  const bCid = String(getCid(b));

  const aIn = CID_ORDER_MAP.has(aCid);
  const bIn = CID_ORDER_MAP.has(bCid);

  if (aIn && bIn) {
    return CID_ORDER_MAP.get(aCid) - CID_ORDER_MAP.get(bCid);
  }

  if (aIn) return -1;
  if (bIn) return 1;

  return 0;
}

function buildM3UEntry(channel) {
  const cid = getCid(channel);
  const name = getName(channel);
  const logo = makeLogoUrl(channel);
  const liveUrl = makeLiveUrl(cid);

  return [
    `#EXTINF:-1 tvg-id="${cid}" tvg-logo="${logo}" group-title="${GROUP_TITLE}",${name}`,
    liveUrl,
  ].join("\n");
}

async function main() {
  if (!AUTHKEY || AUTHKEY === "YOUR_AUTHKEY_HERE") {
    throw new Error("AUTHKEY ни киритинг");
  }

  console.log("📥 Каналлар рўйхати олиняпти...");
  const channelsAll = await loadChannels();

  const rows = channelsAll
    .filter((ch) => Number(ch.has_subscription) !== 0)
    .filter((ch) => getCid(ch) !== "NO_CID")
    .sort(sortByCidArray)
    .map(buildM3UEntry);

  fs.writeFileSync(
    OUTPUT_FILE,
    "#EXTM3U\n" + rows.join("\n") + "\n",
    "utf8"
  );

  console.log(`💾 Сақланди: ${OUTPUT_FILE}`);
  console.log(`✅ Каналлар: ${rows.length}`);
}

main().catch((err) => {
  console.error("🚨 Хато:", err.message || err);
  process.exit(1);
});
