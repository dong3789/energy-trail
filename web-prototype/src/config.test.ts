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

    it('1인칭 카메라는 캡슐 머리 안에 들어가지 않는다', () => {
      expect(SCENE.firstPersonOffsetBack).toBeGreaterThan(PLAYER.radius * 2);
      expect(SCENE.firstPersonOffsetUp).toBeGreaterThan(0.5);
    });

    it('1인칭에서 자기 몸통이 화면을 채우지 않도록 충분히 뒤에 둔다', () => {
      // 캡슐 높이 1.7m / FOV 90° 기준, 5m 뒤에서 화면 높이의 ~20%
      expect(SCENE.firstPersonOffsetBack).toBeGreaterThanOrEqual(5);
      expect(SCENE.firstPersonOffsetUp).toBeGreaterThan(1.5);
    });
  });

  describe('PLAYER 라벨', () => {
    it('자기 닉네임 스프라이트는 1인칭 시야를 가리지 않게 끈다', () => {
      expect(PLAYER.showSelfLabel).toBe(false);
    });
  });

  describe('GAME 밸런스', () => {
    // 2026-08-28: 동속도 밸런스 — 기본 속도는 전 역할 동일, 흡수 부스트만이 격차를 만든다.
    it('동속도 원칙: 술래는 도망자 스프린트보다 약간 빠르거나 같다 (격차 10% 이내)', () => {
      const runnerMaxSpeed = GAME.baseSpeed * SPEED_TIERS.sprint.multiplier;
      const taggerSpeed =
        GAME.baseSpeed * SPEED_TIERS.run.multiplier * GAME.taggerPatrolSpeedMultiplier;
      expect(taggerSpeed).toBeLessThan(runnerMaxSpeed * 1.1);
    });

    it('흡수 부스트가 유일한 도주 수단 — 부스트 중 도망자는 술래보다 확실히 빠르다', () => {
      const taggerSpeed =
        GAME.baseSpeed * SPEED_TIERS.run.multiplier * GAME.taggerPatrolSpeedMultiplier;
      const boostedRunner =
        GAME.baseSpeed *
        SPEED_TIERS.sprint.multiplier *
        1.3 * // AI 도망자 배율 (RunnerAIStub.baseSpeed)
        GAME.absorbedSpeedMultiplier;
      expect(boostedRunner).toBeGreaterThan(taggerSpeed * 1.15);
    });

    it('taggerContactDistance가 캡슐 두 개 반경 합보다 커서 코너에 몰아도 OUT', () => {
      const minContact = PLAYER.radius + PLAYER.radius * GAME.taggerScale;
      expect(GAME.taggerContactDistance).toBeGreaterThan(minContact + 0.3);
    });

    it('부스터는 사이클 4회 후 stall (boostStallThreshold > boostFatiguePerUse * 3)', () => {
      expect(GAME.boostStallThreshold).toBeGreaterThan(GAME.boostFatiguePerUse * 3);
    });

    it('roundSeconds가 양수', () => {
      expect(GAME.roundSeconds).toBeGreaterThan(0);
    });

    it('자국 목표치가 양수 (도망자 승리 조건)', () => {
      expect(GAME.trailGoal).toBeGreaterThan(0);
    });

    it('iceDuration + iceCooldown 합이 라운드 시간보다 작음 (라운드당 여러 번 사용 가능)', () => {
      const cycle = GAME.iceDuration + GAME.iceCooldown;
      expect(cycle).toBeLessThan(GAME.roundSeconds);
    });

    it('자석은 승리 조건보다 적게만 당긴다', () => {
      expect(GAME.itemMagnetMaxAbsorb).toBe(2);
      expect(GAME.itemMagnetMaxAbsorb).toBeLessThan(GAME.trailGoal);
    });

    it('얼림 사거리는 접촉 잡기보다 충분히 크다', () => {
      expect(GAME.iceRange).toBeGreaterThan(GAME.taggerContactDistance * 2);
    });

    it('AI 술래 감지 범위는 놓치는 거리보다 짧다', () => {
      expect(GAME.taggerDetectRange).toBeGreaterThan(8);
      expect(GAME.taggerLoseRange).toBeGreaterThan(GAME.taggerDetectRange);
    });

    // 2026-08-28: 동속도 밸런스 — AI 술래도 도망자와 같은 배율(1.3). 직선 추적 AI라
    // 사람보다 강한 건 허용하되 스프린트 도망자는 최소한 못 따라잡는 수준까지 낮춤.
    it('AI 술래는 도망자와 동속도 배율이며 스프린트 도망자를 못 따라잡는다', () => {
      const runnerSprint = GAME.baseSpeed * SPEED_TIERS.sprint.multiplier;
      const ai = GAME.baseSpeed * SPEED_TIERS.run.multiplier * GAME.taggerAiChaseMultiplier;
      expect(GAME.taggerAiChaseMultiplier).toBe(GAME.taggerPatrolSpeedMultiplier);
      expect(ai).toBeLessThanOrEqual(runnerSprint * 1.05);
    });

    it('연막은 몇 초 유지되고 끝난 뒤 술래가 바로 못 잡는다', () => {
      expect(GAME.itemSmokeDuration).toBeGreaterThan(4);
      expect(GAME.itemSmokeForgetSeconds).toBeGreaterThan(0.5);
    });

    it('그물망은 발사 후 벌어지고 땅에 잠깐 남는다', () => {
      expect(GAME.shotNetRadiusMax).toBeGreaterThan(GAME.shotRadius);
      expect(GAME.shotRadius).toBeGreaterThan(PLAYER.radius);
      expect(GAME.shotNetZoneSeconds).toBeGreaterThan(0);
      expect(GAME.shotCooldown).toBeGreaterThan(GAME.shotNetZoneSeconds);
      expect(GAME.shotRange / GAME.shotSpeed).toBeGreaterThan(0.4);
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

    it('runner 색상 4종 정의 (cyan/yellow/purple/pink) — 캐릭터 선택 UI와 일치', () => {
      expect(PLAYER.runnerColors['runner-cyan']).toBeDefined();
      expect(PLAYER.runnerColors['runner-yellow']).toBeDefined();
      expect(PLAYER.runnerColors['runner-purple']).toBeDefined();
      expect(PLAYER.runnerColors['runner-pink']).toBeDefined();
    });

    it('runner-pink 색상이 tagger와 다름 (실제 색상 구분)', () => {
      // 핑크가 tagger 색상이면 플레이어가 술래/도망자 구별 불가
      expect(PLAYER.runnerColors['runner-pink']).not.toBe(PLAYER.taggerColor);
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
