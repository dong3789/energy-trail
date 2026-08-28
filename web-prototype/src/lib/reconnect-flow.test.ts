import { describe, it, expect } from 'vitest';
import { reconnectFlow, type AttemptResult } from './reconnect-flow';
import { MAX_RECONNECT_ATTEMPTS } from './reconnect';

/**
 * 재연결 흐름 E2E 단위 테스트.
 * - attempt 함수를 mock으로 주입해 모든 분기 (lobby/playing/failed/cancel/abort)를 검증
 * - sleep을 fake로 (즉시 resolve) → 빠른 실행
 */

const profile = {
  nickname: '테스터',
  characterId: 'runner-cyan',
  roleWish: 'random',
  mapId: 'park',
};

describe('reconnectFlow', () => {
  it('첫 시도에 lobby 응답 → 즉시 ok 종료', async () => {
    const attempts: number[] = [];
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        attempts.push(1);
        return { phase: 'lobby', payload: { code: '1234' } };
      },
      sleep: () => Promise.resolve(),
      onAttempt: (n) => attempts.push(n * 10),
    });
    expect(result).toBe('ok');
    expect(attempts).toEqual([1, 10]); // attempt 실행 + onAttempt(1, 'lobby')
  });

  it('playing 응답 시 maxAttempts까지 재시도 후 abort', async () => {
    let calls = 0;
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        return { phase: 'playing' };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe('abort');
    expect(calls).toBe(MAX_RECONNECT_ATTEMPTS);
  });

  it('failed 응답 → 재시도 후 abort (playing과 동일 정책)', async () => {
    let calls = 0;
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        return { phase: 'failed' };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe('abort');
    expect(calls).toBe(MAX_RECONNECT_ATTEMPTS);
  });

  it('처음 2번 failed 후 3번째 lobby → ok (재시도가 진짜로 작동)', async () => {
    let calls = 0;
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        if (calls < 3) return { phase: 'failed' };
        return { phase: 'lobby' };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('cancel 신호 → 즉시 cancelled 종료 (다음 시도 진입 전)', async () => {
    let calls = 0;
    let cancelled = false;
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        cancelled = true; // 첫 시도 응답 후 cancel
        return { phase: 'failed' };
      },
      sleep: () => Promise.resolve(),
      shouldCancel: () => cancelled,
    });
    expect(result).toBe('cancelled');
    expect(calls).toBe(1); // 첫 시도만 실행 후 cancel
  });

  it('각 시도 후 closeAttempt 호출 (성공 시도 제외)', async () => {
    const closed: number[] = [];
    let calls = 0;
    await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        if (calls < 3) return { phase: 'failed', ws: { close: () => closed.push(calls) } };
        return { phase: 'lobby', ws: { close: () => closed.push(calls) } };
      },
      closeAttempt: (ws) => ws?.close(),
      sleep: () => Promise.resolve(),
    });
    // 성공 시도(3)에서는 close 안 함 — 호출자가 새 net을 할당할 수 있도록 보존
    expect(closed).toEqual([1, 2]);
  });

  it('abort 시 마지막 시도도 closeAttempt 호출', async () => {
    const closed: number[] = [];
    let calls = 0;
    await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        return { phase: 'failed', ws: { close: () => closed.push(calls) } };
      },
      closeAttempt: (ws) => ws?.close(),
      sleep: () => Promise.resolve(),
    });
    expect(closed).toEqual([1, 2, 3, 4, 5]);
  });

  it('onAttempt 콜백이 attempt + phase와 함께 호출됨', async () => {
    const observed: Array<{ n: number; phase: string }> = [];
    let calls = 0;
    await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        return calls < 2 ? { phase: 'failed' } : { phase: 'lobby' };
      },
      sleep: () => Promise.resolve(),
      onAttempt: (n, phase) => observed.push({ n, phase }),
    });
    expect(observed).toEqual([
      { n: 1, phase: 'failed' },
      { n: 2, phase: 'lobby' },
    ]);
  });

  it('onTerminal 콜백이 outcome과 attempts와 함께 호출됨', async () => {
    const events: Array<{ outcome: string; attempts: number }> = [];
    await reconnectFlow('1234', profile, {
      attempt: async () => ({ phase: 'lobby' }),
      sleep: () => Promise.resolve(),
      onTerminal: (outcome, attempts) => events.push({ outcome, attempts }),
    });
    expect(events).toEqual([{ outcome: 'ok', attempts: 1 }]);
  });

  it('abort도 onTerminal 호출', async () => {
    const events: Array<{ outcome: string; attempts: number }> = [];
    await reconnectFlow('1234', profile, {
      attempt: async () => ({ phase: 'failed' }),
      sleep: () => Promise.resolve(),
      onTerminal: (outcome, attempts) => events.push({ outcome, attempts }),
    });
    expect(events.length).toBe(1);
    expect(events[0].outcome).toBe('abort');
    expect(events[0].attempts).toBe(MAX_RECONNECT_ATTEMPTS);
  });

  it('maxAttempts 옵션으로 정책 override 가능', async () => {
    let calls = 0;
    const result = await reconnectFlow('1234', profile, {
      maxAttempts: 2,
      attempt: async () => {
        calls += 1;
        return { phase: 'failed' };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe('abort');
    expect(calls).toBe(2);
  });

  it('sleep이 실제 시간 흐름을 시뮬레이션 (fake sleep이 ms 인자 기록)', async () => {
    const waits: number[] = [];
    let calls = 0;
    await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        return calls < 2 ? { phase: 'failed' } : { phase: 'lobby' };
      },
      sleep: async (ms) => {
        waits.push(ms);
        // 즉시 resolve (테스트에서 시간 단축)
      },
    });
    // 첫 시도 failed 후 백오프: attempt 1 → backoff(0) = 1000ms
    expect(waits).toEqual([1000]);
  });

  it('attempt 함수가 throw하면 failed로 처리하고 계속 진행', async () => {
    let calls = 0;
    const result = await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error('mock attempt throw');
        return { phase: 'lobby' };
      },
      sleep: () => Promise.resolve(),
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('shouldCancel이 attempt 도중 토글되어도 다음 attempt 진입 전 검사됨', async () => {
    const cancelAfter = 2;
    let calls = 0;
    let shouldCancel = false;
    await reconnectFlow('1234', profile, {
      attempt: async () => {
        calls += 1;
        if (calls >= cancelAfter) shouldCancel = true;
        return { phase: 'failed' };
      },
      sleep: async () => {
        // sleep 동안 cancel 토글됨
      },
      shouldCancel: () => shouldCancel,
    });
    // 2번째 attempt 후 cancel true → 3번째 진입 전 검사 → cancelled
    expect(calls).toBe(2);
  });

  it('payload는 성공 시 AttemptResult에 포함되어 호출자가 활용 가능', async () => {
    const captured: AttemptResult[] = [];
    await reconnectFlow('5678', profile, {
      attempt: async (code) => {
        const r: AttemptResult = { phase: 'lobby', payload: { code } };
        captured.push(r);
        return r;
      },
      sleep: () => Promise.resolve(),
    });
    expect(captured[0].payload).toEqual({ code: '5678' });
  });
});
