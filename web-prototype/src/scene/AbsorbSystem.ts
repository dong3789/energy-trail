// 2026-08-15: 자국 흡수 시스템 (코어 메카닉)
// - 자국 위에서 1초간 유지 (이동/얼림/OUT 시 취소) — 옛 동작
// - 2026-08-25: 자동 수집 (E/탭 불필요)
// - 2026-08-25 v2: 즉시 흡수 (1초 hold 제거). GAME.absorbSeconds === 0 이면
//                   absorbing 상태 자체를 바이패스하고 같은 프레임에 complete.
//                   양수면 N 초 hold (이전 동작, 되돌릴 수 있도록 상수만 유지).
// - 완료 시: 자국 제거 + 4초 가속 + 1회 무적 + 색상 변화
// - 쿨다운: instant 모드는 4초, 옛 모드는 absorbSeconds × 8

import { GAME } from '../config';

export type AbsorbEvent = 'idle' | 'progress' | 'complete' | 'cancel' | 'interrupted';

export interface AbsorbSystemCallbacks {
  onStart?: () => void; // 흡수 시작
  onProgress?: (progress01: number) => void; // 0~1 매 프레임
  onComplete?: (strength: number) => void; // 1초 완료, 흡수한 자국 강도
  onCancel?: () => void; // 자국에서 벗어남 / 얼림 / OUT
  onBoostStart?: (durationSec: number) => void; // 가속 시작
  onBoostEnd?: () => void; // 가속 종료
}

export class AbsorbSystem {
  private absorbing = false;
  private progress = 0; // 0~1 (1초 기준)
  private cooldown = 0; // 남은 쿨다운 (초)
  private boostRemaining = 0; // 가속 남은 시간 (초)
  private invulnerable = false; // 1회 무적
  private strengthConsumed = 1.0; // 마지막 흡수 강도 (0~1)
  private lastTrailWorldPos: { x: number; z: number } | null = null;

  /** instant 모드 여부 (config 흡수 시간 ≤ 0) */
  private readonly instant: boolean;

  private readonly callbacks: AbsorbSystemCallbacks;

  constructor(callbacks: AbsorbSystemCallbacks = {}) {
    this.callbacks = callbacks;
    this.instant = GAME.absorbSeconds <= 0;
  }

  /**
   * 흡수 시작 시도
   * - 조건: 쿨다운 0, 가속 중 아님, 자국 위에 있어야 함
   * - instant 모드: 항상 성공 (boost / 쿨다운 가드만 통과하면 OK)
   * @returns 성공 여부
   */
  tryStart(): boolean {
    if (this.cooldown > 0) return false;
    if (this.absorbing) return false;
    if (this.boostRemaining > 0) return false; // 가속 중에는 재흡수 불가
    this.absorbing = true;
    this.progress = 0;
    this.callbacks.onStart?.();
    return true;
  }

  /**
   * 매 프레임 호출
   * @param dt 프레임 시간 (초)
   * @param inTrail 자국 위에 있는지 여부
   * @param frozen 얼림 중인지 (얼림 중엔 흡수 불가/취소)
   *
   * instant 모드 (GAME.absorbSeconds === 0):
   *   inTrail 이면 같은 프레임에 tryStart + 즉시 complete (absorbing 상태는 거치지 않음).
   *
   * hold 모드 (GAME.absorbSeconds > 0, 레거시):
   *   inTrail 이면 tryStart, N초 hold 후 complete. 자국에서 빠지면 cancel.
   */
  update(dt: number, inTrail: boolean, frozen: boolean): AbsorbEvent {
    // 부스트 중 / 쿨다운 감소 (모든 모드 공통)
    if (this.boostRemaining > 0) {
      this.boostRemaining -= dt;
      if (this.boostRemaining <= 0) {
        this.boostRemaining = 0;
        this.invulnerable = false;
        this.callbacks.onBoostEnd?.();
      }
    }
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }

    // instant 모드: 자국 위 + 가능 상태면 같은 프레임에 complete
    if (this.instant) {
      if (inTrail && !frozen && this.cooldown <= 0 && this.boostRemaining <= 0) {
        this.tryStart();
        this.absorbing = false;
        this.progress = 0;
        this.cooldown = GAME.absorbCooldownSeconds;
        this.boostRemaining = GAME.boostSeconds;
        this.invulnerable = true;
        this.callbacks.onComplete?.(this.strengthConsumed);
        this.callbacks.onBoostStart?.(GAME.boostSeconds);
        return 'complete';
      }
      return 'idle';
    }

    // hold 모드 (레거시)
    // 자동 시작: 자국 위에 있고, 쿨다운 0, 부스트 중 아님, 얼림 아님
    if (!this.absorbing && inTrail && !frozen && this.cooldown <= 0 && this.boostRemaining <= 0) {
      this.tryStart();
    }
    if (this.absorbing) {
      if (!inTrail || frozen) {
        this.absorbing = false;
        this.progress = 0;
        this.cooldown = 0.6;
        this.callbacks.onCancel?.();
        return 'cancel';
      }
      this.progress += dt / GAME.absorbSeconds;
      this.callbacks.onProgress?.(Math.min(1, this.progress));
      if (this.progress >= 1) {
        this.absorbing = false;
        this.progress = 0;
        this.cooldown = GAME.absorbSeconds * 8;
        this.boostRemaining = GAME.boostSeconds;
        this.invulnerable = true;
        this.callbacks.onComplete?.(this.strengthConsumed);
        this.callbacks.onBoostStart?.(GAME.boostSeconds);
        return 'complete';
      }
      return 'progress';
    }
    return 'idle';
  }

  /** 흡수 대상 자국 위치 추적 (시각 표시용) */
  setLastTrailPosition(x: number, z: number): void {
    this.lastTrailWorldPos = { x, z };
  }

  getLastTrailPosition(): { x: number; z: number } | null {
    return this.lastTrailWorldPos;
  }

  /** 흡수할 자국 강도 (자국 색 농도 → 가속 배율 미세 조정) */
  setStrengthConsumed(s: number): void {
    this.strengthConsumed = Math.max(0.4, Math.min(1.0, s));
  }

  // === Getters ===
  isAbsorbing(): boolean {
    return this.absorbing;
  }
  getProgress(): number {
    return this.progress;
  }
  isInvulnerable(): boolean {
    return this.invulnerable;
  }
  getBoostRemaining(): number {
    return this.boostRemaining;
  }
  getBoostSpeedMultiplier(): number {
    return this.boostRemaining > 0 ? GAME.absorbedSpeedMultiplier * this.strengthConsumed : 1.0;
  }
  getCooldown(): number {
    return this.cooldown;
  }

  /** 외부에서 무적을 소비 (충돌 1회 무시) — true면 무적 소진됨 */
  consumeInvulnerability(): boolean {
    if (this.invulnerable) {
      this.invulnerable = false;
      return true;
    }
    return false;
  }

  /** 리셋 (OUT 또는 라운드 종료) */
  reset(): void {
    this.absorbing = false;
    this.progress = 0;
    this.cooldown = 0;
    this.boostRemaining = 0;
    this.invulnerable = false;
    this.lastTrailWorldPos = null;
  }
}
