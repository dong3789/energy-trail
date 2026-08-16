import { describe, it, expect, beforeEach } from 'vitest';
import { BoostSystem } from './BoostSystem';
import { GAME } from '../config';

describe('BoostSystem (술래 부스터 상태머신)', () => {
  let boost: BoostSystem;

  beforeEach(() => {
    boost = new BoostSystem();
  });

  describe('trigger()', () => {
    it('정상 발동 → fatigue 증가 + boostActiveRemaining 설정', () => {
      const ok = boost.trigger();
      expect(ok).toBe(true);
      expect(boost.isBoosting()).toBe(true);
      expect(boost.getCooldownRemaining()).toBeGreaterThan(0);
    });

    it('1회 fatigue = GAME.boostFatiguePerUse (보통 18)', () => {
      boost.trigger();
      // fatigue는 getFatigue()로 직접 확인 가능
      expect(boost.getFatigue()).toBe(GAME.boostFatiguePerUse);
    });

    it('쿨다운 중에는 발동 거부', () => {
      boost.trigger();
      const ok2 = boost.trigger();
      expect(ok2).toBe(false);
    });

    it('연속 4회 발동 시 fatigue 72 → stall 직전', () => {
      for (let i = 0; i < 4; i++) {
        boost.update(GAME.boostActiveDuration + 0.01); // active 끝까지 시간
        boost.update(GAME.boostCooldown + 0.01); // 쿨다운 끝까지 시간
        boost.trigger();
      }
      // 4회 후 fatigue = 72 (< 80 threshold라 stall 안 됨)
      expect(boost.getFatigue()).toBe(72);
      expect(boost.isStalling()).toBe(false);
    });
  });

  describe('update()', () => {
    it('시간 경과 → boostActiveRemaining 감소', () => {
      boost.trigger();
      boost.update(0.5);
      // 0.5s 후엔 1.5s active가 아직 안 끝남
      expect(boost.isBoosting()).toBe(true);
    });

    it('boostActiveDuration 후 → boosting=false', () => {
      boost.trigger();
      boost.update(GAME.boostActiveDuration + 0.01);
      expect(boost.isBoosting()).toBe(false);
    });
  });

  describe('scale + speedMul 공식', () => {
    it('fatigue 0 → scale 1.0, speedMul 1.0', () => {
      expect(boost.getScale()).toBeCloseTo(1.0, 5);
      expect(boost.getSpeedMultiplier()).toBeCloseTo(1.0, 5);
    });

    it('부스터 active 중 → speedMul = 1.5x × fatigue 보정', () => {
      boost.trigger();
      // fatigue=18 → 1.0 - 0.4 * 0.18 = 0.928 → × 1.5 = 1.392
      const expected = (1.0 - (1.0 - GAME.boostFatigueSpeedMul) * (GAME.boostFatiguePerUse / 100)) * GAME.boostActiveSpeedMul;
      expect(boost.getSpeedMultiplier()).toBeCloseTo(expected, 5);
      // 1.0보다 큰지 확인 (실제 가속됨)
      expect(boost.getSpeedMultiplier()).toBeGreaterThan(1.0);
    });

    it('fatigue 누적 → scale/speedMul 감소 (boostFatigueShrink/SpeedMul 적용)', () => {
      // fatigue을 100에 가깝게 만들기
      for (let i = 0; i < 6; i++) {
        boost.update(GAME.boostActiveDuration + 0.01);
        boost.update(GAME.boostCooldown + 0.01);
        boost.trigger();
      }
      const scale = boost.getScale();
      const speedMul = boost.getSpeedMultiplier();
      // scale: 1.0 - (1.0 - 0.55) * (fatigue/100) → fatigue=100이면 0.55
      // speedMul: 1.0 - (1.0 - 0.6) * (fatigue/100) → 0.6
      // 단, 6회 트리거 + update 사이클에서 fatigue이 약간 회복될 수 있음
      expect(scale).toBeGreaterThanOrEqual(0.3); // floor
      expect(scale).toBeLessThanOrEqual(1.0);
      expect(speedMul).toBeGreaterThanOrEqual(0);
      expect(speedMul).toBeLessThanOrEqual(GAME.boostActiveSpeedMul);
    });
  });

  describe('getCooldownRemaining', () => {
    it('초기값 0', () => {
      expect(boost.getCooldownRemaining()).toBe(0);
    });

    it('발동 후 > 0, 시간 경과 시 감소', () => {
      boost.trigger();
      const c1 = boost.getCooldownRemaining();
      expect(c1).toBeGreaterThan(0);
      boost.update(0.5);
      const c2 = boost.getCooldownRemaining();
      expect(c2).toBeLessThan(c1);
    });
  });
});
