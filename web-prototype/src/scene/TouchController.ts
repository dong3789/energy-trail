// 2026-08-09 v6: 모바일 가상 조이스틱
// - Pointer Events 기반 (마우스/터치 통합)
// - 캔버스 좌하단에 조이스틱 노브 표시
// - 조이스틱을 떼면 자동으로 0으로 복귀
// - PlayerController.setInput(forward, right)를 호출해 직접 입력 주입

import { LOOK_STICK, lookAxesFromDelta } from '../lib/look-stick';

export interface JoystickOptions {
  host: HTMLElement; // 조이스틱을 붙일 부모 (보통 game-canvas-wrap)
  onChange: (forward: number, right: number) => void;
  /** 조이스틱 베이스 반경 (px) */
  baseRadius?: number;
  /** 조이스틱 노브 반경 (px) */
  knobRadius?: number;
  /** 화면 하단/왼쪽 여백 (px) */
  marginBottom?: number;
  marginLeft?: number;
}

export class Joystick {
  private readonly host: HTMLElement;
  private readonly onChange: (f: number, r: number) => void;
  private readonly baseRadius: number;
  private readonly knobRadius: number;
  private readonly marginBottom: number;
  private readonly marginLeft: number;

  private baseEl: HTMLDivElement | null = null;
  private knobEl: HTMLDivElement | null = null;
  private activePointerId: number | null = null;
  private centerX = 0;
  private centerY = 0;
  private currentF = 0;
  private currentR = 0;

  constructor(opts: JoystickOptions) {
    this.host = opts.host;
    this.onChange = opts.onChange;
    this.baseRadius = opts.baseRadius ?? 48;
    this.knobRadius = opts.knobRadius ?? 22;
    this.marginBottom = opts.marginBottom ?? 24;
    this.marginLeft = opts.marginLeft ?? 24;
  }

  mount(): void {
    const base = document.createElement('div');
    base.className = 'joystick-base';
    const knob = document.createElement('div');
    knob.className = 'joystick-knob';
    base.appendChild(knob);
    this.host.appendChild(base);
    this.baseEl = base;
    this.knobEl = knob;

    // Pointer Events
    base.addEventListener('pointerdown', this.onPointerDown);
  }

  unmount(): void {
    this.detachPointer();
    if (this.baseEl) {
      this.baseEl.removeEventListener('pointerdown', this.onPointerDown);
      this.baseEl.parentElement?.removeChild(this.baseEl);
      this.baseEl = null;
      this.knobEl = null;
    }
  }

  /** 매 프레임 외부에서 호출 — 입력 0으로 자동 복귀 */
  tick(): void {
    if (this.activePointerId === null) {
      // 자동 복귀: 데드존
      if (Math.abs(this.currentF) > 0.001 || Math.abs(this.currentR) > 0.001) {
        this.currentF = 0;
        this.currentR = 0;
        this.updateKnobVisual(0, 0);
        this.onChange(0, 0);
      }
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    if (this.baseEl) {
      const rect = this.baseEl.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;
      try {
        this.baseEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.baseEl.addEventListener('pointermove', this.onPointerMove);
      this.baseEl.addEventListener('pointerup', this.onPointerUp);
      this.baseEl.addEventListener('pointercancel', this.onPointerUp);
    }
    this.handleMove(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.handleMove(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.detachPointer();
    this.activePointerId = null;
    this.currentF = 0;
    this.currentR = 0;
    this.updateKnobVisual(0, 0);
    this.onChange(0, 0);
  };

  private detachPointer(): void {
    if (this.baseEl) {
      this.baseEl.removeEventListener('pointermove', this.onPointerMove);
      this.baseEl.removeEventListener('pointerup', this.onPointerUp);
      this.baseEl.removeEventListener('pointercancel', this.onPointerUp);
    }
  }

  private handleMove(clientX: number, clientY: number): void {
    const dx = clientX - this.centerX;
    const dy = clientY - this.centerY;
    // 원형 클램프
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = this.baseRadius;
    let nx = dx;
    let ny = dy;
    if (dist > maxDist) {
      nx = (dx / dist) * maxDist;
      ny = (dy / dist) * maxDist;
    }
    // 노브 위치 (단위: px, 좌상단 0,0 기준)
    this.updateKnobVisual(nx, ny);

    // 정규화 (-1 ~ 1)
    const normalizedX = nx / maxDist;
    const normalizedY = ny / maxDist;

    // Y는 화면 좌표계에서 아래가 +이므로 입력 Y는 부호 반전
    // - 화면 위 = -Y → forward(전진) = +1
    // - 화면 아래 = +Y → backward = -1
    // input.forward: W=+1 (앞), S=-1 (뒤) → 위쪽 드래그 = +1
    const forward = -normalizedY;
    const right = normalizedX;

    // 데드존 (5% 이내 0)
    const deadzone = 0.08;
    const f = Math.abs(forward) < deadzone ? 0 : forward;
    const r = Math.abs(right) < deadzone ? 0 : right;

    this.currentF = f;
    this.currentR = r;
    this.onChange(f, r);
  }

  private updateKnobVisual(px: number, py: number): void {
    if (!this.knobEl) return;
    // 노브는 베이스 중앙 기준 상대 위치
    this.knobEl.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
  }
}

export interface LookAxes {
  yaw: number;
  pitch: number;
}

/** Right-thumb look analog: origin at press, displacement drives turn *rate*. */
export class LookStick {
  private readonly host: HTMLElement;
  private readonly maxRadius: number;
  private zoneEl: HTMLDivElement | null = null;
  private ghostEl: HTMLDivElement | null = null;
  private knobEl: HTMLDivElement | null = null;
  private activePointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private yaw = 0;
  private pitch = 0;

  constructor(opts: { host: HTMLElement; maxRadius?: number }) {
    this.host = opts.host;
    this.maxRadius = opts.maxRadius ?? LOOK_STICK.maxRadius;
  }

  mount(): void {
    const zone = document.createElement('div');
    zone.className = 'look-zone';
    const hint = document.createElement('div');
    hint.className = 'look-hint';
    hint.setAttribute('aria-hidden', 'true');
    const ghost = document.createElement('div');
    ghost.className = 'look-ghost';
    const knob = document.createElement('div');
    knob.className = 'look-ghost-knob';
    ghost.appendChild(knob);
    zone.appendChild(hint);
    zone.appendChild(ghost);
    this.host.appendChild(zone);
    this.zoneEl = zone;
    this.ghostEl = ghost;
    this.knobEl = knob;
    zone.addEventListener('pointerdown', this.onPointerDown);
  }

  unmount(): void {
    this.detachPointer();
    if (this.zoneEl) {
      this.zoneEl.removeEventListener('pointerdown', this.onPointerDown);
      this.zoneEl.parentElement?.removeChild(this.zoneEl);
    }
    this.zoneEl = null;
    this.ghostEl = null;
    this.knobEl = null;
    this.yaw = 0;
    this.pitch = 0;
  }

  getAxes(): LookAxes {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.activePointerId = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    if (this.zoneEl) {
      try {
        this.zoneEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.zoneEl.addEventListener('pointermove', this.onPointerMove);
      this.zoneEl.addEventListener('pointerup', this.onPointerUp);
      this.zoneEl.addEventListener('pointercancel', this.onPointerUp);
      this.zoneEl.classList.add('is-looking');
    }
    this.placeGhost(e.clientX, e.clientY);
    this.handleMove(e.clientX, e.clientY);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.handleMove(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.detachPointer();
    this.activePointerId = null;
    this.yaw = 0;
    this.pitch = 0;
    if (this.ghostEl) this.ghostEl.classList.remove('active');
    if (this.zoneEl) this.zoneEl.classList.remove('is-looking');
    if (this.knobEl) this.knobEl.style.transform = 'translate(-50%, -50%)';
  };

  private detachPointer(): void {
    if (this.zoneEl) {
      this.zoneEl.removeEventListener('pointermove', this.onPointerMove);
      this.zoneEl.removeEventListener('pointerup', this.onPointerUp);
      this.zoneEl.removeEventListener('pointercancel', this.onPointerUp);
    }
  }

  private placeGhost(clientX: number, clientY: number): void {
    if (!this.ghostEl || !this.zoneEl) return;
    const rect = this.zoneEl.getBoundingClientRect();
    this.ghostEl.style.left = `${clientX - rect.left}px`;
    this.ghostEl.style.top = `${clientY - rect.top}px`;
    this.ghostEl.classList.add('active');
  }

  private handleMove(clientX: number, clientY: number): void {
    const dx = clientX - this.originX;
    const dy = clientY - this.originY;
    const axes = lookAxesFromDelta(dx, dy, this.maxRadius);
    this.yaw = axes.yaw;
    this.pitch = axes.pitch;
    if (!this.knobEl) return;
    const dist = Math.hypot(dx, dy);
    const k = dist > this.maxRadius && dist > 1e-6 ? this.maxRadius / dist : 1;
    this.knobEl.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  }
}

/** 모바일 화면 감지 — `navigator.maxTouchPoints > 0` 또는 좁은 너비 */
export function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const narrowWidth = window.innerWidth <= 900;
  return hasTouch || narrowWidth;
}
