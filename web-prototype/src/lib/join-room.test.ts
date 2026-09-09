import { describe, it, expect } from 'vitest';
// 서버 런타임 모듈 — tsc가 .mjs 선언을 못 찾으므로 테스트에서만 허용
// @ts-expect-error server mjs has no TS declarations
import { decideJoin, findGhostByUniqueName } from '../../server/join-policy.mjs';

const base = {
  currentRoomCode: null as string | null,
  targetCode: '1234',
  roomFound: true,
  phase: 'lobby',
  liveSeats: 1,
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
    expect(decideJoin({ ...base, liveSeats: 5, reclaimPlayerId: 'p_old' })).toEqual({
      action: 'reclaim',
      playerId: 'p_old',
    });
  });

  it('유령만 방을 채워도 라이브가 5 미만이면 신규 입장을 막지 않는다', () => {
    expect(decideJoin({ ...base, liveSeats: 1, reclaimPlayerId: null })).toEqual({
      action: 'add',
    });
  });

  it('라이브 5명이면 거절', () => {
    expect(decideJoin({ ...base, liveSeats: 5 })).toEqual({
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

describe('findGhostByUniqueName', () => {
  it('같은 닉 유령이 하나면 그 좌석을 고른다', () => {
    const ghost = { id: 'p_a', name: '민수', ws: null };
    const live = { id: 'p_b', name: '민수', ws: {} };
    expect(findGhostByUniqueName([ghost, live], '민수')).toEqual(ghost);
  });

  it('동명 유령이 둘이면 고르지 않는다', () => {
    const a = { id: 'p_a', name: '손님', ws: null };
    const b = { id: 'p_b', name: '손님', ws: null };
    expect(findGhostByUniqueName([a, b], '손님')).toBeNull();
  });

  it('빈 닉은 매칭하지 않는다', () => {
    expect(findGhostByUniqueName([{ id: 'p_a', name: '', ws: null }], '')).toBeNull();
    expect(findGhostByUniqueName([{ id: 'p_a', name: '  ', ws: null }], '  ')).toBeNull();
  });
});
