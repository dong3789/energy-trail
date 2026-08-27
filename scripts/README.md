# 운영 스크립트 가이드

Mac mini에서 에너지트레일 멀티플레이어를 운영하기 위한 스크립트 모음.

## 빠른 참조 (재부팅 후 1회 실행)

```bash
# 전체 서비스 시작 (Docker + ngrok)
bash scripts/start-all.sh

# 현재 ngrok URL 확인 (친구에게 공유용)
bash scripts/ngrok-status.sh

# 도메인 풀스택 검증 (HTTP + WebSocket)
bash scripts/verify-domain.sh trail.yndl.dev
```

---

## 스크립트 목록

| 스크립트 | 용도 | 자동/수동 |
|---|---|---|
| `start-all.sh` | Docker Desktop 확인 + compose up + ngrok 영구 서비스 시작 + URL 출력 | **자동** |
| `ngrok-status.sh` | 현재 ngrok TCP 터널 URL + ws URL + 검증 명령 출력 | **자동** |
| `verify-domain.sh [domain\|ws://URL]` | HTTP + 정적 + WebSocket 풀스택 smoke + 자동 진단 | **자동** |
| `setup-tunnel.sh` | Cloudflare 터널 1회 셋업 (cert.pem → tunnel create → DNS route → config 패치) | **수동 1회** |
| `setup-domain.sh [zone]` | Cloudflare API로 HTTP/2 to Origin Off + 도메인 검증 | **수동 1회** (토큰 필요) |

---

## 1. `start-all.sh` — 재부팅 후 1회 실행

Docker Desktop 확인 + docker compose up + ngrok 영구 서비스(`com.ngrok.energy-trail`) 시작 + 현재 URL 출력. **Mac mini 재부팅 후 가장 먼저 실행.**

```bash
bash scripts/start-all.sh
# → Docker OK → caddy + ws healthy → ngrok 시작 → ws URL 출력
```

ngrok URL은 무료 플랜이라 재시작마다 변경됨. 공유 시 주의.

## 2. `ngrok-status.sh` — 현재 ngrok URL

ngrok 영구 서비스가 떠 있을 때 현재 TCP URL + ws URL + 한 줄 검증 명령 출력.

```bash
bash scripts/ngrok-status.sh
# → tcp://0.tcp.jp.ngrok.io:28849
# → ws://0.tcp.jp.ngrok.io:28849/ws
# → node 한 줄 검증 명령 출력
```

ngrok이 죽었으면 `launchctl start com.ngrok.energy-trail`로 재시작.

## 3. `verify-domain.sh` — 풀스택 검증

HTTP/HTTPS 정적 자산 + WebSocket 멀티플레이어 풀스택 자동 검증. 실패 시 자동 진단.

```bash
# 도메인 (HTTP + ws 자동)
bash scripts/verify-domain.sh trail.yndl.dev

# localhost / IP (HTTP + ws)
bash scripts/verify-domain.sh localhost

# ngrok URL 직접 (HTTP 스킵, ws만)
bash scripts/verify-domain.sh ws://0.tcp.jp.ngrok.io:28849/ws
```

**자동 진단** (WebSocket 실패 시):

| 증상 | 원인 | 해결 |
|---|---|---|
| curl HTTP/2 upgrade = 200 | Cloudflare가 핸드셰이크 헤더 drop | Network → HTTP/2 to Origin: Off |
| curl HTTP/2 upgrade = 000 | 도메인/네트워크 도달 불가 | 터널/DNS 확인 |
| 기타 | 알 수 없음 | caddy 로그 확인 |

## 4. `setup-tunnel.sh` — Cloudflare Tunnel (사용 안 함)

> **참고**: 현재 운영은 Cloudflare 도메인이 아닌 **ngrok 경로**를 사용 중. 이 스크립트는 Cloudflare 도메인을 유지하면서 멀티플레이어를 노출하고 싶을 때 사용.

Cloudflare 터널 1회 셋업 (cert.pem → tunnel create → config 패치 → DNS route → launchctl). 브라우저에서 Cloudflare 로그인 필요 (사용자 1회 인터랙티브).

```bash
./scripts/setup-tunnel.sh
# → cloudflared login (브라우저 인증)
# → cloudflared tunnel create energy-trail
# → cloudflared tunnel route dns energy-trail trail.yndl.dev
# → config.yml UUID 자동 패치
# → launchctl load + start
```

## 5. `setup-domain.sh` — Cloudflare API 도메인 설정 (토큰 필요)

> **용도**: `trail.yndl.dev` 도메인을 통한 정식 WebSocket 경로 활성화. Cloudflare Network → HTTP/2 to Origin Off 자동 설정.

**사용자 1회 작업**:

1. `https://dash.cloudflare.com/profile/api-tokens` 에서 토큰 생성
   - 권한: **Zone → Zone Settings: Edit**
2. 환경변수 설정 + 스크립트 실행:

```bash
export CF_API_TOKEN="<your-token>"
bash scripts/setup-domain.sh yndl.dev
# → Zone ID 조회 → HTTP/2 Off PATCH → SSL 모드 확인
# → 30초 propagation 대기 → verify-domain.sh 자동 실행
```

**완료 후**: `bash scripts/verify-domain.sh trail.yndl.dev` → ALL PASS 확인.

**토큰 보안**: 환경변수에만 저장 (`.env` 파일에 적지 말 것). 세션 종료 시 `unset CF_API_TOKEN`.

---

## 일반 운영 흐름

### 재부팅 후

```bash
bash scripts/start-all.sh
```

### 멀티플레이어 검증 (수시)

```bash
bash scripts/verify-domain.sh ws://0.tcp.jp.ngrok.io:28849/ws
```

### 도메인 ws 검증 (Cloudflare HTTP/2 Off 후)

```bash
bash scripts/verify-domain.sh trail.yndl.dev
```

### ngrok URL 공유 (친구 초대)

```bash
bash scripts/ngrok-status.sh
# 출력된 ws:// URL 공유
```

---

## 의존성

- **Docker Desktop**: `start-all.sh`가 자동 시작 (30초 대기)
- **ngrok**: brew 설치 + `/Users/developer/Library/Application Support/ngrok/ngrok.yml`에 authtoken
- **cloudflared**: `setup-tunnel.sh` 사용 시 필요 (현재 미사용)
- **Cloudflare API 토큰**: `setup-domain.sh` 사용 시 필요 (`CF_API_TOKEN`)

## 트러블슈팅

| 증상 | 확인 | 해결 |
|---|---|---|
| ngrok URL 안 보임 | `curl http://127.0.0.1:4040/api/tunnels` | ngrok 미실행 → `launchctl start com.ngrok.energy-trail` |
| Docker 컨테이너 unhealthy | `docker compose ps` | healthcheck URL이 `localhost` → IPv6 우선 해석, 서버는 IPv4만. `127.0.0.1` 사용 (이미 적용됨) |
| ws 핸드셰이크 실패 (Cloudflare 도메인) | `bash scripts/verify-domain.sh trail.yndl.dev` | 자동 진단 결과 보고 |
| WebSocket 400 응답 (ngrok) | URL에 `/ws` path 빠짐 | `ws://host:port/ws` 형식 확인 |
