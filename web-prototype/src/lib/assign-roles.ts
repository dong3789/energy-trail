export type RoleWish = 'tagger' | 'runner' | 'random';
export type AssignedRole = 'tagger' | 'runner';

export interface RoleSeat {
  id: string;
  wish: RoleWish;
}

export const WISH_LABEL: Record<RoleWish, string> = {
  tagger: '술래 희망',
  runner: '도망자 희망',
  random: '랜덤',
};

export const MIN_SOLO_AI = 1;
export const MAX_SOLO_AI = 4;

export function clampSoloAiCount(n: number): number {
  if (!Number.isFinite(n)) return MIN_SOLO_AI;
  return Math.min(MAX_SOLO_AI, Math.max(MIN_SOLO_AI, Math.round(n)));
}

export function buildSoloSeats(aiCount: number, selfWish: RoleWish): RoleSeat[] {
  const n = clampSoloAiCount(aiCount);
  const seats: RoleSeat[] = [{ id: 'self', wish: selfWish }];
  for (let i = 0; i < n; i++) seats.push({ id: `ai-${i}`, wish: 'random' });
  return seats;
}

/** 술래 희망자가 있으면 그 중에서, 없으면 전원 중에서 술래 1명. 나머지는 도망자. */
export function assignRoles(
  seats: readonly RoleSeat[],
  rng: () => number = Math.random,
): Record<string, AssignedRole> {
  if (seats.length === 0) return {};
  const hopefuls = seats.filter((s) => s.wish === 'tagger');
  const notRunner = seats.filter((s) => s.wish !== 'runner');
  const pool = hopefuls.length > 0 ? hopefuls : notRunner.length > 0 ? notRunner : seats;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const taggerId = pool[index].id;
  const roles: Record<string, AssignedRole> = {};
  for (const seat of seats) {
    roles[seat.id] = seat.id === taggerId ? 'tagger' : 'runner';
  }
  return roles;
}
