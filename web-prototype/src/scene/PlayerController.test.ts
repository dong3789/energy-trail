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

describe('PlayerController input smoothing', () => {
  const listeners: PlayerController[] = [];

  afterEach(() => {
    for (const p of listeners) p.dispose();
    listeners.length = 0;
  });

  it('input → full speed in the same wall-clock time at 30fps and 60fps', () => {
    const timeToFull = (dt: number): number => {
      const { player, mesh } = makePlayer();
      listeners.push(player);
      player.setInput(1, 0);
      player.setMoveBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
      const fullStep = dt * 6.3; // run tier: 4.5 × 1.4
      let t = 0;
      let lastLen = 0;
      for (let i = 0; i < 600; i++) {
        player.update(dt);
        t += dt;
        const len = Math.hypot(mesh.position.x, mesh.position.z);
        if (lastLen > 0 && len - lastLen >= fullStep * 0.99) break;
        lastLen = len;
      }
      return t;
    };
    // 프레임 보정 전엔 60fps가 30fps의 2배 시간이 걸렸다 — 이제 거의 동일
    const t30 = timeToFull(1 / 30);
    const t60 = timeToFull(1 / 60);
    expect(Math.abs(t30 - t60)).toBeLessThan(0.15);
  });
});

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
