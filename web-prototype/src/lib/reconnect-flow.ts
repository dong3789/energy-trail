// 2026-08-25: 멀티플레이 자동 재연결 — 핵심 흐름 (UI/DOM 분리).
// main.ts의 tryAutoReconnect에서 이 함수를 호출하고 UI/DOM은 main.ts에서 관리.
// 테스트에서는 mock attempt 함수로 모든 분기 검증.
//
// 결정 정책은 ./reconnect.ts의 decideReconnect 사용.

import { MAX_RECONNECT_ATTEMPTS, decideReconnect, waitBeforeNextAttempt } from './reconnect';

export type ReconnectPhase = 'lobby' | 'playing' | 'failed' | 'cancelled';

/** 재연결에 필요한 클라이언트 프로필 */
export interface ReconnectProfile {
  nickname: string;
  characterId: string;
  roleWish: string;
  mapId: string;
}

/** 단일 시도 결과 + 다음 시도에서 close할 ws 핸들(있으면) */
export interface AttemptResult {
  phase: ReconnectPhase;
  /** close 가능한 핸들 — 다음 시도 또는 종료 시 closeAttempt로 정리 */
  ws?: { close: () => void };
  /** 성공 시 phase 추출용 — lobby 결과에 첨부. UI에서 추가 정보 표시 가능 */
  payload?: { code: string };
}

export interface ReconnectFlowOptions {
  /** 단일 시도 — ws 연결 + hello + join + phase 반환 */
  attempt: (code: string, profile: ReconnectProfile) => Promise<AttemptResult>;
  /** ws 핸들 정리 (다음 시도 또는 종료 시) */
  closeAttempt?: (ws: AttemptResult['ws']) => void;
  /** 최대 시도 횟수 (기본 MAX_RECONNECT_ATTEMPTS) */
  maxAttempts?: number;
  /** 백오프 sleep — 테스트에서 fake timer 또는 즉시 resolve 가능 */
  sleep?: (ms: number) => Promise<void>;
  /** 각 시도마다 호출 (UI 갱신용) */
  onAttempt?: (n: number, phase: ReconnectPhase) => void;
  /** 종료 시 호출 — outcome + 마지막 attempts */
  onTerminal?: (outcome: 'ok' | 'abort' | 'cancelled', attempts: number) => void;
  /** abort 시 즉시 종료 신호 — UI의 cancel 버튼이 true로 토글 */
  shouldCancel?: () => boolean;
}

export type ReconnectOutcome = 'ok' | 'abort' | 'cancelled';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 자동 재연결 흐름:
 * - 1) attempt 호출 → phase 받음
 * - 2) lobby → ok (성공)
 * - 3) playing/failed → decideReconnect로 다음 행동
 * - 4) retry → waitBeforeNextAttempt만큼 sleep → 다음 시도
 * - 5) abort → 중단
 * - 6) shouldCancel? → cancelled
 *
 * 각 시도 후 closeAttempt로 ws 정리 (성공 시에도 정리하지만 payload는 보존).
 */
export async function reconnectFlow(
  code: string,
  profile: ReconnectProfile,
  opts: ReconnectFlowOptions,
): Promise<ReconnectOutcome> {
  const max = opts.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (opts.shouldCancel?.()) {
      opts.onTerminal?.('cancelled', attempt - 1);
      return 'cancelled';
    }

    let res: AttemptResult;
    try {
      res = await opts.attempt(code, profile);
    } catch {
      res = { phase: 'failed' };
    }

    opts.onAttempt?.(attempt, res.phase);

    if (res.phase === 'lobby') {
      // 성공 — ws는 호출자가 닫거나 유지. 흐름은 종료.
      // 호출자가 새 ws를 net에 할당하면 됨 (payload.code 참고).
      opts.onTerminal?.('ok', attempt);
      return 'ok';
    }

    // failed / playing / cancelled 모두 정책으로 결정
    const outcome = decideReconnect({
      attempt,
      result: res.phase === 'playing' ? 'phase_playing_or_ended' : 'connect_failed',
      maxAttempts: max,
    });

    // 다음 시도 전에 ws 정리
    if (res.ws && opts.closeAttempt) opts.closeAttempt(res.ws);

    if (outcome === 'abort') {
      opts.onTerminal?.('abort', attempt);
      return 'abort';
    }

    // retry — 백오프 후 다음 시도
    if (attempt < max) {
      const waitMs = waitBeforeNextAttempt(attempt, max);
      if (waitMs > 0) await sleep(waitMs);
    }
  }

  // max회 모두 실패 (decideReconnect abort와 동일하지만 명시적 종료)
  opts.onTerminal?.('abort', max);
  return 'abort';
}
