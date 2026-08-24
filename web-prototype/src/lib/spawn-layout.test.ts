import { describe, it, expect } from 'vitest';
import { matchSpawns, xzDistance } from './spawn-layout';

describe('matchSpawns', () => {
  it('플레이어 술래는 도망자들을 맵에 흩뿌린다', () => {
    const s = matchSpawns(true, ['runner', 'runner']);
    expect(s.bots).toHaveLength(2);
    expect(xzDistance(s.player, s.bots[0])).toBeGreaterThan(10);
  });

  it('플레이어 도망자는 술래와 멀리, 다른 AI는 술래 쪽에 미끼', () => {
    const s = matchSpawns(false, ['tagger', 'runner', 'runner']);
    const tagger = s.bots[0];
    const decoy = s.bots[1];
    expect(xzDistance(s.player, tagger)).toBeGreaterThan(30);
    expect(xzDistance(decoy, tagger)).toBeLessThan(xzDistance(s.player, tagger));
  });
});
