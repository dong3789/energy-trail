import { describe, it, expect } from 'vitest';
import { cameraMoveBasis, faceDirFromWorldDir } from './direction';
import {
  LOOK_STICK,
  lookAxesFromDelta,
  lookDeltaFromAxes,
  firstPersonYawFromLookAxes,
  moveAxesFromPointerDelta,
} from './look-stick';

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

describe('firstPersonYawFromLookAxes', () => {
  it('stick right is negative addYaw (camera look goes +X / screen right)', () => {
    const d = firstPersonYawFromLookAxes(1, 0.05);
    expect(d).toBeCloseTo(-LOOK_STICK.yawRate * 0.05, 8);
    expect(d).toBeLessThan(0);
  });

  it('matches orbit camState dYaw — both look right with the same sign', () => {
    const orbit = lookDeltaFromAxes(1, 0, 0.05);
    const fp = firstPersonYawFromLookAxes(1, 0.05);
    expect(fp).toBeCloseTo(orbit.dYaw, 8);
  });
});

describe('moveAxesFromPointerDelta', () => {
  it('finger up (negative dy) is forward, same as W', () => {
    const a = moveAxesFromPointerDelta(0, -64, 64);
    expect(a.forward).toBeCloseTo(1, 5);
    expect(a.right).toBeCloseTo(0, 5);
  });

  it('finger right is +right, same as D', () => {
    const a = moveAxesFromPointerDelta(64, 0, 64);
    expect(a.right).toBeCloseTo(1, 5);
    expect(a.forward).toBeCloseTo(0, 5);
  });

  it('finger down is backward, same as S', () => {
    const a = moveAxesFromPointerDelta(0, 64, 64);
    expect(a.forward).toBeCloseTo(-1, 5);
  });
});

describe('mobile stick vs PC WASD at spawn', () => {
  it('stick up moves into the camera view (-Z), not the back (+Z)', () => {
    const look = faceDirFromWorldDir(0, 0, 1);
    const b = cameraMoveBasis(look.x, look.z);
    const stick = moveAxesFromPointerDelta(0, -64, 64);
    const vx = b.forwardX * stick.forward + b.rightX * stick.right;
    const vz = b.forwardZ * stick.forward + b.rightZ * stick.right;
    expect(vx).toBeCloseTo(0, 5);
    expect(vz).toBeCloseTo(-1, 5);
  });

  it('stick right strafes +X (screen right when looking -Z)', () => {
    const look = faceDirFromWorldDir(0, 0, 1);
    const b = cameraMoveBasis(look.x, look.z);
    const stick = moveAxesFromPointerDelta(64, 0, 64);
    const vx = b.forwardX * stick.forward + b.rightX * stick.right;
    const vz = b.forwardZ * stick.forward + b.rightZ * stick.right;
    expect(vx).toBeCloseTo(1, 5);
    expect(vz).toBeCloseTo(0, 5);
  });
});
