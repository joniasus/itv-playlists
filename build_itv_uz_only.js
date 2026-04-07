const https = require('https');
const fs = require('fs');

const SOURCE_URL = 'https://raw.githubusercontent.com/Dimonovich/TV/Dimonovich/FREE/TV';
const TARGET_GROUP = 'group-title="Itv.uz (🇺🇿)"';
const OUTPUT_FILE = 'itv_uz_only.m3u';

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const code = res.statusCode || 0;

      if (code >= 300 && code < 400 && res.headers.location) {
        if (redirects >= 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        resolve(download(res.headers.location, redirects + 1));
        return;
      }

      if (code !== 200) {
        reject(new Error(`HTTP ${code}`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function isUrlLine(line) {
  return /^https?:\/\//i.test(line.trim());
}

function filterM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = ['#EXTM3U'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.startsWith('#EXTINF:')) continue;
    if (!line.includes(TARGET_GROUP)) continue;

    out.push(line);

    let foundUrl = false;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];

      if (next.startsWith('#EXTINF:')) {
        i = j - 1;
        break;
      }

      if (next.trim() !== '') {
        out.push(next);
      }

      if (isUrlLine(next)) {
        foundUrl = true;
        i = j;
        break;
      }

      if (j === lines.length - 1) {
        i = j;
      }
    }

    if (!foundUrl) {
      // leave collected metadata even if URL was missing
    }
  }

  return out.join('\n').trimEnd() + '\n';
}

async function main() {
  const text = await download(SOURCE_URL);
  const filtered = filterM3U(text);
  fs.writeFileSync(OUTPUT_FILE, filtered, 'utf8');

  const count = (filtered.match(/^#EXTINF:/gm) || []).length;
  console.log(`Saved ${OUTPUT_FILE} with ${count} channels.`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
