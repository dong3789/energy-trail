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

  it('봇 수가 스폰 지점 수를 넘쳐도 좌표가 절대 겹치지 않는다', () => {
    // 2026-08-25: 기존 modulo 매핑은 5번째 봇부터 1번째와 정확히 같은 지점이었다
    const s = matchSpawns(true, ['runner', 'runner', 'runner', 'runner', 'runner', 'runner']);
    const seen = new Set(s.bots.map((b) => `${b.x},${b.z}`));
    expect(seen.size).toBe(s.bots.length);
  });

  it('AI 술래가 여러 명이어도 좌표가 겹치지 않는다', () => {
    const s = matchSpawns(false, ['tagger', 'tagger', 'tagger']);
    const seen = new Set(s.bots.map((b) => `${b.x},${b.z}`));
    expect(seen.size).toBe(s.bots.length);
  });

  it('스폰 지점 수 이내일 때는 기존 좌표를 그대로 쓴다 (오프셋 0)', () => {
    const s = matchSpawns(true, ['runner', 'runner', 'runner', 'runner']);
    expect(s.bots[0]).toEqual({ x: 12, z: 14 });
    expect(s.bots[3]).toEqual({ x: -12, z: 4 });
  });
});
