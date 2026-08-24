import { describe, it, expect } from 'vitest';
import { assignRoles, buildSoloSeats, clampSoloAiCount, type RoleWish } from './assign-roles';

const rng = (n: number) => () => n;

describe('assignRoles', () => {
  it('술래 희망자가 한 명이면 그 사람이 술래', () => {
    const roles = assignRoles(
      [
        { id: 'a', wish: 'tagger' },
        { id: 'b', wish: 'runner' },
        { id: 'c', wish: 'random' },
      ],
      rng(0),
    );
    expect(roles.a).toBe('tagger');
    expect(roles.b).toBe('runner');
    expect(roles.c).toBe('runner');
  });

  it('술래 희망자가 여러 명이면 그 중에서만 뽑는다', () => {
    const roles = assignRoles(
      [
        { id: 'a', wish: 'tagger' },
        { id: 'b', wish: 'tagger' },
        { id: 'c', wish: 'runner' },
      ],
      rng(0.99),
    );
    expect(roles.a).toBe('runner');
    expect(roles.b).toBe('tagger');
    expect(roles.c).toBe('runner');
  });

  it('모두 랜덤이면 전원 후보에서 한 명을 술래로', () => {
    const seats: Array<{ id: string; wish: RoleWish }> = [
      { id: 'a', wish: 'random' },
      { id: 'b', wish: 'random' },
    ];
    expect(assignRoles(seats, rng(0)).a).toBe('tagger');
    expect(assignRoles(seats, rng(0.99)).b).toBe('tagger');
  });

  it('도망자 희망자는 다른 후보가 있으면 술래가 안 된다', () => {
    const roles = assignRoles(
      [
        { id: 'self', wish: 'runner' },
        { id: 'ai-0', wish: 'random' },
        { id: 'ai-1', wish: 'random' },
      ],
      rng(0),
    );
    expect(roles.self).toBe('runner');
    const taggers = Object.values(roles).filter((r) => r === 'tagger');
    expect(taggers).toHaveLength(1);
  });

  it('모두 도망자 희망이어도 술래는 한 명 나온다', () => {
    const roles = assignRoles(
      [
        { id: 'a', wish: 'runner' },
        { id: 'b', wish: 'runner' },
      ],
      rng(0),
    );
    const taggers = Object.values(roles).filter((r) => r === 'tagger');
    expect(taggers).toHaveLength(1);
  });

  it('빈 좌석은 빈 결과', () => {
    expect(assignRoles([])).toEqual({});
  });
});

describe('clampSoloAiCount / buildSoloSeats', () => {
  it('AI 수는 1~4로 자른다', () => {
    expect(clampSoloAiCount(0)).toBe(1);
    expect(clampSoloAiCount(3)).toBe(3);
    expect(clampSoloAiCount(9)).toBe(4);
  });

  it('혼자 플레이 좌석 = 나 + AI n명', () => {
    const seats = buildSoloSeats(3, 'tagger');
    expect(seats).toHaveLength(4);
    expect(seats[0]).toEqual({ id: 'self', wish: 'tagger' });
    expect(seats.slice(1).every((s) => s.wish === 'random')).toBe(true);
  });
});
