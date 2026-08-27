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
  void opts.playerCaught;
  // 2026-08-25: 목표 달성을 잡힘 판정보다 우선 — 자국 목표를 채운 순간 잡혀도 도망자 승.
  if (opts.trailScore >= opts.trailGoal) {
    return { winner: 'runner', reason: `자국 ${opts.trailGoal}개 수집` };
  }
  // 개인 잡힘은 라운드 종료가 아님 — 동료가 남으면 관전. 전원 OUT만 술래 승.
  if (opts.allRunnersOut) return { winner: 'tagger', reason: '도망자를 모두 잡았습니다' };
  if (opts.timeLeft <= 0) {
    return { winner: 'tagger', reason: `자국 ${opts.trailScore}/${opts.trailGoal}` };
  }
  return null;
}
