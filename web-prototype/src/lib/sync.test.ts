// 2026-08-25: 원격 플레이어 동기화 단위 테스트 — 보간/외삽/slerp 정확성 검증
import { describe, expect, it } from 'vitest';
import { RemotePlayerSync, slerpYaw, type PeerSnapshot } from './sync';

const opts = { interpolationDelayMs: 100, maxExtrapolationMs: 250 };

const snap = (over: Partial<PeerSnapshot> = {}): PeerSnapshot => ({
  id: 'p1',
  x: 0,
  z: 0,
  yaw: 0,
  out: false,
  vx: 0,
  vz: 0,
  ts: 1000,
  ...over,
});

describe('RemotePlayerSync', () => {
  it('빈 history → sample returns null', () => {
    const s = new RemotePlayerSync(opts);
    expect(s.sample(2000)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it('단일 history → 그 스냅샷 그대로 반환', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 5, z: 7, yaw: 1.2, ts: 1000 }));
    expect(s.size()).toBe(1);
    const r = s.sample(2000);
    expect(r).toEqual({ x: 5, z: 7, yaw: 1.2, out: false });
  });

  it('두 점 사이 선형 보간 — 정확히 중간값', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 0, z: 0, yaw: 0, ts: 1000 }));
    s.applyUpdate(snap({ x: 10, z: 20, yaw: Math.PI / 2, ts: 1100 }));
    // f = 0.5 → (5, 10), yaw 0 → π/2 중간 = π/4
    const r = s.sample(1050);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(5, 5);
    expect(r!.z).toBeCloseTo(10, 5);
    expect(r!.yaw).toBeCloseTo(Math.PI / 4, 5);
  });

  it('보간 f=0 → 이전 스냅샷, f=1 → 이후 스냅샷', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 0, z: 0, ts: 1000 }));
    s.applyUpdate(snap({ x: 10, z: 20, ts: 1100 }));
    const a = s.sample(1000);
    const b = s.sample(1100);
    expect(a!.x).toBeCloseTo(0, 5);
    expect(a!.z).toBeCloseTo(0, 5);
    expect(b!.x).toBeCloseTo(10, 5);
    expect(b!.z).toBeCloseTo(20, 5);
  });

  it('외� — 마지막 스냅샷 이후, velocity * dt로 이동', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 0, z: 0, vx: 4, vz: 0, ts: 1000 }));
    s.applyUpdate(snap({ x: 4, z: 0, vx: 4, vz: 0, ts: 1100 }));
    // 마지막 ts=1100, 50ms 후 (1150) → x = 4 + 4 * 0.05 = 4.2
    const r = s.sample(1150);
    expect(r!.x).toBeCloseTo(4.2, 5);
    expect(r!.z).toBeCloseTo(0, 5);
  });

  it('외삽 한계 초과 — 마지막 위치로 고정', () => {
    const s = new RemotePlayerSync(opts); // maxExtrapolationMs: 250
    s.applyUpdate(snap({ x: 0, z: 0, vx: 4, vz: 0, ts: 1000 }));
    s.applyUpdate(snap({ x: 4, z: 0, vx: 4, vz: 0, ts: 1100 }));
    // 1100 + 500 = 1600 → 한계(250) 초과 → 마지막 위치 고정
    const r = s.sample(1600);
    expect(r!.x).toBeCloseTo(4, 5);
    expect(r!.z).toBeCloseTo(0, 5);
  });

  it('catch-up — 너무 과거 → 가장 오래된 스냅샷 반환', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 5, z: 5, ts: 1000 }));
    s.applyUpdate(snap({ x: 10, z: 10, ts: 1100 }));
    // 900 (첫 스냅샷보다 과거) → 첫 스냅샷
    const r = s.sample(900);
    expect(r!.x).toBeCloseTo(5, 5);
    expect(r!.z).toBeCloseTo(5, 5);
  });

  it('history 한계 — maxHistory 초과 시 오래된 것부터 제거', () => {
    const s = new RemotePlayerSync({ ...opts, maxHistory: 3 });
    s.applyUpdate(snap({ x: 1, ts: 1000 }));
    s.applyUpdate(snap({ x: 2, ts: 1100 }));
    s.applyUpdate(snap({ x: 3, ts: 1200 }));
    s.applyUpdate(snap({ x: 4, ts: 1300 })); // 1번째 제거됨
    expect(s.size()).toBe(3);
    // 가장 오래된 ts=1100 시점 → 보간 가능
    const r = s.sample(1100);
    expect(r!.x).toBeCloseTo(2, 5);
  });

  it('snapTo — 텔레포트, history를 단일 스냅�으로 교체', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 0, z: 0, ts: 1000 }));
    s.applyUpdate(snap({ x: 10, z: 10, ts: 1100 }));
    expect(s.size()).toBe(2);
    s.snapTo(snap({ x: 50, z: 50, ts: 2000 }));
    expect(s.size()).toBe(1);
    const r = s.sample(2050);
    expect(r!.x).toBeCloseTo(50, 5);
  });

  it('clear — history 비우기', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ ts: 1000 }));
    s.applyUpdate(snap({ ts: 1100 }));
    expect(s.size()).toBe(2);
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.sample(1500)).toBeNull();
  });

  it('last — 가장 최근 스냅샷', () => {
    const s = new RemotePlayerSync(opts);
    expect(s.last()).toBeNull();
    s.applyUpdate(snap({ x: 5, ts: 1000 }));
    expect(s.last()!.x).toBe(5);
    s.applyUpdate(snap({ x: 9, ts: 1100 }));
    expect(s.last()!.x).toBe(9);
  });

  it('out 상태 — 마지막 스냅샷의 out 반영', () => {
    const s = new RemotePlayerSync(opts);
    s.applyUpdate(snap({ x: 0, z: 0, out: false, ts: 1000 }));
    s.applyUpdate(snap({ x: 5, z: 5, out: true, ts: 1100 }));
    // 보간 시 out은 last.out (시각적으로는 즉시 적용하지 말고 mesh fade로 부드럽게)
    const r = s.sample(1050);
    expect(r!.out).toBe(true);
  });
});

describe('slerpYaw', () => {
  it('f=0 → a', () => {
    expect(slerpYaw(0, Math.PI, 0)).toBe(0);
  });
  it('f=1 → b', () => {
    expect(slerpYaw(0, Math.PI, 1)).toBeCloseTo(Math.PI, 5);
  });
  it('f=0.5 → 정확히 중간', () => {
    expect(slerpYaw(0, Math.PI, 0.5)).toBeCloseTo(Math.PI / 2, 5);
  });
  it('-π ~ π wrap — 짧은 경로 선택', () => {
    // a = 3.1 (≈ -π), b = -3.1 (≈ π). wrap 시 짧은 경로 = 0.2 진행
    const result = slerpYaw(3.1, -3.1, 0.5);
    // 3.1 → -3.1: diff = -6.2 + 2π ≈ 0.0832 → f=0.5 → a + 0.0416 ≈ 3.1416
    expect(Math.abs(result - Math.PI)).toBeLessThan(0.01);
  });
  it('반대 방향 wrap — b - a = +6.2도 짧은 경로', () => {
    const result = slerpYaw(-3.1, 3.1, 0.5);
    expect(Math.abs(result + Math.PI)).toBeLessThan(0.01);
  });
});
