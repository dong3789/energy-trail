import { describe, it, expect } from 'vitest';
import {
  canEnterWithCode,
  generateRoomCode,
  isCompleteRoomCode,
  lookupRoom,
  normalizeRoomCode,
  pruneRooms,
  ROOM_CODE_TTL_MS,
  upsertRoom,
  type RoomListing,
} from './room-code';

const room = (code: string, createdAt: number): RoomListing => ({
  code,
  host: 'A',
  mapId: 'park',
  createdAt,
});

describe('room codes', () => {
  it('숫자 4자리만 남긴다', () => {
    expect(normalizeRoomCode('12ab34')).toBe('1234');
    expect(normalizeRoomCode('9')).toBe('9');
    expect(isCompleteRoomCode('1234')).toBe(true);
    expect(isCompleteRoomCode('12')).toBe(false);
  });

  it('1000~9999 코드를 만든다', () => {
    const a = Number(generateRoomCode(() => 0));
    const b = Number(generateRoomCode(() => 0.5));
    expect(a).toBeGreaterThanOrEqual(1000);
    expect(a).toBeLessThan(10000);
    expect(b).toBeGreaterThan(a);
  });

  it('4자리면 로컬 목록에 없어도 입장할 수 있다', () => {
    expect(canEnterWithCode('12ab34')).toEqual({ ok: true, code: '1234' });
    expect(canEnterWithCode('12')).toEqual({ ok: false });
  });

  it('같은 코드는 덮어쓰고 만료된 방은 찾지 않는다', () => {
    const now = ROOM_CODE_TTL_MS + 50;
    const list = upsertRoom([room('1111', 0)], room('2222', now));
    expect(lookupRoom(list, '2222', now)?.host).toBe('A');
    expect(lookupRoom(list, '1111', now)).toBeNull();
    expect(pruneRooms(list, now).map((r) => r.code)).toEqual(['2222']);
  });
});
