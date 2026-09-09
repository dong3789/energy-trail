/**
 * 멀티플레이 입장 정책.
 * 끊긴 좌석(ws=null)을 join이 새 player로 추가하면 같은 닉이 쌓여 MAX_PLAYERS를 채운다.
 * join은 이미 이 방이면 no-op, 토큰/유일 닉 유령 좌석은 회수, 만석은 라이브 인원만 센다.
 *
 * @param {{
 *   currentRoomCode: string | null,
 *   targetCode: string,
 *   roomFound: boolean,
 *   phase: string,
 *   liveSeats: number,
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
  if (input.liveSeats >= input.maxPlayers) {
    return { action: 'reject', reason: 'full' };
  }
  return { action: 'add' };
}

/**
 * 토큰이 없을 때: 같은 닉의 유령 좌석이 정확히 하나면 그 자리를 회수한다.
 * 동명이 둘이면 추측하지 않는다.
 * @param {Iterable<{ id: string, name?: string, ws: unknown }>} players
 * @param {string} name
 * @returns {{ id: string, name?: string, ws: unknown } | null}
 */
export function findGhostByUniqueName(players, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const ghosts = [...players].filter((p) => p.ws === null && String(p.name || '').trim() === n);
  return ghosts.length === 1 ? ghosts[0] : null;
}
