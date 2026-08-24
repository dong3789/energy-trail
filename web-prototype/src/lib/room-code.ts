export interface RoomListing {
  code: string;
  host: string;
  mapId: string;
  createdAt: number;
}

export const ROOM_CODE_TTL_MS = 2 * 60 * 60 * 1000;

export function normalizeRoomCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}

export function isCompleteRoomCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

export function generateRoomCode(rng: () => number = Math.random): string {
  return String(1000 + Math.floor(rng() * 9000));
}

export function upsertRoom(list: readonly RoomListing[], room: RoomListing): RoomListing[] {
  return [...list.filter((r) => r.code !== room.code), room];
}

export function pruneRooms(
  list: readonly RoomListing[],
  now: number,
  ttlMs: number = ROOM_CODE_TTL_MS,
): RoomListing[] {
  return list.filter((r) => now - r.createdAt <= ttlMs);
}

export function lookupRoom(
  list: readonly RoomListing[],
  code: string,
  now: number,
  ttlMs: number = ROOM_CODE_TTL_MS,
): RoomListing | null {
  const n = normalizeRoomCode(code);
  if (!isCompleteRoomCode(n)) return null;
  const hit = list.find((r) => r.code === n);
  if (!hit) return null;
  if (now - hit.createdAt > ttlMs) return null;
  return hit;
}

/** 입장 게이트: 4자리면 통과. 방이 로컬 목록에 없어도 코드만 맞으면 들어간다. */
export function canEnterWithCode(raw: string): { ok: true; code: string } | { ok: false } {
  const code = normalizeRoomCode(raw);
  if (!isCompleteRoomCode(code)) return { ok: false };
  return { ok: true, code };
}
