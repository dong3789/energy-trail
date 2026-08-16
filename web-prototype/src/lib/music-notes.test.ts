import { describe, it, expect } from 'vitest';
import {
  WIN_ARPEGGIO,
  WIN_FINAL_CHORD,
  LOSE_DESCENT,
  ICE_CHORD_FREQUENCIES,
  ABSORB_COMPLETE_FREQUENCIES,
  nearestNoteName,
} from './music-notes';

describe('music-notes', () => {
  describe('WIN_ARPEGGIO', () => {
    it('C-E-G-C 메이저 아르페지오 4음 (C5/E5/G5/C6)', () => {
      expect(WIN_ARPEGGIO).toHaveLength(4);
      const freqs = WIN_ARPEGGIO.map((n) => n.frequency);
      expect(freqs).toEqual([523, 659, 784, 1047]);
      expect(nearestNoteName(freqs[0])).toBe('C5');
      expect(nearestNoteName(freqs[1])).toBe('E5');
      expect(nearestNoteName(freqs[2])).toBe('G5');
      expect(nearestNoteName(freqs[3])).toBe('C6');
    });

    it('음 사이 간격이 균일 (120ms)', () => {
      const starts = WIN_ARPEGGIO.map((n) => n.startAt);
      expect(starts[1] - starts[0]).toBeCloseTo(0.12, 5);
      expect(starts[2] - starts[1]).toBeCloseTo(0.12, 5);
      expect(starts[3] - starts[2]).toBeCloseTo(0.12, 5);
    });
  });

  describe('WIN_FINAL_CHORD', () => {
    it('C6-E6-G6 메이저 코드', () => {
      expect(WIN_FINAL_CHORD).toHaveLength(3);
      const freqs = WIN_FINAL_CHORD.map((n) => n.frequency);
      expect(nearestNoteName(freqs[0])).toBe('C6');
      expect(nearestNoteName(freqs[1])).toBe('E6');
      expect(nearestNoteName(freqs[2])).toBe('G6');
    });

    it('아르페지오 마지막 음(C6, startAt=0.36) 이후에 들림 (startAt=0.4)', () => {
      const lastArpEnd = WIN_ARPEGGIO[3].startAt;
      expect(WIN_FINAL_CHORD[0].startAt).toBeGreaterThan(lastArpEnd);
    });
  });

  describe('LOSE_DESCENT (sad trombone)', () => {
    it('5음 하강 (E5 → D5 → C#5 → B4 → A4)', () => {
      expect(LOSE_DESCENT).toHaveLength(5);
      const freqs = LOSE_DESCENT.map((n) => n.frequency);
      expect(nearestNoteName(freqs[0])).toBe('E5');
      expect(nearestNoteName(freqs[1])).toBe('D5');
      expect(nearestNoteName(freqs[2])).toBe('C#5');
      expect(nearestNoteName(freqs[3])).toBe('B4');
      expect(nearestNoteName(freqs[4])).toBe('A4');
    });

    it('주파수가 단조 감소', () => {
      const freqs = LOSE_DESCENT.map((n) => n.frequency);
      for (let i = 1; i < freqs.length; i++) {
        expect(freqs[i]).toBeLessThan(freqs[i - 1]);
      }
    });

    it('마지막 음(A4)이 더 김 (0.5s vs 0.18s)', () => {
      const others = LOSE_DESCENT.slice(0, 4).map((n) => n.duration);
      for (const d of others) {
        expect(d).toBeCloseTo(0.18, 5);
      }
      expect(LOSE_DESCENT[4].duration).toBeCloseTo(0.5, 5);
    });
  });

  describe('ICE_CHORD_FREQUENCIES', () => {
    it('880/1320/1760 — A5/E6/A6', () => {
      expect(ICE_CHORD_FREQUENCIES).toEqual([880, 1320, 1760]);
      expect(nearestNoteName(880)).toBe('A5');
      expect(nearestNoteName(1320)).toBe('E6');
      expect(nearestNoteName(1760)).toBe('A6');
    });
  });

  describe('ABSORB_COMPLETE_FREQUENCIES', () => {
    it('C5/E5/G5/C6 한 옥타브', () => {
      expect(ABSORB_COMPLETE_FREQUENCIES).toEqual([523, 659, 784, 1047]);
    });
  });

  describe('nearestNoteName', () => {
    it('A4 정확 일치 → A4', () => {
      expect(nearestNoteName(440)).toBe('A4');
    });
    it('C5 (1옥타브 위 도) → C5', () => {
      expect(nearestNoteName(523.25)).toBe('C5');
    });
    it('미세한 주파수 차이도 가장 가까운 음표로 snap', () => {
      // C5 = 523.25Hz, ±5Hz 차이도 C5로 인식되어야 함
      expect(nearestNoteName(528)).toBe('C5');
      expect(nearestNoteName(518)).toBe('C5');
    });
  });
});
