import { describe, it, expect } from 'vitest';
import {
  MAX_RECONNECT_ATTEMPTS,
  reconnectBackoffMs,
  decideReconnect,
  waitBeforeNextAttempt,
} from './reconnect';

describe('MAX_RECONNECT_ATTEMPTS', () => {
  it('5회로 고정 (기획: 최대 5회 후 명시적 로비)', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
  });
});

describe('reconnectBackoffMs', () => {
  it('attemptIndex 0 → 1초', () => {
    expect(reconnectBackoffMs(0)).toBe(1000);
  });

  it('attemptIndex 1 → 2초', () => {
    expect(reconnectBackoffMs(1)).toBe(2000);
  });

  it('attemptIndex 2 → 4초', () => {
    expect(reconnectBackoffMs(2)).toBe(4000);
  });

  it('attemptIndex 3 → 8초', () => {
    expect(reconnectBackoffMs(3)).toBe(8000);
  });

  it('attemptIndex 4 → 16초', () => {
    expect(reconnectBackoffMs(4)).toBe(16000);
  });

  it('총 백오프 시간 ≤ 31초 (1+2+4+8+16)', () => {
    const total = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, i) =>
      reconnectBackoffMs(i),
    ).reduce((a, b) => a + b, 0);
    expect(total).toBe(31_000);
  });
});

describe('decideReconnect', () => {
  it('ok_lobby → ok (성공)', () => {
    expect(decideReconnect({ attempt: 1, result: 'ok_lobby' })).toBe('ok');
  });

  it('phase_playing_or_ended + attempt < max → retry (라운드 끝나면 복구 가능)', () => {
    expect(decideReconnect({ attempt: 1, result: 'phase_playing_or_ended' })).toBe('retry');
    expect(decideReconnect({ attempt: 3, result: 'phase_playing_or_ended' })).toBe('retry');
  });

  it('connect_failed → retry (일시 장애)', () => {
    expect(decideReconnect({ attempt: 1, result: 'connect_failed' })).toBe('retry');
    expect(decideReconnect({ attempt: 1, result: 'timeout' })).toBe('retry');
    expect(decideReconnect({ attempt: 1, result: 'error' })).toBe('retry');
  });

  it('attempt >= maxAttempts → abort (포기, 명시적 로비)', () => {
    expect(decideReconnect({ attempt: 5, result: 'connect_failed' })).toBe('abort');
    expect(decideReconnect({ attempt: 5, result: 'phase_playing_or_ended' })).toBe('abort');
  });

  it('ok_lobby는 attempt >= max여도 항상 ok (성공이 최우선)', () => {
    expect(decideReconnect({ attempt: 10, result: 'ok_lobby' })).toBe('ok');
  });

  it('maxAttempts override로 정책 튜닝 가능', () => {
    expect(decideReconnect({ attempt: 2, result: 'connect_failed', maxAttempts: 2 })).toBe('abort');
  });
});

describe('waitBeforeNextAttempt', () => {
  it('attempt 1 → 1초 (첫 시도 후 두 번째 시도까지)', () => {
    expect(waitBeforeNextAttempt(1)).toBe(1000);
  });

  it('attempt 5 (마지막 시도 후) → 0 (포기)', () => {
    expect(waitBeforeNextAttempt(5)).toBe(0);
  });

  it('attempt 4 → 8초 (네 번째 시도 후 다섯 번째 대기)', () => {
    expect(waitBeforeNextAttempt(4)).toBe(8000);
  });
});
