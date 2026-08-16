// Phase B: 자국 (Trail) 시스템 — 생성/소멸/풀링 (2026-08-15 리본 업그레이드)
// - 술래가 일정 거리 이상 이동하면 자국 1개 생성 (속도 등급 비례 색/강도)
// - trailLifetime 후 자연 소멸
// - trailMaxCount 초과 시 가장 오래된 자국부터 제거
// - Phase B+ 확장 자리: 흡수(1초 유지), 가속, 무적
//
// 시각: 이동 방향으로 정렬된 짧은 리본 (PlaneGeometry). AdditiveBlending으로
// 겹치는 자국이 자연스럽게 밝아짐.

import * as THREE from 'three';
import { GAME, SPEED_TIERS, type SpeedTier } from '../config';

// 리본 shape — 길이 1.2m, 폭 0.35m. PlaneGeometry는 XY 평면 → X는 길이, Y는 폭.
// 2026-08-15 v2: 폭 0.5 → 0.35 — 자국이 너무 두꺼워서 부셔지던 보정
const TRAIL_LENGTH = 1.2;
const TRAIL_WIDTH = 0.35;
const TRAIL_GEOMETRY = new THREE.PlaneGeometry(TRAIL_LENGTH, TRAIL_WIDTH);

interface ActiveTrail {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  createdAt: number;
  expiresAt: number;
  strength: number;
  baseScale: number; // 자국 생성 시점 스케일
}

export interface TrailEmitterOptions {
  scene: THREE.Scene;
  tagger: THREE.Object3D; // 술래 mesh 또는 AI 객체 — position/quaternion 사용
  taggerSpeedTierRef: { current: SpeedTier };
  isTaggerFrozenRef?: { current: boolean }; // 얼림 중이면 자국 안 남김
}

export class TrailEmitter {
  private readonly scene: THREE.Scene;
  private readonly tagger: THREE.Object3D;
  private readonly taggerSpeedTierRef: { current: SpeedTier };
  private readonly isTaggerFrozenRef: { current: boolean } | undefined;

  private readonly active: ActiveTrail[] = [];
  private lastPosition = new THREE.Vector3();
  private distanceAccumulator = 0;
  private readonly trailTmpVec = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();

  constructor(opts: TrailEmitterOptions) {
    this.scene = opts.scene;
    this.tagger = opts.tagger;
    this.taggerSpeedTierRef = opts.taggerSpeedTierRef;
    this.isTaggerFrozenRef = opts.isTaggerFrozenRef;
    this.lastPosition.copy(this.tagger.position);
  }

  update(_dt: number, now: number): void {
    const cur = this.tagger.position;
    this.trailTmpVec.copy(cur).sub(this.lastPosition);
    const moved = this.trailTmpVec.length();
    this.lastPosition.copy(cur);

    const tier = this.taggerSpeedTierRef.current;
    const strength = SPEED_TIERS[tier].trailStrength;

    if (!this.isTaggerFrozenRef?.current && strength > 0 && moved > 0) {
      this.distanceAccumulator += moved;
      while (this.distanceAccumulator >= GAME.trailInterval) {
        this.spawnTrail(cur, strength);
        this.distanceAccumulator -= GAME.trailInterval;
      }
    } else {
      this.distanceAccumulator = 0;
    }

    // 자연 소멸 (opacity + scale 애니메이션)
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i];
      if (now >= t.expiresAt) {
        this.scene.remove(t.mesh);
        t.material.dispose();
        this.active.splice(i, 1);
      } else {
        // 잔존 비율 1 → 0 (생성 직후 1, 소멸 직전 0)
        const remain = (t.expiresAt - now) / GAME.trailLifetime;
        const r = Math.max(0, Math.min(1, remain));
        t.material.opacity = r * t.strength;
        // 살짝 줄어드는 느낌 (1.0 → 0.85)
        const scale = t.baseScale * (0.85 + 0.15 * r);
        t.mesh.scale.set(scale, scale, scale);
      }
    }

    // 최대 개수 제한
    while (this.active.length > GAME.trailMaxCount) {
      const oldest = this.active.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        oldest.material.dispose();
      }
    }
  }

  private spawnTrail(position: THREE.Vector3, strength: number): void {
    const tier = this.taggerSpeedTierRef.current;
    const color = SPEED_TIERS[tier].color;
    // v28: NormalBlending (daylight) — AdditiveBlending은 발광 느낌이라 daylight엔 부자연스러움
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: strength,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(TRAIL_GEOMETRY, material);

    // 위치: 바닥 살짝 위 (z-fighting 방지)
    mesh.position.set(position.x, 0.06, position.z);

    // 회전: 술래가 향하는 방향으로 리본의 길이(X축)가 정렬되도록
    // PlaneGeometry는 XY 평면 → 기본은 -Z를 향함. -Z를 술래의 forward와 정렬하면 됨.
    // PlaneGeometry의 회전은 Y축 기준이라, 리본의 길이를 forward 방향으로 두려면
    // mesh.rotation.y를 (forward 각도 - 0)으로 맞춤.
    this.tmpForward.set(0, 0, -1).applyQuaternion(this.tagger.quaternion);
    // forward의 XZ 평면 각도 (Math.atan2 사용)
    const angle = Math.atan2(this.tmpForward.x, this.tmpForward.z);
    mesh.rotation.set(-Math.PI / 2, 0, -angle);
    // → 바닥에 누운 리본, 길이 축이 forward와 정렬

    this.scene.add(mesh);
    this.active.push({
      mesh,
      material,
      createdAt: performance.now() / 1000,
      expiresAt: performance.now() / 1000 + GAME.trailLifetime,
      strength,
      baseScale: 1.0,
    });
  }

  dispose(): void {
    for (const t of this.active) {
      this.scene.remove(t.mesh);
      t.material.dispose();
    }
    this.active.length = 0;
    TRAIL_GEOMETRY.dispose();
  }

  /** 현재 활성 자국 개수 (HUD용) */
  getActiveCount(): number {
    return this.active.length;
  }

  /**
   * 2026-08-15: 흡수 가능 자국 쿼리
   * - position 주변 radius 내에 가장 가까운 활성 자국이 있는지 검사
   * - @returns hit 여부, 자국 위치, 자국 강도(strength = 0~1, 색 농도)
   */
  queryNearest(
    position: THREE.Vector3,
    radius: number,
  ): {
    hit: boolean;
    position: THREE.Vector3 | null;
    strength: number;
  } {
    let best: ActiveTrail | null = null;
    let bestDist2 = radius * radius;
    for (const t of this.active) {
      const dx = t.mesh.position.x - position.x;
      const dz = t.mesh.position.z - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestDist2) {
        bestDist2 = d2;
        best = t;
      }
    }
    if (best) {
      return { hit: true, position: best.mesh.position.clone(), strength: best.strength };
    }
    return { hit: false, position: null, strength: 0 };
  }

  /**
   * 2026-08-15: 흡수 — 가장 가까운 자국을 제거하고 강도 반환
   * - 흡수 시작 시점에 호출하지 말고, 1초 유지 완료 시점에 호출
   * - @returns 제거된 자국의 강도, 없으면 0
   */
  consumeNearest(position: THREE.Vector3, radius: number): number {
    let best: ActiveTrail | null = null;
    let bestDist2 = radius * radius;
    let bestIdx = -1;
    for (let i = 0; i < this.active.length; i++) {
      const t = this.active[i];
      const dx = t.mesh.position.x - position.x;
      const dz = t.mesh.position.z - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestDist2) {
        bestDist2 = d2;
        best = t;
        bestIdx = i;
      }
    }
    if (best && bestIdx >= 0) {
      this.scene.remove(best.mesh);
      best.material.dispose();
      this.active.splice(bestIdx, 1);
      return best.strength;
    }
    return 0;
  }
}
