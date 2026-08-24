import { describe, it, expect } from 'vitest';
import { LOOK_STICK, lookAxesFromDelta, lookDeltaFromAxes } from './look-stick';

describe('lookAxesFromDelta', () => {
  it('zero delta is idle', () => {
    expect(lookAxesFromDelta(0, 0)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('tiny thumb jitter inside deadzone is idle', () => {
    const r = LOOK_STICK.maxRadius * (LOOK_STICK.deadzone * 0.4);
    expect(lookAxesFromDelta(r, 0)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('full right is yaw +1', () => {
    const a = lookAxesFromDelta(LOOK_STICK.maxRadius, 0);
    expect(a.yaw).toBeCloseTo(1, 5);
    expect(a.pitch).toBeCloseTo(0, 5);
  });

  it('clamps past the rim', () => {
    const a = lookAxesFromDelta(LOOK_STICK.maxRadius * 4, 0);
    expect(a.yaw).toBeCloseTo(1, 5);
  });

  it('down is positive pitch (finger down = look down)', () => {
    const a = lookAxesFromDelta(0, LOOK_STICK.maxRadius);
    expect(a.pitch).toBeCloseTo(1, 5);
    expect(a.yaw).toBeCloseTo(0, 5);
  });
});

describe('lookDeltaFromAxes', () => {
  it('right stick looks right (negative yaw, matching drag)', () => {
    const d = lookDeltaFromAxes(1, 0, 0.05);
    expect(d.dYaw).toBeCloseTo(-LOOK_STICK.yawRate * 0.05, 8);
    expect(d.dPitch).toBe(0);
  });

  it('caps a hitch so one frame cannot whip the camera', () => {
    const capped = lookDeltaFromAxes(1, 0, 1);
    const atCap = lookDeltaFromAxes(1, 0, 0.05);
    expect(capped.dYaw).toBeCloseTo(atCap.dYaw, 8);
  });

  it('idle axes do not rotate', () => {
    const d = lookDeltaFromAxes(0, 0, 0.016);
    expect(d.dYaw).toBeCloseTo(0, 8);
    expect(d.dPitch).toBeCloseTo(0, 8);
  });
});
