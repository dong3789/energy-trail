import { describe, it, expect, beforeEach } from 'vitest';
import { AbsorbSystem, type AbsorbEvent } from './AbsorbSystem';
import { GAME } from '../config';

describe('AbsorbSystem (자국 흡수 상태머신)', () => {
  let events: string[];
  let absorb: AbsorbSystem;

  beforeEach(() => {
    events = [];
    absorb = new AbsorbSystem({
      onStart: () => events.push('start'),
      onProgress: (p) => events.push(`progress:${p.toFixed(2)}`),
      onComplete: (s) => events.push(`complete:${s.toFixed(2)}`),
      onCancel: () => events.push('cancel'),
      onBoostStart: (d) => events.push(`boost-start:${d.toFixed(1)}`),
      onBoostEnd: () => events.push('boost-end'),
    });
  });

  describe('tryStart()', () => {
    it('정상 시작 → onStart 콜백', () => {
      const ok = absorb.tryStart();
      expect(ok).toBe(true);
      expect(absorb.isAbsorbing()).toBe(true);
      expect(events).toEqual(['start']);
    });

    it('흡수 중에는 재시작 거부', () => {
      absorb.tryStart();
      const ok = absorb.tryStart();
      expect(ok).toBe(false);
    });

    it('쿨다운 중에는 시작 거부', () => {
      // 흡수 완료 → 쿨다운 시작
      absorb.tryStart();
      absorb.update(1.0, true, false); // 1초 후 완료
      expect(absorb.getCooldown()).toBeGreaterThan(0);
      const ok = absorb.tryStart();
      expect(ok).toBe(false);
    });

    it('가속 중에는 시작 거부 (boostRemaining > 0)', () => {
      // 강제로 가속 중 만들기
      absorb.tryStart();
      absorb.update(1.0, true, false); // 완료 → 4초 가속
      expect(absorb.getBoostRemaining()).toBeGreaterThan(0);
      const ok = absorb.tryStart();
      expect(ok).toBe(false);
    });
  });

  describe('update()', () => {
    it('1초 누적 → 흡수 완료 (boost + 무적 + 쿨다운)', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getBoostRemaining()).toBeCloseTo(GAME.boostSeconds, 5);
      expect(absorb.isInvulnerable()).toBe(true);
      expect(absorb.getCooldown()).toBeGreaterThan(0);
    });

    it('자국에서 벗어나면 → cancel', () => {
      absorb.tryStart();
      const e: AbsorbEvent = absorb.update(0.5, false, false);
      expect(e).toBe('cancel');
      expect(absorb.isAbsorbing()).toBe(false);
    });

    it('얼림 중 → cancel', () => {
      absorb.tryStart();
      const e: AbsorbEvent = absorb.update(0.5, true, true);
      expect(e).toBe('cancel');
    });

    it('progress 0~1 단조 증가', () => {
      absorb.tryStart();
      const p1 = absorb.getProgress();
      absorb.update(0.3, true, false);
      const p2 = absorb.getProgress();
      absorb.update(0.3, true, false);
      const p3 = absorb.getProgress();
      expect(p2).toBeGreaterThan(p1);
      expect(p3).toBeGreaterThan(p2);
      expect(p3).toBeLessThanOrEqual(1.0);
    });

    it('0.5초 + 0.5초 → 완료 (1초 도달)', () => {
      absorb.tryStart();
      absorb.update(0.5, true, false);
      expect(absorb.isAbsorbing()).toBe(true);
      absorb.update(0.5, true, false);
      expect(absorb.isAbsorbing()).toBe(false); // 1초 누적 → 완료
    });
  });

  describe('무적 (invulnerability)', () => {
    it('흡수 완료 후 무적 ON', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      expect(absorb.isInvulnerable()).toBe(true);
    });

    it('consumeInvulnerability() 1회 소진', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      const consumed1 = absorb.consumeInvulnerability();
      const consumed2 = absorb.consumeInvulnerability();
      expect(consumed1).toBe(true);
      expect(consumed2).toBe(false);
      expect(absorb.isInvulnerable()).toBe(false);
    });

    it('가속 종료 시 무적 자동 해제', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      expect(absorb.isInvulnerable()).toBe(true);
      // 가속 시간 (4초) 경과
      absorb.update(GAME.boostSeconds + 0.1, false, false);
      expect(absorb.isInvulnerable()).toBe(false);
    });
  });

  describe('쿨다운', () => {
    it('시간 경과 시 감소', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      const c1 = absorb.getCooldown();
      absorb.update(2.0, false, false);
      const c2 = absorb.getCooldown();
      expect(c2).toBeLessThan(c1);
    });

    it('0이하로 내려가지 않음', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      absorb.update(100.0, false, false);
      expect(absorb.getCooldown()).toBe(0);
    });
  });

  describe('reset()', () => {
    it('OUT 후 모든 상태 초기화', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      absorb.reset();
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getBoostRemaining()).toBe(0);
      expect(absorb.getCooldown()).toBe(0);
      expect(absorb.isInvulnerable()).toBe(false);
    });
  });

  describe('getBoostSpeedMultiplier()', () => {
    it('가속 중 → 1.4×strengthConsumed', () => {
      absorb.setStrengthConsumed(0.8);
      absorb.tryStart();
      absorb.update(1.0, true, false);
      expect(absorb.getBoostSpeedMultiplier()).toBeCloseTo(GAME.absorbedSpeedMultiplier * 0.8, 5);
    });

    it('가속 종료 → 1.0', () => {
      absorb.tryStart();
      absorb.update(1.0, true, false);
      absorb.update(GAME.boostSeconds + 0.1, false, false);
      expect(absorb.getBoostSpeedMultiplier()).toBe(1.0);
    });

    it('strengthConsumed 범위 클램프 (0.4~1.0)', () => {
      absorb.setStrengthConsumed(0.1); // 너무 작음
      absorb.tryStart();
      absorb.update(1.0, true, false);
      // clamp 0.4 적용
      expect(absorb.getBoostSpeedMultiplier()).toBeCloseTo(GAME.absorbedSpeedMultiplier * 0.4, 5);
    });
  });
});
