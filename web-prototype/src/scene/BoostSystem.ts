// 2026-08-09 v5: 부스터 시스템 (술래)
// - B 키로 부스터 발동 (쿨다운 0.8s)
// - 1회당 fatigue +25, max 100
// - fatigue 비례 shrink (0.55~1.0 scale) + speed (0.60~1.0 mul)
// - fatigue ≥ 90 + 보정 속도 < 0.4x → 회복 정지 (2.5s, fatigue -30/s)
// - 정지 후 fatigue < 30 이하면 자유 이동 복귀

import { GAME } from '../config';

export interface BoostSystemOptions {
  onVisualChange?: (params: BoostVisualParams) => void;
  onStallChange?: (stalling: boolean) => void;
}

export interface BoostVisualParams {
  scale: number; // 1.0 (정상) → 0.55 (fatigue 100)
  speedMul: number; // 1.0 → 0.60
  isBoosting: boolean; // 부스터 활성 중
  isStalling: boolean; // 회복 정지 중
  fatigue: number; // 0~100
}

export class BoostSystem {
  private readonly onVisualChange?: (p: BoostVisualParams) => void;
  private readonly onStallChange?: (b: boolean) => void;

  private fatigue = 0; // 0~100
  private boostActiveRemaining = 0; // 부스터 활성 남은 시간
  private boostCooldownRemaining = 0;
  private stalling = false; // 회복 정지 중
  private stallRemaining = 0;
  private wasStalling = false;

  constructor(opts: BoostSystemOptions = {}) {
    this.onVisualChange = opts.onVisualChange;
    this.onStallChange = opts.onStallChange;
  }

  /** B 키 입력 시 호출. 정지 중이거나 쿨다운 중이면 무시. */
  trigger(): boolean {
    if (this.stalling) return false;
    if (this.boostCooldownRemaining > 0) return false;
    if (this.boostActiveRemaining > 0) return false; // 이미 활성

    this.boostActiveRemaining = GAME.boostActiveDuration;
    this.boostCooldownRemaining = GAME.boostCooldown;
    this.fatigue = Math.min(100, this.fatigue + GAME.boostFatiguePerUse);
    this.checkStallEnter();
    this.emitVisual();
    return true;
  }

  update(dt: number): void {
    if (this.boostActiveRemaining > 0) {
      this.boostActiveRemaining = Math.max(0, this.boostActiveRemaining - dt);
      if (this.boostActiveRemaining === 0) this.emitVisual();
    }
    if (this.boostCooldownRemaining > 0) {
      this.boostCooldownRemaining = Math.max(0, this.boostCooldownRemaining - dt);
    }

    if (this.stalling) {
      this.stallRemaining = Math.max(0, this.stallRemaining - dt);
      this.fatigue = Math.max(0, this.fatigue - GAME.boostStallRecoveryRate * dt);
      if (this.stallRemaining === 0 || this.fatigue < 30) {
        this.stalling = false;
        if (this.wasStalling) {
          this.wasStalling = false;
          if (this.onStallChange) this.onStallChange(false);
        }
      }
      this.emitVisual();
    }
  }

  private checkStallEnter(): void {
    if (this.stalling) return;
    const speedMul = this.getSpeedMultiplier();
    if (this.fatigue >= GAME.boostStallThreshold && speedMul < GAME.boostStallMinSpeed) {
      this.stalling = true;
      this.stallRemaining = GAME.boostStallDuration;
      this.wasStalling = true;
      // 부스터도 강제 종료
      this.boostActiveRemaining = 0;
      if (this.onStallChange) this.onStallChange(true);
    }
  }

  /** 술래의 현재 속도 배율 (정지 중이면 0) */
  getSpeedMultiplier(): number {
    if (this.stalling) return 0;
    let mul = 1.0;
    // 피로 비례 slowdown: fatigue 100 → 0.60
    mul *= 1.0 - (1.0 - GAME.boostFatigueSpeedMul) * (this.fatigue / 100);
    // 부스터 활성 중 추가 가속
    if (this.boostActiveRemaining > 0) {
      mul *= GAME.boostActiveSpeedMul;
    }
    return Math.max(0, mul);
  }

  /** 술래의 현재 시각적 크기 배율 */
  getScale(): number {
    if (this.stalling) return 0.4; // 정지 중 작게
    // 피로 비례 shrink
    const scale = 1.0 - (1.0 - GAME.boostFatigueShrink) * (this.fatigue / 100);
    return Math.max(0.3, scale);
  }

  /** 정지 중? */
  isStalling(): boolean {
    return this.stalling;
  }

  /** 부스터 활성 중? */
  isBoosting(): boolean {
    return this.boostActiveRemaining > 0;
  }

  /** 피로도 0~100 */
  getFatigue(): number {
    return this.fatigue;
  }

  /** 쿨다운 (UI 표시용) */
  getCooldownRemaining(): number {
    return this.boostCooldownRemaining;
  }

  private emitVisual(): void {
    if (!this.onVisualChange) return;
    this.onVisualChange({
      scale: this.getScale(),
      speedMul: this.getSpeedMultiplier(),
      isBoosting: this.isBoosting(),
      isStalling: this.stalling,
      fatigue: this.fatigue,
    });
  }
}
