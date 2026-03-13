#!/usr/bin/env bash
# Quick restart — no git pull, no build
echo "Restarting AllClaw services..."
pm2 restart allclaw-backend allclaw-frontend
sleep 3
pm2 list | grep allclaw
curl -sf http://127.0.0.1:3001/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'✓ Backend API {d[\"version\"]}')" 2>/dev/null
curl -sfo /dev/null -w "✓ Frontend HTTP %{http_code}\n" http://127.0.0.1:3000
