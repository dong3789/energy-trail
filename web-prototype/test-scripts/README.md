# WebSocket 멀티플레이 통합 테스트

WS 서버 (`server/index.mjs`)의 멀티플레이어 동작을 두 클라이언트 시뮬레이션으로 검증.

## 실행

```bash
# 호스트에서 (WS_URL 환경변수로 URL 변경 가능, 기본 ws://127.0.0.1:8791/ws)
docker exec energy-trail-ws node /app/test-scripts/multiplayer.cjs

# 또는 호스트에서 직접 (WS가 127.0.0.1에서 접근 가능해야 함)
node test-scripts/multiplayer.cjs
```

## 검증 시나리오

| # | 시나리오 | 검증 항목 |
|---|---------|----------|
| A | classic 모드 | start.mode=classic broadcast, 'use' silent 무시 |
| B | 잡기 + end | catch broadcast 양쪽 도달, end broadcast winner=tagger, id 일치 |
| C | score race | 양쪽 동시 흡수 시 서버 race 안전, score 동기화 |
| D | use invalid kind | 화이트리스트 외 kind silent 무시, 자기 제외 broadcast |
| E | host 권한 | non-host의 start/mode 변경 silent |
| F | 변조 방어 | 잘못된 JSON / huge / NaN 등에도 연결 유지 |
| G | catch 메시지 순서 | A와 B의 'caught' → 'end' 순서 일치 |

## 회귀 방지

서버 `index.mjs` 변경 후 이 테스트 실행 — 멀티플레이 동작 깨지면 fail.
CI `ws-integration` 잡이 `room-persistence.cjs`와 이 파일을 PR마다 돌린다.

## 단위 테스트 (vitest)

`src/lib/*.test.ts`는 메시지 핸들러/순수 로직 단위. 이 통합 테스트는 **두 클라이언트의 메시지 race/order** 검증으로 vitest로 어려움.
