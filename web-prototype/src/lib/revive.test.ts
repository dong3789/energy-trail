import { describe, it, expect } from 'vitest';
import { canRevive, pickEdgeSpawn, taggerWinsByOutCount } from './revive';
import { GAME } from '../config';

describe('canRevive', () => {
  const base = {
    score: 3,
    timeLeft: 30,
    playing: true,
    targetOut: true,
    targetIsAi: false,
    distance: 1.5,
  };

  it('모든 조건 통과면 ok', () => {
    expect(canRevive(base)).toBe('ok');
  });

  it('자국 부족이면 not_enough_trail', () => {
    expect(canRevive({ ...base, score: 2 })).toBe('not_enough_trail');
  });

  it('score 정확히 cost와 같으면 ok', () => {
    expect(canRevive({ ...base, score: 3 })).toBe('ok');
  });

  it('남은 시간 ≤ 10초면 too_late', () => {
    expect(canRevive({ ...base, timeLeft: 10 })).toBe('too_late');
    expect(canRevive({ ...base, timeLeft: 5 })).toBe('too_late');
  });

  it('남은 시간 11초면 ok', () => {
    expect(canRevive({ ...base, timeLeft: 11 })).toBe('ok');
  });

  it('대상이 OUT 아니면 target_not_out', () => {
    expect(canRevive({ ...base, targetOut: false })).toBe('target_not_out');
  });

  it('AI 대상이면 target_is_ai', () => {
    expect(canRevive({ ...base, targetIsAi: true })).toBe('target_is_ai');
  });

  it('거리가 범위 초과면 target_too_far', () => {
    expect(canRevive({ ...base, distance: GAME.reviveRange + 0.1 })).toBe('target_too_far');
  });

  it('라운드 중 아니면 not_playing', () => {
    expect(canRevive({ ...base, playing: false })).toBe('not_playing');
  });

  it('reviveEnabled false면 disabled (다른 가드보다 우선)', () => {
    expect(canRevive({ ...base, enabled: false })).toBe('disabled');
  });

  it('솔로 모드(enabled false)에서도 disabled', () => {
    expect(canRevive({ ...base, enabled: false, score: 100, timeLeft: 60 })).toBe('disabled');
  });
});

describe('pickEdgeSpawn', () => {
  it('target이 중앙이면 가장 가까운 변(왼쪽)에 가장자리 점', () => {
    const out = pickEdgeSpawn({ targetX: 0, targetZ: 0 });
    // MAP.width=42, halfW=21, margin=3 → x = -21 + 3 = -18
    expect(out.x).toBeCloseTo(-18);
    expect(out.z).toBeCloseTo(0);
  });

  it('target이 오른쪽 가까우면 오른쪽 변', () => {
    const out = pickEdgeSpawn({ targetX: 15, targetZ: 0 });
    // halfW=21, margin=3 → x = 21 - 3 = 18
    expect(out.x).toBeCloseTo(18);
    expect(out.z).toBeCloseTo(0);
  });

  it('target이 위쪽 가까우면 위 변', () => {
    const out = pickEdgeSpawn({ targetX: 0, targetZ: -15 });
    // halfD=21, margin=3 → z = -21 + 3 = -18
    expect(out.z).toBeCloseTo(-18);
    expect(out.x).toBeCloseTo(0);
  });

  it('target이 아래쪽 가까우면 아래 변', () => {
    const out = pickEdgeSpawn({ targetX: 0, targetZ: 15 });
    expect(out.z).toBeCloseTo(18);
    expect(out.x).toBeCloseTo(0);
  });

  it('helperX/Z가 있으면 살리는 쪽과 같은 변 우선', () => {
    // target은 오른쪽(15,0), helper는 왼쪽(-15,0) → 왼쪽 변
    const out = pickEdgeSpawn({ targetX: 15, targetZ: 0, helperX: -15, helperZ: 0 });
    expect(out.x).toBeCloseTo(-18);
    expect(out.z).toBeCloseTo(0);
  });

  it('가장자리가 맵 경계 안쪽으로 마진 유지', () => {
    const out = pickEdgeSpawn({ targetX: 0, targetZ: 25 });
    // targetZ가 halfD(21)보다 크면 clamp되어 halfD-margin=18
    expect(out.z).toBeLessThanOrEqual(18);
    expect(out.z).toBeGreaterThanOrEqual(-18);
  });
});

describe('taggerWinsByOutCount', () => {
  it('downCount ≥ winCount 면 true', () => {
    expect(taggerWinsByOutCount(2, 2)).toBe(true);
    expect(taggerWinsByOutCount(3, 2)).toBe(true);
  });

  it('downCount < winCount 면 false', () => {
    expect(taggerWinsByOutCount(1, 2)).toBe(false);
    expect(taggerWinsByOutCount(0, 2)).toBe(false);
  });

  it('커스텀 winCount 사용', () => {
    expect(taggerWinsByOutCount(1, 1)).toBe(true);
    expect(taggerWinsByOutCount(0, 1)).toBe(false);
  });
});
