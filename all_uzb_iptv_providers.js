#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIMONOVICH_URL =
  process.env.DIMONOVICH_URL ||
  "https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV";

const CINERAMA_URL =
  process.env.CINERAMA_URL ||
  "https://raw.githubusercontent.com/joniasus/itv-playlists/refs/heads/main/Cinerama_UZ.m3u8";

const SARKOR_URL =
  process.env.SARKOR_URL ||
  "https://raw.githubusercontent.com/joniasus/itv-playlists/refs/heads/main/Sarkor_TV.m3u8";

const DIMONOVICH_UPDATE_DATE = process.env.DIMONOVICH_UPDATE_DATE || "";
const DIMONOVICH_UPDATE_LINE = process.env.DIMONOVICH_UPDATE_LINE || "";

const OUTPUT_FILE =
  process.env.OUTPUT_FILE ||
  path.join(process.cwd(), "all_uzb_iptv_providers.m3u8");

const DEBUG_SAMPLE_LIMIT = 25;

async function main() {
  logSection("START");

  console.log("Node version:", process.version);
  console.log("Working directory:", process.cwd());
  console.log("Output file:", OUTPUT_FILE);
  console.log("DIMONOVICH_URL:", DIMONOVICH_URL);
  console.log("CINERAMA_URL:", CINERAMA_URL);
  console.log("SARKOR_URL:", SARKOR_URL);
  console.log("DIMONOVICH_UPDATE_DATE:", DIMONOVICH_UPDATE_DATE);
  console.log("DIMONOVICH_UPDATE_LINE:", DIMONOVICH_UPDATE_LINE);

  const beforeHash = safeFileHash(OUTPUT_FILE);
  const beforeSize = safeFileSize(OUTPUT_FILE);

  console.log("Before write hash:", beforeHash || "(file yo'q)");
  console.log("Before write size:", beforeSize ?? "(file yo'q)");

  const sources = [
    {
      key: "dimonovich",
      name: "Dimonovich TV",
      url: DIMONOVICH_URL,
      required: true,
    },
    {
      key: "cinerama",
      name: "Cinerama UZ",
      url: CINERAMA_URL,
      required: false,
    },
    {
      key: "sarkor",
      name: "Sarkor TV",
      url: SARKOR_URL,
      required: false,
    },
  ];

  const loadedSources = [];

  for (const source of sources) {
    logSection(`FETCH ${source.name}`);

    try {
      const rawText = await fetchText(source.url);
      const normalized = normalizeM3U(rawText);
      const entries = parseM3UEntries(normalized);
      const stats = collectEntryStats(entries);

      console.log(`[${source.name}] raw length:`, rawText.length);
      console.log(`[${source.name}] normalized length:`, normalized.length);
      console.log(`[${source.name}] total parsed entries:`, entries.length);
      console.log(
        `[${source.name}] ITV UZ exact count:`,
        stats.itvUzExactCount
      );
      console.log(
        `[${source.name}] ITV UZ loose count:`,
        stats.itvUzLooseCount
      );
      console.log(
        `[${source.name}] unique channel names:`,
        stats.uniqueChannelNames
      );
      console.log(
        `[${source.name}] duplicate channel names:`,
        stats.duplicateChannelNameCount
      );
      console.log(
        `[${source.name}] duplicate URLs:`,
        stats.duplicateUrlCount
      );
      console.log(
        `[${source.name}] entries without group-title:`,
        stats.noGroupCount
      );

      printGroupBreakdown(source.name, stats.groupCounts);
      printDuplicateSamples(source.name, stats.duplicateChannelNames, "Duplicate channel names");
      printDuplicateSamples(source.name, stats.duplicateUrls, "Duplicate URLs");
      printItvSamples(source.name, entries);

      loadedSources.push({
        ...source,
        rawText,
        normalized,
        entries,
        stats,
      });
    } catch (error) {
      if (source.required) {
        throw new Error(`${source.name} yuklanmadi: ${error.message}`);
      }
      console.warn(`[WARN] ${source.name} skip qilindi: ${error.message}`);
    }
  }

  if (loadedSources.length === 0) {
    throw new Error("Hech qaysi manba yuklanmadi");
  }

  logSection("MERGE");

  const mergedText = buildMergedPlaylist(loadedSources);
  const mergedEntries = parseM3UEntries(mergedText);
  const mergedStats = collectEntryStats(mergedEntries);

  console.log("Merged text length:", mergedText.length);
  console.log("Merged parsed entries:", mergedEntries.length);
  console.log("Merged ITV UZ exact count:", mergedStats.itvUzExactCount);
  console.log("Merged ITV UZ loose count:", mergedStats.itvUzLooseCount);
  console.log("Merged unique channel names:", mergedStats.uniqueChannelNames);
  console.log("Merged duplicate channel names:", mergedStats.duplicateChannelNameCount);
  console.log("Merged duplicate URLs:", mergedStats.duplicateUrlCount);
  console.log("Merged entries without group-title:", mergedStats.noGroupCount);

  printGroupBreakdown("MERGED", mergedStats.groupCounts);
  printDuplicateSamples("MERGED", mergedStats.duplicateChannelNames, "Duplicate channel names");
  printDuplicateSamples("MERGED", mergedStats.duplicateUrls, "Duplicate URLs");
  printItvSamples("MERGED", mergedEntries);

  logSection("WRITE");

  writeTextFile(OUTPUT_FILE, mergedText);

  const afterHash = safeFileHash(OUTPUT_FILE);
  const afterSize = safeFileSize(OUTPUT_FILE);

  console.log("After write hash:", afterHash || "(yozilmadi)");
  console.log("After write size:", afterSize ?? "(yozilmadi)");

  if (beforeHash && afterHash && beforeHash === afterHash) {
    console.log("[OVERWRITE DETECT] Output hash o'zgarmadi");
  } else {
    console.log("[OVERWRITE DETECT] Output hash o'zgardi");
  }

  verifyWrittenFile(OUTPUT_FILE, mergedStats);

  logSection("DONE");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "all-uzb-iptv-providers-debug/1.0",
      accept: "*/*",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

function normalizeM3U(text) {
  let s = String(text || "");
  s = s.replace(/^\uFEFF/, "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.trim();

  if (!s.startsWith("#EXTM3U")) {
    s = "#EXTM3U\n" + s;
  }

  return s + "\n";
}

function parseM3UEntries(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const entries = [];
  let pendingExtinf = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      pendingExtinf = line;
      continue;
    }

    if (pendingExtinf && isStreamLine(line)) {
      entries.push({
        extinf: pendingExtinf,
        url: line,
        groupTitle: extractGroupTitle(pendingExtinf),
        channelName: extractChannelName(pendingExtinf),
      });
      pendingExtinf = null;
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    pendingExtinf = null;
  }

  return entries;
}

function isStreamLine(line) {
  return /^https?:\/\//i.test(line);
}

function extractGroupTitle(extinf) {
  const m = String(extinf || "").match(/group-title="([^"]*)"/i);
  return m ? m[1].trim() : "";
}

function extractChannelName(extinf) {
  const s = String(extinf || "");
  const idx = s.lastIndexOf(",");
  if (idx === -1) return "";
  return s.slice(idx + 1).trim();
}

function normalizeForCompare(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isItvUzExact(groupTitle) {
  return normalizeForCompare(groupTitle) === normalizeForCompare("Itv.uz (🇺🇿)");
}

function isItvUzLoose(groupTitle) {
  const g = normalizeForCompare(groupTitle);
  return g.includes("itv.uz");
}

function collectEntryStats(entries) {
  const groupCounts = new Map();
  const channelNameCounts = new Map();
  const urlCounts = new Map();

  let itvUzExactCount = 0;
  let itvUzLooseCount = 0;
  let noGroupCount = 0;

  for (const entry of entries) {
    const group = entry.groupTitle || "";
    const channelName = entry.channelName || "";
    const url = entry.url || "";

    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);

    if (!group) noGroupCount += 1;
    if (isItvUzExact(group)) itvUzExactCount += 1;
    if (isItvUzLoose(group)) itvUzLooseCount += 1;

    if (channelName) {
      channelNameCounts.set(channelName, (channelNameCounts.get(channelName) || 0) + 1);
    }

    if (url) {
      urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
    }
  }

  const duplicateChannelNames = [...channelNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));

  const duplicateUrls = [...urlCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));

  return {
    totalEntries: entries.length,
    itvUzExactCount,
    itvUzLooseCount,
    uniqueChannelNames: channelNameCounts.size,
    duplicateChannelNameCount: duplicateChannelNames.length,
    duplicateUrlCount: duplicateUrls.length,
    duplicateChannelNames,
    duplicateUrls,
    groupCounts,
    noGroupCount,
  };
}

function printGroupBreakdown(sourceName, groupCounts) {
  logSection(`${sourceName} GROUP BREAKDOWN`);

  const sorted = [...groupCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "ru");
  });

  if (sorted.length === 0) {
    console.log("Group yo'q");
    return;
  }

  for (const [group, count] of sorted) {
    console.log(`- ${group || "(group-title yo'q)"}: ${count}`);
  }
}

function printDuplicateSamples(sourceName, items, label) {
  logSection(`${sourceName} ${label.toUpperCase()}`);

  if (!items.length) {
    console.log("Yo'q");
    return;
  }

  for (const [value, count] of items.slice(0, DEBUG_SAMPLE_LIMIT)) {
    console.log(`- (${count}x) ${value}`);
  }

  if (items.length > DEBUG_SAMPLE_LIMIT) {
    console.log(`... yana ${items.length - DEBUG_SAMPLE_LIMIT} ta`);
  }
}

function printItvSamples(sourceName, entries) {
  logSection(`${sourceName} ITV SAMPLES`);

  const exact = entries.filter((e) => isItvUzExact(e.groupTitle));
  const loose = entries.filter((e) => isItvUzLoose(e.groupTitle));

  console.log("Exact ITV count:", exact.length);
  console.log("Loose ITV count:", loose.length);

  console.log("--- Exact ITV first samples ---");
  for (const entry of exact.slice(0, DEBUG_SAMPLE_LIMIT)) {
    console.log(`- [${entry.groupTitle}] ${entry.channelName} -> ${entry.url}`);
  }

  if (exact.length > DEBUG_SAMPLE_LIMIT) {
    console.log(`... yana ${exact.length - DEBUG_SAMPLE_LIMIT} ta`);
  }

  const suspicious = loose.filter((e) => !isItvUzExact(e.groupTitle));

  console.log("--- ITV-like but exact emas ---");
  if (!suspicious.length) {
    console.log("Yo'q");
  } else {
    for (const entry of suspicious.slice(0, DEBUG_SAMPLE_LIMIT)) {
      console.log(`- [${entry.groupTitle}] ${entry.channelName}`);
    }
    if (suspicious.length > DEBUG_SAMPLE_LIMIT) {
      console.log(`... yana ${suspicious.length - DEBUG_SAMPLE_LIMIT} ta`);
    }
  }
}

function buildMergedPlaylist(sourceObjects) {
  const out = [];

  out.push("#EXTM3U");
  out.push(`#PLAYLIST:All UZB IPTV providers | Generated: ${new Date().toISOString()}`);

  if (DIMONOVICH_UPDATE_LINE) {
    out.push(`#EXTINF:-1 group-title="🔺 INFO 🔺",${sanitizeSingleLine(DIMONOVICH_UPDATE_LINE)}`);
    out.push("https://example.invalid/info");
  } else if (DIMONOVICH_UPDATE_DATE) {
    out.push(`#EXTINF:-1 group-title="🔺 INFO 🔺",Обновление:${sanitizeSingleLine(DIMONOVICH_UPDATE_DATE)}`);
    out.push("https://example.invalid/info");
  }

  for (const source of sourceObjects) {
    out.push("");
    out.push(`# ===== SOURCE: ${source.name} =====`);
    out.push(stripM3UHeader(source.normalized).trim());
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function stripM3UHeader(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^#EXTM3U[^\n]*\n?/i, "");
}

function sanitizeSingleLine(value) {
  return String(value || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function verifyWrittenFile(filePath, expectedStats) {
  logSection("VERIFY WRITTEN FILE");

  if (!fs.existsSync(filePath)) {
    console.log("Output file topilmadi");
    return;
  }

  const text = fs.readFileSync(filePath, "utf8");
  const entries = parseM3UEntries(text);
  const stats = collectEntryStats(entries);

  console.log("Written file entries:", entries.length);
  console.log("Written file ITV exact:", stats.itvUzExactCount);
  console.log("Written file ITV loose:", stats.itvUzLooseCount);
  console.log("Written file duplicate channel names:", stats.duplicateChannelNameCount);
  console.log("Written file duplicate URLs:", stats.duplicateUrlCount);

  if (stats.totalEntries !== expectedStats.totalEntries) {
    console.log(
      `[OVERWRITE DETECT] DIQQAT: memorydagi entries=${expectedStats.totalEntries}, filedagi entries=${stats.totalEntries}`
    );
  } else {
    console.log("[OVERWRITE DETECT] Entries count mos");
  }

  if (stats.itvUzExactCount !== expectedStats.itvUzExactCount) {
    console.log(
      `[OVERWRITE DETECT] DIQQAT: memorydagi ITV exact=${expectedStats.itvUzExactCount}, filedagi ITV exact=${stats.itvUzExactCount}`
    );
  } else {
    console.log("[OVERWRITE DETECT] ITV exact count mos");
  }
}

function safeFileHash(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function safeFileSize(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function logSection(title) {
  console.log("");
  console.log("==================================================");
  console.log(title);
  console.log("==================================================");
}

main().catch((error) => {
  console.error("");
  console.error("==================================================");
  console.error("XATOLIK");
  console.error("==================================================");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
