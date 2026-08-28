# AGENTS.md — Energy Trail (자국)

3D 술래잡기 게임 프로토타입. 술래가 자국을 흘리고, 도망자가 그 자국을 흡수해 가속한다. Three.js + TypeScript + Vite 기반 모바일 우선 단일 페이지 프로토타입. Mac mini + Docker/Caddy로 직접 서빙. 디자인 상세는 `자국-술래잡기-DESIGN.md` 참조.

## 프로젝트 구조

단일 패키지. 루트는 문서/설정만, **모든 코드는 `web-prototype/`에 있다.** 작업 디렉토리로 `cd web-prototype` 후 진행한다.

```
energy-trail/
├── .github/workflows/      # ci.yml (PR/main 푸시마다)
├── Caddyfile               # reverse proxy + 정적 호스팅 + /ws 프록시
├── docker-compose.yml      # caddy + ws 컨테이너 정의
├── deploy.sh               # Mac mini 배포 스크립트 (태그 checkout → build → docker 재시작)
├── web-prototype/          # 실제 코드 — 여기로 들어가서 작업
│   ├── server/             # 멀티플레이어 WS 서버 (Node.js, ws 라이브러리)
│   ├── src/
│   │   ├── lib/            # 순수 모듈 (테스트 가능 — vitest 단위 테스트 대상)
│   │   ├── scene/          # Three.js 씬 모듈 (CharacterFactory, PlayerController 등)
│   │   ├── main.ts         # 게임 진입점 + UI
│   │   ├── config.ts       # 게임 상수/밸런스 (모든 매직넘버는 여기)
│   │   └── style.css
│   ├── public/             # 정적 자산
│   └── *.config.{ts,json}  # vite/vitest/tsconfig/eslint/prettier
├── 자국-술래잡기-DESIGN.md
├── 자국-프로젝트-분석.md
└── README.md
```

`web-prototype/package.json`의 npm 스크립트가 단일 진실 소스. **루트에는 package.json이 없다.**

## 명령어 (모두 `web-prototype/`에서 실행)

### 검증 파이프라인 — CI가 강제하는 순서

`format:check → lint → typecheck → test → build`. PR 올리면 `ci.yml`이 이 순서로 강제 실행된다. **순서 바뀌면 캐시 무효화 + 디버깅 지옥.** 로컬에서도 이 순서 그대로 실행한다.

```bash
npm run format:check      # Prettier (CI 첫 단계)
npm run lint              # ESLint 9 flat config
npm run typecheck         # tsc --noEmit
npm test                  # vitest run (jsdom env)
npm run build             # tsc + vite build (CI 마지막 단계)
```

CI에서 실패하면 **같은 순서로** 로컬 재현. 한 단계 건너뛰지 말 것.

### 개발

```bash
npm run dev               # vite dev 서버 (HMR, http://localhost:5173)
npm run test:watch        # vitest 워치 모드
npm run test:coverage     # v8 커버리지 (lcov + html)
```

### 멀티플레이어 WS 서버 (별도 프로세스)

```bash
PORT=8791 node server/index.mjs     # ws 서버 단독 실행 — vite dev와 별개 프로세스
```

**vite dev는 ws 서버를 자동 실행하지 않는다.** 게임 띄울 때마다 별도 터미널에서 직접 실행해야 한다. 두 프로세스 모두 살아있어야 멀티플레이어 동작. Mac mini 운영 서빙 시에는 `launchctl`/`pm2` 등으로 ws 서버를 자동 시작하도록 구성.

WS 스모크 테스트 작성 시: `ws` 라이브러리로 WebSocket 클라이언트, JSON 메시지 송수신, `t: 'use' / 'catch' / 'score' / 'pos' / 'start'` 등 프로토콜 직접 호출. 서버 권위 검증(예: 점수 clamp, 방어막 차단) 반드시 서버 측에서도 어서트.

### 다중 브라우저 로컬 테스트 (디바이스 1개로 멀티플레이어 검증)

폰 1개뿐이어도 같은 Mac에서 두 브라우저 띄우면 별도 player로 접속한다 (각각 별도 ws 세션).

```
1. 터미널 1: PORT=8791 node server/index.mjs   # ws 서버
2. 터미널 2: cd web-prototype && npm run dev     # vite dev
3. Chrome 창1: http://localhost:5173 → 방 만들기 → room code 표시
4. Safari (또는 Chrome 시크릿) 창2: 같은 URL → "코드로 참여" → 같은 room code 입력
5. 둘 다 호스트가 "게임 시작" 누르면 같은 매치 진입
```

모두 localhost라 지연은 0이지만, 룸코드/역할 배정/peers 동기화 모두 검증된다. 실제 네트워크 지연은 `npm run test:network-sim` (서버 jitter 시뮬레이션 자동 측정) 또는 실제 디바이스(Mac + 폰 같은 WiFi)로 검증.

### 네트워크 시뮬레이션 자동 검증

서버 환경변수로 가짜 지연/드롭을 주입해 클라이언트 보간/외삽이 흡수하는지 자동 측정한다.

```bash
npm run test:network-sim    # 4가지 조건 자동 spawn·측정·assert
```

- `baseline`: 0ms (localhost 기준선)
- `mobile-lte`: 100ms ±30ms (일반 모바일 LTE)
- `unstable`: 300ms ±100ms (지하철/엘리베이터)
- `extreme-drop`: 500ms ±100ms + 5% 드롭 (WiFi 전환 직후)

서버 측 시뮬레이션은 `SIM_LATENCY_MS / SIM_JITTER_MS / SIM_DROP_RATE` 환경변수로 제어. 프로덕션에서는 절대 켜지 말 것 (모두 기본값 0).

### Docker 운영 셋업 (Mac mini 서빙)

도메인(`trail.yndl.dev`) 노출 + 멀티플레이어 풀스택 운영용. 컨테이너 2개 + Cloudflare Tunnel로 외부 접근.

```
[인터넷] → Cloudflare → cloudflared (호스트 launchd) → caddy:80 (Docker) → ws:8791 (Docker)
```

- `Caddyfile` — 정적(dist) 서빙 + `/ws*` 프록시 + `/health` (handle 블록 순서 명시 필수)
- `docker-compose.yml` — caddy(80/443) + ws(8791) 서비스
- `web-prototype/Dockerfile` — node:22-alpine, ws 서버만 (caddy가 dist 마운트해 서빙)
- `~/.cloudflared/config.yml` — 터널 설정 (`<TUNNEL_ID>` 플레이스홀더 → tunnel create로 받은 UUID)
- `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist` — 재부팅 자동 시작

#### 재부팅 후 재시작 순서 (Mac mini 등)

Docker Desktop과 cloudflared는 launchd에 등록되어 있어 자동으로 켜지지만, **docker 컨테이너는 재시작이 필요합니다**:

```bash
# 1. Docker Desktop이 살아있는지 확인 (시스템 환경설정에서 "Docker Desktop" 자동 실행 켜두기 권장)
docker info > /dev/null 2>&1 || open -a Docker && sleep 30

# 2. 컨테이너 재시작
cd /Users/developer/Desktop/ftp/energy-trail
docker compose up -d

# 3. cloudflared 확인 (자동 시작돼야 하지만 죽었으면)
launchctl list | grep cloudflared || launchctl start com.cloudflare.cloudflared

# 4. 검증
curl http://localhost/health          # → ok
curl https://trail.yndl.dev/health    # → ok (터널 살아있을 때)
```

#### 코드 변경 후 반영

```bash
cd /Users/developer/Desktop/ftp/energy-trail

# 프론트 코드만 변경 → dist만 재빌드, caddy가 호스트 dist를 마운트 중이므로 즉시 반영
cd web-prototype && npm run build

# 서버 코드 변경 → ws 이미지 재빌드 + 재시작
docker compose build ws && docker compose up -d ws

# caddy 설정 변경 → reload (재시작 불필요)
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --address localhost:2019
```

#### Cloudflare Tunnel 셋업 (사용자 1회 인터랙티브)

`~/.cloudflared/cert.pem`과 `<UUID>.json`이 없으면 터널 생성 불가. **브라우저 로그인이 필요한 작업**이라 자동화 안 됨:

```bash
cloudflared login                                  # 브라우저에서 yndl.dev 도메인 관리 계정 로그인
cloudflared tunnel create energy-trail            # UUID 출력 + credentials.json 자동 생성
cloudflared tunnel route dns energy-trail trail.yndl.dev
# → UUID를 config.yml의 <TUNNEL_ID>에 수동 치환 (sed -i '' "s/<TUNNEL_ID>/<UUID>/g" ~/.cloudflared/config.yml)

launchctl load ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist
launchctl start com.cloudflare.cloudflared
```

#### ngrok TCP 터널 (Cloudflare 우회 — 검증 완료)

`~/Library/Application Support/ngrok/ngrok.yml`에 authtoken이 이미 있으면 즉시 동작. **Cloudflare HTTP/2 헤더 drop 문제 우회 경로** (자체 검증 완료: room=1060, 4 peers, ts/v 동기화).

```bash
# 영구 서비스 등록 (재부팅 시 자동 시작)
launchctl load ~/Library/LaunchAgents/com.ngrok.energy-trail.plist

# 현재 터널 URL 확인
curl -sS http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
for t in json.load(sys.stdin)['tunnels']:
    print(t['public_url'])"
# → tcp://0.tcp.jp.ngrok.io:28849 → localhost:8791

# ws URL 형식 (반드시 /ws path 추가)
ws://0.tcp.jp.ngrok.io:28849/ws
```

**단점**: 무료 플랜은 매 재시작마다 URL 변경 — 도메인 안정성 X. 고정 도메인은 유료 플랜. 도메인 고정 필요 시 Cloudflare tunnel 권장.

#### Docker 트러블슈팅 (자주 만나는 함정)

| 증상 | 원인 | 해결 |
|---|---|---|
| ws 컨테이너 "unhealthy" | healthcheck가 `localhost` 사용 → IPv6 우선 해석, 서버는 IPv4만 바인딩 | healthcheck URL을 `127.0.0.1`로 (이미 적용됨) |
| `ERR_MODULE_NOT_FOUND: ws` | `ws` 패키지가 devDependencies에만 있고 `--omit=dev`로 안 설치됨 | `package.json` dependencies에 `"ws": "^8.18.0"` 추가 (이미 적용됨) |
| `/health`가 index.html 반환 | Caddyfile에서 bare `try_files` + `file_server`가 implicit catch-all handle로 평가되어 명시적 `handle`보다 먼저 매칭됨 | 모든 디렉티브를 명시적 `handle { ... }` 블록으로 감싸 순서 고정 (이미 적용됨) |
| `/ws` 핸드셰이크 200 (HTML) | Caddy `path /ws/*`는 `/ws/foo`만 매칭, `/ws` 자체는 안 매칭 | `path /ws*`로 변경 (이미 적용됨) |
| `docker compose down` 후 재시작 안 됨 | Docker Desktop이 죽었거나 데몬 부팅 중 | `open -a Docker` 후 30초 대기 |
| trail.yndl.dev → 1초+ 느린 응답 | Cloudflare가 origin 못 찾고 fallback | cloudflared 프로세스 확인 + 터널 DNS 라우팅 상태 확인 |

## 절대 잊지 말 것

- **모든 npm 스크립트는 `web-prototype/`에서 실행.** 루트에서 실행하면 "missing script" 에러.
- **TypeScript strict 모드.** `as any`, `@ts-ignore`, `@ts-expect-error` 금지.
- **테스트는 jsdom 환경.** Three.js DOM 의존성 주의. `src/main.ts`, `src/scene/SceneSetup.ts`는 커버리지에서 제외됨 (통합 코드가 아니라 부트스트랩).
- **테스트 파일 위치: `src/**/*.test.ts`.** vitest가 `node_modules`, `dist` 제외.
- **모든 게임 매직넘버는 `src/config.ts`.** 매직넘버 인라인 박지 말 것.
- **PR은 squash merge only.** 커밋 메시지 가이드라인은 git log 참조.
- **CI status 체크 4개 다 통과해야 merge 가능:** Lint · Typecheck · Test · Build.
- **main 직접 push 금지.** 무조건 feature branch → PR.

## 코드베이스 규칙

### 서버 권위 (server/index.mjs)

모든 게임 룰(잡힘 판정, 점수 합산, 무적/방어막)은 서버 권위. 클라이언트는 `pos`(위치), `use`(아이템 사용), `score`(점수), `catch`(잡기 시도) 메시지를 **요청**만 하고, 서버가 `broadcast`로 `caught`, `shieldblock`, `score` 이벤트를 **판정**한다.

- **점수**: 클라이언트 `n`은 1..10으로 **서버에서 clamp** (`Math.max(1, Math.min(10, ...))`) + 250ms 레이트 리밋 (`SCORE_MIN_INTERVAL_MS`). 클라는 자석 흡수처럼 배치 전송 시 누적치를 `n`에 담아 보낸다.
- **방어막 (shield)**: `player.shieldUntil`을 `use` 메시지에서 서버 권위로 추적. `tickPlaying` + `'catch'` 메시지 핸들러 양쪽에서 `run.shieldUntil > now` 체크. **절대 `run.shieldUntil = 0`으로 리셋하지 말 것** — 그러면 다음 틱에 잡힘이 통과한다. shieldblock만 broadcast하고 `continue`만 한다.
- **TRAIL_GOAL = 8**: 점수 스모크 테스트 시 주의. `n=50` 같은 큰 값을 보내면 즉시 매치 종료됨. 테스트는 `n=5` 이하로.
- **라운드 시작 시**: `p.invulnUntil = 0; p.shieldUntil = 0;` 둘 다 초기화 (둘 다 같은 줄 쌍).

### 클라이언트 패턴

- **net.ts**: `sendScore(n)`, `sendUse(kind)`, `onCaught/onUse/onShieldBlock` 콜백. `onShieldBlock` 추가 시 catch 메시지 핸들러에 `t === 'shieldblock'` 분기 반드시 추가.
- **main.ts addTrailScore**: 멀티플레이어 모드에서 `net?.sendScore()`를 직접 호출하지 말 것. `pendingNetScore`에 누적 후 렌더 루프에서 300ms 간격으로 플러시. 직접 호출하면 서버 레이트 리밋에 연속 막힘.
- **연막 (smoke)**: 화면 안개는 술래 화면에 렌더링되지만 **12m 이내**(`GAME.itemSmokeFogRange`)일 때만 적용. 원거리 연막은 이펙트만.

### 디자인 시스템

- **Vibe E (현재)**: Fall Guys 카툰 파티. jelly bean + 파스텔 + bouncy. 디자인 문서가 진실의 원천. 임의로 다른 비주얼 도입 금지.
- **사운드**: 모두 Web Audio API 절차적 합성. 외부 mp3 자산 없음.

## 일반 함정

- **zsh scm_breeze 래퍼**: 환경에서 `git`이 `_safe_eval` 미정의 오류로 실패한다. 실제 바이너리 `/opt/homebrew/bin/git` 사용. **CI/스크립트는 영향 없음**, 로컬 zsh에서만 문제.
- **deploy.sh**: Mac mini 배포 스크립트. 태그 checkout → npm ci → build → docker 재기동. main 푸시로 자동 실행 X, 릴리스 태그 발행 후 수동 실행.
- **모바일 우선**: 입력/UI/세션 길이 모두 모바일 기준. PC 데스크탑 입력에 최적화하지 말 것.
- **.gstack 디렉토리**: 사용자 환경(gstack 도구) 캐시. 수정 금지.

## 도메인 노출 경로 (권장 순서)

### 1. ngrok TCP 터널 (현재 권장 — 검증 완료, 즉시 동작)

Cloudflare 헤더 drop 문제 우회. launchd 영구 서비스로 동작.

```bash
# 상태 확인
bash scripts/ngrok-status.sh
# → tcp://0.tcp.jp.ngrok.io:28849
# → ws://0.tcp.jp.ngrok.io:28849/ws

# 재부팅 후 자동 시작 (이미 등록됨)
launchctl list | grep ngrok
```

**단점**: 무료 플랜은 매 재시작마다 URL 변경. 고정 도메인은 유료.

### 1.5. Cloudflare Quick Tunnel (Docker 컨테이너 방식 — 검증 완료)

ngrok 대체재. **브라우저 로그인 불필요** (ephemeral `*.trycloudflare.com` 도메인 자동 생성).

```bash
# 시작 (caddy와 같은 네트워크 namespace 공유 → localhost 해석 문제 우회)
bash scripts/cf-quick-tunnel.sh
# → https://xxx-yyy-zzz.trycloudflare.com

# 재부팅 후 자동 시작
docker update --restart unless-stopped energy-trail-cf-quick
```

**장점**: 브라우저 로그인 불필요, 즉시 동작, HTTP/2 to Origin 헤더 drop 문제 자동 우회 (QUIC 터널이 처리).
**단점**: 재시작마다 URL 변경, 컨테이너 의존.

검증 (commit 20c0b46): HTTP /health → 200, ws 풀스택 ALL PASS (room 4421, peers 9).

### 2. Cloudflare 도메인 (HTTP/2 to Origin Off 필요)

`trail.yndl.dev`를 통한 정식 도메인. 사용자 1분 대시보드 작업 필요.

**현재 상태**: Cloudflare Network → HTTP/2 to Origin: **On** (이게 원인). 변경 후 도메인 ws 동작.

### Cloudflare WebSocket 핸드셰이크 헤더 손실 (매우 흔한 함정)

**증상**:
- `https://trail.yndl.dev/` HTTP 200 정상 (HTML 반환)
- `wss://trail.yndl.dev/ws` WebSocket 연결 실패 — `Invalid Sec-WebSocket-Accept header`
- caddy 로그에는 `status: 101`, `Sec-WebSocket-Accept: S+e69Fz...` 정상 응답
- 즉 우리 origin은 정상이지만 Cloudflare가 헤더를 drop

**진단법**:
```bash
# 1) curl upgrade — HTTP/2 → HTML (200)
curl -i -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" https://trail.yndl.dev/ws | head -5

# 2) Node ws (HTTP/1.1) — 101 + UNDEFINED sec-accept
node -e "const W=require('ws');new W('wss://trail.yndl.dev/ws').on('upgrade',r=>console.log(r.statusCode,r.headers['sec-websocket-accept']));"

# 3) caddy 로그 — 정상 응답 확인
docker compose logs caddy | grep -A1 "uri.*ws" | head -10
```

HTTP/2 요청만 실패하고 HTTP/1.1에서 upgrade는 성공하면 Cloudflare 헤더 drop이 원인.

**해결** (Cloudflare 대시보드):

1. **Network → HTTP/2 to Origin: Off** (가장 흔한 원인 — origin으로 HTTP/1.1 강제)
2. **SSL/TLS → Full** (Strict 모드는 cert 없는 origin에서 깨짐, 우리 caddy는 HTTP만 제공)
3. 변경 후 **30초~2분** propagation 대기

**자동화** (API 토큰 기반 — 사용자 1회 토큰 제공):

```bash
# 1. https://dash.cloudflare.com/profile/api-tokens 에서 토큰 생성
#    권한: Zone → Zone Settings: Edit

# 2. 환경변수 + 스크립트 실행 (30초 안에 HTTP/2 Off + 도메인 검증)
export CF_API_TOKEN="<your-token>"
bash scripts/setup-domain.sh yndl.dev
# → Zone ID 조회 → HTTP/2 Off → SSL 모드 확인 → verify-domain.sh 자동 실행
```

토큰은 환경변수에만 (저장 안 함). 세션 종료 시 `unset CF_API_TOKEN`.

**대안** (Cloudflare 완전 우회):
- **ngrok TCP 터널**: `bash scripts/start-all.sh` — 이미 자동 등록됨. `*.ngrok.io` 도메인 사용. 무료 플랜은 재시작마다 URL 변경.
- **직접 DNS**: Cloudflare DNS를 회색 구름(DNS only)으로 + A record → Mac mini 공인 IP. 라우터 포트포워딩 필요.

## 디자인 문서 참조 (필요 시)

- `자국-술래잡기-DESIGN.md` — 게임 디자인 진실의 원천 (49KB, 가장 방대)
- `자국-프로젝트-분석.md` — 프로젝트 분석
- `웹-프로토타입-구현-기획안.md` — 구현 기획안
- `자국-동료살리기-밸런스.md` — 밸런스 노트
- `README.md` — 인프라/CI 가이드
- `CLOUDFLARE_TUNNEL_SETUP.md` — Cloudflare 터널 (선택)

## 작업 흐름 (OpenCode 세션이 따라야 할 패턴)

1. **먼저 `web-prototype/`로 cd** 후 `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` 한 번 돌려서 깨끗한 상태 확인.
2. 작업 시작. 코드 변경 시 **위 5단계 검증** 다시 통과시켜야 함 (CI가 강제).
3. 서버 변경 시 WS 스모크 테스트도 함께 작성 (server는 단위 테스트 없음 — 통합 테스트가 유일한 검증).
4. `feat/<name>` 또는 `fix/<name>` 브랜치 → 커밋 → PR.
5. PR 본문에 변경 의도 + 서버/클라 영향 + 검증 결과 명시.
