import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TaggerAI } from './TaggerAI';

describe('TaggerAI (술래 AI 추격)', () => {
  let mesh: THREE.Mesh;
  let target: THREE.Mesh;
  let ai: TaggerAI;

  beforeEach(() => {
    mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), new THREE.MeshBasicMaterial());
    target = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), new THREE.MeshBasicMaterial());
    // AI가 (0,0,0)에 있고 target이 (1,0,0)에 있음 → +X 방향으로 이동해야 함
    mesh.position.set(0, 0, 0);
    target.position.set(1, 0, 0);
    ai = new TaggerAI({
      mesh,
      obstacles: [],
      mapHalfWidth: 100,
      mapHalfDepth: 100,
      target,
    });
  });

  describe('update() — target 추적', () => {
    it('target이 +X에 있으면 +X 방향으로 이동', () => {
      ai.update(0.5);
      // 0.5초 후 X 위치가 양수여야 함
      expect(mesh.position.x).toBeGreaterThan(0);
    });

    it('target이 -X에 있으면 -X 방향으로 이동', () => {
      target.position.set(-1, 0, 0);
      ai.update(0.5);
      expect(mesh.position.x).toBeLessThan(0);
    });

    it('target이 -Z에 있으면 -Z 방향으로 이동', () => {
      target.position.set(0, 0, -1);
      ai.update(0.5);
      expect(mesh.position.z).toBeLessThan(0);
    });

    it('target이 +Z에 있으면 +Z 방향으로 이동', () => {
      target.position.set(0, 0, 1);
      ai.update(0.5);
      expect(mesh.position.z).toBeGreaterThan(0);
    });
  });

  describe('회전 (회전 공식 정합성)', () => {
    // 2026-08-16 BUG 픽스: atan2(hx, hz) → atan2(-hx, -hz)
    // - 캐릭터 모델은 -Z가 정면
    // - heading이 (0,-1)일 때 회전 0 (정면)
    // - 이전 잘못된 공식은 heading (0,-1)일 때 π 회전 → 등 돌림

    it('heading=(0,-1) (target at -Z) → 회전 0 (정면)', () => {
      // heading을 (0,-1)로 강제 (AI가 -Z로 추적 중)
      target.position.set(0, 0, -1);
      ai.update(0.01);
      // Euler Y 회전: 0 = 정면(-Z)
      const angle = Math.atan2(-mesh.quaternion.x, -mesh.quaternion.z) * 2;
      // slerp로 인해 정확히 0은 아닐 수 있지만, |angle| < π/2 (정면 부근)여야 함
      // 0 또는 ±π 둘 다 정면(-Z)을 의미
      // → 잘못된 공식을 쓰면 angle ≈ π
      const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
      // euler.y는 0 근처여야 함 (정면 -Z)
      expect(Math.abs(euler.y)).toBeLessThan(0.1); // 정면 (Y=0)에 가까움
    });

    it('heading=(1,0) (target at +X) → 회전 -π/2 (오른쪽)', () => {
      target.position.set(1, 0, 0);
      ai.update(0.01);
      const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
      // -Z 정면이 +X를 보려면 -π/2 회전
      // (오른쪽으로 90도 회전)
      // euler.y는 -π/2 근처 (정확히 안 맞아도 정면 ~+X 부근)
      // slerp로 인해 정확하진 않지만, π/2 와 π/2 사이 (오른쪽) 영역
      expect(euler.y).toBeGreaterThan(-Math.PI);
      expect(euler.y).toBeLessThan(0);
    });
  });

  describe('setFrozen()', () => {
    it('얼림 중에는 이동 안 함', () => {
      const before = mesh.position.clone();
      ai.setFrozen(true);
      ai.update(0.5);
      expect(mesh.position.x).toBe(before.x);
      expect(mesh.position.z).toBe(before.z);
    });

    it('얼림 해제 후 다시 이동', () => {
      ai.setFrozen(true);
      ai.update(0.5);
      const beforeUnfreeze = mesh.position.clone();
      ai.setFrozen(false);
      ai.update(0.5);
      // position이 바뀌었어야 함 (target 추적)
      expect(mesh.position.x !== beforeUnfreeze.x || mesh.position.z !== beforeUnfreeze.z).toBe(
        true,
      );
    });
  });

  describe('맵 경계 보정', () => {
    it('맵 가장자리에 도달하면 안쪽으로 방향 보정', () => {
      // 작은 맵 + 가장자리 배치
      const smallAI = new TaggerAI({
        mesh,
        obstacles: [],
        mapHalfWidth: 5,
        mapHalfDepth: 5,
        target: new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1), new THREE.MeshBasicMaterial()),
      });
      // 타겟을 가장자리 너머에 두기
      (smallAI as unknown as { target: THREE.Object3D }).target.position.set(100, 0, 0);
      // AI는 (0,0,0) → 타겟 방향 +X → 가장자리 보정
      // update 한 번 호출
      smallAI.update(0.1);
      // mesh가 가장자리 근처에 머물러야 함 (안쪽으로 보정)
      expect(Math.abs(mesh.position.x)).toBeLessThan(5);
    });
  });
});
