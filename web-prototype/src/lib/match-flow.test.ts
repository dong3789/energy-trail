import { describe, it, expect } from 'vitest';
import { retryScreenForEntry, shouldTeardownGame } from './match-flow';

describe('retryScreenForEntry', () => {
  it('혼자 시작 retry returns to the waiting room', () => {
    expect(retryScreenForEntry('solo')).toBe('room');
  });

  it('room retry returns to the waiting room so wishes can change', () => {
    expect(retryScreenForEntry('room')).toBe('room');
  });
});

describe('shouldTeardownGame', () => {
  it('tears down when restarting game→game so a new match can boot', () => {
    expect(shouldTeardownGame('game', 'game')).toBe(true);
  });

  it('tears down when leaving the game screen', () => {
    expect(shouldTeardownGame('game', 'lobby')).toBe(true);
    expect(shouldTeardownGame('game', 'room')).toBe(true);
  });

  it('does not teardown when entering game from a menu', () => {
    expect(shouldTeardownGame('lobby', 'game')).toBe(false);
    expect(shouldTeardownGame('room', 'game')).toBe(false);
  });
});
