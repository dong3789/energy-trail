# Energy Trail (자국)

> 술래가 자국을 흘리고, 도망자가 그 자국을 흡수해 가속하는 술래잡기. 모바일 우선 3D 게임.

## 상태

**현재 비주얼**: Vibe E — Fall Guys 카툰 파티 (jelly bean + 파스텔 + bouncy). 디자인 문서 참조.

**프로토타입**: Three.js + TypeScript + Vite. 데모는 `web-prototype/` 폴더. 정식 Unity 구현은 보류.

## 한 줄 컨셉

술래는 빨리 뛸수록 자국을 흘리고, 도망자는 그 자국을 흡수해 가속한다. **술래의 강함이 도망자의 무기가 되는** 비선형 미학.

## 디자인 문서

상세 기획은 같은 폴더의 다음 파일:

```
자국-술래잡기-DESIGN.md
```

문서를 먼저 읽고 시작. 이 README는 프로젝트 운영/기술 정보만 다룬다.

## 분위기 변천

- **Vibe A** — 네온 야간 도시 (자국 = 네온 글로우 잔상). 채택 후 폐기.
- **Vibe D** — 로우폴리 데이라이트. 채택 후 폐기.
- **Vibe E (현재)** — Fall Guys 카툰 파티. ✅

## 타겟 플랫폼

- **1차**: 모바일 (iOS, Android) — App Store / Google Play
- **확장 고려**: PC (Steam), 콘솔 (현 단계 아님)

모바일 우선 결정에 따라 입력/UI/세션 길이 모두 모바일 기준.

## 기술 스택 (현재)

### 프로토타입
- **엔진**: Three.js (vanilla, r178)
- **언어**: TypeScript 5.8 (strict)
- **번들러**: Vite 7
- **테스트**: Vitest 2 (44 단위 테스트)
- **린트**: ESLint 9 + Prettier 3
- **CI/CD**: GitHub Actions

### 인프라
- **소스 호스팅**: GitHub (private repo)
- **배포**: Mac mini + Docker/Caddy (정적 호스팅, /ws 프록시)
- **도메인**: trail.yndl.dev (Cloudflare Tunnel)
- **CI**: GitHub Actions (lint → typecheck → test → build, PR마다)

## 폴더 구조

```
EnergyTrail/
├── .github/workflows/      # GitHub Actions CI
│   └── ci.yml              # PR/main 마다 lint + type + test + build
├── Caddyfile               # reverse proxy + 정적 호스팅 + /ws 프록시
├── docker-compose.yml      # caddy + ws 컨테이너 정의
├── deploy.sh               # Mac mini 배포 스크립트
├── web-prototype/          # Three.js 프로토타입
│   ├── src/
│   │   ├── lib/            # 순수 모듈 (테스트 가능)
│   │   │   ├── direction.ts        # atan2 회전 헬퍼
│   │   │   └── music-notes.ts      # 음표/화음 상수
│   │   ├── scene/          # Three.js 씬 모듈
│   │   │   ├── CharacterFactory.ts
│   │   │   ├── PlayerController.ts
│   │   │   ├── RunnerAIStub.ts
│   │   │   ├── TaggerAI.ts
│   │   │   ├── TrailEmitter.ts
│   │   │   ├── SceneSetup.ts
│   │   │   ├── SoundManager.ts
│   │   │   ├── TouchController.ts
│   │   │   ├── IceSystem.ts
│   │   │   └── MapBuilder.ts
│   │   ├── main.ts         # 게임 진입점 + UI
│   │   ├── config.ts       # 게임 상수/밸런스
│   │   └── style.css
│   ├── eslint.config.js
│   ├── vitest.config.ts
│   ├── tsconfig.json
│   ├── Dockerfile          # 정적 호스팅용
│   └── package.json
├── 자국-술래잡기-DESIGN.md
├── 자국-프로젝트-분석.md
├── 웹-프로토타입-구현-기획안.md
└── README.md
```

## 개발 시작

### 요구사항
- Node.js 22+
- npm 10+

### 설치 & 실행

```bash
cd web-prototype
npm install
npm run dev          # http://localhost:5173
```

### 스크립트

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 (HMR) |
| `npm run build` | 프로덕션 빌드 (tsc + vite) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | TypeScript 타입 체크 |
| `npm run lint` | ESLint 검사 |
| `npm run lint:fix` | ESLint 자동 수정 |
| `npm run format` | Prettier 포맷 |
| `npm run format:check` | Prettier 검사 (CI용) |
| `npm test` | 단위 테스트 1회 실행 |
| `npm run test:watch` | 테스트 워치 모드 |
| `npm run test:coverage` | 커버리지 리포트 |

## Git Flow (GitHub Flow)

```
main (보호됨, 직접 push 금지)
  │
  ├── feat/<name>       # 새 기능
  ├── fix/<name>        # 버그 수정
  ├── chore/<name>      # 인프라/문서
  └── refactor/<name>   # 리팩터
```

**워크플로우**:
1. `main`에서 브랜치 생성 (`feat/map-selection`)
2. 커밋 (lint + typecheck + test 통과)
3. `main`에 PR 생성 → CI 자동 실행
4. PR 리뷰 (셀프) → squash merge
5. main에 머지되면 릴리스 태그 발행 (`gh release create`) → Mac mini에서 `deploy.sh <tag>` 수동 배포

**브랜치 보호 규칙** (GitHub Settings → Branches):
- ✅ Require pull request reviews before merging
- ✅ Require status checks to pass before merging: `Lint · Typecheck · Test · Build`
- ✅ Require linear history (squash merge)
- ❌ Allow force push (금지)
- ❌ Allow deletion (금지)

## CI/CD 파이프라인

### GitHub Actions `.github/workflows/ci.yml`

PR / main push마다 자동 실행:

1. **Format check** — Prettier
2. **Lint** — ESLint
3. **Typecheck** — `tsc --noEmit`
4. **Test** — Vitest with coverage
5. **Build** — `vite build` (실제로 번들 생성되는지)
6. **Artifacts** — `dist/` 7일 보관

### 배포 (Mac mini + Docker/Caddy)

`main` 푸시는 CI만 트리거. 실제 배포는:

1. **릴리스 태그 발행**: `gh release create --target main` → `v2026.05.30.1` 형식
2. **Mac mini 배포**: `~/Desktop/ftp/energy-trail` 워크트리에서 `./deploy.sh v2026.05.30.1`
3. 스크립트가 태그 checkout → `npm ci` → `npm run build` → docker 재기동
4. **Caddy 라우팅**: `trail.yndl.dev` → `energy-trail:80` (Cloudflare Tunnel)

## 배포 환경

- **Production**: https://trail.yndl.dev (Mac mini + Cloudflare Tunnel + Caddy)
- **WS 서버**: 같은 호스트, `PORT=8791`, Caddy가 `/ws*` 프록시
- **모바일 PWA**: 향후 manifest.json + service worker 추가 가능

## 출시 로드맵 (참고, 사이드 프로젝트)

| 단계 | 목표 |
|---|---|
| 1차 프로토타입 | 메커니즘 검증 ✅ |
| 2차 프로토타입 | 모바일 입력/UI, 함정/도구 ✅ |
| 알파 | AI 봇, 3개 맵, 폴리시 ✅ |
| 폴리시 | 비주얼 Vibe E, 사운드, 결과 화면 ✅ |
| **인프라** | **CI/CD + Mac mini 운영** ← 현재 |
| 베타 | 멀티플레이어, 로컬라이제이션, iOS TestFlight |
| 정식 출시 | iOS + Google Play 동시 |

## 다음 액션

1. ✅ Mac mini 운영 (Docker/Caddy)
2. ✅ 도메인: `trail.yndl.dev` (Cloudflare Tunnel)
3. PWA manifest + service worker (모바일 홈화면 추가)
4. 디자인 폴리시 (선택)
5. 베타 — 멀티플레이어 (NGO/Photon)

## 노트

- 같은 사용자의 `멈춘 척` 프로토타입(`/Users/yoon/Projects/mungz-unity`)과 별도 프로젝트. 의도적 분리.
- 이 프로젝트는 Obsidian 볼트(`/Users/yoon/Documents/내 동 보관함/`) 내에서 진행. 디자인 문서와 코드가 같은 폴더에 공존.
- 모든 SFX는 Web Audio API로 절차적 합성 — 외부 mp3 자산 없음.
