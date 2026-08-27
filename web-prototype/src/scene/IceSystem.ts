// 2026-08-09 v4: 얼림 (Ice) 시스템 — 도망자가 술래를 잠시 동결
// - 발동 가능 거리 (GAME.iceRange) 이내일 때만 활성
// - 쿨다운 (GAME.iceCooldown) 동안 재사용 불가
// - 발동 시 술래만 frozen. 도망자는 그 동안 도망친다.
// - 지속시간 (GAME.iceDuration) 후 자동 해제
//
// 의존성: PlayerController.setFrozen(bool), TaggerAI.setFrozen(bool)
//        둘 다 frozen 동안 입력을 무시하거나 이동을 0으로 만듦.

import { GAME } from '../config';

export interface IceSystemOptions {
  setPlayerFrozen: (frozen: boolean) => void;
  setTaggerFrozen: (frozen: boolean) => void;
  onTaggerVisual?: (frozen: boolean) => void; // 색상 토글 콜백
}

export class IceSystem {
  private readonly setPlayerFrozen: (b: boolean) => void;
  private readonly setTaggerFrozen: (b: boolean) => void;
  private readonly onTaggerVisual: ((b: boolean) => void) | undefined;

  private active = false;
  private remaining = 0;
  private cooldown = 0; // 0이면 즉시 사용 가능
  private catchGrace = 0;

  constructor(opts: IceSystemOptions) {
    this.setPlayerFrozen = opts.setPlayerFrozen;
    this.setTaggerFrozen = opts.setTaggerFrozen;
    this.onTaggerVisual = opts.onTaggerVisual;
  }

  inRange(distToTagger: number): boolean {
    return Number.isFinite(distToTagger) && distToTagger <= GAME.iceRange;
  }

  denyReason(distToTagger: number): 'active' | 'cooldown' | 'range' | null {
    if (this.active) return 'active';
    if (this.cooldown > 0) return 'cooldown';
    if (!this.inRange(distToTagger)) return 'range';
    return null;
  }

  /** 도망자가 술래와 거리 안에 있고 쿨다운이 끝났으면 얼림 발동 */
  triggerIfReady(distToTagger: number): boolean {
    if (this.denyReason(distToTagger)) return false;

    this.active = true;
    this.remaining = GAME.iceDuration;
    this.setPlayerFrozen(false);
    this.setTaggerFrozen(true);
    if (this.onTaggerVisual) this.onTaggerVisual(true);
    return true;
  }

  update(dt: number): void {
    if (this.active) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.active = false;
        this.remaining = 0;
        this.cooldown = GAME.iceCooldown;
        this.catchGrace = GAME.iceCatchGraceSeconds;
        this.setPlayerFrozen(false);
        this.setTaggerFrozen(false);
        if (this.onTaggerVisual) this.onTaggerVisual(false);
      }
    } else {
      if (this.catchGrace > 0) this.catchGrace = Math.max(0, this.catchGrace - dt);
      if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    }
  }

  /** 수동 리셋 (라운드 재시작 등) */
  reset(): void {
    if (this.active) {
      this.setPlayerFrozen(false);
      this.setTaggerFrozen(false);
      if (this.onTaggerVisual) this.onTaggerVisual(false);
    }
    this.active = false;
    this.remaining = 0;
    this.cooldown = 0;
    this.catchGrace = 0;
  }

  /** UI 표시용 */
  isActive(): boolean {
    return this.active;
  }
  getRemaining(): number {
    return this.remaining;
  }
  getCooldown(): number {
    return this.cooldown;
  }
  isReady(): boolean {
    return !this.active && this.cooldown <= 0;
  }
  blocksCatch(): boolean {
    return this.active || this.catchGrace > 0;
  }
}
