import { describe, it, expect } from 'vitest';
import {
  rotationFromVelocity,
  wrapAngle,
  shortestAngle,
  chaseYawFromMovement,
  faceDirFromWorldDir,
  cameraMoveBasis,
  applyFaceDirFromWorldDir,
  firstPersonYawInput,
  shotAimXZ,
} from './direction';

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

    it('비유한 입력 (±Infinity/NaN) → 0 (while 무한루프 프리즈 방지)', () => {
      expect(wrapAngle(Infinity)).toBe(0);
      expect(wrapAngle(-Infinity)).toBe(0);
      expect(wrapAngle(NaN)).toBe(0);
    });

    it('여러 바퀴 초과 입력도 정규화', () => {
      expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
      expect(wrapAngle(-4 * Math.PI)).toBeCloseTo(0, 5);
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

  describe('chaseYawFromMovement', () => {
    it('미세 이동은 null (시작 떨림 방지)', () => {
      expect(chaseYawFromMovement(0.01, 0.01)).toBeNull();
    });

    it('카메라 yaw 0과 같은 -Z 진행은 yaw 0', () => {
      expect(chaseYawFromMovement(0, -1)).toBeCloseTo(0, 5);
    });

    it('+Z 진행은 ±π (카메라가 뒤를 봄)', () => {
      expect(Math.abs(chaseYawFromMovement(0, 1) ?? 0)).toBeCloseTo(Math.PI, 5);
    });
  });

  describe('first-person look vs mesh world direction', () => {
    // Three.js getWorldDirection = local +Z. Face (eyes) and PerspectiveCamera look = local -Z.
    // Using worldDir as move basis inverts W/joystick vs the view (mobile vs PC 체감 반전).

    it('spawn identity: worldDir +Z is the back; face/look is -Z', () => {
      const look = faceDirFromWorldDir(0, 0, 1);
      expect(look.x).toBeCloseTo(0);
      expect(look.y).toBeCloseTo(0);
      expect(look.z).toBeCloseTo(-1);
    });

    it('W / joystick-up along look goes -Z at spawn (into the camera view)', () => {
      const look = faceDirFromWorldDir(0, 0, 1);
      const b = cameraMoveBasis(look.x, look.z);
      expect(b.forwardX).toBeCloseTo(0);
      expect(b.forwardZ).toBeCloseTo(-1);
      expect(b.rightX).toBeCloseTo(1);
      expect(b.rightZ).toBeCloseTo(0);
    });

    it('in-place negate matches faceDirFromWorldDir', () => {
      const dir = { x: 0, y: 0, z: 1 };
      applyFaceDirFromWorldDir(dir);
      expect(dir.z).toBeCloseTo(-1);
    });
  });

  describe('firstPersonYawInput', () => {
    it('→ 는 음수 (addYaw- → 카메라가 화면 오른쪽/+X 를 봄)', () => {
      expect(firstPersonYawInput(false, true)).toBe(-1);
    });

    it('← 는 양수 (addYaw+ → 카메라가 화면 왼쪽/-X 를 봄)', () => {
      expect(firstPersonYawInput(true, false)).toBe(1);
    });

    it('양쪽 동시 입력은 0', () => {
      expect(firstPersonYawInput(true, true)).toBe(0);
    });
  });

  describe('shotAimXZ', () => {
    it('항상 캐릭터 정면(look)으로 쏜다 — 달리며 몸 돌린 뒤에도', () => {
      const east = shotAimXZ({ firstPerson: true, lookX: 1, lookZ: 0, camYaw: 0 });
      expect(east.x).toBeCloseTo(1, 5);
      expect(east.z).toBeCloseTo(0, 5);
      const east3p = shotAimXZ({ firstPerson: false, lookX: 1, lookZ: 0, camYaw: 0 });
      expect(east3p.x).toBeCloseTo(1, 5);
      expect(east3p.z).toBeCloseTo(0, 5);
    });

    it('스폰 시선(-Z)은 앞으로', () => {
      const dir = shotAimXZ({ firstPerson: true, lookX: 0, lookZ: -1, camYaw: 0 });
      expect(dir.x).toBeCloseTo(0, 5);
      expect(dir.z).toBeCloseTo(-1, 5);
    });

    it('camYaw는 무시된다 (카메라가 따로 돌아도 캐릭터 정면)', () => {
      const dir = shotAimXZ({ firstPerson: false, lookX: 1, lookZ: 0, camYaw: Math.PI / 2 });
      expect(dir.x).toBeCloseTo(1, 5);
      expect(dir.z).toBeCloseTo(0, 5);
    });

    it('대각 시선은 정규화된다', () => {
      const dir = shotAimXZ({ firstPerson: true, lookX: 1, lookZ: -1, camYaw: 0 });
      expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 5);
    });
  });
});
