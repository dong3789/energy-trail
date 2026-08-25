// 2026-08-25: 멀티플레이 자동 재연결 — 백오프/시도 정책 순수 함수.
// main.ts의 tryAutoReconnect에서 import해서 사용. 단위 테스트로 검증.

/** 최대 재시도 횟수 — 5회까지 시도 후 명시적 로비 */
export const MAX_RECONNECT_ATTEMPTS = 5;

/** 첫 시도는 즉시, 이후는 1/2/4/8/16초 백오프. attemptIndex 0=첫 시도 후 두 번째 시도까지 대기 시간 */
export function reconnectBackoffMs(attemptIndex: number): number {
  // 0 → 1s, 1 → 2s, 2 → 4s, 3 → 8s, 4 → 16s
  return 1000 * Math.pow(2, attemptIndex);
}

/** 서버 응답별 다음 행동 결정 */
export type ReconnectOutcome = 'ok' | 'retry' | 'abort';

export interface ReconnectDecisionInput {
  /** 1-based 시도 번호 (1=첫 시도) */
  attempt: number;
  /** 이번 시도 결과 — join 응답의 phase 또는 connect 실패 */
  result: 'ok_lobby' | 'phase_playing_or_ended' | 'connect_failed' | 'timeout' | 'error';
  /** 기본값 MAX_RECONNECT_ATTEMPTS, 테스트에서 override */
  maxAttempts?: number;
}

/**
 * 다음 행동 결정:
 * - ok_lobby → 'ok' (성공, UI 닫고 room 진입)
 * - phase_playing_or_ended → 'retry' (라운드 끝나면 join 가능, 다음 시도)
 * - connect_failed / timeout / error → 'retry' (서버 다운 등 일시 장애)
 * - attempt ≥ maxAttempts → 'abort' (포기, 명시적 로비)
 */
export function decideReconnect(input: ReconnectDecisionInput): ReconnectOutcome {
  const max = input.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
  if (input.result === 'ok_lobby') return 'ok';
  // attempt는 1-based, max 도달했으면 더 이상 시도 X
  if (input.attempt >= max) return 'abort';
  return 'retry';
}

/** 다음 시도까지 대기 시간(밀리초). abort면 0 반환. */
export function waitBeforeNextAttempt(attempt: number, max?: number): number {
  if (decideReconnect({ attempt, result: 'phase_playing_or_ended', maxAttempts: max }) === 'abort')
    return 0;
  // attempt는 1-based, 첫 시도 후 대기는 attempt 1 → backoff(0) = 1s
  return reconnectBackoffMs(attempt - 1);
}
