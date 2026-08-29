/**
 * 멀티플레이 입장 정책.
 * 끊긴 좌석(ws=null)을 join이 새 player로 추가하면 같은 닉이 쌓여 MAX_PLAYERS를 채운다.
 * join은 이미 이 방이면 no-op, 세션 토큰이 가리키는 유령 좌석은 회수, 그 외만 신규 추가.
 *
 * @typedef {'already-in' | 'reclaim' | 'add' | 'reject'} JoinAction
 * @param {{
 *   currentRoomCode: string | null,
 *   targetCode: string,
 *   roomFound: boolean,
 *   phase: string,
 *   occupiedSeats: number,
 *   maxPlayers: number,
 *   reclaimPlayerId: string | null,
 * }} input
 * @returns {{ action: 'already-in' | 'reclaim' | 'add', playerId?: string } | { action: 'reject', reason: 'missing' | 'busy' | 'full' }}
 */
export function decideJoin(input) {
  const code = String(input.targetCode || '');
  if (input.currentRoomCode) {
    if (input.currentRoomCode === code) return { action: 'already-in' };
    return { action: 'reject', reason: 'busy' };
  }
  if (!input.roomFound || (input.phase !== 'lobby' && input.phase !== 'ended')) {
    return { action: 'reject', reason: input.roomFound ? 'busy' : 'missing' };
  }
  if (input.reclaimPlayerId) {
    return { action: 'reclaim', playerId: input.reclaimPlayerId };
  }
  if (input.occupiedSeats >= input.maxPlayers) {
    return { action: 'reject', reason: 'full' };
  }
  return { action: 'add' };
}
