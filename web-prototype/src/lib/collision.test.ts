import { describe, it, expect } from 'vitest';
import { moveCircle, type Aabb } from './collision';

const bounds = { halfWidth: 20, halfDepth: 20 };
const box: Aabb = { x: 0, z: 0, width: 4, depth: 4 }; // covers x,z ∈ [-2, 2]

describe('moveCircle', () => {
  it('moves freely in open space', () => {
    const p = moveCircle(8, 8, 1, 0.5, 0.5, [], bounds);
    expect(p.x).toBeCloseTo(9);
    expect(p.z).toBeCloseTo(8.5);
  });

  it('stops before an AABB face instead of entering it', () => {
    // approach from +X, radius 0.5 → rest at x = 2.5
    const p = moveCircle(4, 0, -2, 0, 0.5, [box], bounds);
    expect(p.x).toBeCloseTo(2.5, 2);
    expect(p.z).toBeCloseTo(0, 2);
  });

  it('slides along a wall when the blocked axis would otherwise freeze both axes', () => {
    // sitting against the +X face, try to move into the box AND along Z
    const p = moveCircle(2.5, 0, -1, 1, 0.5, [box], bounds);
    expect(p.x).toBeCloseTo(2.5, 2);
    expect(p.z).toBeGreaterThan(0.5);
  });

  it('unsticks when already overlapping an AABB', () => {
    const p = moveCircle(1.8, 0, 0, 0, 0.5, [box], bounds);
    const dist = Math.hypot(p.x, p.z);
    expect(dist).toBeGreaterThanOrEqual(2.5 - 0.02);
  });

  it('clamps to map bounds', () => {
    const p = moveCircle(19.8, 0, 2, 0, 0.5, [], bounds);
    expect(p.x).toBeCloseTo(19.5, 5);
  });
});
