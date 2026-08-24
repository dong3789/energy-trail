export const COUNTDOWN_SEQUENCE = ['3', '2', '1', '시작!'] as const;
export const COUNTDOWN_STEP_MS = 800;
export const COUNTDOWN_GAP_MS = 250;
export const COUNTDOWN_STEP_TOTAL_MS = COUNTDOWN_STEP_MS + COUNTDOWN_GAP_MS;
export const COUNTDOWN_DURATION_MS = COUNTDOWN_STEP_TOTAL_MS * COUNTDOWN_SEQUENCE.length;

export type RoundState = 'countdown' | 'playing' | 'ended';

export interface CountdownSnapshot {
  state: RoundState;
  index: number;
  label: (typeof COUNTDOWN_SEQUENCE)[number];
  overlayVisible: boolean;
}

export function countdownFromElapsed(elapsedMs: number): CountdownSnapshot {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed >= COUNTDOWN_DURATION_MS) {
    return {
      state: 'playing',
      index: COUNTDOWN_SEQUENCE.length - 1,
      label: COUNTDOWN_SEQUENCE[COUNTDOWN_SEQUENCE.length - 1],
      overlayVisible: false,
    };
  }
  const index = Math.min(
    COUNTDOWN_SEQUENCE.length - 1,
    Math.floor(elapsed / COUNTDOWN_STEP_TOTAL_MS),
  );
  return {
    state: 'countdown',
    index,
    label: COUNTDOWN_SEQUENCE[index],
    overlayVisible: true,
  };
}

/** Synchronous first paint. Must not call audio — `sound` may still be in TDZ. */
export function firstCountdownPaint(_hooks?: { onBeep?: () => void }): CountdownSnapshot {
  return countdownFromElapsed(0);
}

export function effectiveElapsedMs(
  now: number,
  startedAt: number,
  pausedAt: number | null,
  pausedAccumMs: number,
): number {
  const freezeAt = pausedAt ?? now;
  return Math.max(0, freezeAt - startedAt - pausedAccumMs);
}
