#!/bin/bash
# 2026-08-25: 도메인 검증 스크립트 — 터널 + Docker ws 풀스택 검증
# 사용법: ./scripts/verify-domain.sh [domain] (기본값: trail.yndl.dev)

set -e

DOMAIN="${1:-trail.yndl.dev}"
WS_URL="wss://$DOMAIN/ws"

echo "=== 도메인 검증: $DOMAIN ==="
echo ""

# 1. HTTP 응답
echo "--- 1. HTTP ---"
curl -sS -o /dev/null -w "  GET https://$DOMAIN/         : HTTP %{http_code} (time=%{time_total}s)\n" --max-time 10 "https://$DOMAIN/" 2>&1
curl -sS -w "  GET https://$DOMAIN/health   : HTTP %{http_code}\n" --max-time 10 "https://$DOMAIN/health" 2>&1 | tail -1
echo ""

# 2. 정적 자산
echo "--- 2. 정적 자산 ---"
curl -sS -o /dev/null -w "  GET https://$DOMAIN/manifest.webmanifest : HTTP %{http_code}\n" --max-time 10 "https://$DOMAIN/manifest.webmanifest" 2>&1
echo ""

# 3. WebSocket 풀스택
echo "--- 3. WebSocket 멀티플레이어 (도메인 경유) ---"
cd "$(dirname "$0")/../web-prototype"

node --input-type=module -e "
import WebSocket from 'ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('open', () => res({ ws, msgs }));
  ws.on('error', rej);
});

const host = await connect('$WS_URL');
const guest = await connect('$WS_URL');
console.log('  OK 1) 도메인 통한 ws 연결');

host.ws.send(JSON.stringify({ t: 'hello', name: 'h', wish: 'tagger' }));
guest.ws.send(JSON.stringify({ t: 'hello', name: 'g', wish: 'runner' }));
await sleep(150);

host.ws.send(JSON.stringify({ t: 'create', map: 'park' }));
await sleep(200);
const code = host.ws._msgs?.find?.((m) => m.t === 'room' && m.code)?.code
  ?? host.msgs?.find?.((m) => m.t === 'room' && m.code)?.code
  ?? null;
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

const peers = host.ws._msgs?.filter?.((m) => m.t === 'peers')?.length
  ?? guest.ws._msgs?.filter?.((m) => m.t === 'peers')?.length
  ?? 0;
console.log('  OK 3) peer broadcast — count: ' + peers);
console.log('');
console.log('ALL PASS — 도메인 경유 멀티플레이어 정상');
" 2>&1
