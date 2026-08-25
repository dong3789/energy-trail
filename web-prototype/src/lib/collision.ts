export interface Aabb {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface MapBounds {
  halfWidth: number;
  halfDepth: number;
}

/**
 * Circle (XZ) vs AABB walls. Pushes out of overlaps so a character
 * slides along a face instead of freezing when both axes are blocked.
 */
export function moveCircle(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  obstacles: readonly Aabb[],
  bounds: MapBounds,
): { x: number; z: number } {
  // 2026-08-25: 서브스텝 충돌 — 한 프레임 이동량이 장애물 두께+반지름을 넘으면
  // 목적지만 검사하는 기존 방식으론 얇은 벽을 통과한다(tunneling).
  // 반지름 절반 이하 간격으로 이동을 쪼개 각 구간마다 충돌을 해소한다.
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
  const sdx = dx / steps;
  const sdz = dz / steps;
  let nx = x;
  let nz = z;
  const maxX = Math.max(0, bounds.halfWidth - radius);
  const maxZ = Math.max(0, bounds.halfDepth - radius);

  const clamp = (): void => {
    nx = Math.max(-maxX, Math.min(maxX, nx));
    nz = Math.max(-maxZ, Math.min(maxZ, nz));
  };

  for (let s = 0; s < steps; s++) {
    nx += sdx;
    nz += sdz;
    clamp();

    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      for (const o of obstacles) {
        const oxMin = o.x - o.width / 2;
        const oxMax = o.x + o.width / 2;
        const ozMin = o.z - o.depth / 2;
        const ozMax = o.z + o.depth / 2;
        const cx = Math.max(oxMin, Math.min(nx, oxMax));
        const cz = Math.max(ozMin, Math.min(nz, ozMax));
        const vx = nx - cx;
        const vz = nz - cz;
        const d2 = vx * vx + vz * vz;

        if (d2 < 1e-12) {
          const left = nx - oxMin;
          const right = oxMax - nx;
          const south = nz - ozMin;
          const north = ozMax - nz;
          const min = Math.min(left, right, south, north);
          if (min === left) nx = oxMin - radius;
          else if (min === right) nx = oxMax + radius;
          else if (min === south) nz = ozMin - radius;
          else nz = ozMax + radius;
          pushed = true;
          continue;
        }

        const d = Math.sqrt(d2);
        if (d < radius) {
          const push = (radius - d) / d;
          nx += vx * push;
          nz += vz * push;
          pushed = true;
        }
      }
      clamp();
      if (!pushed) break;
    }
  }

  return { x: nx, z: nz };
}
