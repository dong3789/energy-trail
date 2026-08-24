import { describe, it, expect } from 'vitest';
import {
  contactsInRange,
  headingAway,
  nearestIndex,
  netCatchRadius,
  pickStickyPoint,
  withinDistance,
} from './chase';

describe('nearestIndex', () => {
  it('빈 목록은 -1', () => {
    expect(nearestIndex(0, 0, [])).toBe(-1);
  });

  it('더 가까운 도망자를 고른다', () => {
    const i = nearestIndex(0, 0, [
      { x: 10, z: 0 },
      { x: 2, z: 0 },
      { x: 8, z: 8 },
    ]);
    expect(i).toBe(1);
  });
});

describe('netCatchRadius', () => {
  it('날아갈수록 그물이 벌어진다', () => {
    expect(netCatchRadius(0, 10, 1, 3)).toBeCloseTo(1);
    expect(netCatchRadius(5, 10, 1, 3)).toBeCloseTo(2);
    expect(netCatchRadius(10, 10, 1, 3)).toBeCloseTo(3);
  });

  it('사거리 밖·음수는 클램프', () => {
    expect(netCatchRadius(20, 10, 1, 3)).toBeCloseTo(3);
    expect(netCatchRadius(-2, 10, 1, 3)).toBeCloseTo(1);
  });

  it('사거리 0이면 최대로', () => {
    expect(netCatchRadius(0, 0, 1, 3)).toBe(3);
  });
});

describe('pickStickyPoint', () => {
  const a = { x: 4, z: 0, id: 'a' };
  const b = { x: 10, z: 0, id: 'b' };

  it('첫 대상은 가장 가까운 쪽', () => {
    expect(pickStickyPoint(0, 0, [a, b], undefined, 5)?.id).toBe('a');
  });

  it('현재 대상이 조금 멀어져도 유지한다', () => {
    const far = { x: 8, z: 0, id: 'a' };
    const near = { x: 5, z: 0, id: 'b' };
    expect(pickStickyPoint(0, 0, [far, near], far, 5)?.id).toBe('a');
  });

  it('조금 더 가까운 쪽으로는 안 바꾸고, 확실히 가까우면 바꾼다', () => {
    const closer = { x: 2, z: 0, id: 'c' };
    expect(pickStickyPoint(0, 0, [a, closer], a, 5)?.id).toBe('a');
    expect(pickStickyPoint(0, 0, [a, closer], a, 1)?.id).toBe('c');
  });
});

describe('headingAway', () => {
  it('대상 반대 방향으로 단위 벡터', () => {
    const h = headingAway(0, 0, 4, 0);
    expect(h).not.toBeNull();
    expect(h!.x).toBeCloseTo(-1);
    expect(h!.z).toBeCloseTo(0);
  });

  it('겹치면 null', () => {
    expect(headingAway(1, 1, 1, 1)).toBeNull();
  });
});

describe('withinDistance', () => {
  it('접촉 거리 안이면 true', () => {
    expect(withinDistance(0, 0, 1, 0, 1.1)).toBe(true);
    expect(withinDistance(0, 0, 2, 0, 1.1)).toBe(false);
  });
});

describe('contactsInRange', () => {
  it('닿은 대상을 모두 포함하고 플레이어를 골라낼 수 있다', () => {
    const hits = contactsInRange(
      0,
      0,
      [
        { x: 1, z: 0, isPlayer: true },
        { x: 0.5, z: 0, isPlayer: false },
        { x: 8, z: 0, isPlayer: false },
      ],
      1.1,
    );
    expect(hits).toHaveLength(2);
    expect(hits.some((h) => h.isPlayer)).toBe(true);
  });
});
