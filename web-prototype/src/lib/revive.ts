// 2026-08-25: 동료 살리기 (Revive) 순수 로직
// - 기획안: 자국 3개를 써서 OUT된 사람 도망자를 가장자리로 부활
// - 마지막 10초 불가, AI 살리기 불가, 시체 위치가 아닌 가장자리
// - 서버와 클라가 동일한 가드 로직을 가져야 서버 권한을 일관되게 적용 가능
//   → 순수 함수로 분리해 단위 테스트

import { GAME, MAP } from '../config';

export type ReviveDenyReason =
  | 'ok'
  | 'disabled'
  | 'no_target'
  | 'target_not_out'
  | 'target_is_ai'
  | 'target_too_far'
  | 'not_enough_trail'
  | 'too_late'
  | 'not_playing';

export interface ReviveGuardInput {
  enabled?: boolean; // GAME.reviveEnabled 기본 사용
  score: number;
  cost?: number; // GAME.reviveTrailCost 기본 사용
  timeLeft: number; // 초
  noLastSeconds?: number; // GAME.reviveNoLastSeconds 기본 사용
  playing: boolean;
  targetOut: boolean;
  targetIsAi: boolean;
  distance: number; // 살리는 쪽 → 시체까지 (m), 무한대 = Infinity
  range?: number; // GAME.reviveRange 기본 사용
}

export function canRevive(input: ReviveGuardInput): ReviveDenyReason {
  const enabled = input.enabled ?? GAME.reviveEnabled;
  if (!enabled) return 'disabled';
  if (!input.playing) return 'not_playing';
  if (!input.targetOut) return 'target_not_out';
  if (input.targetIsAi) return 'target_is_ai';
  const range = input.range ?? GAME.reviveRange;
  if (input.distance > range) return 'target_too_far';
  const cost = input.cost ?? GAME.reviveTrailCost;
  if (input.score < cost) return 'not_enough_trail';
  const noLast = input.noLastSeconds ?? GAME.reviveNoLastSeconds;
  if (input.timeLeft <= noLast) return 'too_late';
  return 'ok';
}

/**
 * 부활 좌표 선택 — 가장자리 (시체가 아님)
 * - 4개 변(좌/우/상/하)에서 시체 위치에 가장 가까운 변의 가장자리 점을 반환
 * - 살리는 쪽 방향(살리는 사람 위치를 받으면)과 같은 변 쪽으로 가게 하면 자연스럽지만,
 *   기획안은 "가장자리"만 명시. 살리는 쪽이 시체와 같은 변 → 살리는 쪽 변 우선 (선택).
 */
export interface EdgeSpawnInput {
  targetX: number;
  targetZ: number;
  mapWidth?: number; // MAP.width 기본 (42)
  mapDepth?: number; // MAP.depth 기본 (42)
  margin?: number; // GAME.reviveEdgeMargin 기본 (3.0)
  /** 살리는 쪽 좌표 (옵션) — 있으면 같은 변 방향으로 우선 */
  helperX?: number;
  helperZ?: number;
}

export function pickEdgeSpawn(input: EdgeSpawnInput): { x: number; z: number } {
  const w = input.mapWidth ?? MAP.width;
  const d = input.mapDepth ?? MAP.depth;
  const m = input.margin ?? GAME.reviveEdgeMargin;
  const halfW = w / 2;
  const halfD = d / 2;
  // 살리는 쪽이 있으면 그 방향, 없으면 시체 자체가 가장 가까운 변
  const refX = input.helperX ?? input.targetX;
  const refZ = input.helperZ ?? input.targetZ;
  const dLeft = Math.abs(refX - -halfW);
  const dRight = Math.abs(refX - halfW);
  const dTop = Math.abs(refZ - -halfD);
  const dBottom = Math.abs(refZ - halfD);
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { x: -halfW + m, z: clamp(refZ, -halfD + m, halfD - m) };
  if (min === dRight) return { x: halfW - m, z: clamp(refZ, -halfD + m, halfD - m) };
  if (min === dTop) return { x: clamp(refX, -halfW + m, halfW - m), z: -halfD + m };
  return { x: clamp(refX, -halfW + m, halfW - m), z: halfD - m };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 동시 다운 카운트 (술래 승 조건용) — 기획안: "동시에 2명을 눕히면 술래 승"
 * - downCount ≥ taggerWinOutCount 면 술래 승
 * - 기존 judgeTrailRound와 별개지만 합쳐 사용 가능
 */
export function taggerWinsByOutCount(
  downCount: number,
  winCount: number = GAME.taggerWinOutCount as number,
): boolean {
  return downCount >= winCount;
}
