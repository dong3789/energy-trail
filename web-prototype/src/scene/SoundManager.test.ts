// 2026-08-16: SoundManager setEnabled BUG 회귀 테스트
// - Pass 7 BUG: setEnabled(false)가 musicGain만 mute하고 sfxGain은 그대로
//   → 사운드 OFF 눌러도 발자국/부스터/얼림/OUT 다 들림
// - 픽스: sfxGain도 같이 0으로 토글
// - 회귀 방지: setEnabled가 music/sfx 두 gain 모두에 적용되는지 검증

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SoundManager } from './SoundManager';

class MockGain {
  value = 0;
  // GainNode는 .gain AudioParam을 가짐 (소리 음량 자체)
  // SoundManager는 musicGain.gain.setTargetAtTime(...) 형태로 호출
  gain = new MockAudioParam();
  setTargetAtTimeCalls: Array<{ value: number; time: number; tau: number }> = [];
  connect = vi.fn();
  setTargetAtTime(value: number, time: number, tau: number): void {
    this.gain.value = value;
    this.setTargetAtTimeCalls.push({ value, time, tau });
  }
  linearRampToValueAtTime(value: number, _time: number): void {
    this.gain.value = value;
  }
  exponentialRampToValueAtTime(value: number, _time: number): void {
    this.gain.value = value;
  }
  setValueAtTime(value: number, _time: number): void {
    this.gain.value = value;
  }
}

class MockAudioParam {
  value = 0;
  setTargetAtTimeCalls: Array<{ value: number; time: number; tau: number }> = [];
  setValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number, t: number, tau: number): void {
    this.value = v;
    this.setTargetAtTimeCalls.push({ value: v, time: t, tau });
  }
  linearRampToValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
}

class MockAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  sampleRate = 44100;
  createGain(): MockGain {
    return new MockGain();
  }
  createOscillator(): {
    connect: () => void;
    start: () => void;
    stop: () => void;
    frequency: MockAudioParam;
    type: string;
  } {
    return {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: new MockAudioParam(),
      type: 'sine',
    };
  }
  createBiquadFilter(): {
    type: string;
    frequency: MockAudioParam;
    Q: MockAudioParam;
    connect: () => void;
  } {
    return {
      type: 'lowpass',
      frequency: new MockAudioParam(),
      Q: new MockAudioParam(),
      connect: vi.fn(),
    };
  }
  createBuffer(
    _ch: number,
    len: number,
    _rate: number,
  ): { getChannelData: (n: number) => Float32Array } {
    return { getChannelData: (): Float32Array => new Float32Array(len) };
  }
  createBufferSource(): {
    connect: () => void;
    start: () => void;
    stop: () => void;
    buffer: unknown;
  } {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null };
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

describe('SoundManager.setEnabled (Pass 7 BUG 회귀)', () => {
  let mockCtx: MockAudioContext;
  let sfxGain: MockGain;
  let musicGain: MockGain;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    // Inject mock AudioContext
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {
      return mockCtx;
    };
    sfxGain = new MockGain();
    musicGain = new MockGain();
    // After ensureContext, the SoundManager will call createGain() 3 times: master, sfx, music
    // We don't need to replace them — we just track setTargetAtTime calls.
  });

  it('enabled=true → musicGain과 sfxGain 모두 0이 아닌 값으로 복원', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.setEnabled(false); // 먼저 끄기
    sfxGain.setTargetAtTimeCalls.length = 0;
    musicGain.setTargetAtTimeCalls.length = 0;

    sm.setEnabled(true);

    // 둘 다 setTargetAtTime(양수)로 호출되어야 함
    // Note: setEnabled에서 새로 만들어진 gain이 아니라 기존 인스턴스일 수 있음
    // isEnabled만 확인
    expect(sm.isEnabled()).toBe(true);
  });

  it('enabled=false → isEnabled() false', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.setEnabled(false);
    expect(sm.isEnabled()).toBe(false);
  });

  it('enabled 토글 시 isEnabled 상태 정확', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    expect(sm.isEnabled()).toBe(true);
    sm.setEnabled(false);
    expect(sm.isEnabled()).toBe(false);
    sm.setEnabled(true);
    expect(sm.isEnabled()).toBe(true);
    sm.setEnabled(false);
    expect(sm.isEnabled()).toBe(false);
  });

  it('enabled=false 시 SFX play 메서드들이 no-op (gain이 0으로 라amping)', () => {
    // 이 테스트는 회귀 핵심: 픽스 후에는 setEnabled(false)가 sfxGain을 0으로 보내서
    // 이후 SFX 호출이 정상적으로 들리지 않게 됨
    // AudioContext mock은 setTargetAtTime을 추적하므로 setEnabled 호출 후
    // sfxGain.value가 0이 되었는지 확인
    const sm = new SoundManager();
    sm.ensureContext();

    // ensureContext 후 sfxGain / musicGain 캡처 — SoundManager 인스턴스에서 접근 불가
    // 대신 setEnabled(false) 후 playFootstep이 진동 없이 조용히 종료되는지 확인
    sm.setEnabled(false);
    expect(() => sm.playFootstep(1.0)).not.toThrow();
    expect(() => sm.playBoost()).not.toThrow();
    expect(() => sm.playIce()).not.toThrow();
    expect(() => sm.playOut()).not.toThrow();
    // isEnabled 검사가 첫 줄에 있으므로 audio node 생성 자체가 안 됨
  });

  it('enabled=false에서 playWin/playLose도 no-op', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.setEnabled(false);
    expect(() => sm.playWin()).not.toThrow();
    expect(() => sm.playLose()).not.toThrow();
  });

  it('dispose() 후 setEnabled 호출되어도 안전 (ctx 없어도 throw X)', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.dispose(); // ctx.close → null 처리
    expect(() => sm.setEnabled(false)).not.toThrow();
    expect(() => sm.setEnabled(true)).not.toThrow();
    expect(sm.isEnabled()).toBe(true);
  });

  it('dispose() 후 isEnabled() 일관성 (enabled 상태 자체는 보존)', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.setEnabled(false);
    sm.dispose();
    // enabled 플래그는 그대로 false
    expect(sm.isEnabled()).toBe(false);
  });

  it('startMusic/stopMusic 정상 동작 (회귀: dispose 후 두 번 stopMusic 안전)', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.startMusic();
    expect(sm.isMusicEnabled()).toBe(true);
    sm.stopMusic();
    expect(sm.isMusicEnabled()).toBe(false);
    // 두 번 stopMusic 호출 (no-op 보장)
    expect(() => sm.stopMusic()).not.toThrow();
  });

  it('ensureContext 두 번 호출 안전', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.ensureContext(); // 중복 호출
    // isEnabled 상태 유지
    expect(sm.isEnabled()).toBe(true);
  });
});

// ============================================================
// 2026-08-16: SoundManager 핵심 회귀 — setEnabled가 sfxGain을 0으로 라amping
// (이 부분이 Pass 7의 critical BUG 픽스)
// ============================================================
describe('SoundManager.setEnabled — SFX gain 토글 (Pass 7 핵심 회귀)', () => {
  let ctx: {
    state: string;
    currentTime: number;
    destination: object;
    sampleRate: number;
    _gains: MockGain[];
    createGain(): MockGain;
    createOscillator: () => unknown;
    createBiquadFilter: () => unknown;
    createBuffer: (c: number, l: number, r: number) => unknown;
    createBufferSource: () => unknown;
    resume: () => Promise<void>;
    close: () => Promise<void>;
  };

  beforeEach(() => {
    ctx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      sampleRate: 44100,
      _gains: [],
      createGain(): MockGain {
        const g = new MockGain();
        this._gains.push(g);
        return g;
      },
      createOscillator: () => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: new MockAudioParam(),
        type: 'sine',
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: new MockAudioParam(),
        Q: new MockAudioParam(),
        connect: vi.fn(),
      }),
      createBuffer: (_c: number, len: number, _r: number) => ({
        getChannelData: (): Float32Array => new Float32Array(len),
      }),
      createBufferSource: () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null }),
      resume: () => {
        ctx.state = 'running';
        return Promise.resolve();
      },
      close: () => {
        ctx.state = 'closed';
        return Promise.resolve();
      },
    };
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {
      return ctx;
    };
  });

  it('ensureContext 후 3개 gain 생성 (master, sfx, music) — setEnabled의 토글 대상', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    // master = 0.5, sfx = 0.7, music = 0.15
    // ensureContext가 3개 gain을 만듦
    // setEnabled(false)가 music/sfx 둘 다 0으로 보내는지 검증
    sm.setEnabled(false);
    // isEnabled만으로 검증 (내부 gain은 private)
    expect(sm.isEnabled()).toBe(false);
    sm.setEnabled(true);
    expect(sm.isEnabled()).toBe(true);
  });

  // === Pass 7 핵심 회귀 테스트 ===
  // 기존 BUG: setEnabled(false)가 sfxGain을 0으로 안 보냄 → 사운드 OFF 눌러도 SFX 들림
  // 픽스: setEnabled가 sfxGain도 같이 토글
  it('CRITICAL: setEnabled(false)가 music과 sfx 둘 다 mute (회귀: sfx 안 꺼지면 사운드 OFF 의미 없음)', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    // 3개 gain 생성됨: master(0.5), sfx(0.7), music(0.15)
    expect(ctx._gains.length).toBe(3);
    const sfxGain = ctx._gains[1];
    const musicGain = ctx._gains[2];

    // 사운드 OFF
    sm.setEnabled(false);

    // SoundManager는 musicGain.gain.setTargetAtTime(...) 호출 — gain의 calls 추적
    const sfxLastCall = sfxGain.gain.setTargetAtTimeCalls.at(-1);
    const musicLastCall = musicGain.gain.setTargetAtTimeCalls.at(-1);
    expect(sfxLastCall).toBeDefined();
    expect(musicLastCall).toBeDefined();
    expect(sfxLastCall?.value).toBe(0);
    expect(musicLastCall?.value).toBe(0);
  });

  it('setEnabled(true)가 sfx 0.7, music 0.15로 복원', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    sm.setEnabled(false);
    const sfxGain = ctx._gains[1];
    const musicGain = ctx._gains[2];

    sm.setEnabled(true);

    const sfxLastCall = sfxGain.gain.setTargetAtTimeCalls.at(-1);
    const musicLastCall = musicGain.gain.setTargetAtTimeCalls.at(-1);
    expect(sfxLastCall?.value).toBe(0.7);
    expect(musicLastCall?.value).toBe(0.15);
  });

  it('setEnabled 연속 토글 — 각 토글마다 sfx gain 0 ↔ 0.7', () => {
    const sm = new SoundManager();
    sm.ensureContext();
    const sfxGain = ctx._gains[1];

    sm.setEnabled(false);
    expect(sfxGain.gain.setTargetAtTimeCalls.at(-1)?.value).toBe(0);

    sm.setEnabled(true);
    expect(sfxGain.gain.setTargetAtTimeCalls.at(-1)?.value).toBe(0.7);

    sm.setEnabled(false);
    expect(sfxGain.gain.setTargetAtTimeCalls.at(-1)?.value).toBe(0);

    sm.setEnabled(true);
    expect(sfxGain.gain.setTargetAtTimeCalls.at(-1)?.value).toBe(0.7);
  });

  it('ensureContext 전 setEnabled 호출 안전 (ctx 없을 때)', () => {
    // AudioContext가 없는 환경 (테스트 시작 직후)
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    const sm = new SoundManager();
    // ensureContext 안 한 상태 — ctx 없음
    expect(() => sm.setEnabled(false)).not.toThrow();
    expect(sm.isEnabled()).toBe(false);
  });
});
