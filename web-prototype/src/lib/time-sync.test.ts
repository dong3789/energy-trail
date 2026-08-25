import { describe, it, expect } from 'vitest';
import { serverEpochToClientPerf } from './time-sync';

describe('serverEpochToClientPerf', () => {
  it('서버 시작 직후 (drift=0) → 현재 perfNow 그대로 반환', () => {
    const now = 1_000_000;
    expect(serverEpochToClientPerf(now, now, now)).toBe(now);
  });

  it('서버 시작 후 5초 경과 → perfNow에서 5초 뺀 값', () => {
    const serverStart = 1_000_000;
    const dateNow = serverStart + 5000;
    const perfNow = 100_000 + 5000;
    expect(serverEpochToClientPerf(serverStart, dateNow, perfNow)).toBe(100_000);
  });

  it('서버 시작 후 75초 경과 (라운드 종료) → 0 근처', () => {
    const serverStart = 1_000_000;
    const dateNow = serverStart + 75_000;
    const perfNow = 100_000 + 75_000;
    expect(serverEpochToClientPerf(serverStart, dateNow, perfNow)).toBe(100_000);
  });

  it('서버 시작이 미래일 때 (시계 어긋남) 음수 drift는 0으로 보정해 perfNow 그대로', () => {
    // 서버 시작이 미래 = 음수 drift = 시계 어긋남 또는 서버 시계가 빠른 상태.
    // 클라 perfNow를 기준점으로 사용 (과거 시각으로 가지 않음).
    const futureServerStart = 1_000_000;
    const dateNow = futureServerStart - 1000; // 1초 전
    const perfNow = 100_000;
    expect(serverEpochToClientPerf(futureServerStart, dateNow, perfNow)).toBe(perfNow);
  });

  it('네트워크 지연 보정 — 서버 start가 100ms 전에 발생했을 때 정확히 보정', () => {
    // 서버가 100ms 전(서버 기준)에 라운드 시작 → 클라가 지금 받음
    // 클라 Date.now()와 perf.now()가 같은 머신에서 monotonic하게 흐른다고 가정
    const serverStart = Date.now() - 100; // 100ms 전
    const dateNow = Date.now();
    const perfNow = performance.now();
    const perfAtStart = serverEpochToClientPerf(serverStart, dateNow, perfNow);
    // perfAtStart는 perfNow보다 약 100ms 작은 값
    expect(perfNow - perfAtStart).toBeGreaterThanOrEqual(95);
    expect(perfNow - perfAtStart).toBeLessThanOrEqual(105);
  });

  it('반환값은 0 이상이고 finite', () => {
    const result = serverEpochToClientPerf(Date.now() + 1_000_000, Date.now(), performance.now());
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});
