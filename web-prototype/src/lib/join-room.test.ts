import { describe, it, expect } from 'vitest';
// 서버 런타임 모듈 — tsc가 .mjs 선언을 못 찾으므로 테스트에서만 허용
// @ts-expect-error server mjs has no TS declarations
import { decideJoin } from '../../server/join-policy.mjs';

const base = {
  currentRoomCode: null as string | null,
  targetCode: '1234',
  roomFound: true,
  phase: 'lobby',
  occupiedSeats: 1,
  maxPlayers: 5,
  reclaimPlayerId: null as string | null,
};

describe('decideJoin', () => {
  it('이미 같은 방이면 좌석을 추가하지 않는다', () => {
    expect(decideJoin({ ...base, currentRoomCode: '1234' })).toEqual({ action: 'already-in' });
  });

  it('다른 방에 있으면 새 방에 추가하지 않는다', () => {
    expect(decideJoin({ ...base, currentRoomCode: '9999' })).toEqual({
      action: 'reject',
      reason: 'busy',
    });
  });

  it('유령 좌석 토큰이면 신규 추가 대신 그 좌석을 회수한다', () => {
    expect(decideJoin({ ...base, occupiedSeats: 5, reclaimPlayerId: 'p_old' })).toEqual({
      action: 'reclaim',
      playerId: 'p_old',
    });
  });

  it('유령 좌석이 방을 가득 채운 상태에서도 회수하면 입장한다', () => {
    const r = decideJoin({
      ...base,
      occupiedSeats: 5,
      reclaimPlayerId: 'p_ghost',
    });
    expect(r.action).toBe('reclaim');
  });

  it('회수할 좌석 없이 5명이면 거절', () => {
    expect(decideJoin({ ...base, occupiedSeats: 5 })).toEqual({
      action: 'reject',
      reason: 'full',
    });
  });

  it('없는 방이면 missing', () => {
    expect(decideJoin({ ...base, roomFound: false })).toEqual({
      action: 'reject',
      reason: 'missing',
    });
  });

  it('플레이 중이면 busy (resume만 허용)', () => {
    expect(decideJoin({ ...base, phase: 'playing' })).toEqual({
      action: 'reject',
      reason: 'busy',
    });
  });

  it('lobby에서 새 플레이어 추가', () => {
    expect(decideJoin(base)).toEqual({ action: 'add' });
  });

  it('ended 대기 전환 중에도 추가 허용', () => {
    expect(decideJoin({ ...base, phase: 'ended' })).toEqual({ action: 'add' });
  });
});
