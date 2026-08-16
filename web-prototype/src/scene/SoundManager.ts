// 2026-08-15: 절차적 SFX (Web Audio API)
// - 외부 mp3/ogg 자산 없이 oscillator + 노이즈로 효과음 합성
// - 사용자 첫 인터랙션 후 AudioContext 초기화 (브라우저 autoplay 정책)
// - SFX: 발자국, 부스터, 얼림, OUT, 흡수 (1초 후 가속)
// - BGM: 단순 앰비언트 드론 (옵션, 음소거 가능)
//
// v34+: 음표/화음 상수는 lib/music-notes.ts 로 분리 (테스트 가능)
import {
  WIN_ARPEGGIO,
  WIN_FINAL_CHORD,
  LOSE_DESCENT,
  ICE_CHORD_FREQUENCIES,
  ABSORB_COMPLETE_FREQUENCIES,
} from '../lib/music-notes';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private enabled = true;
  private musicEnabled = false;
  private musicOsc: OscillatorNode | null = null;
  private musicLfo: OscillatorNode | null = null;

  // 발자국 디바운스
  private lastFootstepTime = 0;
  private footstepInterval = 0.28; // 이동 시 발자국 간격 (초) — 속도 비례

  /** 사용자 인터랙션 후 호출 (버튼 클릭 등) */
  ensureContext(): void {
    if (this.ctx) {
      // suspended → resume
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }
    try {
      const AudioCtor =
        (
          window as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
          }
        ).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
    } catch {
      return; // 사운드 미지원 환경
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.7;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.15;
    this.musicGain.connect(this.masterGain);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.15 : 0, this.ctx.currentTime, 0.05);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ===== SFX =====

  /** 발자국 — 짧은 저음 클릭. moved 거리에 따라 살짝 음량 변화. */
  playFootstep(intensity = 1.0): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFootstepTime < this.footstepInterval) return;
    this.lastFootstepTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;

    osc.type = 'square';
    osc.frequency.setValueAtTime(110 + Math.random() * 30, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.05);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15 * intensity, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  setFootstepInterval(seconds: number): void {
    this.footstepInterval = seconds;
  }

  /** 부스터 — whoosh (상승 톤 + 노이즈) */
  playBoost(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    // 1) 상승 톤
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.3);

    // 2) 노이즈 버스트 (whoosh)
    this.playNoise(0.18, now, 0.15, 1200);
  }

  /** 얼림 — 수정 톤 (고음 sine + modulation) */
  playIce(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    // 여러 톤을 동시에 (chord 느낌)
    for (const f of ICE_CHORD_FREQUENCIES) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.55);
    }
    // 짧은 노이즈 (얼어붙는 느낌)
    this.playNoise(0.15, now, 0.08, 4000);
  }

  /** OUT (잡힘) — 저음 둔탁 + 노이즈 */
  playOut(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    // 1) 저음 둔탁
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.65);

    // 2) 노이즈 임팩트
    this.playNoise(0.3, now, 0.25, 800);
  }

  /** 흡수 시작 (1초 유지 시작) */
  playAbsorbStart(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    // 짧은 ascending tone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.15);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** 흡수 완료 (가속 부여) — 화려한 chord */
  playAbsorbComplete(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    for (const f of ABSORB_COMPLETE_FREQUENCIES) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.65);
    }
  }

  /** 자국 흡수 취소 (탐색 실패) */
  playAbsorbCancel(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** v34: 승리 팡파레 — C-E-G-C 메이저 아르페지오 + 코러스 */
  playWin(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (const note of WIN_ARPEGGIO) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.frequency, now + note.startAt);
      gain.gain.setValueAtTime(0, now + note.startAt);
      gain.gain.linearRampToValueAtTime(0.15, now + note.startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.startAt + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + note.startAt);
      osc.stop(now + note.startAt + 0.2);
    }
    // 마지막 음에 화음 추가
    for (const note of WIN_FINAL_CHORD) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.frequency, now + note.startAt);
      gain.gain.setValueAtTime(0, now + note.startAt);
      gain.gain.linearRampToValueAtTime(0.1, now + note.startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.startAt + 0.6);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + note.startAt);
      osc.stop(now + note.startAt + 0.65);
    }
  }

  /** v34: 패배 — sad trombone (하강 톤) */
  playLose(): void {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (const note of LOSE_DESCENT) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(note.frequency, now + note.startAt);
      gain.gain.setValueAtTime(0, now + note.startAt);
      gain.gain.linearRampToValueAtTime(0.12, now + note.startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.startAt + note.duration);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + note.startAt);
      osc.stop(now + note.startAt + note.duration + 0.05);
    }
  }

  // ===== 음악 (앰비언트 드론) =====

  startMusic(): void {
    if (!this.enabled || !this.ctx || !this.musicGain || this.musicOsc) return;
    this.musicEnabled = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1) 기본 드론 (저음 sine)
    this.musicOsc = ctx.createOscillator();
    const droneGain = ctx.createGain();
    this.musicOsc.type = 'sine';
    this.musicOsc.frequency.setValueAtTime(55, now); // A1
    droneGain.gain.setValueAtTime(0, now);
    droneGain.gain.linearRampToValueAtTime(0.18, now + 1.5);
    this.musicOsc.connect(droneGain);
    droneGain.connect(this.musicGain);
    this.musicOsc.start(now);

    // 2) LFO (저주파 변조) — 약간의 떨림
    this.musicLfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    this.musicLfo.type = 'sine';
    this.musicLfo.frequency.setValueAtTime(0.2, now); // 5초 주기
    lfoGain.gain.setValueAtTime(2, now);
    this.musicLfo.connect(lfoGain);
    lfoGain.connect(this.musicOsc.frequency);
    this.musicLfo.start(now);
  }

  stopMusic(): void {
    if (!this.musicOsc || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.musicOsc.stop(now + 0.3);
    this.musicOsc = null;
    if (this.musicLfo) {
      this.musicLfo.stop(now + 0.3);
      this.musicLfo = null;
    }
    this.musicEnabled = false;
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  // ===== 내부: 노이즈 버스트 (low/highpass filter) =====

  private playNoise(duration: number, when: number, peak: number, freq: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;

    const gain = this.ctx.createGain();
    gain.gain.value = peak;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(when);
    src.stop(when + duration);
  }

  dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
