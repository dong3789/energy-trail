import { describe, it, expect } from 'vitest';
import { judgeTrailRound } from './round-rules';

describe('judgeTrailRound', () => {
  const base = {
    trailScore: 3,
    trailGoal: 8,
    timeLeft: 40,
    playerCaught: false,
    allRunnersOut: false,
  };

  it('자국을 목표치만큼 모으면 도망자 승', () => {
    const r = judgeTrailRound({ ...base, trailScore: 8 });
    expect(r?.winner).toBe('runner');
  });

  it('잡히면 술래 승 (자국이 많아도)', () => {
    const r = judgeTrailRound({ ...base, trailScore: 8, playerCaught: true });
    expect(r?.winner).toBe('tagger');
  });

  it('시간 안에 목표를 못 채우면 술래 승', () => {
    const r = judgeTrailRound({ ...base, timeLeft: 0, trailScore: 5 });
    expect(r?.winner).toBe('tagger');
    expect(r?.reason).toContain('5/8');
  });

  it('아직 진행 중이면 null', () => {
    expect(judgeTrailRound(base)).toBeNull();
  });
});
