#!/usr/bin/env bash
# EnergyTrail — Mac mini 배포 스크립트
# 사용법: ./deploy.sh
# - git pull → npm ci → npm run build → docker 재시작
# - 변경 없으면 그냥 종료
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(pwd)"

export PATH="/opt/homebrew/bin:$PATH"

log() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m⚠\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

# 1) 원격 변경 확인
log "원격 변경 확인..."
git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  ok "변경 없음 — 배포 스킵 ($LOCAL)"
  exit 0
fi
ok "새 커밋 감지: $(git log --oneline $LOCAL..$REMOTE | head -3)"

# 2) 코드 업데이트
log "git pull..."
git pull --ff-only origin main

# 3) 의존성 + 빌드
log "의존성 설치..."
cd "$REPO_ROOT/web-prototype"
npm ci --silent

log "빌드..."
npm run build

# 4) Docker 이미지 갱신 + 컨테이너 재시작
log "Docker 이미지 빌드..."
cd "$REPO_ROOT/web-prototype"
docker build -q -t energy-trail:latest . > /dev/null
ok "이미지 빌드 완료"

log "컨테이너 재시작..."
docker rm -f energy-trail >/dev/null 2>&1 || true
docker run -d \
  --name energy-trail \
  --network proxy_net \
  --restart unless-stopped \
  -v "$REPO_ROOT/web-prototype/dist:/usr/share/nginx/html:ro" \
  --label "caddy=http://trail.yndl.dev" \
  --label "caddy.reverse_proxy={{upstreams 80}}" \
  energy-trail:latest > /dev/null

# 5) 컨테이너 헬스체크
sleep 2
if docker ps --filter name=energy-trail --filter status=running --format '{{.Names}}' | grep -q energy-trail; then
  ok "컨테이너 실행 중"
else
  err "컨테이너 시작 실패"
  docker logs energy-trail --tail 20
  exit 1
fi

# 6) caddy 라우트 검증
log "caddy 라우트 검증..."
if docker exec caddy wget -q --timeout=5 -O- --header "Host: trail.yndl.dev" http://127.0.0.1/ | grep -q "자국"; then
  ok "trail.yndl.dev → energy-trail:80 정상"
else
  warn "caddy 라우트 검증 실패 — caddy reload 필요할 수 있음"
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile --address localhost:2019 > /dev/null 2>&1 || true
fi

ok "배포 완료 — https://trail.yndl.dev (Cloudflare 터널 라우팅 추가 후 활성화)"
