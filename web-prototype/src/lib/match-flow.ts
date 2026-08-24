export type MatchEntryMode = 'solo' | 'room';
export type ScreenId =
  'intro' | 'login' | 'character' | 'role' | 'map-select' | 'lobby' | 'room' | 'game';

/** Retry returns to the waiting room so roles can be wished again. */
export function retryScreenForEntry(_mode: MatchEntryMode): 'room' {
  return 'room';
}

/** Restarting game→game must dispose the previous session before renderGame(). */
export function shouldTeardownGame(from: ScreenId, _to: ScreenId): boolean {
  return from === 'game';
}
