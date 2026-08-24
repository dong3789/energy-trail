export function nearestIndex(
  ox: number,
  oz: number,
  points: readonly { x: number; z: number }[],
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - ox;
    const dz = points[i].z - oz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = i;
    }
  }
  return best;
}

export function netCatchRadius(
  traveled: number,
  range: number,
  minR: number,
  maxR: number,
): number {
  if (range <= 0) return maxR;
  const t = Math.min(1, Math.max(0, traveled / range));
  return minR + (maxR - minR) * t;
}

export function pickStickyPoint<T extends { x: number; z: number }>(
  ox: number,
  oz: number,
  points: readonly T[],
  current: T | undefined,
  switchMargin: number,
): T | undefined {
  const ni = nearestIndex(ox, oz, points);
  if (ni < 0) return undefined;
  const nearest = points[ni];
  if (!current) return nearest;
  const dCur = Math.hypot(current.x - ox, current.z - oz);
  const dNear = Math.hypot(nearest.x - ox, nearest.z - oz);
  if (dNear + switchMargin < dCur) return nearest;
  return current;
}

export function headingAway(
  ox: number,
  oz: number,
  fromX: number,
  fromZ: number,
): { x: number; z: number } | null {
  const dx = ox - fromX;
  const dz = oz - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return null;
  return { x: dx / len, z: dz / len };
}

export function withinDistance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  distance: number,
): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= distance * distance;
}

export function contactsInRange<T extends { x: number; z: number }>(
  ox: number,
  oz: number,
  points: readonly T[],
  distance: number,
): T[] {
  return points.filter((p) => withinDistance(ox, oz, p.x, p.z, distance));
}
