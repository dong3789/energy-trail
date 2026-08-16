// 2026-08-15: 먼지 파티클 시스템
// - 플레이어가 이동 중일 때 발밑에서 작은 먼지 파티클 생성
// - 위로 살짝 떠오르며 페이드아웃 (1.5초 수명)
// - 빠른 이동 / 부스터 시 더 많이 생성
// - 단순 Points + 작은 구체 또는 Plane

import * as THREE from 'three';

interface DustParticle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number; // 남은 수명 (초)
  maxLife: number; // 전체 수명
  scale: number; // 시작 크기
}

const POOL_SIZE = 200;
// 2026-08-16: DUST_GEOMETRY를 모듈 레벨에서 인스턴스 레벨로 이동 (TrailEmitter와 동일 패턴)
// - 이전: 모듈 상수 → 여러 DustSystem 인스턴스가 같은 geometry 공유
// - 문제: dispose()에서 dispose하면 2번째 게임부터 먼지 안 보임
// - 픽스: 인스턴스 멤버로 이동 (\`this.geometry\`)

export interface DustSystemOptions {
  scene: THREE.Scene;
  spawnRadius?: number; // 발 중심에서 반경 (m)
  spawnPerSecond?: number; // 초당 생성 (이동 중)
  lifetime?: number; // 수명 (초)
  baseColor?: number; // 베이스 색
  boostMultiplier?: number; // 부스터 시 생성 배율
}

export class DustSystem {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  // 2026-08-16: 인스턴스별 geometry
  private readonly geometry: THREE.PlaneGeometry;
  private readonly particles: DustParticle[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  private readonly spawnRadius: number;
  private readonly spawnPerSecond: number;
  private readonly lifetime: number;
  private readonly baseColor: number;
  private readonly boostMultiplier: number;

  private spawnAccumulator = 0;

  constructor(opts: DustSystemOptions) {
    this.scene = opts.scene;
    this.spawnRadius = opts.spawnRadius ?? 0.45;
    this.spawnPerSecond = opts.spawnPerSecond ?? 18;
    this.lifetime = opts.lifetime ?? 1.5;
    this.baseColor = opts.baseColor ?? 0x6a7888;
    this.boostMultiplier = opts.boostMultiplier ?? 1.6;

    this.material = new THREE.MeshBasicMaterial({
      color: this.baseColor,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.geometry = new THREE.PlaneGeometry(0.3, 0.3);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, POOL_SIZE);
    // 초기에는 모두 scale 0 (안 보이게)
    this.dummy.scale.set(0, 0, 0);
    this.dummy.position.set(0, -100, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < POOL_SIZE; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.mesh);

    // 풀 초기화
    for (let i = 0; i < POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(0, -100, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        scale: 0,
      });
    }
  }

  // 플레이어 발 위치 + 이동량 + 부스터 여부
  // movedDist: 직전 프레임 이동 거리 (m)
  // boost: 부스터 활성 여부
  update(dt: number, footPos: THREE.Vector3, movedDist: number, boost: boolean): void {
    // 1) 새 파티클 생성
    const rate = this.spawnPerSecond * (boost ? this.boostMultiplier : 1);
    this.spawnAccumulator += dt * rate;
    while (this.spawnAccumulator >= 1) {
      this.spawn(footPos);
      this.spawnAccumulator -= 1;
    }

    // 2) 파티클 업데이트 (수명, 위치, 크기)
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        // 화면 밖으로
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      // 위치 업데이트
      p.position.addScaledVector(p.velocity, dt);
      // 위로 떠오름 (점점 느려짐)
      p.velocity.y *= 0.92;

      // 크기: 살짝 커지면서 페이드아웃
      const t = 1 - p.life / p.maxLife; // 0 → 1
      const scale = p.scale * (1 + t * 0.6);
      this.dummy.position.copy(p.position);
      this.dummy.scale.set(scale, scale, scale);
      // 바닥에 누운 plane (회전 X)
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(footPos: THREE.Vector3): void {
    // 비활성 파티클 찾기
    let idx = -1;
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].active) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return; // 풀이 가득 참

    const p = this.particles[idx];
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * this.spawnRadius;
    p.position.set(
      footPos.x + Math.cos(angle) * r,
      0.08 + Math.random() * 0.05,
      footPos.z + Math.sin(angle) * r,
    );
    p.velocity.set(
      (Math.random() - 0.5) * 0.6,
      0.5 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.6,
    );
    p.life = this.lifetime;
    p.maxLife = this.lifetime;
    p.scale = 0.5 + Math.random() * 0.4;
    p.active = true;
  }

  /** 2026-08-15: 이벤트 버스트 (얼림/부스터) — 한 위치에서 N개 동시 생성
   *  - count: 최대 풀 크기만큼
   *  - radius: 바운스 영역
   *  - upwardBias: 위로 솟구치는 정도 (얼림은 강, 부스터는 약)
   *  - speed: 초기 속도 크기
   *  - lifeMul: 수명 배수
   */
  burst(
    center: THREE.Vector3,
    count: number,
    radius: number,
    upwardBias: number,
    speed: number,
    lifeMul: number = 1.0,
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      if (this.particles[i].active) continue;
      const p = this.particles[i];
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      p.position.set(
        center.x + Math.cos(angle) * r,
        0.4 + Math.random() * 0.6,
        center.z + Math.sin(angle) * r,
      );
      p.velocity.set(
        Math.cos(angle) * speed * (0.4 + Math.random() * 0.6),
        (0.5 + Math.random() * 0.5) * upwardBias,
        Math.sin(angle) * speed * (0.4 + Math.random() * 0.6),
      );
      p.life = this.lifetime * lifeMul;
      p.maxLife = this.lifetime * lifeMul;
      p.scale = 0.7 + Math.random() * 0.6;
      p.active = true;
      spawned++;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.material.dispose();
    // 2026-08-16: 인스턴스별 geometry dispose
    this.geometry.dispose();
  }
}
