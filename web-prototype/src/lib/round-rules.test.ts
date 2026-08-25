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

  it('목표 달성과 동시에 잡혀도 목표 달성 우선 (도망자 승)', () => {
    // 2026-08-25 스펙 변경: 기존엔 동시 발생 시 무조건 술래 승이었다
    const r = judgeTrailRound({ ...base, trailScore: 8, playerCaught: true });
    expect(r?.winner).toBe('runner');
  });

  it('목표 미달 상태에서 잡히면 술래 승', () => {
    const r = judgeTrailRound({ ...base, trailScore: 5, playerCaught: true });
    expect(r?.winner).toBe('tagger');
  });

  it('목표 달성과 모두 잡힘이 동시면 목표 달성 우선', () => {
    const r = judgeTrailRound({ ...base, trailScore: 8, allRunnersOut: true });
    expect(r?.winner).toBe('runner');
  });

  it('잡힘과 모두 잡힘이 동시면 잡힘 사유 우선', () => {
    const r = judgeTrailRound({ ...base, playerCaught: true, allRunnersOut: true });
    expect(r?.winner).toBe('tagger');
    expect(r?.reason).toBe('술래에게 잡혔습니다');
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
