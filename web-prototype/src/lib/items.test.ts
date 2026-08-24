import { describe, it, expect } from 'vitest';
import {
  ItemBag,
  nearestGroundItem,
  pointHitsObstacle,
  pickClearPoint,
  type GroundItem,
} from './items';

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
});
