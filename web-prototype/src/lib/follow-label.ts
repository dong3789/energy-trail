import type { Object3D } from 'three';

/** Parent a label to a character mesh so it follows world motion. */
export function attachWorldLabel(label: Object3D, mesh: Object3D, offsetY: number): void {
  label.position.set(0, offsetY, 0);
  mesh.add(label);
}
