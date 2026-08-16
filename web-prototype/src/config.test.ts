import { describe, it, expect } from 'vitest';
import { MAPS, SCENE, GAME, PLAYER, OBSTACLES_BY_MAP, SPEED_TIERS } from './config';

describe('config invariants', () => {
  describe('MAPS', () => {
    it('3개 맵 모두 정의됨 (park/school/playground)', () => {
      expect(Object.keys(MAPS)).toEqual(expect.arrayContaining(['park', 'school', 'playground']));
    });

    it('각 맵이 필수 색상 필드를 가짐', () => {
      for (const id of Object.keys(MAPS) as Array<keyof typeof MAPS>) {
        const m = MAPS[id];
        expect(m.skyColor).toBeGreaterThanOrEqual(0);
        expect(m.skyColor).toBeLessThanOrEqual(0xffffff);
        expect(m.groundColor).toBeGreaterThanOrEqual(0);
        expect(m.groundColor).toBeLessThanOrEqual(0xffffff);
        expect(m.fogFar).toBeGreaterThan(m.fogNear);
      }
    });

    it('난이도가 1, 2, 3 순서로 정의됨', () => {
      expect(MAPS.park.difficulty).toBe(1);
      expect(MAPS.school.difficulty).toBe(2);
      expect(MAPS.playground.difficulty).toBe(3);
    });

    it('preview 색상이 모든 맵에서 서로 다름 (식별 가능)', () => {
      const a = new Set<string>();
      for (const id of Object.keys(MAPS) as Array<keyof typeof MAPS>) {
        const sig = `${MAPS[id].previewColorA}-${MAPS[id].previewColorB}`;
        expect(a.has(sig)).toBe(false);
        a.add(sig);
      }
    });
  });

  describe('SCENE 카메라 FOV (v33 역할별)', () => {
    it('tagger FOV < runner FOV (도망자가 넓은 시야)', () => {
      expect(SCENE.cameraFovTagger).toBeLessThan(SCENE.cameraFovRunner);
    });

    it('FOV가 합리적 범위 (50~100)', () => {
      expect(SCENE.cameraFovTagger).toBeGreaterThanOrEqual(50);
      expect(SCENE.cameraFovTagger).toBeLessThanOrEqual(100);
      expect(SCENE.cameraFovRunner).toBeGreaterThanOrEqual(50);
      expect(SCENE.cameraFovRunner).toBeLessThanOrEqual(100);
    });
  });

  describe('GAME 밸런스', () => {
    it('tagger가 runner를 따라잡을 수 있는 속도 (tagger speed > runner max speed)', () => {
      const runnerMaxSpeed = GAME.baseSpeed * SPEED_TIERS.sprint.multiplier;
      const taggerSpeed = GAME.baseSpeed * GAME.taggerPatrolSpeedMultiplier;
      expect(taggerSpeed).toBeGreaterThan(runnerMaxSpeed);
    });

    it('taggerContactDistance가 캡슐 두 개 반경 합보다 크거나 같음 (닿기 전에 OUT)', () => {
      const minContact = PLAYER.radius + PLAYER.radius * GAME.taggerScale;
      expect(GAME.taggerContactDistance).toBeGreaterThanOrEqual(minContact - 0.01);
    });

    it('부스터는 사이클 4회 후 stall (boostStallThreshold > boostFatiguePerUse * 3)', () => {
      expect(GAME.boostStallThreshold).toBeGreaterThan(GAME.boostFatiguePerUse * 3);
    });

    it('roundSeconds가 양수', () => {
      expect(GAME.roundSeconds).toBeGreaterThan(0);
    });

    it('iceDuration + iceCooldown 합이 라운드 시간보다 작음 (라운드당 여러 번 사용 가능)', () => {
      const cycle = GAME.iceDuration + GAME.iceCooldown;
      expect(cycle).toBeLessThan(GAME.roundSeconds);
    });
  });

  describe('PLAYER 색상', () => {
    it('runner 색상 3종 정의 (cyan/yellow/purple)', () => {
      expect(PLAYER.runnerColors['runner-cyan']).toBeDefined();
      expect(PLAYER.runnerColors['runner-yellow']).toBeDefined();
      expect(PLAYER.runnerColors['runner-purple']).toBeDefined();
    });

    it('tagger 색상이 핑크 (Vibe E)', () => {
      expect(PLAYER.taggerColor).toBe(0xff5c8a);
    });
  });

  describe('OBSTACLES_BY_MAP', () => {
    it('3개 맵 모두 장애물 가짐', () => {
      for (const id of ['park', 'school', 'playground'] as const) {
        expect(OBSTACLES_BY_MAP[id]).toBeDefined();
        expect(OBSTACLES_BY_MAP[id].length).toBeGreaterThan(0);
      }
    });

    it('모든 장애물이 맵 경계 안', () => {
      const half = SCENE.cameraFar / 2; // 대략적 맵 크기 (실제 MAP.width=42)
      for (const id of ['park', 'school', 'playground'] as const) {
        for (const o of OBSTACLES_BY_MAP[id]) {
          expect(Math.abs(o.x)).toBeLessThan(half);
          expect(Math.abs(o.z)).toBeLessThan(half);
        }
      }
    });
  });

  describe('SPEED_TIERS', () => {
    it('walk < run < sprint (속도 단조 증가)', () => {
      expect(SPEED_TIERS.walk.multiplier).toBeLessThan(SPEED_TIERS.run.multiplier);
      expect(SPEED_TIERS.run.multiplier).toBeLessThan(SPEED_TIERS.sprint.multiplier);
    });

    it('trail strength도 walk < run < sprint', () => {
      expect(SPEED_TIERS.walk.trailStrength).toBeLessThanOrEqual(SPEED_TIERS.run.trailStrength);
      expect(SPEED_TIERS.run.trailStrength).toBeLessThanOrEqual(SPEED_TIERS.sprint.trailStrength);
    });
  });
});
