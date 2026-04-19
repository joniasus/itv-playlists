#!/bin/bash
set -u

cd /home/taqqoz/playlists
NODE=/home/taqqoz/.nvm/versions/node/v20.20.0/bin/node
TS() { date '+%Y-%m-%d %H:%M:%S'; }

echo "$(TS) --- Pulling latest changes ---"
git pull --rebase origin main || echo "$(TS) WARN: git pull failed, continuing"

run_gen() {
  local name="$1"
  local script="$2"
  echo "$(TS) --- Running $name ---"
  if $NODE "$script"; then
    echo "$(TS) OK: $name"
  else
    echo "$(TS) FAIL: $name (continuing)"
  fi
}

run_gen "itv_uz"      itv_uz.js
run_gen "tvcom_uz"    tvcom_uz.js
run_gen "zorplay_uz"  zorplay_uz.js
run_gen "mediabay_uz" mediabay_uz.js

if git diff --quiet -- '*.m3u8' '*.json'; then
  echo "$(TS) No changes to push."
  exit 0
fi

echo "$(TS) --- Committing + pushing ---"
git add -- '*.m3u8' '*.json' 2>/dev/null || true
git commit -m "Auto-update playlists" || { echo "$(TS) Nothing to commit"; exit 0; }
git push origin main
echo "$(TS) Done."
