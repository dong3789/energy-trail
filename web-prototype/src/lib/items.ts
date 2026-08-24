import type { ObstacleSpec } from '../config';

export const ITEM_KINDS = ['jelly', 'smoke', 'sticky'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_META: Record<
  ItemKind,
  { label: string; color: number; emoji: string; hint: string }
> = {
  jelly: { label: '젤리', color: 0xff85c1, emoji: '🍬', hint: '잠깐 빨라짐' },
  smoke: { label: '연막', color: 0x9b59b6, emoji: '💨', hint: '술래 시야에서 숨기' },
  sticky: { label: '끈끈이', color: 0xffd83d, emoji: '🍯', hint: '발밑에 둔덕' },
};

export interface GroundItem {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
}

export function pointHitsObstacle(
  x: number,
  z: number,
  obstacles: readonly ObstacleSpec[],
  margin: number,
): boolean {
  for (const o of obstacles) {
    const hx = o.width / 2 + margin;
    const hz = o.depth / 2 + margin;
    if (x >= o.x - hx && x <= o.x + hx && z >= o.z - hz && z <= o.z + hz) return true;
  }
  return false;
}

export function pickClearPoint(
  obstacles: readonly ObstacleSpec[],
  halfWidth: number,
  halfDepth: number,
  rng: () => number,
  margin = 2,
): { x: number; z: number } | null {
  const pad = 4;
  for (let i = 0; i < 24; i++) {
    const x = (rng() * 2 - 1) * (halfWidth - pad);
    const z = (rng() * 2 - 1) * (halfDepth - pad);
    if (!pointHitsObstacle(x, z, obstacles, margin)) return { x, z };
  }
  return null;
}

export function nearestGroundItem(
  items: readonly GroundItem[],
  x: number,
  z: number,
  radius: number,
): GroundItem | null {
  let best: GroundItem | null = null;
  let bestD = radius * radius;
  for (const item of items) {
    const dx = item.x - x;
    const dz = item.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD) {
      bestD = d2;
      best = item;
    }
  }
  return best;
}

export class ItemBag {
  held: ItemKind | null = null;

  take(kind: ItemKind): ItemKind | null {
    const prev = this.held;
    this.held = kind;
    return prev;
  }

  use(): ItemKind | null {
    const kind = this.held;
    this.held = null;
    return kind;
  }
}
