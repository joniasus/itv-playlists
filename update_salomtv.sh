#!/bin/bash
set -e

cd /home/taqqoz/playlists

echo "$(date '+%Y-%m-%d %H:%M:%S') - Pulling latest changes..."
git pull --rebase origin main

echo "$(date '+%Y-%m-%d %H:%M:%S') - Running salomtv_uz.js..."
/home/taqqoz/.nvm/versions/node/v20.20.0/bin/node salomtv_uz.js

if git diff --quiet salomtv_uz.m3u8; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') - No changes to push."
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - Pushing changes to GitHub..."
git add salomtv_uz.m3u8
git commit -m "Auto-update playlists"
git push origin main

echo "$(date '+%Y-%m-%d %H:%M:%S') - Done."
