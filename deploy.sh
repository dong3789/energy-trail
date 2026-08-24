#!/usr/bin/env bash
# EnergyTrail — Mac mini 배포 스크립트
# 사용법: ./deploy.sh v0.2.0
# - 릴리스 태그를 checkout → npm ci → npm run build → docker 재시작
# - main 커밋만으로는 배포하지 않음
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(pwd)"

export PATH="/opt/homebrew/bin:$PATH"

log() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m⚠\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

TAG="${1:-}"
if [ -z "$TAG" ]; then
  err "사용법: ./deploy.sh <tag>  (예: ./deploy.sh v0.2.0)"
  exit 1
fi

# 1) 릴리스 태그 checkout
log "태그 $TAG 가져오는 중..."
git fetch --quiet --tags origin
if ! git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  err "태그 없음: $TAG"
  exit 1
fi
git checkout --detach "refs/tags/$TAG"
ok "checkout $TAG ($(git rev-parse --short HEAD))"

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

log "실시간 방 서버..."
docker build -q -t energy-trail-ws:latest "$REPO_ROOT/web-prototype/server" > /dev/null
docker rm -f energy-trail-ws >/dev/null 2>&1 || true
docker run -d \
  --name energy-trail-ws \
  --network proxy_net \
  --restart unless-stopped \
  -e PORT=8791 \
  energy-trail-ws:latest > /dev/null

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

git checkout main >/dev/null 2>&1 || true

ok "배포 완료 — $TAG → https://trail.yndl.dev"
