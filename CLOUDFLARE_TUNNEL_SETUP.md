# Cloudflare 터널 라우팅 추가 (1회, 30초)

EnergyTrail을 `trail.yndl.dev`로 서빙하려면 Cloudflare 터널에 1개 호스트네임 추가만 하면 됩니다.

## 단계

1. **브라우저에서** https://one.dash.cloudflare.com/ 접속
2. 왼쪽 메뉴 → **Networks** → **Tunnels** 클릭
3. **`yoon-m4-2026-03-03`** 터널 클릭 (이미 연결됨, status: HEALTHY)
4. **Public Hostname** 탭 → **Add a public hostname** 버튼
5. 입력:
   - **Subdomain**: `trail`
   - **Domain**: `yndl.dev`
   - **Service**: Type=`HTTP`, URL=`caddy:80` (← 기존 caddy 재사용)
6. **Save** 클릭

## 확인

```bash
# 내부에서 직접 확인
curl -H "Host: trail.yndl.dev" http://localhost/

# 외부에서 확인 (터널 라우팅 후)
curl -I https://trail.yndl.dev
# HTTP/2 200 기대
```

## 트러블슈팅

### 502 Bad Gateway
- caddy 컨테이너가 죽었거나 energy-trail 컨테이너를 못 찾음
- `docker ps | grep -E "(caddy|energy-trail)"`로 둘 다 healthy인지 확인
- `docker logs caddy --tail 20`로 에러 확인

### 404 Not Found
- Caddyfile 라우트 추가 안 됨 → `/Users/yoon/Projects/caddy_config/Caddyfile` 확인 후 reload:
  ```bash
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile --address localhost:2019
  ```

### 터널 라우팅이 안 보임
- 1~2분 Cloudflare 전파 시간
- `https://trail.yndl.dev` 직접 접속해 보기
