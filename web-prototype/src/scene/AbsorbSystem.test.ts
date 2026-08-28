import { describe, it, expect, beforeEach } from 'vitest';
import {
  AbsorbSystem,
  botShouldAbsorbTrails,
  botTrailAbsorbHoldSeconds,
  type AbsorbEvent,
} from './AbsorbSystem';
import { GAME } from '../config';

// 2026-08-25: 자국 흡수 = 즉시 (1초 hold 없음)
// - GAME.absorbSeconds === 0 이면 instant 모드
// - 자국 위에 닿는 순간 같은 프레임에 complete → boostRemaining=4s, cooldown=4s
// - absorbing / progress / cancel 상태는 거치지 않음
// - hold 모드 (absorbSeconds > 0) 분기는 코드에 보존되어 있으나 default 가 0 이므로 비활성
describe('AbsorbSystem (자국 흡수 — 즉시 흡수 모드)', () => {
  let events: string[];
  let absorb: AbsorbSystem;

  beforeEach(() => {
    // sanity: instant 모드 전제
    expect(GAME.absorbSeconds).toBe(0);
    expect(GAME.absorbCooldownSeconds).toBeGreaterThan(0);

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

  describe('tryStart() (수동 시작 — 자동 시작 트리거로도 사용)', () => {
    it('정상 시작 → onStart 콜백 + absorbing=true', () => {
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
      // 1회 흡수 → 쿨다운 시작
      absorb.update(0.016, true, false);
      expect(absorb.getCooldown()).toBeGreaterThan(0);
      const ok = absorb.tryStart();
      expect(ok).toBe(false);
    });

    it('가속 중에는 시작 거부 (boostRemaining > 0)', () => {
      // 1회 흡수 → 부스트 시작
      absorb.update(0.016, true, false);
      expect(absorb.getBoostRemaining()).toBeGreaterThan(0);
      const ok = absorb.tryStart();
      expect(ok).toBe(false);
    });
  });

  describe('update() — 자국 위 닿는 순간 같은 프레임에 complete', () => {
    it('inTrail=true + 단일 프레임 → absorbing=false, boost+무적+쿨다운 set', () => {
      absorb.setLastTrailPosition(1, 1);
      absorb.setStrengthConsumed(0.9);
      const e: AbsorbEvent = absorb.update(0.016, true, false);
      // instant 모드: 같은 프레임에 absorbing 자체를 거치지 않음
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getProgress()).toBe(0);
      expect(e).toBe('complete');
      expect(absorb.getBoostRemaining()).toBeCloseTo(GAME.boostSeconds, 5);
      expect(absorb.isInvulnerable()).toBe(true);
      expect(absorb.getCooldown()).toBeCloseTo(GAME.absorbCooldownSeconds, 5);
    });

    it('이벤트 순서: start → complete → boost-start (absorbing 거치지 않음)', () => {
      absorb.update(0.016, true, false);
      expect(events).toEqual([
        'start',
        `complete:${(1.0).toFixed(2)}`, // 기본 strengthConsumed 1.0
        `boost-start:${GAME.boostSeconds.toFixed(1)}`,
      ]);
    });

    it('cancel 콜백은 발화 안 됨 (instant 모드)', () => {
      absorb.update(0.016, true, false);
      expect(events).not.toContain('cancel');
    });

    it('progress 콜백은 발화 안 됨 (absorbing 상태 자체가 없음)', () => {
      absorb.update(0.016, true, false);
      const progressEvents = events.filter((e) => e.startsWith('progress:'));
      expect(progressEvents).toHaveLength(0);
    });
  });

  describe('update() — 게이팅 조건 (inTrail=true 라도 차단되면 흡수 안 됨)', () => {
    it('inTrail=false → idle, 흡수 안 됨', () => {
      const e: AbsorbEvent = absorb.update(0.016, false, false);
      expect(e).toBe('idle');
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getBoostRemaining()).toBe(0);
      expect(absorb.getCooldown()).toBe(0);
      expect(events).toEqual([]);
    });

    it('frozen=true (얼림 중) → idle, 흡수 안 됨', () => {
      const e: AbsorbEvent = absorb.update(0.016, true, true);
      expect(e).toBe('idle');
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getBoostRemaining()).toBe(0);
      expect(events).toEqual([]);
    });

    it('쿨다운 중 inTrail=true → 차단, 흡수 안 됨', () => {
      // 1회 흡수로 쿨다운 set
      absorb.update(0.016, true, false);
      expect(absorb.getCooldown()).toBeGreaterThan(0);
      events.length = 0;

      const e: AbsorbEvent = absorb.update(0.016, true, false);
      expect(e).toBe('idle');
      expect(events).toEqual([]);
    });

    it('가속 중 inTrail=true → 차단, 흡수 안 됨', () => {
      // 1회 흡수로 부스트 set
      absorb.update(0.016, true, false);
      expect(absorb.getBoostRemaining()).toBeGreaterThan(0);
      events.length = 0;

      const e: AbsorbEvent = absorb.update(0.016, true, false);
      expect(e).toBe('idle');
      expect(events).toEqual([]);
    });

    it('자국에서 빠지면 → idle (cancel 없음, instant 모드)', () => {
      absorb.update(0.016, true, false); // 1회 흡수 → boost+cooldown set
      events.length = 0;

      // 자국에서 빠진 상태에서 다음 프레임 — boost 남은 동안이라 어차피 idle
      const e: AbsorbEvent = absorb.update(0.016, false, false);
      expect(e).toBe('idle');
      expect(events).not.toContain('cancel');
    });
  });

  describe('무적 (invulnerability)', () => {
    it('흡수 완료 후 무적 ON', () => {
      absorb.update(0.016, true, false);
      expect(absorb.isInvulnerable()).toBe(true);
    });

    it('consumeInvulnerability() 1회 소진', () => {
      absorb.update(0.016, true, false);
      const consumed1 = absorb.consumeInvulnerability();
      const consumed2 = absorb.consumeInvulnerability();
      expect(consumed1).toBe(true);
      expect(consumed2).toBe(false);
      expect(absorb.isInvulnerable()).toBe(false);
    });

    it('가속 종료 시 무적 자동 해제', () => {
      absorb.update(0.016, true, false);
      expect(absorb.isInvulnerable()).toBe(true);
      absorb.update(GAME.boostSeconds + 0.1, false, false);
      expect(absorb.isInvulnerable()).toBe(false);
    });
  });

  describe('쿨다운', () => {
    it('시간 경과 시 감소', () => {
      absorb.update(0.016, true, false);
      const c1 = absorb.getCooldown();
      absorb.update(2.0, false, false);
      const c2 = absorb.getCooldown();
      expect(c2).toBeLessThan(c1);
    });

    it('0 이하로 내려가지 않음', () => {
      absorb.update(0.016, true, false);
      absorb.update(100.0, false, false);
      expect(absorb.getCooldown()).toBe(0);
    });

    it('쿨다운 종료 후 다시 자국 위에 서면 즉시 흡수', () => {
      // 1회 흡수 → boost 4s + cooldown 4s = 8s 주기
      absorb.update(0.016, true, false);
      // 8초 경과 (boost 끝나고 cooldown 끝남)
      absorb.update(GAME.boostSeconds + GAME.absorbCooldownSeconds + 0.01, false, false);
      expect(absorb.getCooldown()).toBe(0);
      expect(absorb.getBoostRemaining()).toBe(0);
      // 다시 자국 위에 → 즉시 흡수
      const e: AbsorbEvent = absorb.update(0.016, true, false);
      expect(e).toBe('complete');
    });
  });

  describe('reset()', () => {
    it('OUT 후 모든 상태 초기화', () => {
      absorb.update(0.016, true, false);
      absorb.reset();
      expect(absorb.isAbsorbing()).toBe(false);
      expect(absorb.getProgress()).toBe(0);
      expect(absorb.getBoostRemaining()).toBe(0);
      expect(absorb.getCooldown()).toBe(0);
      expect(absorb.isInvulnerable()).toBe(false);
    });
  });

  describe('getBoostSpeedMultiplier()', () => {
    it('가속 중 → 1.4×strengthConsumed', () => {
      absorb.setStrengthConsumed(0.8);
      absorb.update(0.016, true, false);
      expect(absorb.getBoostSpeedMultiplier()).toBeCloseTo(GAME.absorbedSpeedMultiplier * 0.8, 5);
    });

    it('가속 종료 → 1.0', () => {
      absorb.update(0.016, true, false);
      absorb.update(GAME.boostSeconds + 0.1, false, false);
      expect(absorb.getBoostSpeedMultiplier()).toBe(1.0);
    });

    it('strengthConsumed 범위 클램프 (0.4~1.0)', () => {
      absorb.setStrengthConsumed(0.1); // 너무 작음
      absorb.update(0.016, true, false);
      expect(absorb.getBoostSpeedMultiplier()).toBeCloseTo(GAME.absorbedSpeedMultiplier * 0.4, 5);
    });
  });

  describe('설정 sanity', () => {
    it('instant 모드 = absorbSeconds ≤ 0 + absorbCooldownSeconds > 0', () => {
      // 이 두 조건이 만족되어야 위의 instant 모드 테스트가 유효
      expect(GAME.absorbSeconds).toBe(0);
      expect(GAME.absorbCooldownSeconds).toBe(4.0);
    });
  });

  describe('시간 기반 무적 (setInvulnerableUntilMs / isCurrentlyInvulnerable)', () => {
    // 2026-08-25: 부활 시 1초 무적은 1회용 boolean이 아닌 epoch ms 기반.
    // - isInvulnerable()는 흡수 직후 1회용만 반영
    // - isCurrentlyInvulnerable()는 둘 다 반영 (만료 시 false)

    it('setInvulnerableUntilMs(미래) → isCurrentlyInvulnerable() true', () => {
      absorb.setInvulnerableUntilMs(Date.now() + 1000);
      expect(absorb.isCurrentlyInvulnerable()).toBe(true);
    });

    it('setInvulnerableUntilMs(과거) → isCurrentlyInvulnerable() false', () => {
      absorb.setInvulnerableUntilMs(Date.now() - 1000);
      expect(absorb.isCurrentlyInvulnerable()).toBe(false);
    });

    it('update 경과로 시간 기반 무적 만료 (inTrail=false로 흡수 트리거 회피)', () => {
      // inTrail=true면 update()가 흡수 complete를 트리거해 invulnerable을 다시 켤 수 있음
      // → 무적 만료 동작만 검증하려면 inTrail=false
      absorb.setInvulnerableUntilMs(Date.now() + 100);
      expect(absorb.isCurrentlyInvulnerable()).toBe(true);
      // 만료 시점으로 재설정 후 update — inTrail=false로 흡수 트리거 회피
      absorb.setInvulnerableUntilMs(Date.now() - 1);
      absorb.update(0.016, false, false);
      expect(absorb.isCurrentlyInvulnerable()).toBe(false);
    });

    it('시간 기반 무적은 1회용 consumeInvulnerability()로 소진되지 않음', () => {
      // 시간 기반 무적은 isCurrentlyInvulnerable에서 매번 확인 → 소진 개념 없음
      absorb.setInvulnerableUntilMs(Date.now() + 1000);
      expect(absorb.consumeInvulnerability()).toBe(true); // 1회용 소진
      // 시간 기반은 그대로 유지
      expect(absorb.isCurrentlyInvulnerable()).toBe(true);
    });

    it('reset()은 시간 기반 무적도 함께 해제', () => {
      absorb.setInvulnerableUntilMs(Date.now() + 1000);
      absorb.reset();
      expect(absorb.isCurrentlyInvulnerable()).toBe(false);
    });
  });
});

describe('bot trail absorb (AI must not vacuum trailGoal in a few frames)', () => {
  it('instant 흡수(0s)여도 봇은 매 프레임 가져가지 않는다', () => {
    const hold = botTrailAbsorbHoldSeconds(0, 4);
    expect(hold).toBeGreaterThan(0.2);
    let absorbed = 0;
    let absorbHold = 0;
    const dt = 1 / 60;
    for (let f = 0; f < 8; f++) {
      absorbHold += dt;
      if (absorbHold >= hold) {
        absorbed += 1;
        absorbHold = 0;
      }
    }
    expect(absorbed).toBe(0);
  });

  it('플레이어 쿨다운(4s)을 봇 hold로 써서 한 방에 trailGoal을 못 채운다', () => {
    const hold = botTrailAbsorbHoldSeconds(GAME.absorbSeconds, GAME.absorbCooldownSeconds);
    expect(hold).toBeGreaterThanOrEqual(GAME.absorbCooldownSeconds);
    const framesToGoal = Math.ceil(GAME.trailGoal / 1);
    expect(hold * framesToGoal).toBeGreaterThan(1);
  });

  it('remote 도망자는 로컬에서 자국 점수를 올리지 않는다', () => {
    expect(botShouldAbsorbTrails('remote', 'runner', false)).toBe(false);
    expect(botShouldAbsorbTrails('ai', 'runner', false)).toBe(true);
    expect(botShouldAbsorbTrails('ai', 'tagger', false)).toBe(false);
    expect(botShouldAbsorbTrails('ai', 'runner', true)).toBe(false);
  });
});
