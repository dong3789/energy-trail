import { describe, it, expect } from 'vitest';
import {
  COUNTDOWN_SEQUENCE,
  COUNTDOWN_STEP_TOTAL_MS,
  COUNTDOWN_DURATION_MS,
  countdownFromElapsed,
  firstCountdownPaint,
  effectiveElapsedMs,
} from './countdown';

describe('countdownFromElapsed (shipped round transition)', () => {
  it('starts at 3 with overlay visible', () => {
    const snap = countdownFromElapsed(0);
    expect(snap.state).toBe('countdown');
    expect(snap.label).toBe('3');
    expect(snap.index).toBe(0);
    expect(snap.overlayVisible).toBe(true);
  });

  it('advances 3 → 2 → 1 → 시작! then playing after 4 steps', () => {
    const labels: string[] = [];
    let last = '';
    for (let t = 0; t < COUNTDOWN_DURATION_MS; t += 50) {
      const snap = countdownFromElapsed(t);
      expect(snap.state).toBe('countdown');
      expect(snap.overlayVisible).toBe(true);
      if (snap.label !== last) {
        labels.push(snap.label);
        last = snap.label;
      }
    }
    expect(labels).toEqual([...COUNTDOWN_SEQUENCE]);

    const done = countdownFromElapsed(COUNTDOWN_DURATION_MS);
    expect(done.state).toBe('playing');
    expect(done.overlayVisible).toBe(false);
    expect(done.label).toBe('시작!');
  });

  it('stays on each numeral for a full step+gap window', () => {
    expect(countdownFromElapsed(0).label).toBe('3');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS - 1).label).toBe('3');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS).label).toBe('2');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS * 2).label).toBe('1');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS * 3).label).toBe('시작!');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS * 4 - 1).state).toBe('countdown');
    expect(countdownFromElapsed(COUNTDOWN_STEP_TOTAL_MS * 4).state).toBe('playing');
  });

  it('first paint does not throw when audio is not initialized', () => {
    expect(() => firstCountdownPaint()).not.toThrow();
    const snap = firstCountdownPaint();
    expect(snap.label).toBe('3');
    expect(snap.overlayVisible).toBe(true);
    expect(snap.state).toBe('countdown');
  });

  it('first paint does not invoke optional onBeep (avoids TDZ on sound)', () => {
    let beeps = 0;
    firstCountdownPaint({ onBeep: () => beeps++ });
    expect(beeps).toBe(0);
  });
});

describe('effectiveElapsedMs (pause freezes countdown clock)', () => {
  it('unpaused elapsed is now - startedAt', () => {
    expect(effectiveElapsedMs(5000, 1000, null, 0)).toBe(4000);
  });

  it('while paused, elapsed freezes at the pause instant', () => {
    const startedAt = 1000;
    const pausedAt = 1500; // 500ms into countdown ('3')
    expect(effectiveElapsedMs(11500, startedAt, pausedAt, 0)).toBe(500);
    expect(countdownFromElapsed(500).label).toBe('3');
    expect(countdownFromElapsed(500).state).toBe('countdown');
  });

  it('Continue resumes remaining countdown then reaches playing', () => {
    const startedAt = 1000;
    const pausedAccum = 10_000; // paused for 10s
    const resumeAt = 11_500; // started 1000, ran 500, paused 10000
    expect(effectiveElapsedMs(resumeAt, startedAt, null, pausedAccum)).toBe(500);

    const remaining = COUNTDOWN_DURATION_MS - 500;
    const atPlaying = resumeAt + remaining;
    const elapsed = effectiveElapsedMs(atPlaying, startedAt, null, pausedAccum);
    expect(elapsed).toBe(COUNTDOWN_DURATION_MS);
    const snap = countdownFromElapsed(elapsed);
    expect(snap.state).toBe('playing');
    expect(snap.overlayVisible).toBe(false);
  });
});
