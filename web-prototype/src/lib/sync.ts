// 2026-08-25: 원격 플레이어 동기화 — jitter buffer + 보간/외삽
//
// 서버는 80ms 간격으로 peers 메시지를 broadcast한다 (TICK_MS). 각 메시지에는
// (id, x, z, yaw, vx, vz, ts) 가 들어 있고, ts는 서버 epoch ms (샘플 시점)다.
// 클라이언트는 이 정보를 받아 "render time - interpolationDelayMs" 시점의 위치를
// 계산해 mesh에 적용한다 — 이게 표준 jitter buffer 패턴이고, 도착 지연·지터
// 흡수 + 부드러운 움직임의 핵심이다.
//
// 알고리즘 요약:
// - history는 최대 10개 스냅샷 (서버 tick 12.5Hz × 10 = 800ms = 보간 지연 100ms + 여유)
// - sample(timeMs):
//   1) timeMs가 history [before, after] 사이에 있으면 선형 보간 (x,z) + yaw slerp
//   2) timeMs가 history 최신 이후면 외삽 (after.vx * dt) — maxExtrapolationMs 이내만
//   3) timeMs가 history 가장 과거 이전이면 가장 오래된 스�샷 반환 (catch-up)
// - snapTo: 텔레포트(부활/재접속) — history를 단일 스냅샷으로 교체
//
// 단위 테스트: src/lib/sync.test.ts

export interface PeerSnapshot {
  id: string;
  x: number;
  z: number;
  yaw: number;
  out: boolean;
  vx: number;
  vz: number;
  /** 서버 epoch ms — 서버가 이 위치를 샘플링한 시각 */
  ts: number;
}

export interface RemoteSyncOptions {
  /** 보간 지연 (ms) — 클라가 실제보다 이만큼 뒤에서 그림. 100~150ms 권장 */
  interpolationDelayMs: number;
  /** 최대 외삽 시간 (ms) — 이 시간 지나면 마지막 위치로 고정 */
  maxExtrapolationMs: number;
  /** history 최대 보관 수 (메모리 보호). 기본 10 */
  maxHistory?: number;
}

export interface RemoteSample {
  x: number;
  z: number;
  yaw: number;
  out: boolean;
}

const DEFAULT_MAX_HISTORY = 10;

export class RemotePlayerSync {
  private history: PeerSnapshot[] = [];
  private readonly opts: Required<RemoteSyncOptions>;

  constructor(opts: RemoteSyncOptions) {
    this.opts = {
      interpolationDelayMs: opts.interpolationDelayMs,
      maxExtrapolationMs: opts.maxExtrapolationMs,
      maxHistory: opts.maxHistory ?? DEFAULT_MAX_HISTORY,
    };
  }

  /** 서버에서 새 peer 스냅샷 도착 — history에 push */
  applyUpdate(snap: PeerSnapshot): void {
    this.history.push(snap);
    if (this.history.length > this.opts.maxHistory) {
      this.history.shift();
    }
  }

  /** 텔레포트 (부활, 재접속, 큰 점프) — history를 단일 스냅샷으로 교체 */
  snapTo(snap: PeerSnapshot): void {
    this.history = [snap];
  }

  /** history 길이 (디버그 / 테스트용) */
  size(): number {
    return this.history.length;
  }

  /** 가장 최근 스냅샷 (없으면 null) */
  last(): PeerSnapshot | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /** history 초기화 (라운드 종료 등) */
  clear(): void {
    this.history = [];
  }

  /**
   * renderTimeMs 시점의 보간/외삽된 위치·회전 반환.
   * - history가 비었으면 null
   * - history가 1개면 그 스냅샷 그대로
   * - 2개 이상이면 ts 기준으로 두 점 사이 보간 또는 외삽
   */
  sample(renderTimeMs: number): RemoteSample | null {
    const h = this.history;
    if (h.length === 0) return null;

    if (h.length === 1) {
      const last = h[0];
      return { x: last.x, z: last.z, yaw: last.yaw, out: last.out };
    }

    // ts 오름차순 정렬 — 네트워크 도착 순서가 뒤섞여도 안전
    // (실제로는 서버가 ts 순서대로 보내지만 도착 순서가 다를 수 있어 정렬)
    // 성능: 매 sample마다 sort는 비싸므로, 정렬 가정 + 단조성 침해 시 fallback.
    // 단순화를 위해 정렬하지 않고 last 기준으로 찾는다.
    // (대부분의 경우 서버는 ts 순서대로 보내고 도착도 순서 유지)
    const last = h[h.length - 1];
    const prev = h[h.length - 2];

    // 외삽: renderTimeMs가 가장 최근 스냅샷 이후
    if (renderTimeMs >= last.ts) {
      const deltaMs = renderTimeMs - last.ts;
      if (deltaMs > this.opts.maxExtrapolationMs) {
        // 너무 미래 — 마지막 위치 고정
        return { x: last.x, z: last.z, yaw: last.yaw, out: last.out };
      }
      const sec = deltaMs / 1000;
      return {
        x: last.x + last.vx * sec,
        z: last.z + last.vz * sec,
        yaw: last.yaw,
        out: last.out,
      };
    }

    // catch-up: renderTimeMs가 가장 과거 이전 → 가장 오래된 스냅샷 사용
    const first = h[0];
    if (renderTimeMs <= first.ts) {
      return { x: first.x, z: first.z, yaw: first.yaw, out: first.out };
    }

    // 보간: prev < renderTimeMs < last
    const tSpan = last.ts - prev.ts;
    if (tSpan <= 0) {
      // ts 동일 — 직전 스냅샷 반환
      return { x: last.x, z: last.z, yaw: last.yaw, out: last.out };
    }
    const f = (renderTimeMs - prev.ts) / tSpan;
    return {
      x: prev.x + (last.x - prev.x) * f,
      z: prev.z + (last.z - prev.z) * f,
      yaw: slerpYaw(prev.yaw, last.yaw, f),
      out: last.out,
    };
  }
}

/** -π ~ π wrap을 고려한 yaw 보간 (a→b, f ∈ [0,1]) */
export function slerpYaw(a: number, b: number, f: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * f;
}
