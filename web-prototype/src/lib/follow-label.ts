import type { Object3D } from 'three';

/** Parent a label to a character mesh so it follows world motion. */
export function attachWorldLabel(label: Object3D, mesh: Object3D, offsetY: number): void {
  label.position.set(0, offsetY, 0);
  mesh.add(label);
}

/** Local nametag is a 2.4m sprite — hide it in first person so it cannot fill the camera. */
export function shouldAttachPlayerLabel(opts: {
  showPlayerLabels: boolean;
  isSelf: boolean;
  showSelfLabel: boolean;
}): boolean {
  if (!opts.showPlayerLabels) return false;
  if (opts.isSelf && !opts.showSelfLabel) return false;
  return true;
}
