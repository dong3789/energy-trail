#!/bin/bash
# 2026-08-25: 도메인 검증 스크립트 — 터널 + Docker ws 풀스택 검증
# 사용법: ./scripts/verify-domain.sh [domain] (기본값: trail.yndl.dev)
# localhost/IP를 넘기면 HTTP + ws://, 그 외는 HTTPS + wss:// 자동 선택

set -e

DOMAIN="${1:-trail.yndl.dev}"

# localhost 또는 IP면 HTTP, 그 외는 HTTPS
if [ "$DOMAIN" = "localhost" ] || [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  HTTP_SCHEME="http"
  WS_SCHEME="ws"
else
  HTTP_SCHEME="https"
  WS_SCHEME="wss"
fi

WS_URL="${WS_SCHEME}://${DOMAIN}/ws"

echo "=== 도메인 검증: $DOMAIN ($HTTP_SCHEME) ==="
echo ""

echo "--- 1. HTTP ---"
curl -sS -o /dev/null -w "  GET ${HTTP_SCHEME}://${DOMAIN}/         : HTTP %{http_code} (time=%{time_total}s)\n" --max-time 10 "${HTTP_SCHEME}://${DOMAIN}/" 2>&1
curl -sS -w "  GET ${HTTP_SCHEME}://${DOMAIN}/health   : HTTP %{http_code}\n" --max-time 10 "${HTTP_SCHEME}://${DOMAIN}/health" 2>&1 | tail -1
echo ""

echo "--- 2. 정적 자산 ---"
curl -sS -o /dev/null -w "  GET ${HTTP_SCHEME}://${DOMAIN}/manifest.webmanifest : HTTP %{http_code}\n" --max-time 10 "${HTTP_SCHEME}://${DOMAIN}/manifest.webmanifest" 2>&1
echo ""

echo "--- 3. WebSocket 멀티플레이어 (${WS_URL}) ---"
cd "$(dirname "$0")/../web-prototype"

# 2026-08-25: set -e 일시 해제 — node 실패해도 자동 진단 단계 실행되도록
set +e
WS_URL="$WS_URL" node --input-type=module -e "
import WebSocket from 'ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('open', () => res({ ws, msgs }));
  ws.on('error', rej);
});

const host = await connect(process.env.WS_URL);
const guest = await connect(process.env.WS_URL);
console.log('  OK 1) ws 연결 — 두 클라이언트');

host.ws.send(JSON.stringify({ t: 'hello', name: 'h', wish: 'tagger' }));
guest.ws.send(JSON.stringify({ t: 'hello', name: 'g', wish: 'runner' }));
await sleep(150);

host.ws.send(JSON.stringify({ t: 'create', map: 'park' }));
await sleep(200);
const code = host.msgs.find((m) => m.t === 'room' && m.code)?.code;
if (!code) { console.log('  FAIL: room code 못 받음'); process.exit(1); }
console.log('  OK 2) 방 생성 — code: ' + code);

guest.ws.send(JSON.stringify({ t: 'join', code }));
await sleep(200);
host.ws.send(JSON.stringify({ t: 'start' }));
await sleep(400);

let x = 12;
for (let i = 0; i < 5; i++) {
  x += 0.3;
  host.ws.send(JSON.stringify({ t: 'pos', x, z: 12 }));
  await sleep(30);
}
await sleep(200);

const peers = guest.msgs.filter((m) => m.t === 'peers').length;
console.log('  OK 3) peer broadcast — count: ' + peers);
console.log('');
console.log('ALL PASS — 도메인 경유 멀티플레이어 정상');
" 2>&1
RC=$?
set -e

echo ""
echo "--- 4. 자동 진단 (실패 시 힌트) ---"
if [ $RC -ne 0 ]; then
  echo "✗ WebSocket 멀티플레이어 실패 — 자동 진단 실행"
  echo ""

  # HTTP/2 curl upgrade + Node ws upgrade 동시 테스트로 헤더 손실 여부 감지
  HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
    -H "Upgrade: websocket" -H "Connection: Upgrade" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    "${HTTP_SCHEME}://${DOMAIN}/ws" 2>/dev/null || echo "000")

  WS_STATUS=$(WS_URL="$WS_URL" timeout 5 node --input-type=module -e "
import WebSocket from 'ws';
const ws = new WebSocket(process.env.WS_URL);
ws.on('upgrade', r => { console.log(r.statusCode); process.exit(0); });
ws.on('error', () => process.exit(1));
setTimeout(() => process.exit(2), 4000);
" 2>/dev/null)

  echo "  curl HTTP/2 upgrade  → HTTP $HTTP_STATUS (200 = 헤더 drop, 101 = 정상)"
  echo "  Node ws upgrade      → HTTP $WS_STATUS (101 + sec-websocket-accept 필요)"
  echo ""

  if [ "$HTTP_STATUS" = "200" ] && [ "$WS_STATUS" = "101" ]; then
    echo "→ 진단: Cloudflare가 WebSocket 핸드셰이크 헤더 손실"
    echo "→ 해결: Cloudflare 대시보드 → Network → HTTP/2 to Origin: Off"
    echo "         (SSL/TLS → Full도 함께 확인)"
  elif [ "$HTTP_STATUS" = "000" ] || [ "$WS_STATUS" = "" ]; then
    echo "→ 진단: 도메인/네트워크 도달 불가 — tunnel/터널/DNS 점검"
  else
    echo "→ 진단: 알 수 없는 WebSocket 실패 — caddy 로그 확인 필요"
  fi
  exit $RC
fi
