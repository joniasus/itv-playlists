const fs = require('fs');
const https = require('https');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const OUTPUT_FILE = '4k_video.m3u8';

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseM3U(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const entries = [];
  let header = '#EXTM3U';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (i === 0 && line.startsWith('#EXTM3U')) {
      header = line;
      continue;
    }

    if (!line.startsWith('#EXTINF:')) continue;

    let url = '';
    let j = i + 1;

    while (j < lines.length) {
      const next = lines[j].trim();

      if (!next) {
        j++;
        continue;
      }

      if (next.startsWith('#EXTINF:')) break;

      if (!next.startsWith('#')) {
        url = next;
        break;
      }

      j++;
    }

    if (url) {
      entries.push({ extinf: line, url });
    }
  }

  return { header, entries };
}

function getChannelName(extinf) {
  const idx = extinf.lastIndexOf(',');
  return idx === -1 ? '' : extinf.slice(idx + 1).trim();
}

function isUzbekistanFirst(name) {
  return /Узбекистан|Uzbekistan|Uzbekiston|O['’`]?zbekiston/i.test(name);
}

async function main() {
  try {
    console.log('Playlist yuklanyapti...');
    const text = await download(SOURCE_URL);
    const { header, entries } = parseM3U(text);

    const filtered = entries
      .filter((item) => /group-title="4K VIDEO \(VPN\)"/i.test(item.extinf))
      .map((item) => {
        const extinf = item.extinf.replace(
          /group-title="4K VIDEO \(VPN\)"/gi,
          'group-title="4K VIDEO"'
        );

        return {
          extinf,
          url: item.url,
          name: getChannelName(extinf)
        };
      });

    filtered.sort((a, b) => {
      const aTop = isUzbekistanFirst(a.name) ? 1 : 0;
      const bTop = isUzbekistanFirst(b.name) ? 1 : 0;

      if (aTop !== bTop) return bTop - aTop;
      return a.name.localeCompare(b.name, 'ru');
    });

    const output =
      [header, ...filtered.flatMap((item) => [item.extinf, item.url])].join('\n') + '\n';

    fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

    console.log(`Tayyor: ${OUTPUT_FILE}`);
    console.log(`Jami: ${filtered.length} ta kanal`);
  } catch (err) {
    console.error('Xato:', err.message);
    process.exit(1);
  }
}

main();