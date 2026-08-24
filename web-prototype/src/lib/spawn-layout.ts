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

export function matchSpawns(
  playerIsTagger: boolean,
  botRoles: readonly AssignedRole[],
): { player: XZ; bots: XZ[] } {
  if (playerIsTagger) {
    return {
      player: { ...PLAYER_AS_TAGGER },
      bots: botRoles.map((_, i) => ({
        ...RUNNERS_VS_PLAYER_TAGGER[i % RUNNERS_VS_PLAYER_TAGGER.length],
      })),
    };
  }
  let decoy = 0;
  return {
    player: { ...PLAYER_AS_RUNNER },
    bots: botRoles.map((role) => {
      if (role === 'tagger') return { ...AI_TAGGER };
      const p = DECOYS_NEAR_TAGGER[decoy % DECOYS_NEAR_TAGGER.length];
      decoy += 1;
      return { ...p };
    }),
  };
}

export function xzDistance(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
