#!/bin/bash
# 2026-08-25: Cloudflare quick tunnel (Docker container 방식)
# - 브라우저 로그인 불필요 (ephemeral 도메인 자동 생성)
# - caddy와 같은 네트워크 namespace 공유 → localhost 해석 문제 우회
# - HTTP/2 to Origin 헤더 drop 문제 우회 (QUIC 터널이 처리)
# - 단점: 재시작마다 URL 변경, 컨테이너 의존

set -e

CONTAINER_NAME="energy-trail-cf-quick"

# 기존 컨테이너 정리
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# caddy 컨테이너와 같은 네트워크 namespace 공유로 cloudflared 실행
docker run -d \
  --name "$CONTAINER_NAME" \
  --network container:energy-trail-caddy \
  --restart unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --url http://localhost:80 > /tmp/cf-quick.log 2>&1

# URL 추출 (최대 30초 대기)
echo "터널 URL 추출 중..."
for i in $(seq 1 30); do
  CF_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cf-quick.log 2>/dev/null | head -1)
  [ -n "$CF_URL" ] && break
  sleep 1
done

if [ -z "$CF_URL" ]; then
  echo "URL 추출 실패 — 로그 확인:"
  tail -20 /tmp/cf-quick.log
  exit 1
fi

WS_URL="wss://${CF_URL#https://}/ws"

echo ""
echo "=== Cloudflare Quick Tunnel ==="
echo "HTTP: $CF_URL"
echo "WSS:  $WS_URL"
echo ""
echo "검증:"
echo "  curl -sS -o /dev/null -w '%{http_code}' $CF_URL/health"
echo ""
echo "ws 멀티플레이어 풀스택:"
echo "  bash scripts/verify-domain.sh $WS_URL"
