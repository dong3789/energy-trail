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
  if (opts.playerCaught) return { winner: 'tagger', reason: '술래에게 잡혔습니다' };
  if (opts.allRunnersOut) return { winner: 'tagger', reason: '도망자를 모두 잡았습니다' };
  if (opts.trailScore >= opts.trailGoal) {
    return { winner: 'runner', reason: `자국 ${opts.trailGoal}개 수집` };
  }
  if (opts.timeLeft <= 0) {
    return { winner: 'tagger', reason: `자국 ${opts.trailScore}/${opts.trailGoal}` };
  }
  return null;
}
