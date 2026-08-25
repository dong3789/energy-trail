import type { AssignedRole } from './assign-roles';

export interface XZ {
  x: number;
  z: number;
}

const PLAYER_AS_TAGGER = { x: -11, z: 9 };
const RUNNERS_VS_PLAYER_TAGGER: readonly XZ[] = [
  { x: 12, z: 14 },
  { x: 12, z: -12 },
  { x: -12, z: -12 },
  { x: -12, z: 4 },
];

const PLAYER_AS_RUNNER = { x: -16, z: 0 };
const AI_TAGGER = { x: 16, z: 16 };
const DECOYS_NEAR_TAGGER: readonly XZ[] = [
  { x: 10, z: 8 },
  { x: 6, z: 14 },
  { x: 14, z: 4 },
];

// 2026-08-25: 봇 수가 스폰 지점 수를 넘칠 때 같은 좌표 중복을 피하는 결정적 오프셋(링 패턴).
// 기존 modulo 매핑은 5번째 봇부터 1번째 봇과 정확히 같은 지점에 스폰돼 서로 밀어내며 떨리는 버그.
const DUP_OFFSETS: readonly XZ[] = [
  { x: 0, z: 0 },
  { x: 2, z: 0 },
  { x: 0, z: 2 },
  { x: -2, z: 0 },
  { x: 0, z: -2 },
  { x: 1.5, z: 1.5 },
  { x: -1.5, z: 1.5 },
  { x: 1.5, z: -1.5 },
  { x: -1.5, z: -1.5 },
];

function offsetForLap(index: number, pointCount: number): XZ {
  const lap = Math.floor(index / Math.max(1, pointCount));
  return DUP_OFFSETS[lap % DUP_OFFSETS.length];
}

export function matchSpawns(
  playerIsTagger: boolean,
  botRoles: readonly AssignedRole[],
): { player: XZ; bots: XZ[] } {
  if (playerIsTagger) {
    const len = RUNNERS_VS_PLAYER_TAGGER.length;
    return {
      player: { ...PLAYER_AS_TAGGER },
      bots: botRoles.map((_, i) => {
        const base = RUNNERS_VS_PLAYER_TAGGER[i % len];
        const off = offsetForLap(i, len);
        return { x: base.x + off.x, z: base.z + off.z };
      }),
    };
  }
  let decoy = 0;
  let aiTagger = 0;
  return {
    player: { ...PLAYER_AS_RUNNER },
    bots: botRoles.map((role) => {
      if (role === 'tagger') {
        const off = offsetForLap(aiTagger, 1);
        aiTagger += 1;
        return { x: AI_TAGGER.x + off.x, z: AI_TAGGER.z + off.z };
      }
      const len = DECOYS_NEAR_TAGGER.length;
      const base = DECOYS_NEAR_TAGGER[decoy % len];
      const off = offsetForLap(decoy, len);
      decoy += 1;
      return { x: base.x + off.x, z: base.z + off.z };
    }),
  };
}

export function xzDistance(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
