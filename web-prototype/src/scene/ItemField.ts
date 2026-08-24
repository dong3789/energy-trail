import * as THREE from 'three';
import { GAME, type ObstacleSpec } from '../config';
import {
  ITEM_KINDS,
  ITEM_META,
  ItemBag,
  nearestGroundItem,
  pickClearPoint,
  type GroundItem,
  type ItemKind,
} from '../lib/items';

interface Spawned {
  data: GroundItem;
  mesh: THREE.Mesh;
  respawnAt: number;
}

interface StickyZone {
  x: number;
  z: number;
  until: number;
  mesh: THREE.Mesh;
}

export class ItemField {
  readonly bag = new ItemBag();
  private readonly scene: THREE.Scene;
  private readonly obstacles: readonly ObstacleSpec[];
  private readonly halfW: number;
  private readonly halfD: number;
  private readonly spawned: Spawned[] = [];
  private readonly stickies: StickyZone[] = [];
  private nextId = 1;
  private readonly geom: THREE.SphereGeometry;
  private readonly stickyGeom: THREE.CircleGeometry;
  private time = 0;

  constructor(opts: {
    scene: THREE.Scene;
    obstacles: readonly ObstacleSpec[];
    halfWidth: number;
    halfDepth: number;
  }) {
    this.scene = opts.scene;
    this.obstacles = opts.obstacles;
    this.halfW = opts.halfWidth;
    this.halfD = opts.halfDepth;
    this.geom = new THREE.SphereGeometry(0.38, 12, 10);
    this.stickyGeom = new THREE.CircleGeometry(GAME.itemStickyRadius, 16);
    for (let i = 0; i < GAME.itemSpawnCount; i++) this.spawnNow();
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.spawned) {
      if (s.respawnAt > 0 && this.time >= s.respawnAt) {
        this.place(s);
      }
      if (s.respawnAt === 0) {
        s.mesh.position.y = 0.55 + Math.sin(this.time * 3 + s.data.id) * 0.12;
        s.mesh.rotation.y += dt * 1.6;
      }
    }
    for (let i = this.stickies.length - 1; i >= 0; i--) {
      const z = this.stickies[i];
      if (this.time >= z.until) {
        this.scene.remove(z.mesh);
        (z.mesh.material as THREE.Material).dispose();
        this.stickies.splice(i, 1);
      }
    }
  }

  tryPickup(x: number, z: number): ItemKind | null {
    const live = this.spawned.filter((s) => s.respawnAt === 0).map((s) => s.data);
    const hit = nearestGroundItem(live, x, z, GAME.itemPickupRadius);
    if (!hit) return null;
    const slot = this.spawned.find((s) => s.data.id === hit.id);
    if (!slot) return null;
    slot.respawnAt = this.time + GAME.itemRespawnSeconds;
    slot.mesh.visible = false;
    this.bag.take(hit.kind);
    return hit.kind;
  }

  useHeld(): ItemKind | null {
    return this.bag.use();
  }

  dropSticky(x: number, z: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: ITEM_META.sticky.color,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.stickyGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.stickies.push({ x, z, until: this.time + GAME.itemStickyDuration, mesh });
  }

  isInSticky(x: number, z: number): boolean {
    const r2 = GAME.itemStickyRadius * GAME.itemStickyRadius;
    for (const s of this.stickies) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  dispose(): void {
    for (const s of this.spawned) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    for (const z of this.stickies) {
      this.scene.remove(z.mesh);
      (z.mesh.material as THREE.Material).dispose();
    }
    this.geom.dispose();
    this.stickyGeom.dispose();
    this.spawned.length = 0;
    this.stickies.length = 0;
  }

  private spawnNow(): void {
    const kind = ITEM_KINDS[this.spawned.length % ITEM_KINDS.length];
    const slot: Spawned = {
      data: { id: this.nextId++, kind, x: 0, z: 0 },
      mesh: new THREE.Mesh(
        this.geom,
        new THREE.MeshStandardMaterial({
          color: ITEM_META[kind].color,
          emissive: ITEM_META[kind].color,
          emissiveIntensity: 0.55,
          roughness: 0.35,
        }),
      ),
      respawnAt: 0,
    };
    slot.mesh.castShadow = true;
    this.scene.add(slot.mesh);
    this.spawned.push(slot);
    this.place(slot);
  }

  private place(slot: Spawned): void {
    const p = pickClearPoint(this.obstacles, this.halfW, this.halfD, Math.random);
    if (!p) {
      slot.mesh.visible = false;
      slot.respawnAt = this.time + 2;
      return;
    }
    slot.data.x = p.x;
    slot.data.z = p.z;
    slot.mesh.position.set(p.x, 0.55, p.z);
    slot.mesh.visible = true;
    slot.respawnAt = 0;
  }
}
