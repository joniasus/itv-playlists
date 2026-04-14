const fs = require("fs");

const API_BASE = "https://api.mediabay.tv";
const THREAD_URL = (id) => `${API_BASE}/v2/channels/thread/${id}`;

const M3U_FILE = process.env.M3U_FILE || "mediabay_uz.m3u8";
const BACKUP_M3U_FILE = process.env.BACKUP_M3U_FILE || "mediabay_uz.backup.m3u8";

const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const RETRY = Number(process.env.RETRY || 2);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 1200);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const DEBUG_URLS = String(process.env.DEBUG_URLS || "0") === "1";

const EMBEDDED_COOKIE = "a4549368f7c632ea178ea919f8e5b0e5136fe8077169ecc9b243909a7c541945a%3A2%3A%7Bi%3A0%3Bs%3A8%3A%22language%22%3Bi%3A1%3Bs%3A2%3A%22ru%22%3B%7D; G_ENABLED_IDPS=google; SERVERID=s3; G_AUTHUSER_H=0; uppodhtml5_volume=0.8; PHPSESSID=3a6r3ri53c3v4n206nb615mam5; _identity=b2524a5379b8a08f09d1fa1bd5784dc2169d31249ff56e1281a8dd2cecb36ee1a%3A2%3A%7Bi%3A0%3Bs%3A9%3A%22_identity%22%3Bi%3A1%3Bs%3A52%3A%22%5B1667890%2C%22eoa6Dlq8ec7NDuIO3M_hOS7PPHTGfW6R%22%2C2592000%5D%22%3B%7D; _csrf=68bbee8b7914f0bee362d944de473a2211e024e60b6d55a02da5e339e6a3c805a%3A2%3A%7Bi%3A0%3Bs%3A5%3A%22_csrf%22%3Bi%3A1%3Bs%3A32%3A%22YOv8B9bLC1pw9u8G8Yvj5g5Sivw5d-t8%22%3B%7D";
const EMBEDDED_TOKEN = "";

const COOKIE = (process.env.MEDIABAY_COOKIE || EMBEDDED_COOKIE || "").trim();
const TOKEN = (process.env.MEDIABAY_TOKEN || EMBEDDED_TOKEN || "").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders() {
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0",
    origin: "https://mediabay.tv",
    referer: "https://mediabay.tv/",
  };

  if (COOKIE) headers.cookie = COOKIE;
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

  return headers;
}

function pickFirstThreadAddress(json) {
  if (typeof json?.threadAddress === "string" && json.threadAddress.trim()) {
    return json.threadAddress.trim();
  }

  if (typeof json?.data?.threadAddress === "string" && json.data.threadAddress.trim()) {
    return json.data.threadAddress.trim();
  }

  if (Array.isArray(json)) {
    const found = json.find((x) => typeof x?.threadAddress === "string" && x.threadAddress.trim());
    if (found) return found.threadAddress.trim();
  }

  if (Array.isArray(json?.data)) {
    const found = json.data.find((x) => typeof x?.threadAddress === "string" && x.threadAddress.trim());
    if (found) return found.threadAddress.trim();
  }

  return "";
}

function isPaymentRequiredResponse(status, text) {
  if (status === 402) return true;
  return /"message"\s*:\s*"Payment required"/i.test(String(text || ""));
}

function isUnauthorizedResponse(status, text) {
  if (status === 401 || status === 403) return true;
  return /"message"\s*:\s*"(Unauthorized|Forbidden)"/i.test(String(text || ""));
}

function maskSensitiveUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    for (const key of ["token", "access_token", "auth", "signature", "sig"]) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, "***");
      }
    }
    return u.toString();
  } catch {
    return String(url || "").replace(
      /([?&](?:token|access_token|auth|signature|sig)=)[^&]+/gi,
      "$1***"
    );
  }
}

async function fetchTextWithRetry(url) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        signal: controller.signal,
      });

      const text = await res.text();

      if (isPaymentRequiredResponse(res.status, text)) {
        return {
          __skip__: true,
          __reason__: "Payment required",
          __status__: res.status,
          __text__: text,
        };
      }

      if (isUnauthorizedResponse(res.status, text)) {
        return {
          __skip__: true,
          __reason__: `HTTP ${res.status}`,
          __status__: res.status,
          __text__: text,
        };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} | ${text.slice(0, 300)}`);
      }

      return {
        __status__: res.status,
        __text__: text,
      };
    } catch (err) {
      lastError = err;
      if (attempt < RETRY) {
        await sleep(RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchJsonWithRetry(url) {
  const result = await fetchTextWithRetry(url);

  if (result?.__skip__) return result;

  try {
    return JSON.parse(result.__text__);
  } catch {
    throw new Error(`JSON parse error | ${String(result.__text__ || "").slice(0, 300)}`);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

function extractTvgId(extinfLine) {
  const m = String(extinfLine || "").match(/tvg-id="([^"]+)"/i);
  if (!m) return "";
  return String(m[1] || "").trim();
}

function isLikelyUrlLine(line) {
  return /^(https?:\/\/)/i.test(String(line || "").trim());
}

function parseM3UEntries(lines) {
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "");

    if (!line.startsWith("#EXTINF")) continue;

    let urlLineIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const next = String(lines[j] || "").trim();

      if (!next) continue;
      if (next.startsWith("#EXTINF")) break;

      if (isLikelyUrlLine(next)) {
        urlLineIndex = j;
        break;
      }
    }

    if (urlLineIndex === -1) continue;

    const tvgId = extractTvgId(line);
    const oldUrl = String(lines[urlLineIndex] || "").trim();

    entries.push({
      extinfLineIndex: i,
      urlLineIndex,
      tvgId,
      oldUrl,
    });
  }

  return entries;
}

function writeFileAtomic(path, content) {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, path);
}

function copyFileAtomic(fromPath, toPath) {
  const tmp = `${toPath}.tmp`;
  fs.copyFileSync(fromPath, tmp);
  fs.renameSync(tmp, toPath);
}

function resolveInputFile() {
  if (fs.existsSync(M3U_FILE)) {
    return {
      inputFile: M3U_FILE,
      usedBackupAsInput: false,
    };
  }

  if (fs.existsSync(BACKUP_M3U_FILE)) {
    return {
      inputFile: BACKUP_M3U_FILE,
      usedBackupAsInput: true,
    };
  }

  throw new Error(`Fayl topilmadi. Asosiy: ${M3U_FILE} | Zahira: ${BACKUP_M3U_FILE}`);
}

function createBackupIfPossible() {
  if (!fs.existsSync(M3U_FILE)) {
    return false;
  }

  copyFileAtomic(M3U_FILE, BACKUP_M3U_FILE);
  return true;
}

async function main() {
  const { inputFile, usedBackupAsInput } = resolveInputFile();

  const text = fs.readFileSync(inputFile, "utf8");
  const lines = text.split(/\r?\n/);
  const entries = parseM3UEntries(lines);

  if (!entries.length) {
    throw new Error(`#EXTINF + URL juftlik topilmadi: ${inputFile}`);
  }

  const backupCreated = createBackupIfPossible();

  console.log(`INPUT FILE        : ${inputFile}`);
  console.log(`TARGET FILE       : ${M3U_FILE}`);
  console.log(`BACKUP FILE       : ${BACKUP_M3U_FILE}`);
  console.log(`USED BACKUP INPUT : ${usedBackupAsInput ? "ha" : "yo'q"}`);
  console.log(`BACKUP CREATED    : ${backupCreated ? "ha" : "yo'q"}`);
  console.log(`ENTRY             : ${entries.length} ta`);
  console.log(`COOKIE            : ${COOKIE ? "bor" : "yo'q"}`);
  console.log(`TOKEN             : ${TOKEN ? "bor" : "yo'q"}`);
  console.log(`CONCURRENCY       : ${CONCURRENCY}`);

  const results = await mapLimit(entries, CONCURRENCY, async (entry, index) => {
    if (!entry.tvgId || !/^\d+$/.test(entry.tvgId)) {
      console.log(`⏭️ SKIP [${index + 1}/${entries.length}] tvg-id topilmadi`);
      return {
        ...entry,
        ok: false,
        skipped: true,
        reason: "No valid tvg-id",
        newUrl: entry.oldUrl,
      };
    }

    const apiUrl = THREAD_URL(entry.tvgId);

    try {
      const json = await fetchJsonWithRetry(apiUrl);

      if (json?.__skip__) {
        console.log(`⏭️ SKIP [${index + 1}/${entries.length}] id=${entry.tvgId} -> ${json.__reason__}`);
        return {
          ...entry,
          ok: false,
          skipped: true,
          reason: json.__reason__,
          newUrl: entry.oldUrl,
        };
      }

      const freshUrl = pickFirstThreadAddress(json);

      if (!freshUrl) {
        console.log(`⚠️ NO_URL [${index + 1}/${entries.length}] id=${entry.tvgId}`);
        return {
          ...entry,
          ok: false,
          skipped: false,
          reason: "No threadAddress",
          newUrl: entry.oldUrl,
        };
      }

      console.log(`✅ OK [${index + 1}/${entries.length}] id=${entry.tvgId}`);

      if (DEBUG_URLS) {
        console.log(`   OLD : ${maskSensitiveUrl(entry.oldUrl)}`);
        console.log(`   NEW : ${maskSensitiveUrl(freshUrl)}`);
      }

      return {
        ...entry,
        ok: true,
        skipped: false,
        reason: "",
        newUrl: freshUrl,
      };
    } catch (err) {
      const msg = String(err.message || err);
      console.log(`❌ ERR [${index + 1}/${entries.length}] id=${entry.tvgId} -> ${msg}`);
      return {
        ...entry,
        ok: false,
        skipped: false,
        reason: msg,
        newUrl: entry.oldUrl,
      };
    }
  });

  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const row of results) {
    const oldUrl = String(lines[row.urlLineIndex] || "").trim();
    const newUrl = String(row.newUrl || "").trim();

    if (!newUrl) {
      errorCount++;
      continue;
    }

    lines[row.urlLineIndex] = newUrl;

    if (row.skipped) skippedCount++;
    if (!row.ok && !row.skipped) errorCount++;

    if (oldUrl === newUrl) {
      unchangedCount++;
    } else {
      updatedCount++;
    }
  }

  writeFileAtomic(M3U_FILE, lines.join("\n"));

  console.log("\nTayyor.");
  console.log(`UPDATED URL       : ${updatedCount} ta`);
  console.log(`UNCHANGED URL     : ${unchangedCount} ta`);
  console.log(`SKIPPED           : ${skippedCount} ta`);
  console.log(`ERROR             : ${errorCount} ta`);
  console.log(`WRITTEN FILE      : ${M3U_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});