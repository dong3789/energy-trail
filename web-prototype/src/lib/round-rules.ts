export type RoundWinner = 'tagger' | 'runner';

export interface RoundJudgement {
  winner: RoundWinner;
  reason: string;
}

export function judgeTrailRound(opts: {
  trailScore: number;
  trailGoal: number;
  timeLeft: number;
  playerCaught: boolean;
  allRunnersOut: boolean;
}): RoundJudgement | null {
  // 2026-08-25: 목표 달성을 잡힘 판정보다 우선 — 자국 목표를 채운 순간 잡혀도 도망자 승.
  // 같은 프레임 동시 발생 시 무조건 술래가 이기던 기존 동작은 목표를 달성한 유저가 억울함을 느끼는 케이스.
  if (opts.trailScore >= opts.trailGoal) {
    return { winner: 'runner', reason: `자국 ${opts.trailGoal}개 수집` };
  }
  if (opts.playerCaught) return { winner: 'tagger', reason: '술래에게 잡혔습니다' };
  if (opts.allRunnersOut) return { winner: 'tagger', reason: '도망자를 모두 잡았습니다' };
  if (opts.timeLeft <= 0) {
    return { winner: 'tagger', reason: `자국 ${opts.trailScore}/${opts.trailGoal}` };
  }
  return null;
}
