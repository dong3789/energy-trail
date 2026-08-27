# AGENTS.md — Energy Trail (자국)

3D 술래잡기 게임 프로토타입. 술래가 자국을 흘리고, 도망자가 그 자국을 흡수해 가속한다. Three.js + TypeScript + Vite 기반 모바일 우선 단일 페이지 프로토타입. Vercel 자동 배포. 디자인 상세는 `자국-술래잡기-DESIGN.md` 참조.

## 프로젝트 구조

단일 패키지. 루트는 문서/설정만, **모든 코드는 `web-prototype/`에 있다.** 작업 디렉토리로 `cd web-prototype` 후 진행한다.

```
energy-trail/
├── .github/workflows/      # ci.yml (PR/main 푸시마다), deploy.yml (Vercel)
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
- **deploy.sh**: Vercel 배포 스크립트. PR 자동 배포와 별개로 수동 배포 트리거할 때만 사용.
- **Vercel Root Directory**: `web-prototype`로 설정되어야 함 (README 참조). 루트로 잘못 설정하면 빌드 실패.
- **모바일 우선**: 입력/UI/세션 길이 모두 모바일 기준. PC 데스크탑 입력에 최적화하지 말 것.
- **.gstack 디렉토리**: 사용자 환경(gstack 도구) 캐시. 수정 금지.

## 디자인 문서 참조 (필요 시)

- `자국-술래잡기-DESIGN.md` — 게임 디자인 진실의 원천 (49KB, 가장 방대)
- `자국-프로젝트-분석.md` — 프로젝트 분석
- `웹-프로토타입-구현-기획안.md` — 구현 기획안
- `자국-동료살리기-밸런스.md` — 밸런스 노트
- `README.md` — 인프라/CI/Vercel 가이드
- `CLOUDFLARE_TUNNEL_SETUP.md` — Cloudflare 터널 (선택)
- `VERCEL_DEPLOY.md` — Vercel 배포 상세

## 작업 흐름 (OpenCode 세션이 따라야 할 패턴)

1. **먼저 `web-prototype/`로 cd** 후 `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` 한 번 돌려서 깨끗한 상태 확인.
2. 작업 시작. 코드 변경 시 **위 5단계 검증** 다시 통과시켜야 함 (CI가 강제).
3. 서버 변경 시 WS 스모크 테스트도 함께 작성 (server는 단위 테스트 없음 — 통합 테스트가 유일한 검증).
4. `feat/<name>` 또는 `fix/<name>` 브랜치 → 커밋 → PR.
5. PR 본문에 변경 의도 + 서버/클라 영향 + 검증 결과 명시.
