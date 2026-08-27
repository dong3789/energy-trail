import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { attachWorldLabel, shouldAttachPlayerLabel } from './follow-label';

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

describe('shouldAttachPlayerLabel', () => {
  it('hides the local player nametag so it cannot fill the camera', () => {
    expect(
      shouldAttachPlayerLabel({ showPlayerLabels: true, isSelf: true, showSelfLabel: false }),
    ).toBe(false);
  });

  it('still shows other players when labels are on', () => {
    expect(
      shouldAttachPlayerLabel({ showPlayerLabels: true, isSelf: false, showSelfLabel: false }),
    ).toBe(true);
  });

  it('hides everyone when labels are globally off', () => {
    expect(
      shouldAttachPlayerLabel({ showPlayerLabels: false, isSelf: false, showSelfLabel: true }),
    ).toBe(false);
  });
});
