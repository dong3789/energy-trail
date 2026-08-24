import { describe, it, expect } from 'vitest';
import { wsUrlFromLocation } from './net';

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
