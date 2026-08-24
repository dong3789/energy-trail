/** Dual-stick look: displacement → axes, then axes → yaw/pitch rate. */

export const LOOK_STICK = {
  maxRadius: 64,
  deadzone: 0.14,
  /** Full-stick yaw, rad/s — a 1s hold turns ~72°. */
  yawRate: 1.25,
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
