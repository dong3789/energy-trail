#!/bin/bash
# 2026-08-25: 현재 ngrok TCP 터널 상태 + ws URL 출력
# ngrok이 launchd 영구 서비스로 떠 있을 때만 동작

set -e

if ! curl -sS http://127.0.0.1:4040/api/tunnels > /dev/null 2>&1; then
  echo "ngrok 에이전트 미실행"
  echo "  시작: launchctl start com.ngrok.energy-trail"
  echo "  또는: nohup ngrok tcp 8791 > /tmp/ngrok.log 2>&1 &"
  exit 1
fi

TCP_URL=$(curl -sS http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
d = json.load(sys.stdin)
for t in d['tunnels']:
    print(t['public_url'])
    break
")
HOST_PORT="${TCP_URL#tcp://}"
WS_URL="ws://$HOST_PORT/ws"

echo "tcp: $TCP_URL"
echo "ws:  $WS_URL"
echo
echo "검증:"
echo "  node --input-type=module -e \"import WebSocket from 'ws'; const ws = new WebSocket('$WS_URL'); ws.on('open', () => console.log('OK'))\""
echo
echo "테스트:"
echo "  bash scripts/verify-domain.sh '$WS_URL'"
