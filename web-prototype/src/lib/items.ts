import type { ObstacleSpec } from '../config';

export const ITEM_KINDS = [
  'jelly',
  'smoke',
  'sticky',
  'decoy',
  'magnet',
  'shield',
  'dash',
  'reversal',
  'rocket',
  'invis',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_META: Record<
  ItemKind,
  { label: string; color: number; emoji: string; hint: string }
> = {
  jelly: { label: '젤리', color: 0xff85c1, emoji: '🍬', hint: '잠깐 빨라짐' },
  smoke: { label: '연막', color: 0x9b59b6, emoji: '💨', hint: '화면 가득 안개' },
  sticky: { label: '끈끈이', color: 0xffd83d, emoji: '🍯', hint: '발밑에 둔덕' },
  decoy: { label: '분신', color: 0x7fd8ff, emoji: '🫥', hint: '술래가 분신을 쫓아요' },
  magnet: { label: '자석', color: 0xff6b9d, emoji: '🧲', hint: '주변 자국 흡수' },
  shield: { label: '방어막', color: 0x7dffb0, emoji: '🛡️', hint: '한 번 잡혀도 무효' },
  dash: { label: '대시', color: 0xffe14a, emoji: '⚡', hint: '즉시 점프' },
  reversal: { label: '반전', color: 0xb39dff, emoji: '🌀', hint: '술래 방향 혼란' },
  rocket: { label: '로켓', color: 0xff8c42, emoji: '🚀', hint: '2배 가속!' },
  invis: { label: '투명', color: 0xd0d0ff, emoji: '👻', hint: '술래에게 안 보임' },
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

export interface SpawnAvoid {
  x: number;
  z: number;
  r: number;
}

function hitsAvoid(x: number, z: number, avoid: readonly SpawnAvoid[]): boolean {
  for (const a of avoid) {
    const dx = x - a.x;
    const dz = z - a.z;
    if (dx * dx + dz * dz < a.r * a.r) return true;
  }
  return false;
}

function rectDistance(x: number, z: number, o: ObstacleSpec): number {
  const dx = Math.max(Math.abs(x - o.x) - o.width / 2, 0);
  const dz = Math.max(Math.abs(z - o.z) - o.depth / 2, 0);
  return Math.hypot(dx, dz);
}

export function pickClearPoint(
  obstacles: readonly ObstacleSpec[],
  halfWidth: number,
  halfDepth: number,
  rng: () => number,
  margin = 2,
  avoid: readonly SpawnAvoid[] = [],
): { x: number; z: number } {
  const pad = 4;
  let best: { x: number; z: number } | null = null;
  let bestClearance = -Infinity;
  for (let i = 0; i < 24; i++) {
    const x = (rng() * 2 - 1) * (halfWidth - pad);
    const z = (rng() * 2 - 1) * (halfDepth - pad);
    if (!pointHitsObstacle(x, z, obstacles, margin) && !hitsAvoid(x, z, avoid)) {
      return { x, z };
    }
    // 실패한 후보 중 가장 여유로운 지점을 기록 — 2026-08-25:
    // 24회 전부 실패 시 null을 반환해 아이템이 아예 스폰되지 않던 문제 방지 (밀집 맵)
    let clearance = Infinity;
    for (const o of obstacles) clearance = Math.min(clearance, rectDistance(x, z, o));
    for (const a of avoid) {
      clearance = Math.min(clearance, Math.hypot(x - a.x, z - a.z) - a.r);
    }
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = { x, z };
    }
  }
  return best ?? { x: 0, z: 0 };
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
