// 자국 (Energy Trail) — 게임/씬 설정값
// 2026-08-15 v30: Vibe D → Vibe E Fall Guys (카툰 파티 게임)
// - 젤리빈 캐릭터 + 큰 눈 + 미소
// - 맑은 파스텔 하늘 + 형형색색 오브젝트
// - 라운드/바운시 애니메이션
// - 폰트: 둥근 산세리프
import * as THREE from 'three';

// ============================================================
// 맵 정의 (Vibe E: Fall Guys 카툰 파티)
// ============================================================
export type MapId = 'park' | 'school' | 'playground';

export interface MapDef {
  id: MapId;
  name: string;
  description: string;
  difficulty: 1 | 2 | 3;
  previewColorA: number;
  previewColorB: number;
  skyColor: number;
  groundColor: number;
  wallColor: number;
  obstacleColor: number;
  obstacleAccent: number; // 상단 액센트 (밝은 색)
  buildingColorA: number;
  buildingColorB: number;
  buildingRoof: number; // 지붕 색
  treeColor: number;
  exitColor: number;
  ambientColor: number;
  sunColor: number;
  fogNear: number;
  fogFar: number;
}

export const MAPS: Record<MapId, MapDef> = {
  park: {
    id: 'park',
    name: '블록버튼',
    description: '파스텔 잔디와 큐브. 입문자 추천.',
    difficulty: 1,
    previewColorA: 0xb4e4f4,
    previewColorB: 0xffb3d9,
    skyColor: 0xa8e0ff, // 맑은 파란 하늘
    groundColor: 0xc8e878, // 형광 파스텔 잔디
    wallColor: 0xff85a2, // 핑크 벽
    obstacleColor: 0xffe14a, // 노란 큐브
    obstacleAccent: 0xff85a2, // 핑크 액센트
    buildingColorA: 0x6dd5ed, // 시안
    buildingColorB: 0xffd83d, // 골드
    buildingRoof: 0xff5c8a, // 핑크 지붕
    treeColor: 0x2ecc71, // 형광 그린
    exitColor: 0xfff44a, // 형광 노랑
    ambientColor: 0xfff5e1, // 따뜻한 햇빛
    sunColor: 0xfff0c0,
    fogNear: 32,
    fogFar: 80,
  },
  school: {
    id: 'school',
    name: '도라에몽',
    description: '동그란 공장과 굴뚝. 시야 중간.',
    difficulty: 2,
    previewColorA: 0xffb3d9,
    previewColorB: 0x6dd5ed,
    skyColor: 0xa8e0ff,
    groundColor: 0xffd83d, // 골드 잔디
    wallColor: 0x6dd5ed, // 시안 벽
    obstacleColor: 0xff85a2, // 핑크
    obstacleAccent: 0xfff44a,
    buildingColorA: 0x9b59b6, // 퍼플
    buildingColorB: 0x6dd5ed, // 시안
    buildingRoof: 0xff5c8a,
    treeColor: 0x2ecc71,
    exitColor: 0x9b59b6,
    ambientColor: 0xfff5e1,
    sunColor: 0xfff0c0,
    fogNear: 28,
    fogFar: 75,
  },
  playground: {
    id: 'playground',
    name: '슬라임 산맥',
    description: '미끄럼틀과 슬라짐. 장애물 빽빽.',
    difficulty: 3,
    previewColorA: 0x6dd5ed,
    previewColorB: 0x2ecc71,
    skyColor: 0x84c8ff,
    groundColor: 0x84e0b8, // 청록 잔디
    wallColor: 0xff85a2,
    obstacleColor: 0x9b59b6, // 퍼플
    obstacleAccent: 0xfff44a,
    buildingColorA: 0xff5c8a, // 핑크
    buildingColorB: 0xfff44a, // 노랑
    buildingRoof: 0x9b59b6,
    treeColor: 0x2ecc71,
    exitColor: 0xff5c8a,
    ambientColor: 0xfff5e1,
    sunColor: 0xfff0c0,
    fogNear: 24,
    fogFar: 68,
  },
};

// ============================================================
// 3D 씬 (Vibe D: 로우폴리 데이라이트) — 2026-08-15 v28
// - 핀트톤 안 함, 단순 MeshLambertMaterial
// - Bloom/Reflector/Rain 전부 OFF
// - 햇빛 + 부드러운 ambient + hemisphere
// ============================================================
export const SCENE = {
  // v28: 데이라이트 — 밝은 파란 하늘
  backgroundColor: 0xc6e2ea,
  fogColor: 0xc6e2ea,
  fogNear: 28,
  fogFar: 70,

  // 카메라 (3인칭 사선) — 데이라이트는 살짝 더 가까이/낮게 (드론 시점 강조 X)
  cameraFov: 70,
  cameraNear: 0.1,
  cameraFar: 120,
  cameraPosition: { x: 0, y: 8, z: 12 },
  cameraLookAt: { x: 0, y: 1, z: 0 },

  // 카메라 오비팅 — daylight는 부드럽게
  cameraOrbitSpeed: 0.8,
  cameraOrbitRadius: 1.5,
  cameraOrbitYAmplitude: 0.4,

  // v28: 햇빛 (DirectionalLight) — 따뜻한 노란빛, 위에서
  sunColor: 0xfff5e0,
  sunIntensity: 2.4,
  sunDirection: new THREE.Vector3(-0.3, 1, -0.2).normalize(),

  // 환경광 (전반 밝기) — daylight라 더 강하게
  ambientColor: 0xeae4d4,
  ambientIntensity: 0.85,

  // Hemisphere (sky/ground) — 자연스러운 그라데이션
  hemisphereSky: 0xc6e2ea,
  hemisphereGround: 0x7fb069,
  hemisphereIntensity: 0.5,

  // v28: Bloom OFF (로우폴리는 글레우 안 어울림)
  bloom: {
    enabled: false,
    threshold: 0.85,
    strength: 0.0,
    radius: 0.4,
  },

  // v28: 톤매핑 OFF (LinearToneMapping)
  toneMappingExposure: 1.0,

  // === 카메라 팔로우 (2026-08-15: 오비팅 → 플레이어 뒤 따라오기로 변경) ===
  // v5: 6.0 → 7.0
  // v6: 7.0 → 8.0
  // v7: 8.0 → 9.0
  // v8: 9.0 → 10.0
  // v9: 10.0 → 11.0
  // v10: 11.0 → 12.0
  // v11: 12.0 → 13.0
  // v12: 13.0 → 14.0
  // v13: 14.0 → 15.0
  // v14: 15.0 → 16.0
  // v15: 16.0 → 17.0
  // v16: 17.0 → 18.0 — 맵 42m 확장에 더 맞춰 (시야 약간 더)
  // v17: 18.0 → 10.0 — 너무 멀면 게임성 망가짐 (시야 좁아짐, 조준 어려움)
  cameraFollowDistance: 10.0,
  // v6: 3.2 → 3.5
  // v7: 3.5 → 4.0
  // v8: 4.0 → 4.5
  // v9: 4.5 → 5.0
  // v10: 5.0 → 5.5
  // v11: 5.5 → 6.0
  // v12: 6.0 → 6.5
  // v13: 6.5 → 7.0
  // v14: 7.0 → 7.5
  // v15: 7.5 → 8.0
  // v16: 8.0 → 8.5
  // v17: 8.5 → 9.0
  // v18: 9.0 → 9.5
  // v19: 9.5 → 10.0
  // v20: 10.0 → 10.5
  // v21: 10.5 → 11.0 — 살짝 위에서 (박스 너머 안 가게)
  // v28: 6.5 → 4.5 — daylight는 카메라 더 낮게 (자연스러운 3인칭)
  cameraFollowHeight: 4.5,
  // 2026-08-15 v3: 1.0 → 1.5
  // 2026-08-15 v4: 1.5 → 2.0 — 평점 3인칭 게임 표준(GTA/Witcher)
  // 2026-08-15 v5: 2.0 → 2.5
  // 2026-08-15 v6: 2.5 → 3.0 — 더 멀리 미리 봄 (GTA V 표준)
  // 2026-08-15 v7: 3.0 → 3.5
  // 2026-08-15 v8: 3.5 → 4.0
  // 2026-08-15 v9: 4.0 → 5.0
  // 2026-08-15 v10: 5.0 → 5.5
  // 2026-08-15 v11: 5.5 → 6.0
  // 2026-08-15 v12: 6.0 → 6.5
  // 2026-08-15 v13: 6.5 → 7.0
  // 2026-08-15 v14: 7.0 → 7.5
  // 2026-08-15 v15: 7.5 → 8.0
  // 2026-08-15 v16: 8.0 → 8.5
  // 2026-08-15 v17: 8.5 → 9.0
  // 2026-08-15 v18: 9.0 → 9.5
  // 2026-08-15 v19: 9.5 → 10.0
  // 2026-08-15 v20: 10.0 → 10.5
  // 2026-08-15 v21: 10.5 → 11.0
  // 2026-08-15 v22: 11.0 → 11.5
  // 2026-08-15 v23: 11.5 → 12.0
  // 2026-08-15 v24: 12.0 → 12.5 — 더 멀리
  // v28: 4.0 → 2.5 — daylight는 가까이 (캐릭터 클로즈업)
  cameraFollowLookAhead: 2.5,
  cameraFollowSmoothing: 0.08, // 0~1, 클수록 빠르게 따라옴 (낮을수록 부드러움)
  cameraFollowShake: 0.04, // 살짝 호흡감 추가

  // 2026-08-15 v28: Reflector OFF (daylight 로우폴리)
  reflectorEnabled: false,
  reflectorResolutionScale: 0.5,
  reflectorColor: 0xc6e2ea,
  reflectorOpacity: 0.0,

  // === 부스터 시 FOV 펄스 (v28: base 70 → 78) ===
  boostFov: 78,
  fovLerpSpeed: 8.0,

  // === v33: role별 카메라 FOV — 도망자가 술래보다 넓은 시야 (회피 유리) ===
  cameraFovTagger: 68, // 술래: 좁고 정밀한 시야
  cameraFovRunner: 82, // 도망자: 넓은 시야 (술래를 먼저 보자)
} as const;

// ============================================================
// 맵 (Vibe D: 로우폴리 데이라이트) — 2026-08-15 v28
// ============================================================
export const MAP = {
  width: 42,
  depth: 42,
  wallHeight: 2.2, // v28: 4.5 → 2.2 (낮은 담장)
  wallThickness: 0.5,

  // v28: 바닥 — 맵별 색 (park = 잔디)
  floorColor: 0x7fb069, // 잔디 기본값 (MAPS에 의해 오버라이드됨)
  floorRoughness: 0.95, // v28: 0.25 → 0.95 (반사 없음, 매트)
  floorMetalness: 0.0, // v28: 0.55 → 0.0 (비금속)

  // 외곽벽 — 낮고 따뜻한 톤
  wallColor: 0xc8b896, // v28: 0x303a52 → 0xc8b896 (베이지)
  wallEmissive: 0x000000, // v28: 없음
  wallEmissiveIntensity: 0.0,
  wallRoughness: 0.85,
  wallMetalness: 0.0,

  // 내벽 장애물 — 크림/라이트 베이지
  obstacleColor: 0xe8e0d0, // v28: 0x424b66 → 0xe8e0d0 (크림)
  obstacleEmissive: 0x000000,
  obstacleEmissiveIntensity: 0.0,
  obstacleRoughness: 0.85,
  obstacleMetalness: 0.0,

  // v28: 림 라이트 OFF (로우폴리엔 안 어울림)
  rimColor: 0x000000,
  rimIntensity: 0.0,
} as const;

// ============================================================
// 맵 장애물 (Phase A 기본 배치)
// 1차 MVP 1:1 검증용. 추후 절차적/설정 기반으로 전환.
// ============================================================
export interface ObstacleSpec {
  x: number;
  z: number;
  width: number; // X
  height: number; // Y
  depth: number; // Z
}
// 2026-08-09 v5: OBSTACLES 재설계 — 도망자(반경 0.45)는 들어갈 수 있고 술래(반경 0.63)는 막히는 좁은 틈 구조
// 도망자 마진 0.6 = 통로 폭 ≥ 1.05m 필요, 술래 마진 0.6 = 통로 폭 ≥ 1.23m 필요
// 따라서 통로 폭 0.6~0.9m이면 도망자만 통과 (적정 마진 포함)
export const OBSTACLES: readonly ObstacleSpec[] = [
  // === 큰 박스 4개 — 벽/엄폐물 ===
  { x: -8, z: -4, width: 3.0, height: 2.4, depth: 1.6 }, // 북서쪽 담장 (얇은 두께)
  { x: 8, z: 6, width: 3.0, height: 2.4, depth: 1.6 }, // 동남쪽 담장
  { x: -7, z: 8, width: 1.6, height: 2.0, depth: 3.0 }, // 북동쪽 박스 (담장)
  { x: 7, z: -8, width: 1.6, height: 2.0, depth: 3.0 }, // 남서쪽 박스 (담장)

  // === 좁은 통로 생성용 작은 박스들 (담장 사이에 0.7m 틈) ===
  // 북쪽 벽 (z = -5~-3 라인): 좌우 큰 박스 → 중앙에 0.7m 통로
  { x: -4, z: -5, width: 1.0, height: 2.0, depth: 1.6 }, // 좌측 벽돌
  { x: 4, z: -5, width: 1.0, height: 2.0, depth: 1.6 }, // 우측 벽돌 (중간 7m 통로)

  // 동쪽 벽 (x = 5~7 라인): 상하 작은 박스 → 중앙에 0.7m 통로
  { x: 6, z: -2, width: 1.6, height: 2.0, depth: 1.0 }, // 상단 벽돌
  { x: 6, z: 2, width: 1.6, height: 2.0, depth: 1.0 }, // 하단 벽돌

  // 중앙 L자 형 장애물 (시야 차단, 도망자 숨을 수 있는 코너)
  { x: -3, z: 0, width: 4.0, height: 1.4, depth: 0.6 }, // 중앙 수평
  { x: -3, z: 0, width: 0.6, height: 1.4, depth: 4.0 }, // 중앙 수직 (L자)

  // === 술래 차단용 좁은 통로 벽 ===
  // z = 5 라인 벽 (남쪽): 두 박스 사이 0.8m 틈
  { x: -3, z: 5, width: 2.0, height: 2.2, depth: 0.6 }, // 좌
  { x: 3, z: 5, width: 2.0, height: 2.2, depth: 0.6 }, // 우
  // x = -2 라인 벽 (서쪽): 두 박스 사이 0.8m 틈
  { x: -2, z: -3, width: 0.6, height: 2.2, depth: 2.0 }, // 상
  { x: -2, z: 3, width: 0.6, height: 2.2, depth: 2.0 }, // 하
] as const;

// ============================================================
// 2026-08-15: 맵별 OBSTACLES (맵 선택 시스템)
// - neon-alley: 기본 OBSTACLES (= 1차 검증 셋업, 위 상수와 동일)
// - industrial-zone: 박스 적게, 큰 박스 위주 (전략적 거점, 시야 넓음)
// - downtown: 박스 더 많고 작은 박스로 미로화 (압박감 ↑, 시야 좁음)
// ============================================================
const OBSTACLES_INDUSTRIAL: readonly ObstacleSpec[] = [
  // 4개 큰 박스 (전략 거점 — 쌓여있거나 길목 차단)
  { x: -6, z: -5, width: 4.0, height: 2.6, depth: 2.0 },
  { x: 6, z: 5, width: 4.0, height: 2.6, depth: 2.0 },
  { x: -5, z: 7, width: 3.0, height: 2.4, depth: 1.6 },
  { x: 5, z: -7, width: 3.0, height: 2.4, depth: 1.6 },
  // 중앙 컨테이너 더미 (L자, 시야 차단)
  { x: -2, z: 0, width: 4.0, height: 1.6, depth: 0.8 },
  { x: -2, z: 0, width: 0.8, height: 1.6, depth: 4.0 },
  // 남쪽 좁은 통로 (단 한 줄)
  { x: -3, z: 4, width: 2.0, height: 2.0, depth: 0.6 },
  { x: 3, z: 4, width: 2.0, height: 2.0, depth: 0.6 },
];

const OBSTACLES_DOWNTOWN: readonly ObstacleSpec[] = [
  // === 박스 더 많음 — 좁은 골목 미로 ===
  // 외곽 4개 큰 박스
  { x: -8, z: -4, width: 3.0, height: 2.4, depth: 1.6 },
  { x: 8, z: 6, width: 3.0, height: 2.4, depth: 1.6 },
  { x: -7, z: 8, width: 1.6, height: 2.0, depth: 3.0 },
  { x: 7, z: -8, width: 1.6, height: 2.0, depth: 3.0 },
  // === 좁은 통로 다수 (술래 차단) ===
  // 북쪽 (z = -3)
  { x: -3, z: -3, width: 0.6, height: 2.2, depth: 2.0 },
  { x: 3, z: -3, width: 0.6, height: 2.2, depth: 2.0 },
  // 동쪽 (x = 4)
  { x: 4, z: -3, width: 2.0, height: 2.2, depth: 0.6 },
  { x: 4, z: 3, width: 2.0, height: 2.2, depth: 0.6 },
  // 중앙 미로
  { x: -3, z: 0, width: 4.0, height: 1.4, depth: 0.6 },
  { x: -3, z: 0, width: 0.6, height: 1.4, depth: 4.0 },
  { x: 3, z: 0, width: 0.6, height: 1.4, depth: 3.0 },
  // 남쪽 추가 박스
  { x: 0, z: 5, width: 3.0, height: 2.0, depth: 0.6 },
  { x: -5, z: 2, width: 1.4, height: 2.0, depth: 1.4 },
  { x: 5, z: -2, width: 1.4, height: 2.0, depth: 1.4 },
];

// 2026-08-15: 맵 32 → 42 확장 시 OBSTACLES도 1.3배 스케일 (32 → 42 비율)
const scaleObstacles =
  (s: number) =>
  (arr: readonly ObstacleSpec[]): ObstacleSpec[] =>
    arr.map((o) => ({ x: o.x * s, z: o.z * s, width: o.width, height: o.height, depth: o.depth }));

const scale13 = scaleObstacles(42 / 32); // ≈ 1.3125
export const OBSTACLES_BY_MAP: Record<MapId, readonly ObstacleSpec[]> = {
  park: scale13(OBSTACLES), // v28: neon-alley → park
  school: scale13(OBSTACLES_INDUSTRIAL), // v28: industrial-zone → school
  playground: scale13(OBSTACLES_DOWNTOWN), // v28: downtown → playground
};

// ============================================================
// 플레이어 (Phase A: 캡슐 더미, 색상만 차별화)
// Phase B에서 TaggerSpeedController, TrailAbsorber로 확장.
// ============================================================
export const PLAYER = {
  // 이동 속도 (m/s) — Phase A는 단일 속도, Phase B에서 단계화
  baseSpeed: 4.5,

  // 캡슐 크기
  radius: 0.45,
  height: 1.7,

  // 2026-08-15 v30: 캐릭터 v5 — Fall Guys 스타일 (밝은 primary 색)
  // - 술래: 핑크 (Fall Guys 핑크 빈)
  // - 도망자: 시안/옐로우/퍼플
  taggerColor: 0xff5c8a, // v30: 핑크 (Fall Guys 핑크)
  taggerAccent: 0xe83a6a,
  taggerEmissiveColor: 0x000000,
  taggerEmissiveIntensity: 0.0,
  taggerHoodLightIntensity: 0.0,
  taggerHoodLightDistance: 0.0,
  showPlayerLabels: true,
  labelOffsetY: 1.4,
  taggerLabel: '술래',
  runnerLabel: '나',
  runnerColors: {
    'runner-cyan': 0x4dd0e1, // v30: Fall Guys 시안
    'runner-yellow': 0xffd83d, // v30: Fall Guys 옐로우
    'runner-purple': 0x9b59b6, // v30: Fall Guys 퍼플
  } as Record<string, number>,
} as const;

// ============================================================
// 게임 진행 (Phase B: 이동 + 속도 3단계 + 자국 1개 데모)
// ============================================================
export type SpeedTier = 'walk' | 'run' | 'sprint';

export const SPEED_TIERS: Record<
  SpeedTier,
  { multiplier: number; trailStrength: number; label: string; color: number }
> = {
  walk: { multiplier: 1.0, trailStrength: 0.0, label: '워크', color: 0xb8b8c8 }, // v30: 라이트 그레이
  run: { multiplier: 1.4, trailStrength: 0.3, label: '런', color: 0x4dd0e1 }, // v30: 시안
  sprint: { multiplier: 1.8, trailStrength: 0.7, label: '스프린트', color: 0xffd83d }, // v30: 골드
} as const;

export const GAME = {
  // 인원 — 디자인 문서 모바일 권장 4p, 분석 문서 1차 1:1→1:2→1:3
  maxPlayers: 5,
  runnerCount: 4,
  taggerCount: 1,

  // 승리 조건
  taggerWinOutCount: 2, // 5인 기준 (Phase A: 단일 플레이어 검증용으로 1)
  runnerWinEscapeCount: 1, // 1명이라도 탈출

  // 라운드
  roundSeconds: 150,

  // === Phase B: 이동 / 속도 3단계 / 자국 ===
  baseSpeed: 4.5, // m/s, 1차 = 4.5. SPEED_TIERS.multiplier와 곱해 실제 속도 결정
  rotationSpeed: 12, // rad/s, 캐릭터가 이동 방향으로 회전하는 속도

  // 자국 (Phase B: 1차 = 자국 생성/소멸만, 흡수는 Phase B+ 확장)
  trailInterval: 0.18, // m 이동마다 1개 생성
  trailLifetime: 6.0, // 자국 자연 소멸 시간 (초)
  trailMaxCount: 80, // 최대 자국 개수 (초과 시 오래된 자국부터 제거)
  trailPoolSize: 100, // 자국 오브젝트 풀 초기 크기

  // 흡수 (Phase B+ 확장 자리)
  absorbSeconds: 1.0,
  boostSeconds: 4.0,
  // 2026-08-15 v5: 1.6 → 1.4 — 도망자 너무 빠르면 술래 못 잡음
  absorbedSpeedMultiplier: 1.4,
  invulnerabilitySeconds: 2.0,
  // 2026-08-15 v3: 0.9 → 1.1 — 두 캡슐 반경 합(0.45+0.63=1.08)보다 살짝 크게
  // → 캡슐이 닿기 직전에 OUT 발동
  taggerContactDistance: 1.1,
  exitHoldSeconds: 1.0,

  // 술래 AI (Phase B: 단순 패트롤 — Phase C에서 추적 AI로 확장)
  // 2026-08-15 v3: 1.2 → 1.5 — 술래가 도망자를 실제로 잡을 수 있도록
  // 2026-08-15 v4: 1.5 → 1.9 — 더 공격적
  // 2026-08-15 v5: 1.9 → 2.4 — 도망자(흡수 후 1.4×4s=11.3 m/s)보다 훨씬 빠르게 따라잡게
  // 2026-08-15 v8: 2.4 → 1.9 — 도망자 입장에서 너무 빠름 (체감 불균형)
  // - AI 술래: 4.5 × 1.4 × 1.9 = 11.97 m/s (도망자 6.3의 1.9배)
  // - 흡수 부스트(1.4×) 시: 도망자 8.82 m/s — 차이 1.36배 → 도망자 도주 가능
  // - 플레이어 술래도 같은 1.9배 적용 (이전엔 1.0배로 AI보다 느렸음)
  taggerPatrolSpeedMultiplier: 1.9,
  // 2026-08-15 v8: 키 리바인드 — Space = 부스터 (요청)
  // - Space (탭) = 부스터 발동 (B 대안)
  // - B = 부스터 (기존, 유지)
  // - 클릭(왼쪽) = 즉시 사격
  // - F = 조준 사격 (홀딩→조준선→떼면 발사) — 도망자 F=얼림과 충돌 → Shift로 변경
  shotKey: 'KeyF', // F = 사격 (홀딩 조준)
  shotClickKey: 'Pointer0', // 마우스 왼쪽 = 즉시 사격
  shotRange: 20,
  shotCooldown: 1.5,
  shotSpeed: 30,
  shotRadius: 0.4,
  shotColor: 0xff3a3a,
  taggerPatrolRadiusMin: 4.0,
  taggerPatrolRadiusMax: 10.0,
  taggerPatrolTurnInterval: 2.5,

  // 2026-08-09 v4: 얼림 (Ice) 시스템 — 도망자가 술래를 잠시 동결
  // 2026-08-15 v5: 1.0 → 1.2 — 도망자가 멀리서도 얼림 발동 가능
  iceRange: 1.2,
  // v6: 2.5 → 3.0 — 도망자가 얼림 동안 더 멀리 도망 가능 (16m 밖으로)
  iceDuration: 3.0,
  // v6: 15.0 → 12.0 — 라운드당 사용 횟수 12~13회 (도망자 유리)
  iceCooldown: 12.0,
  iceTaggerTint: 0x66e0ff, // 술래 동결 시 색상 (얼음 시안)

  // 2026-08-09 v5: 술래 크기 + 부스터 시스템
  // 술래 반경/높이 (캡슐) — 도망자보다 큼 (반경 1.4배)
  taggerScale: 1.4, // PLAYER.radius * 1.4 = 0.63, height 비례
  // 부스터 (B 키) — 짧은 폭주 + 누적 피로
  // 2026-08-15 v8: 부스터 재밸런스 — "무한 부스트" 버그 수정
  // - 피로 100 캡인데 정지 임계값이 120이라 정지 안 일어남
  // - → 80/0.7로 낮춰서 실제로 정지 트리거
  // - 1사이클에 ~4번 부스터, 이후 2초 정지 → 긴장감 ↑
  boostKey: 'Space', // Space = 부스터 (기본, 접근성 ↑)
  boostKeyAlt: 'KeyB', // B = 부스터 (대안)
  boostActiveSpeedMul: 1.5, // 부스트 활성 중 속도 배율 추가
  boostActiveDuration: 1.5, // 부스트 1회 지속 (초)
  boostFatiguePerUse: 18, // 12 → 18 (1사이클 4회)
  boostCooldown: 0.8, // 0.5 → 0.8 (잦은 연타 방지)
  // 피로 → 효과 변환
  boostFatigueShrink: 0.5, // 0.55 → 0.50 (피로 100일 때 scale = 0.5)
  boostFatigueSpeedMul: 0.5, // 0.60 → 0.50 (피로 100일 때 speed 50% = 절반 속도)
  // 회복 정지 — 실제로 트리거되도록 보정
  boostStallThreshold: 80, // 120 → 80 (정지 임계값 = 피로 80)
  boostStallMinSpeed: 0.7, // 0.4 → 0.7 (피로 80에서 speed 0.68 < 0.7 → 정지)
  boostStallDuration: 2.0, // 1.5 → 2.0 (정지 시간 충분)
  boostStallRecoveryRate: 35, // 50 → 35 (정지 중 회복 35/s, 2초 = 70 회복)

  // 2026-08-09 v6: 장애물 자성 — 도망자(AI)가 장애물 근처에서 미세하게 끌어당겨짐
  obstacleMagnetism: 0.6, // 마진 내 인력 계수 (m/s² 스케일, m 단위 가속)
  obstacleMagnetismRange: 0.6, // 마진 대비 추가 자성 범위 (마진 + 이만큼 = 자성 영향 반경)
} as const;
