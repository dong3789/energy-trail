import { describe, it, expect } from 'vitest';
import { applyRoomSelfId, wsUrlFromLocation } from './net';

describe('applyRoomSelfId', () => {
  it('selfId가 있으면 내 id를 그 값으로 맞춘다', () => {
    expect(applyRoomSelfId('p_new', 'p_host')).toBe('p_host');
  });

  it('selfId가 없으면 기존 id를 유지한다', () => {
    expect(applyRoomSelfId('p_new', undefined)).toBe('p_new');
    expect(applyRoomSelfId('p_new', '')).toBe('p_new');
  });
});

describe('wsUrlFromLocation', () => {
  it('https 페이지는 wss /ws', () => {
    expect(wsUrlFromLocation({ protocol: 'https:', host: 'trail.yndl.dev' })).toBe(
      'wss://trail.yndl.dev/ws',
    );
  });

  it('http 로컬은 ws', () => {
    expect(wsUrlFromLocation({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
  });
});
