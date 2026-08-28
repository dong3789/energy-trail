import { describe, it, expect } from 'vitest';
import { IceSystem } from './IceSystem';
import { GAME } from '../config';

describe('IceSystem', () => {
  it('사거리 밖이면 발동 안 함', () => {
    const ice = new IceSystem({
      setPlayerFrozen: () => {},
      setTaggerFrozen: () => {},
    });
    expect(ice.triggerIfReady(GAME.iceRange + 0.1)).toBe(false);
  });

  it('사거리 판정과 denyReason', () => {
    const ice = new IceSystem({
      setPlayerFrozen: () => {},
      setTaggerFrozen: () => {},
    });
    expect(ice.inRange(GAME.iceRange)).toBe(true);
    expect(ice.inRange(GAME.iceRange + 0.1)).toBe(false);
    expect(ice.denyReason(GAME.iceRange + 1)).toBe('range');
    expect(ice.denyReason(0)).toBeNull();
    ice.triggerIfReady(0);
    expect(ice.denyReason(0)).toBe('active');
  });

  it('발동 중·직후 잠깐은 잡기를 막는다', () => {
    const ice = new IceSystem({
      setPlayerFrozen: () => {},
      setTaggerFrozen: () => {},
    });
    expect(ice.triggerIfReady(GAME.iceRange)).toBe(true);
    expect(ice.blocksCatch()).toBe(true);
    ice.update(GAME.iceDuration + 0.01);
    expect(ice.isActive()).toBe(false);
    expect(ice.blocksCatch()).toBe(true);
    ice.update(GAME.iceCatchGraceSeconds + 0.01);
    expect(ice.blocksCatch()).toBe(false);
  });
});
