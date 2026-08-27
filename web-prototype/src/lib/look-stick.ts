/** Dual-stick look: displacement → axes, then axes → yaw/pitch rate. */

export const LOOK_STICK = {
  maxRadius: 64,
  deadzone: 0.14,
  /** Full-stick yaw, rad/s — a 1s hold turns ~143° (2026-08-26: 1.25 → 2.5, 갑갑함 개선). */
  yawRate: 2.5,
  pitchRate: 0.85,
} as const;

export function lookAxesFromDelta(
  dx: number,
  dy: number,
  maxRadius: number = LOOK_STICK.maxRadius,
  deadzone: number = LOOK_STICK.deadzone,
): { yaw: number; pitch: number } {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { yaw: 0, pitch: 0 };
  const clamped = Math.min(dist, maxRadius);
  const nx = (dx / dist) * (clamped / maxRadius);
  const ny = (dy / dist) * (clamped / maxRadius);
  const mag = Math.hypot(nx, ny);
  if (mag < deadzone) return { yaw: 0, pitch: 0 };
  const scaled = (mag - deadzone) / (1 - deadzone);
  const k = scaled / mag;
  return { yaw: nx * k, pitch: ny * k };
}

export function lookDeltaFromAxes(
  yawAxis: number,
  pitchAxis: number,
  dt: number,
  yawRate: number = LOOK_STICK.yawRate,
  pitchRate: number = LOOK_STICK.pitchRate,
): { dYaw: number; dPitch: number } {
  const t = Math.min(Math.max(dt, 0), 0.05);
  return {
    dYaw: -yawAxis * yawRate * t,
    dPitch: pitchAxis * pitchRate * t,
  };
}

/**
 * First-person mesh yaw from look-stick axis.
 * Stick right → negative addYaw. addYaw(+) turns camera look left (Y-axis CCW),
 * so the sign matches lookDeltaFromAxes.dYaw (3rd-person orbit look-right).
 */
export function firstPersonYawFromLookAxes(
  yawAxis: number,
  dt: number,
  yawRate: number = LOOK_STICK.yawRate,
): number {
  const t = Math.min(Math.max(dt, 0), 0.05);
  return -yawAxis * yawRate * t;
}

/** Left-stick pointer delta → WASD-equivalent axes. Screen Y+ is down, so up = forward. */
export function moveAxesFromPointerDelta(
  dx: number,
  dy: number,
  maxDist: number,
  deadzone = 0.08,
): { forward: number; right: number } {
  if (!(maxDist > 0) || !Number.isFinite(maxDist)) return { forward: 0, right: 0 };
  const dist = Math.hypot(dx, dy);
  let nx = dx;
  let ny = dy;
  if (dist > maxDist && dist > 1e-6) {
    nx = (dx / dist) * maxDist;
    ny = (dy / dist) * maxDist;
  }
  const forward = -ny / maxDist;
  const right = nx / maxDist;
  return {
    forward: Math.abs(forward) < deadzone ? 0 : forward,
    right: Math.abs(right) < deadzone ? 0 : right,
  };
}
