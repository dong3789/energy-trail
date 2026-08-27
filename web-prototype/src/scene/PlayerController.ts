// Phase B: 자기 캐릭터 (도망자) 컨트롤러
// - WASD / 화살표 키 입력
// - SpeedTier (walk/run/sprint) 전환
// - 맵 경계 + 장애물 충돌 (간단 AABB)
// - 캐릭터가 이동 방향으로 회전
//
// 라벨은 외부에서 갱신 책임 (moveToLabel 같은 함수는 caller가 관리).

import * as THREE from 'three';
import { GAME, SCENE, SPEED_TIERS, type SpeedTier, type ObstacleSpec } from '../config';
import { moveCircle } from '../lib/collision';

export interface PlayerInputState {
  forward: number; // -1..1 (W=1, S=-1)
  right: number; // -1..1 (D=1, A=-1)
}

export interface PlayerControllerOptions {
  scene: THREE.Scene;
  mesh: THREE.Mesh;
  obstacles: readonly ObstacleSpec[];
  mapHalfWidth: number; // x ± (MAP.width / 2 - 캐릭터 반경 마진)
  mapHalfDepth: number;
  inputTarget?: HTMLElement | Window; // 키 이벤트 받을 타겟 (기본 window — 포커스 무관 안정)
  collisionMargin?: number; // v5: 도망자는 0.4 (좁은 틈 통과), 술래는 기본 0.6
  speedMultiplier?: number; // 2026-08-15 v8: 술래일 때 1.9, 도망자일 때 1.0
}

export class PlayerController {
  private readonly mesh: THREE.Mesh;
  private readonly obstacles: readonly ObstacleSpec[];
  private readonly mapHalfWidth: number;
  private readonly mapHalfDepth: number;
  private readonly inputTarget: HTMLElement | Window;
  private readonly collisionMargin: number;
  private readonly speedMultiplier: number; // v8: 술래 속도 배율
  private readonly velocity = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  // 2026-08-15 v29: WASD = 카메라-상대 (3인칭 표준)
  // - W = 카메라가 보는 방향, S = 반대 — 게임 loop에서 setMoveBasis()로 매 프레임 갱신
  // - A/D = 카메라 기준 좌우 (W+A 누르면 카메라 좌측-대각선으로 이동)
  // - 이전: 캐릭터 진행 방향 기준 → 빙글빙글 도는 버그
  // - 새: 카메라 forward = W → 직진 이동이 가장 빠르고 자연스러움
  private readonly moveForward = new THREE.Vector3(0, 0, -1);
  private readonly moveRight = new THREE.Vector3(1, 0, 0);

  // 2026-08-15 v3: 부드러운 가속/감속 (입력 즉시 반응 X)
  // - smoothInputF/R: 실제 적용값 (lerp으로 따라옴)
  // - 가속: 0.18, 감속: 0.22 (가속 살짝 느리게, 멈춤 빠르게)
  private smoothInputF = 0;
  private smoothInputR = 0;
  private readonly accelLerp = 0.18; // 0~1, 클수록 즉시 반응
  private readonly decelLerp = 0.22;
  // 대시 시스템: 짧은 시간 동안 2배 속도 (Shift)
  private dashTimeLeft = 0;
  private dashCooldownLeft = 0;
  private readonly DASH_DURATION = 0.3;
  private readonly DASH_COOLDOWN = 1.5;
  private readonly DASH_MULTIPLIER = 2.2;

  private speedTier: SpeedTier = 'run'; // 시작은 런 (디자인 §10: 술래 시작도 Run)
  private input: PlayerInputState = { forward: 0, right: 0 };
  private frozen = false; // 2026-08-09 v4: 얼림 — true면 입력 무시
  // 2026-08-27: 1인칭 모드 — ←/→ 키로 yaw 회전, mesh 자동 회전 OFF
  // - true: ArrowLeft/Right가 yaw 회전 입력으로 전환 (strafe 해제)
  // - false: ArrowLeft/Right는 좌/우 strafe (기존)
  private firstPerson = false;
  private yawLeft = false;
  private yawRight = false;

  // 디버그 헬퍼 — 최신 입력값 (HUD에서 읽음)
  getDebugInput(): PlayerInputState {
    return { ...this.input };
  }

  // 키 핸들러 정리용
  private readonly keyDownHandler: (e: KeyboardEvent) => void;
  private readonly keyUpHandler: (e: KeyboardEvent) => void;
  private readonly keyDownSpeedHandler: (e: KeyboardEvent) => void;

  constructor(opts: PlayerControllerOptions) {
    this.mesh = opts.mesh;
    this.obstacles = opts.obstacles;
    this.mapHalfWidth = opts.mapHalfWidth;
    this.mapHalfDepth = opts.mapHalfDepth;
    this.inputTarget = opts.inputTarget ?? window; // v6: 기본 window (포커스 무관)
    this.collisionMargin = opts.collisionMargin ?? 0.6;
    this.speedMultiplier = opts.speedMultiplier ?? 1.0; // v8: 술래 1.9, 도망자 1.0

    this.keyDownHandler = (e) => this.onKeyDown(e);
    this.keyUpHandler = (e) => this.onKeyUp(e);
    this.keyDownSpeedHandler = (e) => this.onKeyDownSpeed(e);

    this.inputTarget.addEventListener('keydown', this.keyDownHandler as EventListener);
    this.inputTarget.addEventListener('keyup', this.keyUpHandler as EventListener);
    this.inputTarget.addEventListener('keydown', this.keyDownSpeedHandler as EventListener);
  }

  getSpeedTier(): SpeedTier {
    return this.speedTier;
  }
  setSpeedTier(tier: SpeedTier): void {
    this.speedTier = tier;
  }
  setFrozen(value: boolean): void {
    this.frozen = value;
    if (value) {
      // 얼림 들어오면 입력 즉시 0으로 (잔여 입력으로 즉시 재진입 방지)
      this.input.forward = 0;
      this.input.right = 0;
    }
  }

  // 2026-08-27: 1인칭 모드 토글
  // - true: ArrowLeft/Right가 yaw 회전으로 전환, update()의 velocity-기반 mesh 자동 회전 스킵
  // - 모드 진입 시 yaw 입력 잔여값 초기화 (입력 안 눌린 상태로 시작)
  setFirstPersonMode(on: boolean): void {
    this.firstPerson = on;
    this.yawLeft = false;
    this.yawRight = false;
    if (on) {
      // 1인칭 진입 시 strafe 입력 잔여값 정리 (ArrowLeft/Right가 이제 회전이므로)
      this.input.right = 0;
    }
  }
  isFirstPerson(): boolean {
    return this.firstPerson;
  }

  // 2026-08-27: 1인칭 yaw 누적 — mesh.quaternion을 Y축으로 dr 만큼 회전
  // - 외부 카메라가 mesh.quaternion을 그대로 따라가므로 시각적 카메라 yaw가 됨
  addYaw(dr: number): void {
    if (dr === 0) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dr);
    this.mesh.quaternion.premultiply(q);
  }
  isFrozen(): boolean {
    return this.frozen;
  }

  // 2026-08-15: 흡수 중 (1초 유지) — 이동 차단, 회전 차단
  private absorbing = false;
  setAbsorbing(value: boolean): void {
    this.absorbing = value;
    if (value) {
      this.input.forward = 0;
      this.input.right = 0;
    }
  }
  isAbsorbing(): boolean {
    return this.absorbing;
  }

  // 2026-08-15: 흡수 후 가속 (boostRemaining 동안 적용)
  private boostSpeedMul = 1.0;
  private extraSpeedMul = 1.0;
  setBoostSpeedMultiplier(mul: number): void {
    this.boostSpeedMul = Math.max(1.0, mul);
  }
  getBoostSpeedMultiplier(): number {
    return this.boostSpeedMul;
  }
  setExtraSpeedMul(mul: number): void {
    this.extraSpeedMul = Math.max(0.2, mul);
  }

  // v6: 터치/외부 입력 직접 주입 (조이스틱 등 가상 입력용)
  setInput(forward: number, right: number): void {
    this.input.forward = Math.max(-1, Math.min(1, forward));
    this.input.right = Math.max(-1, Math.min(1, right));
  }

  /** 외부에서 라벨 텍스트 등을 업데이트하기 위한 핸들. */
  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  // 2026-08-15: 카메라 회전과 무관하게 W = 자기 앞, S = 자기 뒤가 되도록
  // main.ts가 매 프레임 캐릭터의 월드 forward/right를 전달
  setMoveBasis(forward: THREE.Vector3, right: THREE.Vector3): void {
    this.moveForward.copy(forward);
    this.moveRight.copy(right);
  }

  update(dt: number): void {
    // 2026-08-09 v4: 얼림 상태면 이동/회전 모두 스킵
    if (this.frozen) return;

    // 2026-08-15: 흡수 중이면 이동/회전 모두 스킵 (정지 상태로 흡수 게이지 유지)
    if (this.absorbing) return;

    // 2026-08-27: 1인칭 yaw 회전 — ←/→ 누르고 있는 동안 누적
    // - frozen/absorbing이 아닐 때만, 그리고 1인칭일 때만
    // - ← = +yaw (좌회전), → = -yaw (우회전)
    if (this.firstPerson) {
      const yawDelta = (this.yawLeft ? 1 : 0) - (this.yawRight ? 1 : 0);
      if (yawDelta !== 0) {
        this.addYaw(yawDelta * SCENE.firstPersonYawSpeed * dt);
      }
    }

    // 2026-08-15 v3: 대시 타이머
    if (this.dashTimeLeft > 0) {
      this.dashTimeLeft = Math.max(0, this.dashTimeLeft - dt);
    }
    if (this.dashCooldownLeft > 0) {
      this.dashCooldownLeft = Math.max(0, this.dashCooldownLeft - dt);
    }

    // 2026-08-15 v3: 부드러운 가속/감속 (입력 → 실제 적용값 lerp)
    // - 입력이 0이 아니면 가속 (lerp 0.18)
    // - 입력이 0이면 감속 (lerp 0.22, 더 빠르게 멈춤)
    const targetF = this.input.forward;
    const targetR = this.input.right;
    const isInputActive = Math.abs(targetF) > 0.01 || Math.abs(targetR) > 0.01;
    const lerpRate = isInputActive ? this.accelLerp : this.decelLerp;
    this.smoothInputF += (targetF - this.smoothInputF) * lerpRate;
    this.smoothInputR += (targetR - this.smoothInputR) * lerpRate;
    // 미세 잔여값 0으로 스냅
    if (Math.abs(this.smoothInputF) < 0.005 && !isInputActive) this.smoothInputF = 0;
    if (Math.abs(this.smoothInputR) < 0.005 && !isInputActive) this.smoothInputR = 0;

    const baseSpeed = GAME.baseSpeed;
    const tierMult = SPEED_TIERS[this.speedTier].multiplier;
    const dashMul = this.dashTimeLeft > 0 ? this.DASH_MULTIPLIER : 1.0;
    // v8: 술래일 때 speedMultiplier(1.9) 적용 — AI 술래와 같은 속도
    const speed =
      baseSpeed *
      tierMult *
      this.boostSpeedMul *
      dashMul *
      this.speedMultiplier *
      this.extraSpeedMul;

    // 입력 × basis 로 실제 속도 계산
    // - forward basis: 캐릭터가 향하는 방향 (월드)
    // - right basis: 캐릭터의 우측 (월드, forward × up = right)
    // - 카메라 yaw와 무관하게 W = 자기 앞, S = 자기 뒤
    this.velocity.set(0, 0, 0);
    this.velocity.addScaledVector(this.moveForward, this.smoothInputF);
    this.velocity.addScaledVector(this.moveRight, this.smoothInputR);
    if (this.velocity.lengthSq() > 1e-6) {
      this.velocity.normalize().multiplyScalar(speed);
    }

    const next = this.tmpVec.copy(this.mesh.position).addScaledVector(this.velocity, dt);

    if (this.velocity.lengthSq() > 1e-4) {
      // 2026-08-27: 1인칭은 카메라 yaw가 mesh yaw이므로 velocity 방향으로 mesh가 회전하면
      // 카메라가 같이 돌아가는 부자연스러운 결과. → 1인칭에서는 mesh 자동 회전 스킵.
      if (!this.firstPerson) {
        const fwdComp = this.velocity.dot(this.moveForward);
        const isStrafe = Math.abs(fwdComp) < 0.3;
        const rotSpeed = isStrafe ? GAME.rotationSpeed * 0.35 : GAME.rotationSpeed * 0.6;
        const angle = Math.atan2(-this.velocity.x, -this.velocity.z);
        this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        this.mesh.quaternion.slerp(this.tmpQuat, Math.min(1, rotSpeed * dt));
      }
    }

    const resolved = moveCircle(
      this.mesh.position.x,
      this.mesh.position.z,
      next.x - this.mesh.position.x,
      next.z - this.mesh.position.z,
      this.collisionMargin,
      this.obstacles,
      { halfWidth: this.mapHalfWidth, halfDepth: this.mapHalfDepth },
    );
    this.mesh.position.x = resolved.x;
    this.mesh.position.z = resolved.z;
  }

  // 2026-08-15 v3: 대시 (Shift 키) — 0.3s 짧은 돌진
  tryDash(): boolean {
    if (this.dashCooldownLeft > 0) return false;
    if (this.dashTimeLeft > 0) return false;
    this.dashTimeLeft = this.DASH_DURATION;
    this.dashCooldownLeft = this.DASH_COOLDOWN;
    return true;
  }
  isDashing(): boolean {
    return this.dashTimeLeft > 0;
  }
  getDashCooldownRemaining(): number {
    return this.dashCooldownLeft;
  }
  getDashCooldownMax(): number {
    return this.DASH_COOLDOWN;
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = 1;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.forward = -1;
        break;
      // 2026-08-27: 1인칭 모드에서 A/D도 yaw 회전 입력 (FPS 표준)
      // - W 누르면서 A 누르면 좌회전하며 W 진행 (전형 FPS 좌전진)
      // - 3인칭이면 strafe로 동작 (기존 호환)
      case 'KeyA':
      case 'ArrowLeft':
        if (this.firstPerson) this.yawLeft = true;
        else this.input.right = -1;
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.firstPerson) this.yawRight = true;
        else this.input.right = 1;
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        if (this.input.forward > 0) this.input.forward = 0;
        break;
      case 'KeyS':
      case 'ArrowDown':
        if (this.input.forward < 0) this.input.forward = 0;
        break;
      // 2026-08-27: 1인칭 yaw 입력 해제 (A/D/←/→ 공통)
      case 'KeyA':
      case 'ArrowLeft':
        if (this.firstPerson) this.yawLeft = false;
        else if (this.input.right < 0) this.input.right = 0;
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.firstPerson) this.yawRight = false;
        else if (this.input.right > 0) this.input.right = 0;
        break;
    }
  }

  private onKeyDownSpeed(e: KeyboardEvent): void {
    if (e.repeat) return;
    switch (e.code) {
      case 'Digit1':
        this.speedTier = 'walk';
        break;
      case 'Digit2':
        this.speedTier = 'run';
        break;
      case 'Digit3':
        this.speedTier = 'sprint';
        break;
    }
  }

  dispose(): void {
    this.inputTarget.removeEventListener('keydown', this.keyDownHandler as EventListener);
    this.inputTarget.removeEventListener('keyup', this.keyUpHandler as EventListener);
    this.inputTarget.removeEventListener('keydown', this.keyDownSpeedHandler as EventListener);
    // 2026-08-25: mesh가 외부 소유지만 dispose는 PlayerController가 호출되므로
    // 여기서 GPU 자원도 함께 해제. 라운드 재시작마다 새 mesh가 만들어지므로
    // 해제 안 하면 CapsuleGeometry/Material이 누적됨.
    const m = this.mesh;
    if (m) {
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    }
  }
}
