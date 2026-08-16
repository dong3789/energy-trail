// 맵 빌더 (Vibe D: 로우폴리 데이라이트) — 2026-08-15 v28
// - 바닥: 잔디 (그냥 매트 매트리얼)
// - 외곽벽: 낮은 베이지/크림
// - 장애물: 크림 박스
// - 외곽: 오렌지/크림 빌딩 + 다크 그린 나무
// - 비/네온/반사/사인 전부 OFF

import * as THREE from 'three';
import { MAP, OBSTACLES_BY_MAP, type MapDef, type ObstacleSpec } from '../config';

export interface TreeRefs {
  meshes: THREE.Mesh[];
}

export interface MapRefs {
  floor: THREE.Object3D;
  walls: THREE.Mesh[];
  obstacles: THREE.Mesh[];
  obstaclesData: readonly ObstacleSpec[];
  buildings: THREE.Mesh[];
  trees: TreeRefs;
}

/**
 * 2026-08-16: 맵 자원 일괄 해제
 * - buildMap()이 생성한 모든 geometry/material을 dispose
 * - teardownGame에서 호출 → GPU 메모리 누수 방지
 */
function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((m) => m.dispose());
  } else {
    material.dispose();
  }
}

export function disposeMap(mapRefs: MapRefs): void {
  // Floor
  if (mapRefs.floor instanceof THREE.Mesh) {
    mapRefs.floor.geometry.dispose();
    disposeMaterial(mapRefs.floor.material);
  }
  // Walls
  mapRefs.walls.forEach((m) => {
    m.geometry.dispose();
    disposeMaterial(m.material);
  });
  // Obstacles
  mapRefs.obstacles.forEach((m) => {
    m.geometry.dispose();
    disposeMaterial(m.material);
  });
  // Buildings
  mapRefs.buildings.forEach((m) => {
    m.geometry.dispose();
    // building.add(win) 형태로 자식 mesh 포함 → traverse로 자식도 dispose
    m.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        disposeMaterial(child.material);
      }
    });
  });
  // Trees
  mapRefs.trees.meshes.forEach((m) => {
    m.geometry.dispose();
    disposeMaterial(m.material);
  });
}

// 외곽벽 바깥에 배치될 빌딩 사양 (v28: 낮고 단정한 주택)
interface BuildingSpec {
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

const BUILDING_OFFSET = 3.5; // 외곽벽에서 바깥으로
const BUILDING_BASE_HEIGHT = 4; // v28: 12 → 4 (낮은 주택)
const BUILDING_HEIGHT_VAR = 2; // ±2m

export function buildMap(scene: THREE.Scene, mapDef: MapDef): MapRefs {
  // === 바닥 (잔디) ===
  // v28: MeshLambertMaterial (단순, 반사 없음, 데이라이트에 자연스러움)
  const floorGeometry = new THREE.PlaneGeometry(MAP.width, MAP.depth);
  const floorMaterial = new THREE.MeshLambertMaterial({
    color: mapDef.groundColor,
  });
  const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // === 외곽벽 (낮은 크림/베이지) ===
  const wallMaterial = new THREE.MeshLambertMaterial({
    color: mapDef.wallColor,
  });

  const halfW = MAP.width / 2;
  const halfD = MAP.depth / 2;
  const H = MAP.wallHeight;
  const T = MAP.wallThickness;

  const wallSpecs: Array<{ w: number; h: number; d: number; pos: [number, number, number] }> = [
    { w: MAP.width + T * 2, h: H, d: T, pos: [0, H / 2, -halfD - T / 2] },
    { w: MAP.width + T * 2, h: H, d: T, pos: [0, H / 2, halfD + T / 2] },
    { w: T, h: H, d: MAP.depth, pos: [halfW + T / 2, H / 2, 0] },
    { w: T, h: H, d: MAP.depth, pos: [-halfW - T / 2, H / 2, 0] },
  ];

  const walls: THREE.Mesh[] = [];
  for (const spec of wallSpecs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), wallMaterial);
    mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    walls.push(mesh);
  }

  // === 내벽 장애물 (맵별) ===
  const obstacles = OBSTACLES_BY_MAP[mapDef.id];

  const obstacleMaterial = new THREE.MeshLambertMaterial({
    color: mapDef.obstacleColor,
  });
  const obstacleAccentMaterial = new THREE.MeshLambertMaterial({
    color: mapDef.obstacleAccent,
  });

  const obstacleMeshes: THREE.Mesh[] = [];
  for (const obs of obstacles) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width, obs.height, obs.depth),
      obstacleMaterial,
    );
    mesh.position.set(obs.x, obs.height / 2, obs.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    obstacleMeshes.push(mesh);

    // 상단 액센트 띠 (Fall Guys 느낌)
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width + 0.1, 0.3, obs.depth + 0.1),
      obstacleAccentMaterial,
    );
    accent.position.set(obs.x, obs.height + 0.15, obs.z);
    scene.add(accent);
    obstacleMeshes.push(accent);
  }

  // === 외곽 빌딩 (오렌지/크림) ===
  const buildings = buildBuildings(scene, mapDef);

  // === 외곽 나무 (다크 그린 원뿔) ===
  const trees = buildTrees(scene, mapDef);

  return {
    floor: floorMesh,
    walls,
    obstacles: obstacleMeshes,
    obstaclesData: obstacles,
    buildings,
    trees,
  };
}

// === 외곽 빌딩 (v30: Fall Guys 카툰 집) ===
function buildBuildings(scene: THREE.Scene, mapDef: MapDef): THREE.Mesh[] {
  // v30: 파스텔 primary 색 + 박스 지붕 (원뿔 대신 평평한 지붕 + 액센트 색)
  const matA = new THREE.MeshLambertMaterial({ color: mapDef.buildingColorA });
  const matB = new THREE.MeshLambertMaterial({ color: mapDef.buildingColorB });
  const roofMat = new THREE.MeshLambertMaterial({ color: mapDef.buildingRoof });
  const accentMat = new THREE.MeshLambertMaterial({ color: mapDef.obstacleAccent });

  const halfW = MAP.width / 2;
  const halfD = MAP.depth / 2;

  const specs: BuildingSpec[] = [];
  // 4면 각각 3개씩 = 12개 빌딩
  for (let i = -2; i <= 2; i++) {
    const x = i * 7;
    specs.push({
      x,
      z: -halfD - BUILDING_OFFSET,
      width: 4 + Math.random() * 1.5,
      height: BUILDING_BASE_HEIGHT + Math.random() * BUILDING_HEIGHT_VAR,
      depth: 4 + Math.random() * 1,
    });
  }
  for (let i = -2; i <= 2; i++) {
    const x = i * 7;
    specs.push({
      x,
      z: halfD + BUILDING_OFFSET,
      width: 4 + Math.random() * 1.5,
      height: BUILDING_BASE_HEIGHT + Math.random() * BUILDING_HEIGHT_VAR,
      depth: 4 + Math.random() * 1,
    });
  }
  for (let i = -2; i <= 2; i++) {
    const z = i * 7;
    specs.push({
      x: halfW + BUILDING_OFFSET,
      z,
      width: 4 + Math.random() * 1,
      height: BUILDING_BASE_HEIGHT + Math.random() * BUILDING_HEIGHT_VAR,
      depth: 4 + Math.random() * 1.5,
    });
  }
  for (let i = -2; i <= 2; i++) {
    const z = i * 7;
    specs.push({
      x: -halfW - BUILDING_OFFSET,
      z,
      width: 4 + Math.random() * 1,
      height: BUILDING_BASE_HEIGHT + Math.random() * BUILDING_HEIGHT_VAR,
      depth: 4 + Math.random() * 1.5,
    });
  }

  const buildings: THREE.Mesh[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const baseMat = i % 2 === 0 ? matA : matB;
    // 본체 (박스)
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, spec.height, spec.depth),
      baseMat,
    );
    building.position.set(spec.x, spec.height / 2, spec.z);
    building.castShadow = true;
    building.receiveShadow = true;
    scene.add(building);
    buildings.push(building);

    // 지붕 (박스 + 액센트 띠) — 카툰 느낌
    const roofH = 0.4;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 1.05, roofH, spec.depth * 1.05),
      roofMat,
    );
    roof.position.set(spec.x, spec.height + roofH / 2, spec.z);
    roof.castShadow = true;
    scene.add(roof);
    buildings.push(roof);

    // 창문 (밝은 색 사각형 — Fall Guys 풍)
    addWindowsToBuilding(building, spec, accentMat);

    // 지면 베이스 (밝은 띠)
    const baseStripe = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 1.08, 0.3, spec.depth * 1.08),
      accentMat,
    );
    baseStripe.position.set(spec.x, 0.15, spec.z);
    scene.add(baseStripe);
    buildings.push(baseStripe);
  }
  return buildings;
}

function addWindowsToBuilding(
  building: THREE.Mesh,
  spec: BuildingSpec,
  windowMat: THREE.Material,
): void {
  const ww = 0.5;
  const wh = 0.6;
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), windowMat);
    const yLocal = -spec.height / 2 + spec.height * 0.5;
    const xLocal = (i - (count - 1) / 2) * ((spec.width * 0.6) / Math.max(1, count - 1));
    const zLocal = spec.depth / 2 + 0.02;
    win.position.set(xLocal, yLocal, zLocal);
    building.add(win);
  }
}

// === 외곽 나무 (v28: 다크 그린 Cone + 갈색 기둥) ===
function buildTrees(scene: THREE.Scene, mapDef: MapDef): TreeRefs {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4423 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: mapDef.treeColor });

  const halfW = MAP.width / 2;
  const halfD = MAP.depth / 2;

  // 외곽 4면에 나무 배치 (8개)
  const positions: Array<{ x: number; z: number; scale: number }> = [];
  for (let i = -1; i <= 1; i += 2) {
    positions.push({ x: i * (halfW + 2), z: -halfD - 1, scale: 1 });
    positions.push({ x: i * (halfW + 2), z: halfD + 1, scale: 1 });
    positions.push({ x: -halfW - 1, z: i * (halfD * 0.5), scale: 0.9 });
    positions.push({ x: halfW + 1, z: i * (halfD * 0.5), scale: 0.9 });
  }

  const meshes: THREE.Mesh[] = [];
  for (const pos of positions) {
    // 기둥
    const trunkH = 0.8 * pos.scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, trunkH, 6), trunkMat);
    trunk.position.set(pos.x, trunkH / 2, pos.z);
    trunk.castShadow = true;
    scene.add(trunk);
    meshes.push(trunk);

    // 잎 (Cone)
    const leavesH = 1.6 * pos.scale;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.7 * pos.scale, leavesH, 6), leavesMat);
    leaves.position.set(pos.x, trunkH + leavesH / 2, pos.z);
    leaves.castShadow = true;
    scene.add(leaves);
    meshes.push(leaves);
  }

  return { meshes };
}

// === 탈출 지점 (v28: 단순한 원반) ===
export function buildExitPoint(scene: THREE.Scene): THREE.Mesh {
  const radius = 1.4;
  const geometry = new THREE.CylinderGeometry(radius, radius, 0.08, 32);
  const material = new THREE.MeshLambertMaterial({
    color: 0xf4d160, // 골드 (맵별 색은 main에서 적용 가능)
  });
  const disc = new THREE.Mesh(geometry, material);
  disc.position.set(0, 0.04, 11);
  disc.receiveShadow = true;
  scene.add(disc);
  return disc;
}
