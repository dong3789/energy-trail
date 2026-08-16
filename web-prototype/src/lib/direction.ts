// 순수 모듈 — 방향/회전 헬퍼
// Three.js Y-up 좌표계에서 velocity → quaternion 회전 계산

/**
 * 2D 진행 방향(vx, vz)으로 캐릭터가 바라봐야 할 Y축 회전각(rad) 반환
 *
 * - 캐릭터 모델은 기본적으로 +Z 방향(전면)을 향함
 * - vx=0, vz=1 (북쪽 진행) → 회전 0
 * - vx=1, vz=0 (동쪽 진행) → 회전 -π/2 (오른쪽으로 90도)
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
