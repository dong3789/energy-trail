// Phase B: 술래 AI (단순 패트롤)
// - 일정 시간마다 랜덤한 방향 선택 → 그쪽으로 이동
// - 맵 경계 근처에서는 안쪽으로 방향 보정
// - 충돌 처리(맵 경계/장애물)는 PlayerController와 동일 로직

import * as THREE from 'three';
import { GAME, SPEED_TIERS, type ObstacleSpec } from '../config';

export interface TaggerAIOptions {
  mesh: THREE.Mesh;
  obstacles: readonly ObstacleSpec[];
  mapHalfWidth: number;
  mapHalfDepth: number;
  target?: THREE.Object3D; // 추적 대상 (없으면 랜덤 패트롤)
  boostSystem?: import('./BoostSystem').BoostSystem; // v5: 부스터/피로 시스템
}

export class TaggerAI {
  private readonly mesh: THREE.Mesh;
  private readonly obstacles: readonly ObstacleSpec[];
  private readonly mapHalfWidth: number;
  private readonly mapHalfDepth: number;
  private readonly target: THREE.Object3D | undefined;
  private readonly boostSystem: import('./BoostSystem').BoostSystem | undefined;
  private frozen = false; // 2026-08-09 v4: 얼림 — true면 이동 스킵

  private heading = new THREE.Vector3(1, 0, 0);
  private turnTimer = 0;
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();

  // v5: 충돌 마진 — 술래 캡슐은 도망자보다 큼 (반경 0.63 + 마진 0.5 = 1.13m)
  // 2026-08-15: 0.6 → 0.5 — 박스 코너에서 덜 막혀서 추적 자연스러움
  private readonly collisionMargin = 0.5;

  constructor(opts: TaggerAIOptions) {
    this.mesh = opts.mesh;
    this.obstacles = opts.obstacles;
    this.mapHalfWidth = opts.mapHalfWidth;
    this.mapHalfDepth = opts.mapHalfDepth;
    this.target = opts.target;
    this.boostSystem = opts.boostSystem;
    if (!this.target) this.pickNewHeading();
  }

  update(dt: number): void {
    // 2026-08-09 v4: 얼림 상태면 이동/회전 스킵
    if (this.frozen) return;

    // v5: 부스터 시스템 — 회복 정지 중이면 이동/회전 모두 스킵 (자연 회복)
    if (this.boostSystem && this.boostSystem.isStalling()) {
      this.boostSystem.update(dt);
      // 비주얼 갱신은 main.ts에서 처리 (size는 main.ts의 콜백으로)
      return;
    }

    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.pickNewHeading();
      this.turnTimer = GAME.taggerPatrolTurnInterval * (0.7 + Math.random() * 0.6);
    }

    // target이 있으면 추적, 없으면 패트롤
    if (this.target) {
      this.tmpVec.copy(this.target.position).sub(this.mesh.position);
      this.tmpVec.y = 0;
      if (this.tmpVec.lengthSq() > 1e-4) {
        this.heading.copy(this.tmpVec).normalize();
      }
    }

    // 맵 경계 근처면 안쪽으로 보정
    const margin = 3.0;
    const px = this.mesh.position.x;
    const pz = this.mesh.position.z;
    if (Math.abs(px) > this.mapHalfWidth - margin) this.heading.x = px > 0 ? -1 : 1;
    if (Math.abs(pz) > this.mapHalfDepth - margin) this.heading.z = pz > 0 ? -1 : 1;
    this.heading.normalize();

    // v5: 부스터/피로 시스템의 속도 배율 반영
    let speed = GAME.baseSpeed * SPEED_TIERS.run.multiplier * GAME.taggerPatrolSpeedMultiplier;
    if (this.boostSystem) {
      const mul = this.boostSystem.getSpeedMultiplier();
      // 부스터 시스템은 stalling 체크 후이므로 mul > 0 보장
      if (mul < 1) speed *= mul; // slowdown만 적용, 부스트는 base에 포함 안 되므로 더 곱함
      if (mul > 1 && this.boostSystem.isBoosting()) speed *= mul;
    }

    const next = this.tmpVec.copy(this.mesh.position).addScaledVector(this.heading, speed * dt);

    // 회전 — 2026-08-15 v2: target 추적이므로 즉시 회전 (slerp 제거) → 더 공격적
    // 2026-08-16 BUG 픽스: atan2(hx, hz) → atan2(-hx, -hz)로 정정
    // - 캐릭터 모델은 -Z가 정면. heading이 (0,-1) [north] 일 때 회전 0 (정면이 -Z)
    // - 이전 atan2(hx, hz)는 heading이 (0,-1)일 때 π를 반환 → 등 돌림
    // - PlayerController / RunnerAIStub과 동일 공식으로 통일
    if (this.heading.lengthSq() > 1e-4) {
      const angle = Math.atan2(-this.heading.x, -this.heading.z);
      this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      this.mesh.quaternion.copy(this.tmpQuat);
    }

    this.mesh.position.x = this.resolveAxis(this.mesh.position.x, next.x, true);
    this.mesh.position.z = this.resolveAxis(this.mesh.position.z, next.z, false);
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  // 2026-08-09 v4: 얼림 — true면 update에서 이동/회전 스킵 (자국도 안 남음)
  setFrozen(value: boolean): void {
    this.frozen = value;
  }
  isFrozen(): boolean {
    return this.frozen;
  }

  private pickNewHeading(): void {
    const angle = Math.random() * Math.PI * 2;
    this.heading.set(Math.cos(angle), 0, Math.sin(angle));
  }

  private resolveAxis(current: number, target: number, isX: boolean): number {
    const half = isX ? this.mapHalfWidth : this.mapHalfDepth;
    const margin = this.collisionMargin;
    let clamped = Math.max(-half + margin, Math.min(half - margin, target));
    for (const o of this.obstacles) {
      const oxMin = o.x - o.width / 2 - margin;
      const oxMax = o.x + o.width / 2 + margin;
      const ozMin = o.z - o.depth / 2 - margin;
      const ozMax = o.z + o.depth / 2 + margin;
      if (isX) {
        if (
          clamped >= oxMin &&
          clamped <= oxMax &&
          this.mesh.position.z >= ozMin &&
          this.mesh.position.z <= ozMax
        ) {
          clamped = current;
        }
      } else {
        if (
          clamped >= ozMin &&
          clamped <= ozMax &&
          this.mesh.position.x >= oxMin &&
          this.mesh.position.x <= oxMax
        ) {
          clamped = current;
        }
      }
    }
    return clamped;
  }
}
