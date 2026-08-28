#!/usr/bin/env bash
# EnergyTrail — Mac mini 운영 배포
# 사용법: ./deploy.sh v2026.08.28.01
# GitHub Release 발행 시 self-hosted runner가 이 스크립트를 실행한다.
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# vite/tsc는 devDependencies 필요. NODE_ENV=production이면 npm ci가 누락한다.
unset NODE_ENV

NGINX_NAME=energy-trail
WS_NAME=energy-trail-ws
NET=proxy_net

log() { printf "\033[1;36m▶\033[0m %s\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m⚠\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; }

# launchd에는 osxkeychain 프롬프트가 없다. bearer extraheader는 GitHub가 거절한다.
git_net() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    local auth
    auth="$(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | openssl base64 -A)"
    git -c credential.helper= \
      -c credential.https://github.com.helper= \
      -c "http.extraHeader=AUTHORIZATION: basic ${auth}" \
      "$@"
  else
    git "$@"
  fi
}

TAG="${1:-}"
if [ -z "$TAG" ]; then
  err "사용법: ./deploy.sh <tag>  (예: ./deploy.sh v2026.08.28.01)"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  err "작업 트리가 dirty — 배포 중단"
  git status -sb
  exit 1
fi

log "태그 $TAG 가져오는 중..."
git_net fetch --quiet --tags origin
if ! git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  git_net fetch --quiet origin "refs/tags/$TAG:refs/tags/$TAG"
fi
if ! git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  err "태그 없음: $TAG"
  exit 1
fi
git checkout --detach "refs/tags/$TAG"
ok "checkout $TAG ($(git rev-parse --short HEAD))"

log "의존성 설치..."
cd "$REPO_ROOT/web-prototype"
npm ci --silent

log "빌드..."
npm run build
test -f "$REPO_ROOT/web-prototype/dist/index.html" || { err "dist/index.html 없음"; exit 1; }
DIST_JS=$(basename "$(ls "$REPO_ROOT/web-prototype/dist/assets"/index-*.js | head -1)")
ok "dist $DIST_JS"

log "정적 컨테이너 (dist bind-mount, nginx 이미지는 재빌드하지 않음)..."
if docker ps --filter "name=^/${NGINX_NAME}$" --filter status=running --format '{{.Names}}' | grep -qx "$NGINX_NAME"; then
  docker exec "$NGINX_NAME" nginx -s reload >/dev/null 2>&1 || true
  ok "$NGINX_NAME 이미 실행 중 — nginx reload"
else
  docker rm -f "$NGINX_NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$NGINX_NAME" \
    --network "$NET" \
    --restart unless-stopped \
    -v "$REPO_ROOT/web-prototype/dist:/usr/share/nginx/html:ro" \
    -v "$REPO_ROOT/web-prototype/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
    --label "caddy=http://trail.yndl.dev" \
    --label "caddy.reverse_proxy={{upstreams 80}}" \
    nginx:alpine >/dev/null
  ok "$NGINX_NAME 시작"
fi

log "실시간 방 서버 이미지..."
docker build -q -t energy-trail-ws:latest "$REPO_ROOT/web-prototype" >/dev/null
docker rm -f "$WS_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$WS_NAME" \
  --network "$NET" \
  --restart unless-stopped \
  -e PORT=8791 \
  energy-trail-ws:latest >/dev/null
ok "$WS_NAME 교체"

sleep 2
if ! docker ps --filter "name=^/${NGINX_NAME}$" --filter status=running --format '{{.Names}}' | grep -qx "$NGINX_NAME"; then
  err "$NGINX_NAME 시작 실패"
  docker logs "$NGINX_NAME" --tail 20
  exit 1
fi
if ! docker ps --filter "name=^/${WS_NAME}$" --filter status=running --format '{{.Names}}' | grep -qx "$WS_NAME"; then
  err "$WS_NAME 시작 실패"
  docker logs "$WS_NAME" --tail 20
  exit 1
fi
ok "컨테이너 실행 중"

log "caddy 라우트 검증..."
if docker exec caddy wget -q --timeout=5 -O- --header "Host: trail.yndl.dev" http://127.0.0.1/ | grep -q "자국"; then
  ok "trail.yndl.dev → energy-trail:80 정상"
else
  warn "caddy 라우트 검증 실패 — caddy reload"
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile --address localhost:2019 >/dev/null 2>&1 || true
fi

log "라이브 에셋 해시..."
LIVE_JS=$(curl -fsS --max-time 8 -H "Host: trail.yndl.dev" -H "Cache-Control: no-cache" http://127.0.0.1/ | grep -oE 'index-[A-Za-z0-9_-]*\.js' | head -1 || true)
if [ "$LIVE_JS" = "$DIST_JS" ]; then
  ok "live $LIVE_JS == dist"
else
  err "live($LIVE_JS) != dist($DIST_JS)"
  exit 1
fi

log "멀티플레이어 통합 테스트..."
if docker exec "$WS_NAME" node /app/test-scripts/multiplayer.cjs >/tmp/multiplayer-test.log 2>&1; then
  ok "멀티플레이어 테스트 통과"
else
  warn "멀티플레이어 테스트 실패 — /tmp/multiplayer-test.log"
  tail -20 /tmp/multiplayer-test.log | sed 's/^/  /'
fi

git checkout main >/dev/null 2>&1 || true
git_net pull --ff-only origin main >/dev/null 2>&1 || true

ok "배포 완료 — $TAG → https://trail.yndl.dev"
