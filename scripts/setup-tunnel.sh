#!/bin/bash
# 2026-08-25: Cloudflare Tunnel 셋업 자동화 스크립트
# 사용자가 직접 실행해야 하는 유일한 단계: cloudflared login (브라우저 로그인)
# 나머지는 이 스크립트가 자동으로 진행 (tunnel create, DNS route, config 패치, 자동 시작 등록, 검증)
#
# 사용법:
#   chmod +x scripts/setup-tunnel.sh
#   ./scripts/setup-tunnel.sh
#
# 사전 조건: cloudflared 설치, config.yml 템플릿 준비, docker compose up 상태

set -e

CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.cloudflare.cloudflared.plist"
TUNNEL_NAME="energy-trail"
DOMAIN="trail.yndl.dev"

echo "=== Cloudflare Tunnel 셋업 ==="
echo ""

# 1단계: cert.pem 확인 (login 완료 신호)
if [ ! -f "$CONFIG_DIR/cert.pem" ]; then
  echo "[1/5] cert.pem 없음 → cloudflared login 실행"
  echo "      브라우저가 열립니다. $DOMAIN 을 관리하는 Cloudflare 계정으로 로그인하세요."
  echo ""
  cloudflared login || { echo "FAIL: login 실패"; exit 1; }
  echo ""
fi

# 2단계: tunnel credentials 확인
TUNNEL_JSON=$(ls "$CONFIG_DIR"/*.json 2>/dev/null | grep -v package | head -1)
if [ -z "$TUNNEL_JSON" ]; then
  echo "[2/5] 터널 credentials 없음 → tunnel create 실행"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_JSON=$(ls "$CONFIG_DIR"/*.json 2>/dev/null | grep -v package | head -1)
fi

# UUID 추출 (파일명에서)
TUNNEL_ID=$(basename "$TUNNEL_JSON" .json)
echo "      TUNNEL_ID: $TUNNEL_ID"

# 3단계: config.yml 패치 (UUID로 placeholder 교체)
if grep -q "<TUNNEL_ID>" "$CONFIG_FILE"; then
  echo "[3/5] config.yml 패치 (UUID → $TUNNEL_ID)"
  sed -i '' "s/<TUNNEL_ID>/$TUNNEL_ID/g" "$CONFIG_FILE"
else
  echo "[3/5] config.yml 이미 패치됨 (UUID: $TUNNEL_ID)"
fi

# 4단계: DNS 라우팅
if ! cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>&1 | grep -q "Added"; then
  echo "      DNS 라우팅 이미 존재하거나 추가됨"
else
  echo "[4/5] DNS 라우팅 추가: $DOMAIN → $TUNNEL_NAME"
fi

# 5단계: launchd 등록 + 시작
if [ ! -f "$LAUNCHD_PLIST" ]; then
  echo "FAIL: $LAUNCHD_PLIST 없음 — AGENTS.md 따라 plist 작성 필요"
  exit 1
fi
launchctl load "$LAUNCHD_PLIST" 2>/dev/null || echo "      이미 load됨"
launchctl start com.cloudflare.cloudflared
echo "[5/5] cloudflared 시작됨"

echo ""
echo "=== 셋업 완료 ==="
echo "도메인 검증 (5초 후):"
sleep 5
curl -sS -o /dev/null -w "  $DOMAIN: HTTP %{http_code} (time=%{time_total}s)\n" --max-time 10 "https://$DOMAIN/"
echo ""
echo "터널 상태:"
cloudflared tunnel info "$TUNNEL_NAME" 2>&1 | head -10
