// 순수 모듈 — 방향/회전 헬퍼
// Three.js Y-up 좌표계에서 velocity → quaternion 회전 계산

/**
 * 2D 진행 방향(vx, vz)으로 캐릭터가 바라봐야 할 Y축 회전각(rad) 반환
 *
 * - 캐릭터 FACE와 PerspectiveCamera look는 local -Z (눈/화살표가 -Z)
 * - Three.js getWorldDirection은 local +Z (등) — 이동 basis로 쓰면 앞뒤가 뒤집힘
 * - vx=0, vz=-1 (얼굴 방향) → 회전 0
 * - vx=1, vz=0 (동쪽 진행) → 회전 -π/2
 *
 * @returns 회전각 (radians), |속도|² < 1e-4 이면 0
 */
export function rotationFromVelocity(vx: number, vz: number): number {
  if (vx * vx + vz * vz < 1e-4) return 0;
  return Math.atan2(-vx, -vz);
}

/**
 * 각도를 -π ~ +π 범위로 정규화
 */
export function wrapAngle(angle: number): number {
  // 2026-08-25: 비유한 입력(±Infinity/NaN) 가드 — while 루프가 ±Infinity에서 빠져나오지 못해
  // 탭 프리즈로 이어짐. 회전 보간 특성상 안전한 0으로 수렴시킨다.
  if (!Number.isFinite(angle)) return 0;
  // -π ~ π 로 wrap
  const TAU = Math.PI * 2;
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/**
 * 두 각도 사이의 최단 회전 방향 (1 또는 -1) + 거리
 * 보간에 사용
 */
export function shortestAngle(from: number, to: number): { delta: number; abs: number } {
  const delta = wrapAngle(to - from);
  return { delta, abs: Math.abs(delta) };
}

/** Chase camera yaw: same convention as camera yaw 0 = facing -Z. Null if barely moving. */
export function chaseYawFromMovement(dx: number, dz: number, minDist = 0.05): number | null {
  if (dx * dx + dz * dz < minDist * minDist) return null;
  return rotationFromVelocity(dx, dz);
}

export interface XZBasis {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

/**
 * Mesh.getWorldDirection (local +Z / 등) → face + camera look (local -Z).
 * 1인칭 이동/카메라 offset은 이 방향을 써야 PC WASD와 모바일 스틱이 같다.
 */
export function faceDirFromWorldDir(
  wx: number,
  wy: number,
  wz: number,
): { x: number; y: number; z: number } {
  return { x: -wx, y: -wy, z: -wz };
}

/** Negate getWorldDirection in place so the vector is face/camera look. */
export function applyFaceDirFromWorldDir(dir: { x: number; y: number; z: number }): void {
  dir.x = -dir.x;
  dir.y = -dir.y;
  dir.z = -dir.z;
}

/**
 * Flatten look onto XZ and build camera-relative move basis.
 * look × worldUp → right. Looking -Z gives right = +X (D / 스틱 오른쪽).
 */
export function cameraMoveBasis(lookX: number, lookZ: number): XZBasis {
  const len = Math.hypot(lookX, lookZ);
  if (len < 1e-8) return { forwardX: 0, forwardZ: -1, rightX: 1, rightZ: 0 };
  const fx = lookX / len;
  const fz = lookZ / len;
  return { forwardX: fx, forwardZ: fz, rightX: -fz, rightZ: fx };
}

/**
 * 1인칭 ←/→ 키 → addYaw 부호.
 * addYaw(+)는 카메라 look을 왼쪽(-X)으로 돌림 (Y축 CCW).
 * → 키는 화면 오른쪽(+X)을 봐야 하므로 음수.
 */
export function firstPersonYawInput(left: boolean, right: boolean): number {
  return (left ? 1 : 0) - (right ? 1 : 0);
}
