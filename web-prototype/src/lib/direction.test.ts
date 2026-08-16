import { describe, it, expect } from 'vitest';
import { rotationFromVelocity, wrapAngle, shortestAngle } from './direction';

describe('direction', () => {
  describe('rotationFromVelocity', () => {
    // 컨벤션: 캐릭터는 기본적으로 -Z를 바라봄 (Three.js 모델).
    // 진행 방향이 -Z이면 회전 0, +Z이면 회전 π (반대편).

    it('정지 (0,0) → 0', () => {
      expect(rotationFromVelocity(0, 0)).toBe(0);
    });

    it('매우 작은 속도 → 0 (epsilon 처리)', () => {
      expect(rotationFromVelocity(1e-6, 1e-6)).toBe(0);
    });

    it('남쪽 진행 (0, -1) → 0 (정면, -Z)', () => {
      expect(rotationFromVelocity(0, -1)).toBeCloseTo(0, 5);
    });

    it('동쪽 진행 (1, 0) → -π/2 (오른쪽 90도)', () => {
      expect(rotationFromVelocity(1, 0)).toBeCloseTo(-Math.PI / 2, 5);
    });

    it('북쪽 진행 (0, 1) → ±π (반대편, +Z, signed-zero 영향으로 부호 흔들림)', () => {
      // atan2(-0, -1) = -π in JS, atan2(0, -1) = +π. 180° 회전은 부호 무관.
      expect(Math.abs(rotationFromVelocity(0, 1))).toBeCloseTo(Math.PI, 5);
    });

    it('서쪽 진행 (-1, 0) → π/2 (왼쪽 90도)', () => {
      expect(rotationFromVelocity(-1, 0)).toBeCloseTo(Math.PI / 2, 5);
    });

    it('속도 크기와 무관 (정규화 효과)', () => {
      const a = rotationFromVelocity(0, -5);
      const b = rotationFromVelocity(0, -1);
      expect(a).toBeCloseTo(b, 5);
    });

    it('대각선 (1, 1) → -3π/4 (NE)', () => {
      expect(rotationFromVelocity(1, 1)).toBeCloseTo((-3 * Math.PI) / 4, 5);
    });
  });

  describe('wrapAngle', () => {
    it('이미 -π~π 범위면 그대로', () => {
      expect(wrapAngle(0)).toBe(0);
      expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 5);
      expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 5);
    });

    it('π 보다 크면 wrap', () => {
      expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 5);
    });

    it('-π 보다 작으면 wrap', () => {
      expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 5);
    });

    it('2π → 0', () => {
      expect(wrapAngle(2 * Math.PI)).toBeCloseTo(0, 5);
    });
  });

  describe('shortestAngle', () => {
    it('이미 최단 (0 → π/2) → delta=π/2', () => {
      const r = shortestAngle(0, Math.PI / 2);
      expect(r.delta).toBeCloseTo(Math.PI / 2, 5);
      expect(r.abs).toBeCloseTo(Math.PI / 2, 5);
    });

    it('직접 거리 vs 반대 거리 — 더 짧은 쪽 선택', () => {
      // 0 → 3π/4: 직접 = 3π/4, 반대 = 5π/4. 직접이 더 짧음.
      const r = shortestAngle(0, (3 * Math.PI) / 4);
      expect(r.abs).toBeCloseTo((3 * Math.PI) / 4, 5);
    });

    it('반대편은 최단 (3π/2 → π/2 → -π/2) 가 짧음', () => {
      // 0 → -π/2: 직접 -π/2, 반대 +3π/2. 직접이 더 짧음.
      const r1 = shortestAngle(0, -Math.PI / 2);
      expect(r1.abs).toBeCloseTo(Math.PI / 2, 5);

      // 0 → 3π/2: 직접 +3π/2, 반대 -π/2. 반대가 더 짧음.
      const r2 = shortestAngle(0, (3 * Math.PI) / 2);
      expect(r2.abs).toBeCloseTo(Math.PI / 2, 5);
      expect(r2.delta).toBeLessThan(0); // 음수 = 최단이 반대 방향
    });
  });
});
