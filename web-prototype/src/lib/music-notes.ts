// 순수 모듈 — 음표/화음 상수 (테스트 가능하도록 분리)
// v34 WIN arpeggio + LOSE sad trombone 의도된 주파수
//
// A4 = 440Hz 기준. 각 음은 equal-temperament 계산 없이 의도된 고정 주파수 사용
// (이미 사운드 매니저에서 검증된 값을 export)

export interface Note {
  /** 시작 주파수 (Hz) */
  frequency: number;
  /** 시작 시간 (초) */
  startAt: number;
  /** 지속 시간 (초) */
  duration: number;
}

/** v34: 승리 팡파레 — C5 → E5 → G5 → C6 메이저 아르페지오 + 마지막 음에 코러스 */
export const WIN_ARPEGGIO: readonly Note[] = [
  { frequency: 523, startAt: 0, duration: 0.18 }, // C5
  { frequency: 659, startAt: 0.12, duration: 0.18 }, // E5
  { frequency: 784, startAt: 0.24, duration: 0.18 }, // G5
  { frequency: 1047, startAt: 0.36, duration: 0.18 }, // C6
];

/** WIN 마지막 음에 깔리는 코러스 (C6, E6, G6) */
export const WIN_FINAL_CHORD: readonly Note[] = [
  { frequency: 1047, startAt: 0.4, duration: 0.6 }, // C6
  { frequency: 1319, startAt: 0.4, duration: 0.6 }, // E6
  { frequency: 1568, startAt: 0.4, duration: 0.6 }, // G6
];

/** v34: 패배 — sad trombone 4단 하강 (E5 → D5 → C#5 → B4 → A4) */
export const LOSE_DESCENT: readonly Note[] = [
  { frequency: 659, startAt: 0, duration: 0.18 }, // E5
  { frequency: 587, startAt: 0.18, duration: 0.18 }, // D5
  { frequency: 554, startAt: 0.36, duration: 0.18 }, // C#5
  { frequency: 494, startAt: 0.54, duration: 0.18 }, // B4
  { frequency: 440, startAt: 0.72, duration: 0.5 }, // A4
];

/** 얼림 — 수정 톤 (A5, E6, A6) */
export const ICE_CHORD_FREQUENCIES: readonly number[] = [880, 1320, 1760];

/** 흡수 완료 — C5 E5 G5 C6 한 옥타브 */
export const ABSORB_COMPLETE_FREQUENCIES: readonly number[] = [523, 659, 784, 1047];

/** 가장 가까운 표준 음표 이름 반환 (A-G + sharp + 옥타브) */
export function nearestNoteName(hz: number): string {
  const a4 = 440;
  const semitonesFromA4 = 12 * Math.log2(hz / a4);
  const rounded = Math.round(semitonesFromA4);
  // MIDI 69 = A4, MIDI 60 = C4. MIDI % 12 = 0 → C, 9 → A.
  // 인덱스 0=C 부터 시작하도록 정렬.
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = 69 + rounded;
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[noteIndex]}${octave}`;
}
