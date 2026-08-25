// 2026-08-15: 자국 흡수 시스템 (코어 메카닉)
// - 자국 위에서 1초간 유지 (이동/얼림/OUT 시 취소)
// - 완료 시: 자국 제거 + 4초 가속 + 1회 무적 + 색상 변화
// - 쿨다운: 8초
// - 흡수 중에는 이동 불가 (PlayerController.setAbsorbing(true) 처리)

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

  private readonly callbacks: AbsorbSystemCallbacks;

  constructor(callbacks: AbsorbSystemCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * 흡수 시작 시도
   * - 조건: 쿨다운 0, 가속 중 아님, 자국 위에 있어야 함
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
   * 2026-08-25: 자동 시작 — inTrail 이면 흡수 중이 아닐 때 자동으로 tryStart().
   *              자동 시작을 흡수 진행 로직 *앞에* 두어 같은 프레임에 progress 도 누적되도록 함.
   *              호출자가 매 프레임 setLastTrailPosition / setStrengthConsumed 로
   *              최신 자국 정보를 채워줘야 자동 시작 시 올바른 값으로 시작됨.
   */
  update(dt: number, inTrail: boolean, frozen: boolean): AbsorbEvent {
    // 자동 시작: 자국 위에 있고, 쿨다운 0, 부스트 중 아님, 얼림 아님
    if (!this.absorbing && inTrail && !frozen && this.cooldown <= 0 && this.boostRemaining <= 0) {
      this.tryStart();
    }
    // 흡수 중
    if (this.absorbing) {
      if (!inTrail || frozen) {
        // 취소
        this.absorbing = false;
        this.progress = 0;
        this.cooldown = 0.6; // 짧은 디바운스 쿨다운
        this.callbacks.onCancel?.();
        return 'cancel';
      }
      this.progress += dt / GAME.absorbSeconds; // 1초 기준
      this.callbacks.onProgress?.(Math.min(1, this.progress));
      if (this.progress >= 1) {
        // 완료
        this.absorbing = false;
        this.progress = 0;
        this.cooldown = GAME.absorbSeconds * 8; // 8초 쿨다운
        this.boostRemaining = GAME.boostSeconds;
        this.invulnerable = true;
        this.callbacks.onComplete?.(this.strengthConsumed);
        this.callbacks.onBoostStart?.(GAME.boostSeconds);
        return 'complete';
      }
      return 'progress';
    }
    // 가속 중
    if (this.boostRemaining > 0) {
      this.boostRemaining -= dt;
      if (this.boostRemaining <= 0) {
        this.boostRemaining = 0;
        this.invulnerable = false;
        this.callbacks.onBoostEnd?.();
      }
    }
    // 쿨다운 감소
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
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
