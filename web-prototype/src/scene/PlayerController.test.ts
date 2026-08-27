import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from './PlayerController';

function makePlayer(): { player: PlayerController; mesh: THREE.Mesh } {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const player = new PlayerController({
    scene,
    mesh,
    obstacles: [],
    mapHalfWidth: 20,
    mapHalfDepth: 20,
  });
  player.setFirstPersonMode(true);
  return { player, mesh };
}

function cameraLookX(mesh: THREE.Object3D): number {
  const cam = new THREE.PerspectiveCamera();
  cam.quaternion.copy(mesh.quaternion);
  cam.updateMatrixWorld(true);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  return dir.x;
}

describe('PlayerController first-person arrows', () => {
  const listeners: PlayerController[] = [];

  afterEach(() => {
    for (const p of listeners) p.dispose();
    listeners.length = 0;
  });

  it('ArrowRight turns the camera look toward +X (screen right)', () => {
    const { player, mesh } = makePlayer();
    listeners.push(player);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    player.update(0.5);
    expect(cameraLookX(mesh)).toBeGreaterThan(0.5);
  });

  it('ArrowLeft turns the camera look toward -X (screen left)', () => {
    const { player, mesh } = makePlayer();
    listeners.push(player);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    player.update(0.5);
    expect(cameraLookX(mesh)).toBeLessThan(-0.5);
  });

  it('ArrowUp moves into the camera view (-Z at spawn)', () => {
    const { player, mesh } = makePlayer();
    listeners.push(player);
    player.setMoveBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    const z0 = mesh.position.z;
    player.update(0.25);
    expect(mesh.position.z).toBeLessThan(z0);
  });
});
