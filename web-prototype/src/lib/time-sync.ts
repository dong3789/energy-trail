// 2026-08-25: 서버 epoch ms ↔ 클라 performance.now() 변환.
// 멀티플레이 라운드 시작 시 서버가 보낸 roundStartedAt(epoch ms)을
// 클라 카운트다운/시간 계산이 사용하는 performance.now() 기준으로 변환.
// 네트워크 지연/시계 차이로 클라 카운트다운 시작이 서버와 어긋나는 문제 해결.

/**
 * 서버 roundStartedAt(epoch ms) → 클라 performance.now() 기준 시각.
 *
 * 공식:
 *   perfNow_at_server_round_started = currentPerfNow - (currentDateNow - serverRoundStartedAt)
 *
 * 같은 머신 안에서 performance.now()와 Date.now()의 origin 차이(시스템 부팅 vs epoch)는
 * 무관 — 둘 다 monotonic-ish하게 흐르고 drift가 안정적이라 위 식으로 환산 가능.
 *
 * 음수 반환하지 않음 (서버 시작이 미래일 수 없음 — 안전 가드).
 */
export function serverEpochToClientPerf(
  serverRoundStartedAt: number,
  clientDateNow: number,
  clientPerfNow: number,
): number {
  const driftMs = clientDateNow - serverRoundStartedAt;
  // 2026-08-25: 서버 시작이 미래일 수 없음 (시계 어긋남) — 음수 drift는 0으로 보정.
  // 양수 drift만 유효 (서버가 시작했고 그만큼 경과).
  const safeDrift = Math.max(0, driftMs);
  const perfAtServerStart = clientPerfNow - safeDrift;
  return Math.max(0, perfAtServerStart);
}

/**
 * 성능 시간 기준 startedAt → Date.now() 기준 elapsed 초.
 * 살리기 가능 시간 체크(마지막 10초)에서 사용.
 */
export function elapsedSecondsFromPerf(
  perfStartedAt: number,
  clientPerfNow: number,
  clientDateNow: number,
  serverRoundStartedAt: number,
): number {
  // perfStartedAt과 clientPerfNow는 같은 머신 performance.now() 기준.
  // serverRoundStartedAt은 epoch ms. 둘을 비교하려면 변환 필요.
  const serverPerfStartedAt = serverEpochToClientPerf(
    serverRoundStartedAt,
    clientDateNow,
    clientPerfNow,
  );
  // 변환 후엔 같은 머신 performance.now() 기준이므로 직접 비교 가능.
  return Math.max(0, (clientPerfNow - serverPerfStartedAt) / 1000);
}
