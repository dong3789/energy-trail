import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { attachWorldLabel } from './follow-label';

describe('attachWorldLabel', () => {
  it('label world position tracks the mesh after a move', () => {
    const mesh = new THREE.Object3D();
    mesh.position.set(0, 1, 0);
    const label = new THREE.Object3D();
    const offsetY = 1.4;
    attachWorldLabel(label, mesh, offsetY);

    mesh.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    label.getWorldPosition(world);
    expect(world.x).toBeCloseTo(0);
    expect(world.y).toBeCloseTo(1 + offsetY);
    expect(world.z).toBeCloseTo(0);

    mesh.position.set(5, 1, -3);
    mesh.updateMatrixWorld(true);
    label.getWorldPosition(world);
    expect(world.x).toBeCloseTo(5);
    expect(world.y).toBeCloseTo(1 + offsetY);
    expect(world.z).toBeCloseTo(-3);
  });
});
