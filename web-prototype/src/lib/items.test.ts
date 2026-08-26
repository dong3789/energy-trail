import { describe, it, expect } from 'vitest';
import {
  ITEM_KINDS,
  ITEM_META,
  ItemBag,
  nearestGroundItem,
  pointHitsObstacle,
  pickClearPoint,
  type GroundItem,
} from './items';

describe('item catalog', () => {
  it('모든 아이템 종류에 메타가 있고 라벨/이모지/힌트가 비어있지 않다', () => {
    for (const kind of ITEM_KINDS) {
      const meta = ITEM_META[kind];
      expect(meta, `${kind} 메타 누락`).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.emoji.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
    }
  });

  it('아이템은 중복 없는 10종이다', () => {
    expect(new Set(ITEM_KINDS).size).toBe(ITEM_KINDS.length);
    expect(ITEM_KINDS).toHaveLength(10);
  });
});

describe('ItemBag', () => {
  it('빈 가방에 줍으면 들고, 쓰면 비운다', () => {
    const bag = new ItemBag();
    expect(bag.take('jelly')).toBeNull();
    expect(bag.held).toBe('jelly');
    expect(bag.use()).toBe('jelly');
    expect(bag.held).toBeNull();
  });

  it('이미 들고 있으면 교체하고 이전 종류를 돌려준다', () => {
    const bag = new ItemBag();
    bag.take('jelly');
    expect(bag.take('smoke')).toBe('jelly');
    expect(bag.held).toBe('smoke');
  });
});

describe('ground items', () => {
  it('가까운 아이템만 줍는다', () => {
    const items: GroundItem[] = [
      { id: 1, kind: 'jelly', x: 0, z: 0 },
      { id: 2, kind: 'smoke', x: 10, z: 0 },
    ];
    expect(nearestGroundItem(items, 0.4, 0, 1.2)?.kind).toBe('jelly');
    expect(nearestGroundItem(items, 5, 0, 1.2)).toBeNull();
  });

  it('장애물 안은 스폰하지 않는다', () => {
    const box = [{ x: 0, z: 0, width: 4, depth: 4, height: 1 }];
    expect(pointHitsObstacle(0, 0, box, 0.5)).toBe(true);
    expect(pointHitsObstacle(8, 8, box, 0.5)).toBe(false);
    const p = pickClearPoint(box, 20, 20, () => 0.9, 0.5);
    expect(p).not.toBeNull();
    if (p) expect(pointHitsObstacle(p.x, p.z, box, 0.5)).toBe(false);
  });

  it('캐릭터 스폰 지점(avoid) 근처는 피해서 스폰한다', () => {
    const box = [{ x: 0, z: 0, width: 4, depth: 4, height: 1 }];
    // rng 시퀀스: 첫 후보(12.8, 12.8)는 장애물 밖이지만 avoid에 걸림 → 다음 후보를 찾아야 한다
    const seq = [0.9, 0.9, 0.3, 0.2];
    let call = 0;
    const p = pickClearPoint(box, 20, 20, () => seq[call++ % seq.length], 0.5, [
      { x: 12.8, z: 12.8, r: 3 },
    ]);
    const d = Math.hypot(p.x - 12.8, p.z - 12.8);
    expect(d).toBeGreaterThanOrEqual(3);
  });

  it('모든 후보가 막혀도 null 대신 가장 여유로운 지점을 반환한다', () => {
    // 맵 전체를 뒤덮는 장애물 — 24회 모두 실패하는 시나리오 (기존엔 null → 아이템 미스폰)
    const wall = [{ x: 0, z: 0, width: 40, depth: 40, height: 1 }];
    const p = pickClearPoint(wall, 20, 20, () => 0.5, 0.5);
    expect(p).not.toBeNull();
  });
});
