# 멀티플레이 SaaS 전환 가이드

> 2026-09-13: WS 백엔드를 `web-prototype/server/index.mjs`(모놀리스, 922줄)에서
> **multiplay-saas**(범용 멀티플레이 서버, 형제 레포)로 전환했다.

## 왜

- 모놀리스 서버는 룸/세션/재접속 인프라와 게임 룰이 한 파일에 섞여 있었다.
- 멀티플레이 인프라를 범용 SaaS 구조로 분리해, **어떤 게임이든 GameModule만 구현하면
  멀티플레이가 되는** 구조로 확장했다. 게임 IP(룰·콘텐츠)는 이 레포에 그대로 둔다.
- 설계는 Colyseus(Room 모델)와 Nakama(런타임 모듈)를 참고. Hathora 서비스 종료(2026-05)
  사례에서 보듯 룸 로직을 호스팅/벤더와 분리하는 것이 핵심.

## 구조

```
multiplay-saas/                    ← 형제 레포 (별도 clone 필요)
├── src/core/server.ts             게임을 모르는 코어: 연결/세션resume/방코드/
│                                  유령좌석/호스트승계/페이즈머신/틱루프
├── src/core/types.ts              GameModule 인터페이스
├── src/sdk/client.ts              범용 클라이언트 SDK (신규 게임용)
├── src/games/energy-trail/        energy-trail 게임 모듈 (기존 룰 포팅)
└── test/                          스모크 + 클라 호환성 테스트

energy-trail (이 레포)
└── web-prototype/src/lib/net.ts   saas 프로토콜 어댑터 (f4082b4)
```

## 프로토콜 변경 요약 (클라이언트 관점)

| 구(모놀리스) | 신(saas) |
|---|---|
| `hello {name, char, wish, map}` | `hello {name, meta:{char, wish}}` |
| `create {map}` | `create {game:'energy-trail', config:{map}}` |
| `map {map}` / `mode {mode}` | `config {key, value}` |
| room 메시지 top-level `map`/`mode` | room 메시지 `config.map`/`config.mode` |

그 외(`start`, `peers`, `score`, `caught`, `use`, `ice`, `revive`, `end`, `resume`)는 동일.

## 운영 전환

```bash
# 1. 형제 레포 clone (최초 1회)
cd ~/Projects && git clone <multiplay-saas-repo-url> multiplay-saas

# 2. 재빌드 + 재시작 (docker-compose.yml의 ws가 ../multiplay-saas를 빌드)
cd energy-trail
docker compose build ws && docker compose up -d ws
```

Caddyfile 변경 없음 (`/ws` → `ws:8791` 그대로). 헬스 체크 응답이
`{"ok":true,"rooms":N,"connections":N,"games":["energy-trail"]}`로 확장됐다.

## 롤백

1. `docker-compose.yml`의 `ws` 서비스를 파일 내 주석된 legacy 블록으로 교체
2. 클라이언트를 `f4082b4` 이전으로 롤백 후 `web-prototype` 재빌드

## 검증

- multiplay-saas: `npm run typecheck`, `node test/smoke.mjs`(12개), `node test/et-compat.mjs`(7개)
- energy-trail: `npm run typecheck`, `npm test`(335개) 모두 통과

## 새 게임을 멀티플레이로 만들기

1. multiplay-saas에 `GameModule` 구현 (`src/games/<my-game>/module.ts`)
2. `src/index.ts`에 `server.register(createMyGameModule(server.ctx))` 추가
3. 클라이언트는 `src/sdk/client.ts`의 `MultiplayClient` 사용 또는 게임별 어댑터 작성
