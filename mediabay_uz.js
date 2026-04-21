const fs = require("fs");

const API_BASE = "https://api.mediabay.uz";
const CHANNELS_URL = `${API_BASE}/v2/channels/channels`;
const THREAD_URL = (id) => `${API_BASE}/v2/channels/thread/${id}`;

const OUTPUT_M3U = "mediabay__uz.m3u8";
const CONCURRENCY = 12;
const RETRY = 2;
const RETRY_DELAY_MS = 200;
const FETCH_TIMEOUT_MS = 5000;
const GROUP_TITLE = "Mediabay UZ 🇺🇿";
const DEBUG_URLS = true;

const EMBEDDED_COOKIE = "a4549368f7c632ea178ea919f8e5b0e5136fe8077169ecc9b243909a7c541945a%3A2%3A%7Bi%3A0%3Bs%3A8%3A%22language%22%3Bi%3A1%3Bs%3A2%3A%22ru%22%3B%7D; G_ENABLED_IDPS=google; SERVERID=s3; G_AUTHUSER_H=0; uppodhtml5_volume=0.8; PHPSESSID=3a6r3ri53c3v4n206nb615mam5; _identity=b2524a5379b8a08f09d1fa1bd5784dc2169d31249ff56e1281a8dd2cecb36ee1a%3A2%3A%7Bi%3A0%3Bs%3A9%3A%22_identity%22%3Bi%3A1%3Bs%3A52%3A%22%5B1667890%2C%22eoa6Dlq8ec7NDuIO3M_hOS7PPHTGfW6R%22%2C2592000%5D%22%3B%7D; _csrf=68bbee8b7914f0bee362d944de473a2211e024e60b6d55a02da5e339e6a3c805a%3A2%3A%7Bi%3A0%3Bs%3A5%3A%22_csrf%22%3Bi%3A1%3Bs%3A32%3A%22YOv8B9bLC1pw9u8G8Yvj5g5Sivw5d-t8%22%3B%7D";
const EMBEDDED_TOKEN = "";

const COOKIE = (process.env.MEDIABAY_COOKIE || EMBEDDED_COOKIE || "").trim();
const TOKEN = (process.env.MEDIABAY_TOKEN || EMBEDDED_TOKEN || "").trim();

// Eski faylingizdagi INPUT_TEXT ni shu yerga o'zgartirmasdan qo'ying.
const INPUT_TEXT = `
1	Yoshlar	https://api.mediabay.uz/v2/channels/thread/1
2	Toshkent	https://api.mediabay.uz/v2/channels/thread/2
11	Sport	https://api.mediabay.uz/v2/channels/thread/11
12	O'zbekiston	https://api.mediabay.uz/v2/channels/thread/12
34	Россия 1	https://api.mediabay.uz/v2/channels/thread/34
35	Первый	https://api.mediabay.uz/v2/channels/thread/35
37	НТВ	https://api.mediabay.uz/v2/channels/thread/37
39	Dunyo Boylab	https://api.mediabay.uz/v2/channels/thread/39
40	Madaniyat va Marifat	https://api.mediabay.uz/v2/channels/thread/40
41	Discovery	https://api.mediabay.uz/v2/channels/thread/41
44	Россия 24	https://api.mediabay.uz/v2/channels/thread/44
45	Киносвидание	https://api.mediabay.uz/v2/channels/thread/45
46	Россия К	https://api.mediabay.uz/v2/channels/thread/46
47	Карусель	https://api.mediabay.uz/v2/channels/thread/47
48	Звезда	https://api.mediabay.uz/v2/channels/thread/48
53	Кинохит	https://api.mediabay.uz/v2/channels/thread/53
54	Кинопремьера	https://api.mediabay.uz/v2/channels/thread/54
56	Animal Planet	https://api.mediabay.uz/v2/channels/thread/56
57	National Geographic Channel	https://api.mediabay.uz/v2/channels/thread/57
60	ТВЦ	https://api.mediabay.uz/v2/channels/thread/60
61	MilliyTV HD	https://api.mediabay.uz/v2/channels/thread/61
62	Fashion TV	https://api.mediabay.uz/v2/channels/thread/62
63	Телекафе	https://api.mediabay.uz/v2/channels/thread/63
64	УНИКУМ	https://api.mediabay.uz/v2/channels/thread/64
65	Охота и рыбалка	https://api.mediabay.uz/v2/channels/thread/65
66	EuroSport 1 HD	https://api.mediabay.uz/v2/channels/thread/66
67	Euronews	https://api.mediabay.uz/v2/channels/thread/67
75	Viju Explore	https://api.mediabay.uz/v2/channels/thread/75
76	Bolajon	https://api.mediabay.uz/v2/channels/thread/76
78	Viju History	https://api.mediabay.uz/v2/channels/thread/78
80	viju TV1000	https://api.mediabay.uz/v2/channels/thread/80
82	viju TV1000 Русское кино	https://api.mediabay.uz/v2/channels/thread/82
248	Navo	https://api.mediabay.uz/v2/channels/thread/248
261	Наше Новое Кино	https://api.mediabay.uz/v2/channels/thread/261
267	МузТВ	https://api.mediabay.uz/v2/channels/thread/267
344	Mahalla	https://api.mediabay.uz/v2/channels/thread/344
347	Futbol TV	https://api.mediabay.uz/v2/channels/thread/347
348	O'zbekiston 24	https://api.mediabay.uz/v2/channels/thread/348
349	Mening Yurtim	https://api.mediabay.uz/v2/channels/thread/349
350	Индийское кино	https://api.mediabay.uz/v2/channels/thread/350
351	Техно 24	https://api.mediabay.uz/v2/channels/thread/351
352	Авто Плюс	https://api.mediabay.uz/v2/channels/thread/352
362	Discovery Science	https://api.mediabay.uz/v2/channels/thread/362
363	Kinoteatr	https://api.mediabay.uz/v2/channels/thread/363
364	O'zbekiston Tarixi	https://api.mediabay.uz/v2/channels/thread/364
365	RU TV	https://api.mediabay.uz/v2/channels/thread/365
367	National Geographic Wild	https://api.mediabay.uz/v2/channels/thread/367
369	Кинопоказ	https://api.mediabay.uz/v2/channels/thread/369
372	Детский Мир	https://api.mediabay.uz/v2/channels/thread/372
373	Zo'rTV HD	https://api.mediabay.uz/v2/channels/thread/373
375	FTV	https://api.mediabay.uz/v2/channels/thread/375
376	Родное Кино	https://api.mediabay.uz/v2/channels/thread/376
377	Ретро ТВ	https://api.mediabay.uz/v2/channels/thread/377
378	Музыка Первого	https://api.mediabay.uz/v2/channels/thread/378
380	LUX.TV HD	https://api.mediabay.uz/v2/channels/thread/380
393	Taraqqiyot	https://api.mediabay.uz/v2/channels/thread/393
411	Мужское Кино HD	https://api.mediabay.uz/v2/channels/thread/411
426	Киносерия	https://api.mediabay.uz/v2/channels/thread/426
428	Кинокомедия	https://api.mediabay.uz/v2/channels/thread/428
430	Кухня ТВ	https://api.mediabay.uz/v2/channels/thread/430
432	365 Дней	https://api.mediabay.uz/v2/channels/thread/432
441	DaVinci	https://api.mediabay.uz/v2/channels/thread/441
456	Киномикс HD	https://api.mediabay.uz/v2/channels/thread/456
459	Киносемья	https://api.mediabay.uz/v2/channels/thread/459
465	Ля-Минор ТВ	https://api.mediabay.uz/v2/channels/thread/465
468	Мультиландия HD	https://api.mediabay.uz/v2/channels/thread/468
546	HD Life	https://api.mediabay.uz/v2/channels/thread/546
549	Дом кино	https://api.mediabay.uz/v2/channels/thread/549
552	МИР	https://api.mediabay.uz/v2/channels/thread/552
555	МИР 24	https://api.mediabay.uz/v2/channels/thread/555
558	Aqlvoy	https://api.mediabay.uz/v2/channels/thread/558
559	Ruxsor TV	https://api.mediabay.uz/v2/channels/thread/559
562	Gold UZ TV	https://api.mediabay.uz/v2/channels/thread/562
567	Dasturxon TV	https://api.mediabay.uz/v2/channels/thread/567
568	Renessans TV	https://api.mediabay.uz/v2/channels/thread/568
571	Nurafshon TV	https://api.mediabay.uz/v2/channels/thread/571
574	История	https://api.mediabay.uz/v2/channels/thread/574
575	Живая Планета	https://api.mediabay.uz/v2/channels/thread/575
577	Доктор	https://api.mediabay.uz/v2/channels/thread/577
578	MMA_TV	https://api.mediabay.uz/v2/channels/thread/578
582	Сарафан	https://api.mediabay.uz/v2/channels/thread/582
584	France 24	https://api.mediabay.uz/v2/channels/thread/584
586	Мульт	https://api.mediabay.uz/v2/channels/thread/586
589	Мама	https://api.mediabay.uz/v2/channels/thread/589
592	Моя планета	https://api.mediabay.uz/v2/channels/thread/592
593	Наука	https://api.mediabay.uz/v2/channels/thread/593
595	Cinema	https://api.mediabay.uz/v2/channels/thread/595
599	Матч! Планета	https://api.mediabay.uz/v2/channels/thread/599
602	S IKBOL	https://api.mediabay.uz/v2/channels/thread/602
606	CNN International	https://api.mediabay.uz/v2/channels/thread/606
608	BBC World News	https://api.mediabay.uz/v2/channels/thread/608
610	Bloomberg	https://api.mediabay.uz/v2/channels/thread/610
612	CGTN	https://api.mediabay.uz/v2/channels/thread/612
613	TRT AVAZ	https://api.mediabay.uz/v2/channels/thread/613
614	Туган Тел	https://api.mediabay.uz/v2/channels/thread/614
617	8 канал	https://api.mediabay.uz/v2/channels/thread/617
618	ТНВ Планета	https://api.mediabay.uz/v2/channels/thread/618
622	BRIDGE Classic	https://api.mediabay.uz/v2/channels/thread/622
625	В гостях у Сказки	https://api.mediabay.uz/v2/channels/thread/625
627	Ducktv HD	https://api.mediabay.uz/v2/channels/thread/627
629	Дорама	https://api.mediabay.uz/v2/channels/thread/629
631	Trace Sport Stars HD	https://api.mediabay.uz/v2/channels/thread/631
635	Первый HD	https://api.mediabay.uz/v2/channels/thread/635
638	Biz TV	https://api.mediabay.uz/v2/channels/thread/638
648	Setanta Sports 1	https://api.mediabay.uz/v2/channels/thread/648
649	Setanta Sports 2	https://api.mediabay.uz/v2/channels/thread/649
650	TRT Haber	https://api.mediabay.uz/v2/channels/thread/650
651	MUZ TV O'zbekiston	https://api.mediabay.uz/v2/channels/thread/651
654	Ellikqal’a TV	https://api.mediabay.uz/v2/channels/thread/654
661	Zoopark	https://api.mediabay.uz/v2/channels/thread/661
664	Deutsche Welle	https://api.mediabay.uz/v2/channels/thread/664
666	Живи	https://api.mediabay.uz/v2/channels/thread/666
668	Домашние животные	https://api.mediabay.uz/v2/channels/thread/668
670	Усадьба	https://api.mediabay.uz/v2/channels/thread/670
672	Здоровое ТВ	https://api.mediabay.uz/v2/channels/thread/672
674	Вопросы и ответы	https://api.mediabay.uz/v2/channels/thread/674
676	Авто 24	https://api.mediabay.uz/v2/channels/thread/676
678	Драйв	https://api.mediabay.uz/v2/channels/thread/678
684	КХЛ	https://api.mediabay.uz/v2/channels/thread/684
686	Хабар 24	https://api.mediabay.uz/v2/channels/thread/686
688	Живи Активно	https://api.mediabay.uz/v2/channels/thread/688
689	В мире животных	https://api.mediabay.uz/v2/channels/thread/689
693	Рыжий	https://api.mediabay.uz/v2/channels/thread/693
694	Приключения	https://api.mediabay.uz/v2/channels/thread/694
697	Загородный	https://api.mediabay.uz/v2/channels/thread/697
701	Живая природа	https://api.mediabay.uz/v2/channels/thread/701
703	Арсенал	https://api.mediabay.uz/v2/channels/thread/703
706	Капитан Фантастика	https://api.mediabay.uz/v2/channels/thread/706
707	Охотник и рыболов	https://api.mediabay.uz/v2/channels/thread/707
710	Первый космический	https://api.mediabay.uz/v2/channels/thread/710
711	Insight TV	https://api.mediabay.uz/v2/channels/thread/711
715	Глазами Туриста HD	https://api.mediabay.uz/v2/channels/thread/715
718	Наша Сибирь HD	https://api.mediabay.uz/v2/channels/thread/718
728	Точка отрыва	https://api.mediabay.uz/v2/channels/thread/728
731	TRT Muzik	https://api.mediabay.uz/v2/channels/thread/731
734	Qazaqstan	https://api.mediabay.uz/v2/channels/thread/734
736	MYDAYTV	https://api.mediabay.uz/v2/channels/thread/736
737	CGTN Russian	https://api.mediabay.uz/v2/channels/thread/737
740	Euronews English HD	https://api.mediabay.uz/v2/channels/thread/740
743	Hollywood	https://api.mediabay.uz/v2/channels/thread/743
745	NHK World Japan	https://api.mediabay.uz/v2/channels/thread/745
747	KBS WORLD HD	https://api.mediabay.uz/v2/channels/thread/747
748	TV 1000 Action	https://api.mediabay.uz/v2/channels/thread/748
753	viju+ Comedy	https://api.mediabay.uz/v2/channels/thread/753
755	viju+ Serial	https://api.mediabay.uz/v2/channels/thread/755
756	viju+ Sport	https://api.mediabay.uz/v2/channels/thread/756
758	viju+ Premiere	https://api.mediabay.uz/v2/channels/thread/758
759	Бобёр	https://api.mediabay.uz/v2/channels/thread/759
762	Домашний International	https://api.mediabay.uz/v2/channels/thread/762
771	TVT 1	https://api.mediabay.uz/v2/channels/thread/771
773	AzTV	https://api.mediabay.uz/v2/channels/thread/773
774	СТС Kids	https://api.mediabay.uz/v2/channels/thread/774
777	Al Jazeera English	https://api.mediabay.uz/v2/channels/thread/777
791	Ishonch TV	https://api.mediabay.uz/v2/channels/thread/791
794	NTV	https://api.mediabay.uz/v2/channels/thread/794
797	Istiqlol TV	https://api.mediabay.uz/v2/channels/thread/797
801	8TV	https://api.mediabay.uz/v2/channels/thread/801
804	Muloqot telekanali	https://api.mediabay.uz/v2/channels/thread/804
807	TiJi	https://api.mediabay.uz/v2/channels/thread/807
810	English Club TV	https://api.mediabay.uz/v2/channels/thread/810
813	Bollywood HD	https://api.mediabay.uz/v2/channels/thread/813
816	Gulli Girl	https://api.mediabay.uz/v2/channels/thread/816
821	Ocean TV	https://api.mediabay.uz/v2/channels/thread/821
823	РБК ТВ	https://api.mediabay.uz/v2/channels/thread/823
825	viju Nature	https://api.mediabay.uz/v2/channels/thread/825
829	BIZ Cinema	https://api.mediabay.uz/v2/channels/thread/829
836	NUKUS	https://api.mediabay.uz/v2/channels/thread/836
842	XORAZM	https://api.mediabay.uz/v2/channels/thread/842
843	SURXONDARYO	https://api.mediabay.uz/v2/channels/thread/843
848	FARG'ONA	https://api.mediabay.uz/v2/channels/thread/848
868	CNBC HD	https://api.mediabay.uz/v2/channels/thread/868
874	Наша Тема	https://api.mediabay.uz/v2/channels/thread/874
876	Star Cinema	https://api.mediabay.uz/v2/channels/thread/876
878	Русский Бестселлер	https://api.mediabay.uz/v2/channels/thread/878
879	Русский детектив	https://api.mediabay.uz/v2/channels/thread/879
891	Zo'rTV	https://api.mediabay.uz/v2/channels/thread/891
893	Shifo TV	https://api.mediabay.uz/v2/channels/thread/893
895	MiMi TV	https://api.mediabay.uz/v2/channels/thread/895
900	Makon TV	https://api.mediabay.uz/v2/channels/thread/900
901	QIZIQTV	https://api.mediabay.uz/v2/channels/thread/901
902	RETROTV	https://api.mediabay.uz/v2/channels/thread/902
903	Biz Music	https://api.mediabay.uz/v2/channels/thread/903
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(s) {
  return String(s || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseLine(line) {
  const s = String(line || "").trim();
  if (!s) return null;

  // Formatlar:
  // 1   Name   https://...
  // 1   Name
  const m = s.match(/^(\d+)\s+(.+?)(?:\s+https?:\/\/\S+)?$/);
  if (!m) return null;

  const id = Number(m[1]);
  const name = cleanText(m[2]);

  return {
    id,
    name,
    apiUrl: THREAD_URL(id),
  };
}

function buildHeaders() {
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0",
    origin: "https://mediabay.uz",
    referer: "https://mediabay.uz/",
  };

  if (COOKIE) headers.cookie = COOKIE;
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

  return headers;
}

function extractChannels(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.channels)) return json.channels;
  if (Array.isArray(json?.result)) return json.result;
  return [];
}

function toAbsoluteLogoUrl(logoValue) {
  const s = String(logoValue || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;

  try {
    return new URL(s, API_BASE).href;
  } catch {
    return "";
  }
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

function normalizeBaseUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "").trim();
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
        return { __skip__: true, __reason__: "Payment required", __status__: res.status, __text__: text };
      }

      if (isUnauthorizedResponse(res.status, text)) {
        return { __skip__: true, __reason__: `HTTP ${res.status}`, __status__: res.status, __text__: text };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} | ${text.slice(0, 300)}`);
      }

      return { __text__: text, __status__: res.status };
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

async function buildLogoMap() {
  const json = await fetchJsonWithRetry(CHANNELS_URL);
  if (json?.__skip__) {
    throw new Error(`Channel list skip: ${json.__reason__}`);
  }

  const channels = extractChannels(json);
  const map = new Map();

  for (const ch of channels) {
    const id = Number(ch?.id);
    if (!id) continue;

    const logo = toAbsoluteLogoUrl(ch?.logo || ch?.icon || "");
    if (logo) {
      map.set(id, logo);
    }
  }

  return map;
}

function makeM3ULines(rows) {
  const lines = ["#EXTM3U"];

  for (const row of rows) {
    const attrs = [
      `tvg-id="${escapeAttr(String(row.id))}"`,
      `group-title="${escapeAttr(GROUP_TITLE)}"`,
    ];

    if (row.logo) {
      attrs.push(`tvg-logo="${escapeAttr(row.logo)}"`);
    }

    lines.push(`#EXTINF:-1 ${attrs.join(" ")},${row.name}`);
    lines.push(row.streamUrl);
  }

  return lines;
}

async function main() {
  const entries = INPUT_TEXT
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);

  if (!entries.length) {
    throw new Error("INPUT_TEXT ichidan to'g'ri qator topilmadi");
  }

  console.log(`Jami kanal: ${entries.length} ta`);
  console.log(`Cookie: ${COOKIE ? "bor" : "yo'q"}`);
  console.log(`Token : ${TOKEN ? "bor" : "yo'q"}`);

  let logoMap = new Map();

  try {
    console.log("Logo mapping olinmoqda...");
    logoMap = await buildLogoMap();
    console.log(`Logo topildi: ${logoMap.size} ta`);
  } catch (err) {
    console.log(`⚠️ Logo mapping olib bo'lmadi: ${err.message || err}`);
  }

  const rows = await mapLimit(entries, CONCURRENCY, async (item, index) => {
    try {
      const json = await fetchJsonWithRetry(item.apiUrl);
      const logo = logoMap.get(item.id) || "";

      if (json?.__skip__) {
        console.log(`⏭️ SKIP [${index + 1}/${entries.length}] ${item.id} ${item.name} -> ${json.__reason__}`);
        return {
          ...item,
          logo,
          streamUrl: "",
          baseUrl: "",
          ok: false,
          skipped: true,
          reason: json.__reason__,
        };
      }

      const streamUrl = pickFirstThreadAddress(json);

      if (!streamUrl) {
        console.log(`⚠️ NO_URL [${index + 1}/${entries.length}] ${item.id} ${item.name}`);
        return {
          ...item,
          logo,
          streamUrl: "",
          baseUrl: "",
          ok: false,
          skipped: false,
          reason: "No threadAddress",
        };
      }

      const baseUrl = normalizeBaseUrl(streamUrl);

      console.log(`✅ OK [${index + 1}/${entries.length}] ${item.id} ${item.name}`);

      if (DEBUG_URLS) {
        console.log(`   BASE : ${baseUrl}`);
        console.log(`   FULL : ${maskSensitiveUrl(streamUrl)}`);
      }

      return {
        ...item,
        logo,
        streamUrl,
        baseUrl,
        ok: true,
        skipped: false,
        reason: "",
      };
    } catch (err) {
      const msg = String(err.message || err);
      console.log(`❌ ERR [${index + 1}/${entries.length}] ${item.id} ${item.name} -> ${msg}`);
      return {
        ...item,
        logo: logoMap.get(item.id) || "",
        streamUrl: "",
        baseUrl: "",
        ok: false,
        skipped: false,
        reason: msg,
      };
    }
  });

  const okRows = rows.filter((x) => x.ok && x.streamUrl);
  const skippedRows = rows.filter((x) => x.skipped);

  // Faqat aynan bir xil full URL bo'lsa dedupe qilamiz.
  // Base URL bo'yicha faqat debug chiqaramiz, avtomatik o'chirmaymiz.
  const seenExactUrls = new Set();
  const dedupedRows = [];
  let exactDuplicateCount = 0;

  for (const row of okRows) {
    const key = row.streamUrl.trim();
    if (seenExactUrls.has(key)) {
      exactDuplicateCount++;
      continue;
    }
    seenExactUrls.add(key);
    dedupedRows.push(row);
  }

  const baseGroups = new Map();
  for (const row of dedupedRows) {
    const key = row.baseUrl;
    if (!baseGroups.has(key)) baseGroups.set(key, []);
    baseGroups.get(key).push(`${row.id}:${row.name}`);
  }

  fs.writeFileSync(OUTPUT_M3U, makeM3ULines(dedupedRows).join("\n") + "\n", "utf8");

  console.log("\nTayyor.");
  console.log(`OK                : ${okRows.length} ta`);
  console.log(`EXACT DEDUPED     : ${exactDuplicateCount} ta`);
  console.log(`FINAL WRITTEN     : ${dedupedRows.length} ta`);
  console.log(`SKIP              : ${skippedRows.length} ta`);
  console.log(`M3U               : ${OUTPUT_M3U}`);

  const paymentSkips = skippedRows.filter((x) => x.reason === "Payment required").length;
  const authSkips = skippedRows.filter((x) => /^HTTP 401|^HTTP 403/.test(x.reason)).length;

  console.log(`SKIP Payment      : ${paymentSkips} ta`);
  console.log(`SKIP 401/403      : ${authSkips} ta`);

  const duplicateBaseGroups = [...baseGroups.entries()].filter(([, arr]) => arr.length > 1);
  if (duplicateBaseGroups.length) {
    console.log(`\n⚠️ Bir xil BASE URL bilan bir nechta kanal topildi: ${duplicateBaseGroups.length} ta guruh`);
    for (const [base, arr] of duplicateBaseGroups.slice(0, 20)) {
      console.log(`BASE: ${base}`);
      console.log(`  -> ${arr.join(" | ")}`);
    }
  }

  if (DEBUG_URLS) {
    console.log("\nBase URL misollar:");
    for (const row of dedupedRows.slice(0, 10)) {
      console.log(`${row.id} | ${row.name} | ${row.baseUrl}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
