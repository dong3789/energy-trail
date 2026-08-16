// Phase B: 도망자 AI (자기가 술래일 때 사용)
// - threat(술래)와의 거리가 너무 가까워지면 반대 방향으로 도주
// - 충분히 멀면 자유롭게 패트롤 (랜덤 방향)
// - 맵 경계/장애물 회피

import * as THREE from 'three';
import { GAME, SPEED_TIERS, type ObstacleSpec } from '../config';

export interface RunnerAIStubOptions {
  mesh: THREE.Mesh;
  obstacles: readonly ObstacleSpec[];
  mapHalfWidth: number;
  mapHalfDepth: number;
  threat: THREE.Object3D; // 도망 대상 (보통 자기 = 술래)
}

export class RunnerAIStub {
  private readonly mesh: THREE.Mesh;
  private readonly obstacles: readonly ObstacleSpec[];
  private readonly mapHalfWidth: number;
  private readonly mapHalfDepth: number;
  private readonly threat: THREE.Object3D;

  private heading = new THREE.Vector3(1, 0, 0);
  private turnTimer = 0;
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();

  // 2026-08-15: 4.0 → 5.0 — 술래(2.4×=15.1 m/s)에 비해 AI 도망자가 너무 쉽게 잡힘
  // → 회피 거리 늘려서 도망 시작 일찍
  private readonly fleeDistance = 5.0;
  // 2026-08-15 v2: 1.2× → 1.4× — AI 도망자가 술래(2.4×=15.1 m/s)한테 너무 쉽게 잡힘
  // 2026-08-15 v8: 술래 1.9배 — AI 도망자 8.8 m/s는 1.36배 느림 → 도주 가능
  private readonly baseSpeed = GAME.baseSpeed * SPEED_TIERS.run.multiplier * 1.4;

  // v9: 갇힘 감지 — 일정 시간 움직이지 않으면 헤딩 강제 변경
  private lastPosition = new THREE.Vector3();
  private stuckTimer = 0;
  private readonly STUCK_THRESHOLD = 1.0; // 1초 이상 안 움직이면 갇힘으로 간주

  constructor(opts: RunnerAIStubOptions) {
    this.mesh = opts.mesh;
    this.obstacles = opts.obstacles;
    this.mapHalfWidth = opts.mapHalfWidth;
    this.mapHalfDepth = opts.mapHalfDepth;
    this.threat = opts.threat;
    this.lastPosition.copy(this.mesh.position);
    this.pickNewHeading();
  }

  update(dt: number): void {
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.pickNewHeading();
      this.turnTimer = 1.5 + Math.random() * 1.5;
    }

    // threat까지 거리 계산 → 가까우면 반대 방향으로 헤딩 보정
    this.tmpVec.copy(this.mesh.position).sub(this.threat.position);
    this.tmpVec.y = 0;
    const dist = this.tmpVec.length();
    if (dist > 0.001 && dist < this.fleeDistance) {
      this.heading.copy(this.tmpVec).normalize();
    }

    // v6: 장애물 자성 — 가까운 장애물이 있으면 미세하게 끌어당김
    let magnetX = 0;
    let magnetZ = 0;
    let magnetStrength = 0;
    for (const o of this.obstacles) {
      // 장애물 AABB 가장 가까운 점
      const ox = Math.max(o.x - o.width / 2, Math.min(this.mesh.position.x, o.x + o.width / 2));
      const oz = Math.max(o.z - o.depth / 2, Math.min(this.mesh.position.z, o.z + o.depth / 2));
      const dx = ox - this.mesh.position.x;
      const dz = oz - this.mesh.position.z;
      const d2 = dx * dx + dz * dz;
      const range = GAME.obstacleMagnetismRange + 0.4; // collisionMargin 0.4 + 자성 추가 범위
      if (d2 < range * range && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        // 가까울수록 강함 (선형 감쇠)
        const k = 1 - d / range;
        const pull = GAME.obstacleMagnetism * k * dt;
        magnetX += (dx / d) * pull;
        magnetZ += (dz / d) * pull;
        magnetStrength += k;
      }
    }

    // 맵 경계 보정
    const margin = 3.0;
    const px = this.mesh.position.x;
    const pz = this.mesh.position.z;
    if (Math.abs(px) > this.mapHalfWidth - margin) this.heading.x = px > 0 ? -1 : 1;
    if (Math.abs(pz) > this.mapHalfDepth - margin) this.heading.z = pz > 0 ? -1 : 1;
    this.heading.normalize();

    const next = this.tmpVec.copy(this.mesh.position).addScaledVector(this.heading, this.baseSpeed * dt);
    // 자성 추가 (X/Z 각각)
    next.x += magnetX;
    next.z += magnetZ;

    // v9: 회전 공식 수정 — atan2(-velocity.x, -velocity.z) (진행 방향을 보게)
    if (this.heading.lengthSq() > 1e-4) {
      const angle = Math.atan2(-this.heading.x, -this.heading.z);
      this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      this.mesh.quaternion.copy(this.tmpQuat);
    }

    const oldX = this.mesh.position.x;
    const oldZ = this.mesh.position.z;
    this.mesh.position.x = this.resolveAxis(this.mesh.position.x, next.x, true);
    this.mesh.position.z = this.resolveAxis(this.mesh.position.z, next.z, false);

    // v9: 갇힘 감지 — 1초 이상 안 움직이면 헤딩 강제 변경
    const moved = (this.mesh.position.x - oldX) + (this.mesh.position.z - oldZ);
    if (Math.abs(moved) < 0.01) {
      this.stuckTimer += dt;
      if (this.stuckTimer > this.STUCK_THRESHOLD) {
        // 8방향 시도하며 clear한 방향 찾기
        for (let i = 0; i < 8; i++) {
          const testAngle = (i / 8) * Math.PI * 2;
          const testDir = new THREE.Vector3(Math.cos(testAngle), 0, Math.sin(testAngle));
          const testNext = this.mesh.position.clone().addScaledVector(testDir, this.baseSpeed * dt);
          if (this.resolveAxis(this.mesh.position.x, testNext.x, true) !== this.mesh.position.x ||
              this.resolveAxis(this.mesh.position.z, testNext.z, false) !== this.mesh.position.z) {
            this.heading.copy(testDir);
            this.stuckTimer = 0;
            this.turnTimer = 0.5; // 다음 헤딩 변경도 빠르게
            break;
          }
        }
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPosition.copy(this.mesh.position);
  }

  getPosition(): THREE.Vector3 { return this.mesh.position; }

  private pickNewHeading(): void {
    const angle = Math.random() * Math.PI * 2;
    this.heading.set(Math.cos(angle), 0, Math.sin(angle));
  }

  private resolveAxis(current: number, target: number, isX: boolean): number {
    const half = isX ? this.mapHalfWidth : this.mapHalfDepth;
    const margin = 0.6;
    let clamped = Math.max(-half + margin, Math.min(half - margin, target));
    for (const o of this.obstacles) {
      const oxMin = o.x - o.width / 2 - margin;
      const oxMax = o.x + o.width / 2 + margin;
      const ozMin = o.z - o.depth / 2 - margin;
      const ozMax = o.z + o.depth / 2 + margin;
      if (isX) {
        if (clamped >= oxMin && clamped <= oxMax && this.mesh.position.z >= ozMin && this.mesh.position.z <= ozMax) {
          clamped = current;
        }
      } else {
        if (clamped >= ozMin && clamped <= ozMax && this.mesh.position.x >= oxMin && this.mesh.position.x <= oxMax) {
          clamped = current;
        }
      }
    }
    return clamped;
  }
}