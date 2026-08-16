// 2026-08-09 v6: 모바일 가상 조이스틱
// - Pointer Events 기반 (마우스/터치 통합)
// - 캔버스 좌하단에 조이스틱 노브 표시
// - 조이스틱을 떼면 자동으로 0으로 복귀
// - PlayerController.setInput(forward, right)를 호출해 직접 입력 주입

import { GAME } from '../config';

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
    this.baseRadius = opts.baseRadius ?? 64;
    this.knobRadius = opts.knobRadius ?? 32;
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
    // pointermove/up/cancel은 window에 등록 (조이스틱 밖에서도 추적)
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
    if (this.activePointerId !== null) return; // 이미 활성
    this.activePointerId = e.pointerId;
    if (this.baseEl) {
      this.baseEl.setPointerCapture(e.pointerId);
      this.baseEl.addEventListener('pointermove', this.onPointerMove);
      this.baseEl.addEventListener('pointerup', this.onPointerUp);
      this.baseEl.addEventListener('pointercancel', this.onPointerUp);
    }
    // 베이스 중심을 터치 위치로 (또는 베이스 중앙 고정 — 모바일에선 중앙 고정 직관적)
    if (this.baseEl) {
      const rect = this.baseEl.getBoundingClientRect();
      this.centerX = rect.left + rect.width / 2;
      this.centerY = rect.top + rect.height / 2;
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

/** 모바일 화면 감지 — `navigator.maxTouchPoints > 0` 또는 좁은 너비 */
export function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const narrowWidth = window.innerWidth <= 900;
  return hasTouch || narrowWidth;
}
