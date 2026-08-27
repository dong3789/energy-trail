#!/bin/bash
# 2026-08-25: 전체 서비스 시작 (재부팅 후 1회 실행)
# - Docker Desktop 확인 + docker compose up
# - ngrok 영구 서비스 확인 + 시작
# - 현재 URL 출력 + 검증 명령

set -e

echo "=== Docker Desktop 확인 ==="
if ! docker info > /dev/null 2>&1; then
  echo "Docker Desktop 시작 중..."
  open -a Docker
  echo "30초 대기 (데몬 부팅)"
  sleep 30
fi
docker info > /dev/null 2>&1 && echo "OK Docker 데몬 동작 중"

echo ""
echo "=== Docker Compose Up ==="
docker compose up -d
docker compose ps 2>&1 | grep -E "Up|healthy" | head -3

echo ""
echo "=== ngrok 영구 서비스 ==="
launchctl list | grep com.ngrok.energy-trail > /dev/null && echo "OK launchd 등록됨" || {
  echo "ngrok launchd 미등록 — 등록 중..."
  launchctl load ~/Library/LaunchAgents/com.ngrok.energy-trail.plist 2>&1 | head -2
}
launchctl start com.ngrok.energy-trail 2>&1 | head -1
sleep 3

echo ""
echo "=== 현재 ngrok URL ==="
bash scripts/ngrok-status.sh
