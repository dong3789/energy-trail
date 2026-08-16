import './style.css';
import * as THREE from 'three';
import {
  SCENE,
  MAP,
  PLAYER,
  OBSTACLES_BY_MAP,
  GAME,
  SPEED_TIERS,
  MAPS,
  type MapId,
  type MapDef,
  type SpeedTier,
} from './config';
import { createScene, startRenderLoop, type SceneContext } from './scene/SceneSetup';
import { buildMap, buildExitPoint, disposeMap } from './scene/MapBuilder';
import { PlayerController } from './scene/PlayerController';
import { TaggerAI } from './scene/TaggerAI';
import { TrailEmitter } from './scene/TrailEmitter';
import { RunnerAIStub } from './scene/RunnerAIStub';
import { IceSystem } from './scene/IceSystem';
import { BoostSystem } from './scene/BoostSystem';
import { Joystick, isMobileLike } from './scene/TouchController';
import { addCharacterFeatures } from './scene/CharacterFactory';
import { DustSystem } from './scene/DustSystem';
import { SoundManager } from './scene/SoundManager';
import { AbsorbSystem } from './scene/AbsorbSystem';
import { escapeHtml } from './lib/html-escape';

type Screen = 'intro' | 'login' | 'character' | 'role' | 'map-select' | 'lobby' | 'room' | 'game';
type CharacterId = 'runner-cyan' | 'runner-pink' | 'runner-yellow' | 'runner-purple';
type Role = 'tagger' | 'runner';

interface Profile {
  nickname: string;
  characterId: CharacterId;
  role: Role;
  // 2026-08-15: 맵 선택
  mapId: MapId;
}

interface GameState {
  ctx: SceneContext | null;
  stopLoop: (() => void) | null;
  player: PlayerController | null;
  tagger: TaggerAI | null;
  trails: TrailEmitter | null;
  speedButtons: HTMLButtonElement[];
  speedStatus: HTMLElement | null;
  statusTimer: HTMLElement | null;
  statusHud: HTMLElement | null;
  outOverlay: HTMLElement | null;
  outReason: string;
  out: boolean;
  ice: IceSystem | null;
  iceKeyHandler: ((e: KeyboardEvent) => void) | null;
  boost: BoostSystem | null;
  boostKeyHandler: ((e: KeyboardEvent) => void) | null;
  joystick: Joystick | null;
  dust: DustSystem | null; // 2026-08-15: 발밑 먼지 파티클
  speedlines: HTMLElement | null; // 2026-08-15: 부스터 스피드 라인 오버레이
  outFlash: HTMLElement | null; // 2026-08-15: OUT 빨간 비네트 플래시
  sound: SoundManager | null; // 2026-08-15: 절차적 SFX
  absorb: AbsorbSystem | null; // 2026-08-15: 자국 흡수 시스템
  absorbHud: HTMLElement | null; // 2026-08-15: 흡수 진행 HUD
  /**
   * 2026-08-16: 게임 세션 자원 정리 콜백
   * - renderGame 안에서 등록한 DOM/Three.js 이벤트를 teardownGame에서 일괄 해제
   * - addTrackedListener/trackTimer 헬퍼로 push
   */
  disposers: Array<() => void>;
  /**
   * 2026-08-16: 맵 자원 참조 — teardownGame에서 disposeMap()으로 GPU 메모리 해제
   */
  mapRefs: import('./scene/MapBuilder').MapRefs | null;
  /**
   * 2026-08-16: 출구 지점 메시 — teardownGame에서 dispose
   */
  exitDisc: THREE.Mesh | null;
}

// 2026-08-09 v2: 캐릭터 식별용 머리 위 라벨 (캔버스 → Sprite). 카메라 오비팅과 무관하게 항상 정면.
function addPlayerLabel(
  scene: THREE.Scene,
  anchor: THREE.Vector3,
  text: string,
  colorHex: number,
  offsetY: number,
  isSelf = false,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 2026-08-15 v34: Fall Guys 카툰 라벨 — 흰색 둥근 캡슐 + 두꺼운 검은 테두리 + 노란 그림자
  const hex = colorHex.toString(16);
  const cssColor = `#${('000000' + hex).slice(-6)}`;
  // 노란 그림자 (오프셋)
  ctx.fillStyle = '#fff44a';
  const radius = 28;
  const w = canvas.width - 12;
  const h = canvas.height - 12;
  ctx.beginPath();
  ctx.moveTo(12 + radius, 6);
  ctx.lineTo(12 + w - radius, 6);
  ctx.quadraticCurveTo(12 + w, 6, 12 + w, 6 + radius);
  ctx.lineTo(12 + w, 6 + h - radius);
  ctx.quadraticCurveTo(12 + w, 6 + h, 12 + w - radius, 6 + h);
  ctx.lineTo(12 + radius, 6 + h);
  ctx.quadraticCurveTo(12, 6 + h, 12, 6 + h - radius);
  ctx.lineTo(12, 6 + radius);
  ctx.quadraticCurveTo(12, 6, 12 + radius, 6);
  ctx.closePath();
  ctx.fill();
  // 메인 흰색 캡슐 (오프셋 적용)
  const offset = 4;
  ctx.beginPath();
  ctx.moveTo(12 - offset + radius, 6 - offset);
  ctx.lineTo(12 - offset + w - radius, 6 - offset);
  ctx.quadraticCurveTo(12 - offset + w, 6 - offset, 12 - offset + w, 6 - offset + radius);
  ctx.lineTo(12 - offset + w, 6 - offset + h - radius);
  ctx.quadraticCurveTo(12 - offset + w, 6 - offset + h, 12 - offset + w - radius, 6 - offset + h);
  ctx.lineTo(12 - offset + radius, 6 - offset + h);
  ctx.quadraticCurveTo(12 - offset, 6 - offset + h, 12 - offset, 6 - offset + h - radius);
  ctx.lineTo(12 - offset, 6 - offset + radius);
  ctx.quadraticCurveTo(12 - offset, 6 - offset, 12 - offset + radius, 6 - offset);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // 두꺼운 검은 테두리
  ctx.strokeStyle = '#2a1a4a';
  ctx.lineWidth = 5;
  ctx.stroke();
  // 자기(나)는 작은 "나" 배지 추가
  if (isSelf) {
    ctx.fillStyle = '#ff5c8a';
    ctx.beginPath();
    ctx.arc(36, canvas.height / 2, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1a4a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Nunito", ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('나', 36, canvas.height / 2 + 1);
  }
  // 닉네임 텍스트
  ctx.fillStyle = '#2a1a4a';
  ctx.font = 'bold 36px "Nunito", "Quicksand", ui-rounded, system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textX = isSelf ? canvas.width / 2 + 16 : canvas.width / 2;
  ctx.fillText(text, textX, canvas.height / 2);
  // 닉네임이 너무 길면 잘라내기
  if (ctx.measureText(text).width > 200) {
    // 다시 그려서 자르기
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 노란 그림자 + 흰 캡슐 + 테두리 다시 (생략 — 너무 김)
    // 단순 처리: 폰트 줄이기
    ctx.font = 'bold 30px "Nunito", "Quicksand", ui-rounded, system-ui, sans-serif';
    ctx.fillStyle = '#2a1a4a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, textX, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.84, 1); // 320:112 비율
  sprite.position.set(anchor.x, anchor.y + offsetY, anchor.z);
  sprite.renderOrder = 999;
  scene.add(sprite);
}

// Phase B: 속도 버튼 active 상태 갱신 + HUD 텍스트
function updateSpeedButtons(tier: SpeedTier): void {
  for (const btn of game.speedButtons) {
    if (btn.dataset.tier === tier) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }
  if (game.speedStatus) {
    const info = SPEED_TIERS[tier];
    game.speedStatus.textContent = `${info.label} ×${info.multiplier.toFixed(1)}`;
  }
}

const characters: Array<{ id: CharacterId; label: string; color: string }> = [
  { id: 'runner-cyan', label: '시안', color: '#4dd0e1' },
  { id: 'runner-yellow', label: '옐로우', color: '#ffd83d' },
  { id: 'runner-purple', label: '퍼플', color: '#9b59b6' },
  // 2026-08-16: 술래(#ff5c8a)와 구별되는 라이트 핑크
  { id: 'runner-pink', label: '핑크', color: '#ff9eb5' },
];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱 컨테이너를 찾을 수 없습니다.');
const root = app;

let screen: Screen = 'intro';
const profile: Profile = {
  nickname: '',
  characterId: 'runner-cyan',
  role: 'runner',
  mapId: 'park',
};
let roomCode = '';
let roomMode: 'find' | 'create' = 'find';
const game: GameState = {
  ctx: null,
  stopLoop: null,
  player: null,
  tagger: null,
  trails: null,
  speedButtons: [],
  speedStatus: null,
  statusTimer: null,
  statusHud: null,
  outOverlay: null,
  outReason: '',
  out: false,
  ice: null,
  iceKeyHandler: null,
  boost: null,
  boostKeyHandler: null,
  joystick: null,
  dust: null,
  speedlines: null,
  outFlash: null,
  sound: null,
  absorb: null,
  absorbHud: null,
  disposers: [],
  mapRefs: null,
  exitDisc: null,
};

// 2026-08-16: 추적형 리스너 등록 — teardown에서 자동 해제
// - canvasHost/window에 등록하는 모든 리스너는 이걸 통해 등록
// - addEventListener를 직접 부르면 teardownGame이 못 찾음 → 누수
function addTrackedListener(
  target: EventTarget,
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: any,
  options?: AddEventListenerOptions | boolean,
): void {
  target.addEventListener(type, handler, options);
  game.disposers.push(() => target.removeEventListener(type, handler, options));
}

// 2026-08-16: 추적형 setTimeout — teardown에서 자동 클리어 (씬 떠난 뒤 콜백 방지)
function trackTimeout(callback: () => void, ms: number): number {
  const id = window.setTimeout(callback, ms);
  // 이미 실행된 timeout은 clearTimeout이 no-op이라 안전
  game.disposers.push(() => window.clearTimeout(id));
  return id;
}

function setScreen(next: Screen): void {
  // 게임 화면을 떠날 때 Three.js 자원 정리
  if (screen === 'game' && next !== 'game') {
    teardownGame();
  }
  screen = next;
  render();
}

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = `button ${className}`.trim();
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

function panel(title: string, subtitle: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'panel';
  element.innerHTML = `<p class="eyebrow">ENERGY TRAIL</p><h1>${title}</h1><p class="subtitle">${subtitle}</p>`;
  return element;
}

// ============================================================
// 2026-08-15 v29: 게임 준비화면 전면 개편
// - 디자인 원칙: 명확한 시각 계층, 컬러 일관성, 친근한 빈 상태
// - 로비: 3가지 모드 (혼자 AI / 방 만들기 / 방 참여)
// - 맵: 일러스트 + 별점 + 추천 배지
// - 캐릭터/역할: 실루엣 + 능력 표시
// - 로비 → 게임: 한 번에 진입
// ============================================================

function renderIntro(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-intro';
  // 2026-08-15 v29: 자국 — 드라마틱 인트로
  content.innerHTML = `
    <div class="intro-eyebrow">ENERGY TRAIL</div>
    <h1 class="intro-title">자국</h1>
    <p class="intro-tagline">술래가 흘린 흔적을 뒤집어쓰고,<br/>어둠을 빠져나가세요.</p>
    <div class="intro-trail" aria-hidden="true">
      <span class="intro-trail-dot"></span>
      <span class="intro-trail-dot"></span>
      <span class="intro-trail-dot"></span>
      <span class="intro-trail-dot"></span>
      <span class="intro-trail-dot"></span>
    </div>
    <div class="intro-meta">
      <div class="intro-meta-row"><span>장르</span><strong>1:1 추격 · 모바일</strong></div>
      <div class="intro-meta-row"><span>시간</span><strong>한 판 2분 30초</strong></div>
      <div class="intro-meta-row"><span>키</span><strong>WASD · Space · F · Shift</strong></div>
    </div>
    <button type="button" class="button primary intro-cta">시작하기</button>
  `;
  const cta = content.querySelector<HTMLButtonElement>('.intro-cta');
  cta?.addEventListener('click', () => setScreen('login'));
  root.append(content);
}

function renderLogin(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-login';
  content.innerHTML = `
    <div class="login-eyebrow">STEP 1 / 2</div>
    <h1 class="login-title">닉네임 설정</h1>
    <p class="login-sub">시연용 로그인입니다. 닉네임만 입력하면 됩니다.</p>
    <form class="login-form" novalidate>
      <label for="nickname">닉네임</label>
      <div class="login-input-wrap">
        <input id="nickname" class="login-input" maxlength="12" placeholder="예: Mungz" autocomplete="off" />
        <span class="login-counter" id="login-counter">0 / 12</span>
      </div>
      <p class="login-hint">한글/영문/숫자 12자 이내</p>
      <div class="login-error" id="login-error">닉네임을 입력해주세요</div>
    </form>
    <div class="login-actions">
      <button type="button" class="button primary login-next">다음</button>
    </div>
  `;
  const input = content.querySelector<HTMLInputElement>('#nickname');
  const counter = content.querySelector<HTMLElement>('#login-counter');
  const errBox = content.querySelector<HTMLElement>('#login-error');
  const nextBtn = content.querySelector<HTMLButtonElement>('.login-next');
  if (!input || !counter || !errBox || !nextBtn) throw new Error('로그인 UI 구성 실패');
  input.value = profile.nickname;
  const updateCounter = (): void => {
    counter.textContent = `${input.value.length} / 12`;
    input.classList.remove('invalid');
    errBox.classList.remove('show');
  };
  updateCounter();
  input.addEventListener('input', updateCounter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextBtn.click();
    }
  });
  // 1초 후 자동 포커스
  setTimeout(() => input.focus(), 200);
  const onNext = (): void => {
    const nickname = input.value.trim();
    if (nickname.length < 1) {
      input.classList.add('invalid');
      errBox.classList.add('show');
      input.focus();
      return;
    }
    // 2026-08-16: nickname은 raw로 저장. innerHTML 보간하는 곳(lobby/room/role/result)에서만 escapeHtml()로 감싸기.
    // (캔버스 3D 라벨에는 escape된 글자가 그대로 그려지는 문제 방지)
    profile.nickname = nickname;
    // v32: 캐릭터 선택은 room 안으로 — role로 직행
    setScreen('role');
  };
  nextBtn.addEventListener('click', onNext);
  root.append(content);
}

function renderCharacter(): void {
  // v32: 캐릭터 선택은 room 안으로 통합 — 호출되면 login으로 리다이렉트
  setScreen('login');
}

function renderRole(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-role';
  content.innerHTML = `
    <div class="role-eyebrow">STEP 2 / 2 · <span class="muted">${escapeHtml(profile.nickname)}님</span></div>
    <h1 class="role-title">역할 선택</h1>
    <p class="role-sub">ff팀, 이번 판에서 어떤 역할을 하시겠어요?</p>
    <div class="role-grid">
      <button type="button" class="role-card role-tagger" data-role="tagger">
        <div class="role-figure role-figure-tagger">
          <div class="role-figure-head"></div>
          <div class="role-figure-body"></div>
          <div class="role-figure-eyes"></div>
        </div>
        <div class="role-info">
          <span class="role-badge">TAGGER</span>
          <span class="role-label">술래</span>
          <span class="role-desc">도망자를 잡고, 자국으로 교란</span>
        </div>
        <ul class="role-abilities">
          <li><span class="role-ability-key">Space / B</span> 부스터 (1사이클 4회)</li>
          <li><span class="role-ability-key">F · 클릭</span> 포박줄 사격 (20m)</li>
          <li><span class="role-ability-key">Shift</span> 짧은 대시</li>
        </ul>
        <span class="role-check">✓</span>
      </button>
      <button type="button" class="role-card role-runner" data-role="runner">
        <div class="role-figure role-figure-runner">
          <div class="role-figure-head"></div>
          <div class="role-figure-body"></div>
        </div>
        <div class="role-info">
          <span class="role-badge role-badge-runner">RUNNER</span>
          <span class="role-label">도망자</span>
          <span class="role-desc">자국을 흡수해 출구로</span>
        </div>
        <ul class="role-abilities">
          <li><span class="role-ability-key">E</span> 자국 흡수 → 4초 가속 + 2초 무적</li>
          <li><span class="role-ability-key">F</span> 술래 동결 (3초)</li>
          <li><span class="role-ability-key">Shift</span> 짧은 대시</li>
        </ul>
        <span class="role-check">✓</span>
      </button>
    </div>
    <div class="role-actions">
      <button type="button" class="button ghost role-back">← 닉네임 다시</button>
      <button type="button" class="button primary role-next">로비로 →</button>
    </div>
  `;
  const grid = content.querySelector('.role-grid');
  if (!grid) throw new Error('역할 그리드 없음');
  const applySelection = (role: Role): void => {
    profile.role = role;
    grid.querySelectorAll('.role-card').forEach((c) => c.classList.remove('selected'));
    grid.querySelector(`.role-card[data-role="${role}"]`)?.classList.add('selected');
  };
  // 초기 selected
  grid.querySelector(`.role-card[data-role="${profile.role}"]`)?.classList.add('selected');
  grid.querySelectorAll<HTMLButtonElement>('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      const r = card.dataset.role as Role;
      if (r) applySelection(r);
    });
  });
  const backBtn = content.querySelector<HTMLButtonElement>('.role-back');
  const nextBtn = content.querySelector<HTMLButtonElement>('.role-next');
  // v32: 캐릭터 단계 제거 → role back = login
  backBtn?.addEventListener('click', () => setScreen('login'));
  nextBtn?.addEventListener('click', () => setScreen('lobby'));
  root.append(content);
}

function renderMapSelect(): void {
  // v31: 맵 선택은 room 안으로 통합됨 — 호출되면 lobby로 리다이렉트
  setScreen('lobby');
}

function renderLobby(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-lobby';
  content.innerHTML = `
    <div class="lobby-eyebrow">로비 · <span class="muted">${escapeHtml(profile.nickname)}님</span></div>
    <h1 class="lobby-title">로비</h1>
    <p class="lobby-sub">ff팀, 게임을 시작할 방을 선택하세요.</p>
    <div class="lobby-summary">
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">역할</span>
        <strong class="lobby-summary-value">${profile.role === 'tagger' ? '🍑 술래' : '💎 도망자'}</strong>
      </div>
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">닉네임</span>
        <strong class="lobby-summary-value">${escapeHtml(profile.nickname)}</strong>
      </div>
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">모드</span>
        <strong class="lobby-summary-value">3 모드</strong>
      </div>
    </div>
    <div class="lobby-modes">
      <button type="button" class="lobby-mode lobby-mode-solo">
        <div class="lobby-mode-icon">🎮</div>
        <div class="lobby-mode-info">
          <span class="lobby-mode-title">혼자 시작</span>
          <span class="lobby-mode-desc">AI와 즉시 1:1 매치</span>
        </div>
        <span class="lobby-mode-arrow">→</span>
      </button>
      <button type="button" class="lobby-mode lobby-mode-create">
        <div class="lobby-mode-icon">＋</div>
        <div class="lobby-mode-info">
          <span class="lobby-mode-title">방 만들기</span>
          <span class="lobby-mode-desc">친구를 코드로 초대 (최대 5인)</span>
        </div>
        <span class="lobby-mode-arrow">→</span>
      </button>
      <button type="button" class="lobby-mode lobby-mode-find">
        <div class="lobby-mode-icon">⌕</div>
        <div class="lobby-mode-info">
          <span class="lobby-mode-title">방 찾기</span>
          <span class="lobby-mode-desc">공개 방에 참여</span>
        </div>
        <span class="lobby-mode-arrow">→</span>
      </button>
    </div>
    <div class="lobby-actions">
      <button type="button" class="button ghost lobby-back">← 역할 다시</button>
    </div>
  `;
  const soloBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-solo');
  const createBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-create');
  const findBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-find');
  const backBtn = content.querySelector<HTMLButtonElement>('.lobby-back');
  soloBtn?.addEventListener('click', () => {
    // v31: 혼자 시작 = 솔로, 기본 맵 사용
    setScreen('game');
  });
  createBtn?.addEventListener('click', () => {
    roomMode = 'create';
    roomCode = String(Math.floor(1000 + Math.random() * 9000));
    setScreen('room');
  });
  findBtn?.addEventListener('click', () => {
    roomMode = 'find';
    roomCode = '----';
    setScreen('room');
  });
  backBtn?.addEventListener('click', () => setScreen('role'));
  root.append(content);
}

function renderRoom(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-room';
  const isCreate = roomMode === 'create';
  const mapEntries = Object.entries(MAPS);
  content.innerHTML = `
    <div class="room-eyebrow">${isCreate ? '방 대기실' : '방 찾기'} · <span class="muted">${escapeHtml(profile.nickname)}님</span></div>
    <h1 class="room-title">${isCreate ? '방 대기실' : '방 찾기'}</h1>
    <p class="room-sub">${isCreate ? '캐릭터와 맵을 정하고 친구를 기다리세요.' : '캐릭터와 맵을 정하고 시작하세요.'}</p>
    <div class="room-hero">
      <div class="room-code-block">
        <span class="room-code-label">ROOM CODE</span>
        <div class="room-code-digits">
          ${(isCreate ? roomCode : '----')
            .split('')
            .map((c) => `<span class="room-code-digit">${c}</span>`)
            .join('')}
        </div>
        <span class="room-code-status">${isCreate ? '대기 중' : '코드 입력 대기'}</span>
      </div>
    </div>
    <div class="room-character-section">
      <div class="room-character-section-label">내 캐릭터</div>
      <div class="room-character-grid" id="room-character-grid"></div>
    </div>
    <div class="room-map-section">
      <div class="room-map-section-label">맵 선택</div>
      <div class="room-map-grid" id="room-map-grid"></div>
    </div>
    <div class="room-players">
      <div class="room-player room-player-self">
        <span class="room-player-dot" id="room-self-dot" style="background:${characters.find((c) => c.id === profile.characterId)?.color ?? '#00e5ff'}"></span>
        <span class="room-player-name">${escapeHtml(profile.nickname)}</span>
        <span class="room-player-status ready" id="room-self-status">준비 전</span>
      </div>
      <div class="room-player room-player-empty"><span class="room-player-empty-icon">+</span> 빈 자리</div>
      <div class="room-player room-player-empty"><span class="room-player-empty-icon">+</span> 빈 자리</div>
      <div class="room-player room-player-empty"><span class="room-player-empty-icon">+</span> 빈 자리</div>
      <div class="room-player room-player-empty"><span class="room-player-empty-icon">+</span> 빈 자리</div>
    </div>
    <div class="room-actions">
      <button type="button" class="button secondary room-ready" id="room-ready-btn">
        <span class="room-ready-icon">✓</span> 준비하기
      </button>
      <button type="button" class="button primary room-start">🎮 게임 시작 →</button>
      <button type="button" class="button ghost room-back">← 로비로</button>
    </div>
  `;
  // v32: 인라인 캐릭터 선택 — 4개 젤리빈 칩
  const characterGrid = content.querySelector<HTMLElement>('#room-character-grid');
  if (characterGrid) {
    for (const character of characters) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `room-character-card ${profile.characterId === character.id ? 'selected' : ''}`;
      card.style.setProperty('--character-color', character.color);
      card.innerHTML = `
        <div class="room-character-figure">
          <div class="room-character-body"></div>
          <div class="room-character-head"></div>
        </div>
        <div class="room-character-label">${character.label}</div>
        <div class="room-character-check">✓</div>
      `;
      card.addEventListener('click', () => {
        profile.characterId = character.id;
        characterGrid
          .querySelectorAll('.room-character-card')
          .forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        // 플레이어 리스트의 닷도 즉시 반영
        const selfDot = content.querySelector<HTMLElement>('#room-self-dot');
        if (selfDot) selfDot.style.background = character.color;
      });
      characterGrid.append(card);
    }
  }
  // 인라인 맵 선택
  const mapGrid = content.querySelector<HTMLElement>('#room-map-grid');
  if (mapGrid) {
    for (const [id, map] of mapEntries) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `room-map-card ${profile.mapId === id ? 'selected' : ''}`;
      card.style.setProperty('--map-color-a', `#${map.skyColor.toString(16).padStart(6, '0')}`);
      card.style.setProperty('--map-color-b', `#${map.groundColor.toString(16).padStart(6, '0')}`);
      card.style.setProperty(
        '--map-accent',
        `#${map.buildingColorA.toString(16).padStart(6, '0')}`,
      );
      card.innerHTML = `
        <div class="room-map-preview">
          <div class="room-map-sky"></div>
          <div class="room-map-ground"></div>
          <div class="room-map-building" style="left:20%;height:50%"></div>
          <div class="room-map-building" style="left:45%;height:65%"></div>
          <div class="room-map-building" style="left:70%;height:45%"></div>
        </div>
        <div class="room-map-name">${map.name}</div>
        <div class="room-map-check">✓</div>
      `;
      card.addEventListener('click', () => {
        profile.mapId = id as MapId;
        mapGrid.querySelectorAll('.room-map-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      mapGrid.append(card);
    }
  }
  const readyBtn = content.querySelector<HTMLButtonElement>('#room-ready-btn');
  const selfStatus = content.querySelector<HTMLElement>('#room-self-status');
  const startBtn = content.querySelector<HTMLButtonElement>('.room-start');
  const backBtn = content.querySelector<HTMLButtonElement>('.room-back');
  let isReady = false;
  readyBtn?.addEventListener('click', () => {
    isReady = !isReady;
    if (selfStatus) {
      selfStatus.textContent = isReady ? '준비 완료' : '준비 전';
      selfStatus.classList.toggle('done', isReady);
    }
    if (readyBtn) {
      const icon = readyBtn.querySelector('.room-ready-icon');
      if (icon) icon.textContent = isReady ? '✕' : '✓';
      readyBtn.classList.toggle('done', isReady);
    }
    // 2026-08-16: 시작 버튼 활성화 상태 동기화
    if (startBtn) {
      startBtn.classList.toggle('enabled', isReady);
      startBtn.disabled = !isReady;
    }
  });
  // 2026-08-16: 시작 게이팅 — 준비 안 했으면 비활성. 솔로 모드는 준비 단계 스킵이 자연스러우나,
  // 디자인 일관성 + "방장은 항상 준비됨" 룰로 통일.
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.classList.remove('enabled');
  }
  startBtn?.addEventListener('click', () => {
    if (!isReady) {
      // 비활성 상태지만 강제 클릭 방어
      startBtn.classList.add('shake');
      setTimeout(() => startBtn.classList.remove('shake'), 400);
      return;
    }
    setScreen('game');
  });
  backBtn?.addEventListener('click', () => setScreen('lobby'));
  root.append(content);
}

// ============================================================
// 3D 게임 화면 (Phase A: 정적 씬 + 탈출 지점 시각화)
// Phase B에서 캐릭터 이동 / 자국 / 흡수 / OUT / 승패 추가.
// ============================================================
function renderGame(): void {
  // 풀스크린 3D 캔버스 컨테이너
  const wrap = document.createElement('div');
  wrap.className = 'game-canvas-wrap';

  // Three.js 캔버스가 들어갈 곳 — 키 이벤트 포커스 받기 위해 tabindex 부여
  const canvasHost = document.createElement('div');
  canvasHost.className = 'game-canvas-host';
  canvasHost.tabIndex = 0; // 포커스 가능
  canvasHost.setAttribute('role', 'application');
  canvasHost.setAttribute('aria-label', '게임 화면 (WASD 이동, 1/2/3 속도)');
  wrap.appendChild(canvasHost);
  // 캔버스가 풀스크린 z-index로 위에 있을 때 키 포커스 잃지 않게 즉시 focus
  trackTimeout(() => {
    try {
      canvasHost.focus({ preventScroll: true });
    } catch {
      canvasHost.focus();
    }
  }, 0);

  // v6: 캔버스 호스트에 keydown 리스너 (이전엔 stopPropagation 했는데 window 핸들러 차단 버그)
  // - PlayerController는 inputTarget=window에 등록됨 → 캔버스에서 stopPropagation 하면 window까지 안 가서 키 안 먹힘
  // - 캔버스 풀스크린이라서 stopPropagation 필요 없음 (button은 Space/Enter만 처리)
  // - 비워둠 (이전 코드는 제거)

  // ============================================================
  // 2026-08-15: 카메라 자유 회전/줌 (3인칭 표준)
  // - 데스크탑: 마우스 드래그(좌/우클릭) = 회전, 휠 = 줌
  // - 모바일: 화면 우측 절반 드래그 = 회전
  // - 이동은 WASD(데스크탑) / 가상 조이스틱(모바일) 전담
  // - 카메라 회전/줌은 유지 (되돌아가지 않음)
  // ============================================================
  const camState = {
    yaw: 0, // 실제 적용값 (lerp으로 target에서 따라옴)
    yawTarget: 0, // 2026-08-15: 마우스 드래그 목표값 — smoothing의 대상
    pitch: 0.3,
    pitchTarget: 0.3, // 마찬가지
    distance: 7.0,
    dragPointerId: null as number | null,
    lastX: 0,
    lastY: 0,
    // 2026-08-15 v3: 카메라 모드 — 'chase'(자동 등 뒤) | 'orbit'(자유 회전)
    mode: 'chase' as 'chase' | 'orbit',
    // chase 모드 자동 yaw (캐릭터 진행 방향 따라 회전)
    autoYaw: 0,
  };
  const CAM_LIMITS = {
    // 2026-08-15 v2: 0.005/0.004 → 0.0028/0.0023 — 드래그 감도 ↓ (확확 넘어감 방지)
    // + smoothing (CAM_ROT_SMOOTHING) 동시 적용
    yawSpeed: 0.0028,
    pitchSpeed: 0.0023,
    pitchMin: -0.35,
    pitchMax: 0.85,
    distanceMin: 3.0,
    distanceMax: 16.0,
    distanceStep: 0.7,
  };
  // 2026-08-15 v2: 카메라 회전 smoothing — target → actual lerp factor
  // (작을수록 부드럽게 따라옴, 클수록 즉각 반응)
  const CAM_ROT_SMOOTHING = 0.18;

  // 2026-08-15: 술래 포박줄 발사체 시스템
  // - Space 키로 카메라 facing 방향으로 발사
  // - 직선, 12m 사거리, 30m/s, 3초 쿨다운
  // - 도망자에 닿으면 OUT
  const shotState = {
    active: false,
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    traveled: 0,
    mesh: null as THREE.Mesh | null,
    cooldownLeft: 0,
  };
  const shotOriginTmp = new THREE.Vector3();
  const shotHitTmp = new THREE.Vector3();

  function fireShot(): void {
    if (shotState.active || shotState.cooldownLeft > 0) return;
    // 발사 시작점: 술래 가슴 높이
    shotOriginTmp.copy(selfMesh.position);
    shotOriginTmp.y += PLAYER.height * 0.45;
    shotState.position.copy(shotOriginTmp);
    // 방향: 카메라 facing (월드 -Z + yaw)
    cameraFacing.set(0, 0, -1);
    if (Math.abs(camState.yaw) > 0.0001) {
      const yawQ = yawQuatTmp.setFromAxisAngle(yawAxis, camState.yaw);
      cameraFacing.applyQuaternion(yawQ);
    }
    shotState.direction.copy(cameraFacing).normalize();
    shotState.traveled = 0;
    // 메시 생성
    const geom = new THREE.SphereGeometry(GAME.shotRadius, 10, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: GAME.shotColor,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(shotState.position);
    ctx.scene.add(mesh);
    shotState.mesh = mesh;
    shotState.active = true;
    shotState.cooldownLeft = GAME.shotCooldown;
    if (sound) sound.playBoost(); // whoosh 사운드 재활용
  }

  function disposeShot(): void {
    if (shotState.mesh) {
      ctx.scene.remove(shotState.mesh);
      shotState.mesh.geometry.dispose();
      (shotState.mesh.material as THREE.Material).dispose();
      shotState.mesh = null;
    }
    shotState.active = false;
  }

  // 우클릭 컨텍스트 메뉴 차단 (드래그용)
  addTrackedListener(canvasHost, 'contextmenu', (e: Event) => (e as MouseEvent).preventDefault());

  // 2026-08-15 v3: V 키 = 카메라 모드 토글 (chase ↔ orbit)
  // - chase: 캐릭터 진행 방향 자동 추적 (도망자 추천 — 어디로 가든 카메라가 따라옴)
  // - orbit: 사용자 자유 회전 (술래 추천 — 정밀한 시점)
  const cameraModeHandler = (e: KeyboardEvent): void => {
    if (e.repeat || e.code !== 'KeyV') return;
    camState.mode = camState.mode === 'chase' ? 'orbit' : 'chase';
    // 토글 시 yaw 동기화
    if (camState.mode === 'chase') {
      // 캐릭터 진행 방향으로 즉시 맞춤
      const dx = selfMesh.position.x - prevPos.x;
      const dz = selfMesh.position.z - prevPos.z;
      if (Math.hypot(dx, dz) > 0.01) {
        camState.yawTarget = Math.atan2(dx, dz);
      }
    }
    // HUD에 모드 표시
    const modeEl = document.querySelector('.game-debug-mode');
    if (modeEl) modeEl.textContent = `카메라: ${camState.mode === 'chase' ? '추적' : '자유'} (V)`;
  };
  addTrackedListener(canvasHost, 'keydown', cameraModeHandler);

  // 2026-08-15 v3: Shift = 대시 (0.3s 짧은 돌진)
  const dashHandler = (e: KeyboardEvent): void => {
    if (e.repeat || (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight')) return;
    if (game.out || roundState !== 'playing') return;
    if (player.tryDash()) {
      triggerShake(0.15);
      sound.playBoost();
      if (dust) dust.burst(selfMesh.position, 12, 0.6, 1.2, 1.6, 0.4);
    }
  };
  addTrackedListener(canvasHost, 'keydown', dashHandler);

  addTrackedListener(canvasHost, 'pointerdown', (e: Event) => {
    const pe = e as PointerEvent;
    // 데스크탑: 좌/우클릭 모두 카메라 회전
    const isMouse = pe.pointerType === 'mouse' && (pe.button === 0 || pe.button === 2);
    // 모바일: 화면 우측 절반에서 시작한 단일 손가락 → 카메라 회전
    const isRightHalf = pe.pointerType === 'touch' && pe.clientX > window.innerWidth / 2;
    if (isMouse || isRightHalf) {
      camState.dragPointerId = pe.pointerId;
      camState.lastX = pe.clientX;
      camState.lastY = pe.clientY;
      // 2026-08-15 v3: 드래그 시작 시 자동으로 orbit 모드
      if (camState.mode === 'chase') {
        camState.mode = 'orbit';
        const modeEl = document.querySelector('.game-debug-mode');
        if (modeEl) modeEl.textContent = '카메라: 자유 (V)';
      }
      try {
        canvasHost.setPointerCapture(pe.pointerId);
      } catch {
        /* ignore */
      }
      pe.preventDefault();
    }
  });

  addTrackedListener(canvasHost, 'pointermove', (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.pointerId !== camState.dragPointerId) return;
    const dx = pe.clientX - camState.lastX;
    const dy = pe.clientY - camState.lastY;
    // 2026-08-15 v2: target만 갱신, 실제 yaw/pitch는 매 프레임 lerp
    camState.yawTarget -= dx * CAM_LIMITS.yawSpeed;
    if (camState.yawTarget > Math.PI) camState.yawTarget -= 2 * Math.PI;
    else if (camState.yawTarget < -Math.PI) camState.yawTarget += 2 * Math.PI;
    camState.pitchTarget = Math.max(
      CAM_LIMITS.pitchMin,
      Math.min(CAM_LIMITS.pitchMax, camState.pitchTarget + dy * CAM_LIMITS.pitchSpeed),
    );
    camState.lastX = pe.clientX;
    camState.lastY = pe.clientY;
  });

  const endCamDrag = (e: Event): void => {
    const pe = e as PointerEvent;
    if (pe.pointerId === camState.dragPointerId) {
      camState.dragPointerId = null;
    }
  };
  addTrackedListener(canvasHost, 'pointerup', endCamDrag);
  addTrackedListener(canvasHost, 'pointercancel', endCamDrag);

  // 휠 줌 (preventDefault로 페이지 스크롤 차단)
  addTrackedListener(
    canvasHost,
    'wheel',
    (e: Event) => {
      const we = e as WheelEvent;
      we.preventDefault();
      const dir = we.deltaY > 0 ? 1 : -1;
      camState.distance = Math.max(
        CAM_LIMITS.distanceMin,
        Math.min(CAM_LIMITS.distanceMax, camState.distance + dir * CAM_LIMITS.distanceStep),
      );
    },
    { passive: false },
  );

  // v6: 버튼 클릭이 캔버스 포커스를 빼앗지 않도록 mousedown 차단 + 포커스 복원
  // 사용자가 UI 외 영역 클릭 시 다시 캔버스로 포커스
  addTrackedListener(wrap, 'pointerdown', (e: Event) => {
    // UI 버튼 클릭은 막지 않음 (정상 클릭 동작)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;
    try {
      canvasHost.focus({ preventScroll: true });
    } catch {
      canvasHost.focus();
    }
  });
  // v6: mousedown 시 버튼이 focus를 받지 않게 방지 (pointerdown 보완)
  addTrackedListener(wrap, 'mousedown', (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      // 버튼이 기본적으로 갖는 mousedown focus 동작은 캔버스가 처리하므로 preventDefault
      // 단, 버튼 클릭 자체는 살려야 하므로 preventDefault만 호출
      e.preventDefault();
    }
  });

  // 2026-08-15 v4: 디버그 HUD 기본 숨김 — best practice (contextual minimalism)
  // - 기본 OFF (게임 화면 깔끔하게)
  // - ` 키 (Backquote) 또는 우상단 ⚙ 버튼으로 토글
  const debug = document.createElement('div');
  debug.className = 'game-debug';
  const roleLabel = profile.role === 'tagger' ? '술래' : '도망자';
  const mobileMode = isMobileLike();
  const camHint = mobileMode
    ? '조이스틱: 이동 · 우측 드래그: 카메라'
    : 'WASD 이동 · 마우스 드래그: 카메라 · 휠: 줌';
  debug.innerHTML = `
    <div class="game-debug-title">PHASE B · 단일 플레이어 (${roleLabel})</div>
    <div class="game-debug-row muted">WASD 이동 · 1/2/3 속도 · Shift 대시</div>
    <div class="game-debug-row">상대: AI (${profile.role === 'tagger' ? '도망자' : '술래'})</div>
    <div class="game-debug-row">자국: ${GAME.trailLifetime}초 후 소멸, 최대 ${GAME.trailMaxCount}개</div>
    <div class="game-debug-row muted">${camHint}</div>
    <div class="game-debug-row muted">${
      profile.role === 'tagger'
        ? 'Space/B 부스터 · F 홀딩: 조준 → 떼면 발사 · 클릭: 즉시 사격 · V: 카메라 모드'
        : 'E 흡수 · F 얼림 · V: 카메라 모드'
    }</div>
    <div class="game-debug-row muted game-debug-mode">카메라: 추적 (V)</div>
  `;
  debug.style.display = 'none'; // 기본 숨김
  wrap.appendChild(debug);

  // 2026-08-15: 부스터 스피드 라인 (radial blur) — 부스터 활성 시 보임
  const speedlines = document.createElement('div');
  speedlines.className = 'boost-speedlines';
  wrap.appendChild(speedlines);
  game.speedlines = speedlines;

  // 2026-08-15: OUT 빨간 비네트 플래시
  const outFlash = document.createElement('div');
  outFlash.className = 'out-flash';
  wrap.appendChild(outFlash);
  game.outFlash = outFlash;

  // 2026-08-15 v4: 속도 버튼 — v4 small icons (스크린 점유율 1/3)
  const speedBar = document.createElement('div');
  speedBar.className = 'speed-bar speed-bar-v4';
  const tiers: SpeedTier[] = ['walk', 'run', 'sprint'];
  game.speedButtons = [];
  for (const tier of tiers) {
    const tierInfo = SPEED_TIERS[tier];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `speed-btn speed-btn-${tier}`;
    btn.dataset.tier = tier;
    btn.setAttribute('aria-label', `${tierInfo.label} (×${tierInfo.multiplier.toFixed(1)})`);
    // v4: 아이콘만 (텍스트 제거)
    btn.innerHTML = `<span class="speed-btn-icon">${tier === 'walk' ? '🚶' : tier === 'run' ? '🏃' : '⚡'}</span>`;
    btn.addEventListener('click', () => {
      if (game.player) game.player.setSpeedTier(tier);
      updateSpeedButtons(tier);
    });
    speedBar.appendChild(btn);
    game.speedButtons.push(btn);
  }
  wrap.appendChild(speedBar);

  // 2026-08-15 v4: 상단 중앙 = 큰 타이머 + 미니 상태 (best practice: 가장 중요한 정보)
  const statusHud = document.createElement('div');
  statusHud.className = 'status-hud';
  statusHud.innerHTML = `
    <div class="round-timer" id="round-timer">2:30</div>
    <div class="status-hud-row"><span>자국</span><strong id="status-trails">0</strong></div>
    <div class="status-hud-row muted" id="status-debug">대기 중</div>
  `;
  wrap.appendChild(statusHud);
  game.statusHud = statusHud;
  game.statusTimer = statusHud.querySelector<HTMLElement>('#status-trails') ?? null;
  game.speedStatus = statusHud.querySelector<HTMLElement>('#status-speed') ?? null;
  const roundTimerEl = statusHud.querySelector<HTMLElement>('#round-timer');
  const debugStatus = statusHud.querySelector<HTMLElement>('#status-debug');

  // 2026-08-15 v4: 일시정지 메뉴 (best practice: 사용자 자유/통제)
  // - ESC 키 또는 ⚙ 버튼으로 진입
  // - playing 중 일시정지 → 게임 시간 정지, 입력 차단
  // - 옵션: 계속 / 재시작 / 로비 / 사운드 / 디버그 토글 / 조작법
  const pauseOverlay = document.createElement('div');
  pauseOverlay.className = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <div class="pause-card">
      <div class="pause-eyebrow">PAUSED</div>
      <div class="pause-title">일시정지</div>
      <div class="pause-actions">
        <button type="button" class="button primary" id="pause-continue">계속</button>
        <button type="button" class="button" id="pause-restart">다시 시작</button>
        <button type="button" class="button ghost" id="pause-lobby">로비로</button>
      </div>
      <div class="pause-settings">
        <label class="pause-row">
          <span>사운드</span>
          <input type="checkbox" id="pause-sound" checked />
        </label>
        <label class="pause-row">
          <span>디버그 HUD</span>
          <input type="checkbox" id="pause-debug" />
        </label>
        <label class="pause-row">
          <span>조작법</span>
          <span class="pause-hint muted">
            ${
              profile.role === 'tagger'
                ? 'Space/B 부스터 · F 사격 · Shift 대시 · V 카메라'
                : 'E 흡수 · F 얼림 · Shift 대시 · V 카메라'
            }
          </span>
        </label>
      </div>
    </div>
  `;
  wrap.appendChild(pauseOverlay);
  const pauseContinueBtn = pauseOverlay.querySelector<HTMLButtonElement>('#pause-continue');
  const pauseRestartBtn = pauseOverlay.querySelector<HTMLButtonElement>('#pause-restart');
  const pauseLobbyBtn = pauseOverlay.querySelector<HTMLButtonElement>('#pause-lobby');
  const pauseSoundChk = pauseOverlay.querySelector<HTMLInputElement>('#pause-sound');
  const pauseDebugChk = pauseOverlay.querySelector<HTMLInputElement>('#pause-debug');

  function showPauseMenu(): void {
    pauseOverlay.classList.add('show');
    if (pauseSoundChk && sound) pauseSoundChk.checked = sound.isEnabled();
    if (pauseDebugChk) pauseDebugChk.checked = debug.style.display !== 'none';
  }
  function hidePauseMenu(): void {
    pauseOverlay.classList.remove('show');
  }

  pauseContinueBtn?.addEventListener('click', hidePauseMenu);
  pauseRestartBtn?.addEventListener('click', () => {
    hidePauseMenu();
    setScreen('room');
  });
  pauseLobbyBtn?.addEventListener('click', () => {
    hidePauseMenu();
    setScreen('lobby');
  });
  pauseSoundChk?.addEventListener('change', () => {
    if (sound) sound.setEnabled(pauseSoundChk.checked);
    if (soundToggle) {
      if (sound.isEnabled()) {
        soundToggle.classList.remove('muted');
        soundToggle.innerHTML = '🔊';
      } else {
        soundToggle.classList.add('muted');
        soundToggle.innerHTML = '🔇';
      }
    }
  });
  pauseDebugChk?.addEventListener('change', () => {
    debug.style.display = pauseDebugChk.checked ? 'block' : 'none';
  });

  // ESC 키로 일시정지 토글
  const escHandler = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    if (pauseOverlay.classList.contains('show')) {
      hidePauseMenu();
    } else if (roundState === 'playing' || roundState === 'countdown') {
      showPauseMenu();
    }
  };
  addTrackedListener(canvasHost, 'keydown', escHandler);

  // Backquote (`) 키 = 디버그 HUD 토글
  const debugToggleHandler = (e: KeyboardEvent): void => {
    if (e.code !== 'Backquote') return;
    debug.style.display = debug.style.display === 'none' ? 'block' : 'none';
  };
  addTrackedListener(canvasHost, 'keydown', debugToggleHandler);

  // 2026-08-15 v4: 액션 프롬프트 (화면 중앙 하단) — 맥락별 안내
  // - 자국 위: E 흡수 + 진행률
  // - 얼림 사거리 내: F 얼림 (도망자)
  // - 사격 사거리 내: F 사격 (술래)
  // - 첫 3초만 표시 (이후 숨김 — best practice: progressive disclosure)
  const actionPrompt = document.createElement('div');
  actionPrompt.className = 'action-prompt';
  wrap.appendChild(actionPrompt);
  let actionPromptHideUntil = 0;
  function showActionPrompt(text: string, key: string, color: string = '#00e5ff'): void {
    if (performance.now() < actionPromptHideUntil) return;
    actionPrompt.innerHTML = `<span class="action-prompt-key" style="background:${color}">${key}</span><span class="action-prompt-text">${text}</span>`;
    actionPrompt.classList.add('show');
    // 3초 후 자동 숨김
    actionPromptHideUntil = performance.now() + 3000;
    trackTimeout(() => {
      if (performance.now() >= actionPromptHideUntil) {
        actionPrompt.classList.remove('show');
      }
    }, 3000);
  }
  function hideActionPrompt(): void {
    actionPrompt.classList.remove('show');
  }

  // 2026-08-15 v4: 설정 버튼 (우상단) — 일시정지 메뉴 진입
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'icon-btn settings-btn';
  settingsBtn.setAttribute('aria-label', '설정');
  settingsBtn.innerHTML = '⚙';
  settingsBtn.addEventListener('click', () => showPauseMenu());
  wrap.appendChild(settingsBtn);

  // 뒤로가기 버튼 (우상단) — 숨김 (일시정지 메뉴가 생겼으므로)
  const back = button('← 로비', () => setScreen('lobby'), 'ghost game-back');
  back.style.display = 'none';
  wrap.appendChild(back);

  // 2026-08-15: 사운드 ON/OFF 토글 — v4에서 일시정지 메뉴가 처리 (사운드 체크박스)
  // - 그래도 키보드 단축키 (M)로 토글 가능
  const soundToggle = document.createElement('button');
  soundToggle.type = 'button';
  soundToggle.className = 'ghost sound-toggle';
  soundToggle.setAttribute('aria-label', '사운드 토글');
  soundToggle.innerHTML = '🔊';
  soundToggle.style.display = 'none'; // v4: 일시정지 메뉴에서 처리
  soundToggle.addEventListener('click', () => {
    if (!sound) return;
    if (sound.isEnabled()) {
      sound.setEnabled(false);
      soundToggle.classList.add('muted');
      soundToggle.innerHTML = '🔇';
      if (pauseSoundChk) pauseSoundChk.checked = false;
    } else {
      sound.setEnabled(true);
      soundToggle.classList.remove('muted');
      soundToggle.innerHTML = '🔊';
      if (pauseSoundChk) pauseSoundChk.checked = true;
    }
  });
  wrap.appendChild(soundToggle);

  // M 키 = 사운드 토글 (단축키)
  const soundKeyHandler = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyM' || e.repeat) return;
    soundToggle.click();
  };
  addTrackedListener(canvasHost, 'keydown', soundKeyHandler);

  root.appendChild(wrap);

  // === Three.js 초기화 ===
  // 2026-08-15: 맵 선택 시스템 — profile.mapId → MapDef → 씬/맵/AI/장애물 전부
  const mapDef: MapDef = MAPS[profile.mapId];
  const mapObstacles = OBSTACLES_BY_MAP[profile.mapId];
  const ctx = createScene(canvasHost, mapDef);
  const mapRefs = buildMap(ctx.scene, mapDef);
  const exitDisc = buildExitPoint(ctx.scene);
  game.mapRefs = mapRefs;
  game.exitDisc = exitDisc;
  // 출구 위치 (XZ 평면, Y 무시)
  const exitPos = new THREE.Vector3(exitDisc.position.x, 0, exitDisc.position.z);
  const exitRadius = 1.4; // buildExitPoint의 CylinderGeometry radius와 일치

  const mapHalfW = MAP.width / 2 - MAP.wallThickness;

  // 2026-08-15 v4: 미니맵 (상단 우측) — best practice: 공간 인지를 위한 보조 UI
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.width = 140;
  minimapCanvas.height = 140;
  minimapCanvas.className = 'minimap-canvas';
  wrap.appendChild(minimapCanvas);
  const minimapCtx = minimapCanvas.getContext('2d')!;
  const minimapScale = (minimapCanvas.width - 16) / MAP.width;
  function drawMinimap(): void {
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    // 배경
    minimapCtx.fillStyle = 'rgba(8, 11, 22, 0.7)';
    minimapCtx.fillRect(0, 0, w, h);
    // 경계
    minimapCtx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeRect(2, 2, w - 4, h - 4);
    // 좌표 변환 (월드 → 미니맵, Y는 위가 +)
    const wx2mx = (wx: number) => w / 2 + wx * minimapScale;
    const wz2my = (wz: number) => h / 2 + wz * minimapScale;
    // 장애물 (회색 박스)
    minimapCtx.fillStyle = 'rgba(120, 100, 140, 0.6)';
    for (const o of mapRefs.obstaclesData) {
      minimapCtx.fillRect(
        wx2mx(o.x - o.width / 2),
        wz2my(o.z - o.depth / 2),
        o.width * minimapScale,
        o.depth * minimapScale,
      );
    }
    // 출구 (노란 원)
    minimapCtx.fillStyle = '#ffd97a';
    minimapCtx.beginPath();
    minimapCtx.arc(wx2mx(exitPos.x), wz2my(exitPos.z), 4, 0, Math.PI * 2);
    minimapCtx.fill();
    // AI (작은 점, 색은 자기/상대 역할에 따라)
    minimapCtx.fillStyle = isTagger ? '#00e5ff' : '#ff3a5c';
    minimapCtx.beginPath();
    minimapCtx.arc(wx2mx(aiMesh.position.x), wz2my(aiMesh.position.z), 3.5, 0, Math.PI * 2);
    minimapCtx.fill();
    // 자기 (큰 점 + 외곽선, 색은 자기/상대 역할에 따라)
    const selfColor = isTagger ? '#ff3a5c' : '#00e5ff';
    minimapCtx.fillStyle = selfColor;
    minimapCtx.strokeStyle = '#fff';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.arc(wx2mx(selfMesh.position.x), wz2my(selfMesh.position.z), 4.5, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.stroke();
  }

  // ============================================================
  // 2026-08-15: 라운드 상태머신 + 타이머 + 결과 화면
  // ============================================================
  type RoundState = 'countdown' | 'playing' | 'ended';
  let roundState: RoundState = 'countdown';
  let roundTime: number = GAME.roundSeconds; // 남은 시간 (초)
  let escapeHoldTime = 0; // 출구 위 유지 시간
  const roundStats = { absorbed: 0, outCount: 0, iceUsed: 0, boostUsed: 0, startedAt: 0 };

  // 카운트다운 오버레이 (3, 2, 1, 시작!)
  const countdownEl = document.createElement('div');
  countdownEl.className = 'countdown-overlay';
  countdownEl.innerHTML = `<div class="countdown-text" id="countdown-text">3</div>`;
  wrap.appendChild(countdownEl);
  const countdownText = countdownEl.querySelector<HTMLElement>('#countdown-text');

  // 결과 오버레이 (Fall Guys WIN! / ELIMINATED! 스타일)
  const resultOverlay = document.createElement('div');
  resultOverlay.className = 'result-overlay';
  resultOverlay.innerHTML = `
    <div class="result-card">
      <div class="result-eyebrow">ROUND COMPLETE</div>
      <div class="result-medal" id="result-medal">🏆</div>
      <div class="result-title" id="result-title">WIN!</div>
      <div class="result-sub" id="result-sub">도망자가 출구에 도달했습니다</div>
      <div class="result-stats" id="result-stats">
        <div class="result-stat"><span>생존</span><strong id="result-time">0:00</strong></div>
        <div class="result-stat"><span>자국 흡수</span><strong id="result-absorbed">0</strong></div>
        <div class="result-stat"><span>OUT</span><strong id="result-out">0</strong></div>
        <div class="result-stat"><span>얼림</span><strong id="result-ice">0</strong></div>
        <div class="result-stat"><span>부스터</span><strong id="result-boost">0</strong></div>
      </div>
      <div class="result-actions">
        <button type="button" class="button primary" id="result-retry">🔄 한 판 더!</button>
        <button type="button" class="button secondary" id="result-lobby">🏠 로비로</button>
      </div>
    </div>
  `;
  wrap.appendChild(resultOverlay);
  const resultTitleEl = resultOverlay.querySelector<HTMLElement>('#result-title');
  const resultSubEl = resultOverlay.querySelector<HTMLElement>('#result-sub');
  const resultTimeEl = resultOverlay.querySelector<HTMLElement>('#result-time');
  const resultAbsorbedEl = resultOverlay.querySelector<HTMLElement>('#result-absorbed');
  const resultOutEl = resultOverlay.querySelector<HTMLElement>('#result-out');
  const resultIceEl = resultOverlay.querySelector<HTMLElement>('#result-ice');
  const resultBoostEl = resultOverlay.querySelector<HTMLElement>('#result-boost');
  const resultMedalEl = resultOverlay.querySelector<HTMLElement>('#result-medal');
  const resultRetryBtn = resultOverlay.querySelector<HTMLButtonElement>('#result-retry');
  const resultLobbyBtn = resultOverlay.querySelector<HTMLButtonElement>('#result-lobby');
  if (resultRetryBtn) {
    resultRetryBtn.addEventListener('click', () => setScreen('room'));
  }
  if (resultLobbyBtn) {
    resultLobbyBtn.addEventListener('click', () => setScreen('lobby'));
  }

  // 2026-08-15: 인트로 시네마틱 — 카메라 고공 → 추적 위치 (카운트다운 동안)
  const gameStartedAt = performance.now();
  const introDuration = 4.0; // 카운트다운 시퀀스 + 약간 (초)
  const introStartPos = new THREE.Vector3(0, 28, 22);
  const introStartLook = new THREE.Vector3(0, 0, 0);
  // 초기 카메라 위치를 인트로 시작 위치로 강제
  ctx.camera.position.copy(introStartPos);
  ctx.camera.lookAt(introStartLook);

  // 카운트다운 시퀀스 (3, 2, 1, 시작)
  const countdownSequence = ['3', '2', '1', '시작!'];
  let countdownIdx = 0;
  // 2026-08-15: 라운드 시작 후 2초 그레이스 (술래 동결) — 도망자 즉시 OUT 방지
  const ROUND_START_GRACE_SEC = 2.0;
  let graceTimeLeft = 0;
  // 2026-08-16: 카운트다운 안전망 — performance.now() 기반 폴링
  // - 증상: 어떤 환경에서 setTimeout이 fire 안 해서 '3'에서 멈춤
  // - 픽스: 매 프레임 update()에서 경과 시간 체크, setTimeout이 fire 안 해도
  //   performance.now() 기반으로 다음 카운트다운 텍스트로 강제 전환
  const countdownStartedAt = performance.now();
  const COUNTDOWN_STEP_MS = 800; // 각 카운트다운 표시 시간
  const COUNTDOWN_GAP_MS = 250; // 카운트다운 사이 갭
  const COUNTDOWN_STEP_TOTAL = COUNTDOWN_STEP_MS + COUNTDOWN_GAP_MS; // 1050ms per step
  function tickCountdown(): void {
    if (countdownIdx >= countdownSequence.length) {
      countdownEl.classList.remove('show');
      roundState = 'playing';
      roundTime = GAME.roundSeconds;
      roundStats.startedAt = performance.now();
      // 2026-08-15: 그레이스 시작 — 술래 AI 동결, 도망자는 자유
      if (taggerAI) taggerAI.setFrozen(true);
      graceTimeLeft = ROUND_START_GRACE_SEC;
      // v34: GO! 사운드 + 셰이크
      if (sound) {
        try {
          sound.playAbsorbStart();
        } catch (err) {
          console.warn('[countdown] playAbsorbStart 실패', err);
        }
      }
      triggerShake(0.3);
      return;
    }
    if (countdownText) countdownText.textContent = countdownSequence[countdownIdx];
    countdownEl.classList.add('show');
    // v34: 카운트다운 비프음 (절대 피치로 3,2,1) — try/catch로 throw 방어
    if (sound && countdownIdx < 3) {
      try {
        sound.playFootstep(0.6);
      } catch (err) {
        console.warn('[countdown] playFootstep 실패 (계속 진행)', err);
      }
    }
    // 다음 카운트다운
    trackTimeout(() => {
      countdownEl.classList.remove('show');
      countdownIdx++;
      trackTimeout(tickCountdown, COUNTDOWN_GAP_MS);
    }, COUNTDOWN_STEP_MS);
  }
  tickCountdown();
  // 2026-08-16: 카운트다운 폴링 안전망 — setTimeout이 어떤 이유로 fire 안 해도
  // 매 프레임 (render loop) 카운트다운 텍스트가 시간에 맞춰 갱신되도록
  // update 콜백에서 호출됨
  // - Pass 8.1: 직접 텍스트 갱신 + playing 전환 (setTimeout 의존 X)
  // - 1차 시도(setTimeout 50ms 후 tickCountdown 호출)도 setTimeout 자체가
  //   fire 안 하는 환경이면 무한 대기 → 이게 '3' 멈춤의 진짜 원인
  function pumpCountdownFallback(): void {
    if (roundState !== 'countdown') return;
    const elapsed = performance.now() - countdownStartedAt;
    const expectedIdx = Math.min(
      countdownSequence.length,
      Math.floor(elapsed / COUNTDOWN_STEP_TOTAL),
    );
    if (expectedIdx <= countdownIdx) return;

    console.warn(
      `[countdown 폴링 안전망] setTimeout 멈춤 감지 — idx ${countdownIdx} → ${expectedIdx}로 강제 전환`,
    );
    countdownIdx = expectedIdx;

    if (countdownIdx >= countdownSequence.length) {
      // 2026-08-16: 직접 playing으로 전환 (setTimeout 무관)
      countdownEl.classList.remove('show');
      roundState = 'playing';
      roundTime = GAME.roundSeconds;
      roundStats.startedAt = performance.now();
      if (taggerAI) taggerAI.setFrozen(true);
      graceTimeLeft = ROUND_START_GRACE_SEC;
      try {
        if (sound) sound.playAbsorbStart();
      } catch (err) {
        console.warn('[countdown] playAbsorbStart 실패', err);
      }
      triggerShake(0.3);
    } else {
      // 2026-08-16: 텍스트도 직접 갱신 (setTimeout 콜백 안 거치고)
      if (countdownText) countdownText.textContent = countdownSequence[countdownIdx];
      countdownEl.classList.add('show');
      // 비프음도 직접
      if (sound && countdownIdx < 3) {
        try {
          sound.playFootstep(0.6);
        } catch (err) {
          console.warn('[countdown] playFootstep 실패', err);
        }
      }
    }
  }

  // 2026-08-16: setInterval 추가 안전망 — requestAnimationFrame이 throttle되거나
  // render loop가 어떤 이유로 fire 안 해도 200ms마다 강제 진행
  const safetyInterval = setInterval(() => {
    if (roundState !== 'countdown') {
      clearInterval(safetyInterval);
      return;
    }
    pumpCountdownFallback();
  }, 200);
  // teardownGame에서 clear되도록 disposers에 등록
  game.disposers.push(() => clearInterval(safetyInterval));

  // 결과 표시 (Fall Guys WIN! / ELIMINATED! 카툰 스타일)
  function showResult(winner: 'tagger' | 'runner', reason: string): void {
    if (roundState === 'ended') return;
    roundState = 'ended';
    // 2026-08-15 v30: WIN!/ELIMINATED! 타이틀
    // - 자기=술래: winner=tagger → WIN!, winner=runner → ELIMINATED!
    // - 자기=도망자: winner=tagger → ELIMINATED!, winner=runner → WIN!
    const userWon = (winner === 'tagger') === isTagger;
    if (resultTitleEl) {
      resultTitleEl.textContent = userWon ? 'WIN!' : 'ELIMINATED!';
      resultTitleEl.classList.toggle('lose', !userWon);
    }
    if (resultMedalEl) {
      resultMedalEl.textContent = userWon ? '🏆' : '💀';
      resultMedalEl.classList.toggle('lose', !userWon);
    }
    // v34: sub 텍스트에 이모지/친근한 prefix 추가
    if (resultSubEl) {
      const subText = userWon ? `🎉 ${reason}` : `💥 ${reason}`;
      resultSubEl.textContent = subText;
    }
    if (resultTimeEl) {
      const elapsed = Math.round((performance.now() - roundStats.startedAt) / 1000);
      const mm = Math.floor(elapsed / 60);
      const ss = (elapsed % 60).toString().padStart(2, '0');
      resultTimeEl.textContent = `${mm}:${ss}`;
    }
    if (resultAbsorbedEl) resultAbsorbedEl.textContent = String(roundStats.absorbed);
    if (resultOutEl) resultOutEl.textContent = String(roundStats.outCount);
    if (resultIceEl) resultIceEl.textContent = String(roundStats.iceUsed);
    if (resultBoostEl) resultBoostEl.textContent = String(roundStats.boostUsed);
    // v34: 승/패 사운드 + 컨페티
    if (sound) {
      if (userWon) sound.playWin();
      else sound.playLose();
    }
    if (userWon) {
      spawnConfetti();
    } else {
      triggerShake(0.6);
    }
    resultOverlay.classList.add('show');
  }
  const mapHalfD = MAP.depth / 2 - MAP.wallThickness;
  game.out = false;
  game.outReason = '';

  // === role에 따라 자기/AI 분기 ===
  // - runner 선택: 자기 = 캡슐(시안/마젠타/화이트) + WASD, AI = 술래(검은 후드)
  // - tagger 선택: 자기 = 술래(검은 후드) + WASD, AI = 도망자(캡슐)
  const isTagger = profile.role === 'tagger';

  // 자기 캐릭터
  let selfColor: number;
  // v34: 자기 라벨 = 입력한 닉네임 (없으면 기본값)
  const selfLabel: string = profile.nickname || '나';
  let selfMesh: THREE.Mesh;
  let selfMaterial: THREE.MeshStandardMaterial;
  let selfHoodLight: THREE.PointLight | null = null;
  if (isTagger) {
    selfColor = PLAYER.taggerAccent;
    selfMaterial = new THREE.MeshStandardMaterial({
      color: PLAYER.taggerColor,
      emissive: PLAYER.taggerEmissiveColor,
      emissiveIntensity: PLAYER.taggerEmissiveIntensity,
      roughness: 0.6,
      metalness: 0.3,
    });
    selfMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        PLAYER.radius * GAME.taggerScale,
        (PLAYER.height - PLAYER.radius * 2) * GAME.taggerScale,
        4,
        8,
      ),
      selfMaterial,
    );
    // v5: 장애물 (-4,6) 바깥으로 시작 (이전 (-5,5)는 장애물 안에 갇혀 못 나옴)
    selfMesh.position.set(-11, PLAYER.height / 2, 9);
    selfMesh.castShadow = true;
    selfHoodLight = new THREE.PointLight(
      PLAYER.taggerAccent,
      PLAYER.taggerHoodLightIntensity,
      PLAYER.taggerHoodLightDistance,
    );
    selfHoodLight.position.copy(selfMesh.position);
    selfHoodLight.position.y += PLAYER.height * 0.5;
    ctx.scene.add(selfHoodLight);
  } else {
    selfColor = PLAYER.runnerColors[profile.characterId] ?? 0xffffff;
    // v34: selfLabel은 위에서 닉네임으로 초기화됨 — 여기서 덮어쓰지 않음
    selfMaterial = new THREE.MeshStandardMaterial({
      color: selfColor,
      emissive: selfColor,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.2,
    });
    selfMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 4, 8),
      selfMaterial,
    );
    selfMesh.position.set(0, PLAYER.height / 2, -8);
    selfMesh.castShadow = true;
  }
  ctx.scene.add(selfMesh);
  // 2026-08-15: 머리/후드/눈 추가
  addCharacterFeatures(selfMesh, {
    isTagger,
    bodyColor: selfColor,
  });

  // AI 캐릭터 (반대 역할) — 술래는 검은 후드 + 라이트, 도망자는 캡슐
  let aiMaterial: THREE.MeshStandardMaterial;
  let aiColor: number;
  let aiLabel: string;
  let aiHoodLight: THREE.PointLight | null = null;
  if (isTagger) {
    // AI = 도망자 (캡슐)
    aiColor = 0xffffff;
    // v34: AI 라벨에 "AI" 접두사 — 사용자가 자기 닉네임과 구분되게
    aiLabel = 'AI 도망자';
    aiMaterial = new THREE.MeshStandardMaterial({
      color: aiColor,
      emissive: aiColor,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.2,
    });
  } else {
    // AI = 술래 (검은 후드 + 라이트)
    aiColor = PLAYER.taggerAccent;
    // v34: AI 라벨에 "AI" 접두사
    aiLabel = 'AI 술래';
    aiMaterial = new THREE.MeshStandardMaterial({
      color: PLAYER.taggerColor,
      emissive: PLAYER.taggerEmissiveColor,
      emissiveIntensity: PLAYER.taggerEmissiveIntensity,
      roughness: 0.6,
      metalness: 0.3,
    });
  }
  const aiMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      isTagger ? PLAYER.radius : PLAYER.radius * GAME.taggerScale,
      (PLAYER.height - PLAYER.radius * 2) * (isTagger ? 1 : GAME.taggerScale),
      4,
      8,
    ),
    aiMaterial,
  );
  // 2026-08-15 v9: AI 도망자 시작 위치 갇힘 버그 수정
  // - 기존 (10, -10): 장애물 (9.1, -10.4)에 4방향 모두 막혀서 갇힘
  // - 새 위치 (12, -12): SE 코너, 모든 장애물에서 멀리, 플레이어 (-11, 9)와 ~28m
  // - AI 술래 (12, 14): NE 코너, 이미 clear
  aiMesh.position.set(isTagger ? 12 : 12, PLAYER.height / 2, isTagger ? -12 : 14);
  aiMesh.castShadow = true;
  ctx.scene.add(aiMesh);
  // 2026-08-15: AI 머리/후드/눈 추가
  addCharacterFeatures(aiMesh, {
    isTagger: !isTagger, // AI는 반대 역할
    bodyColor: aiColor,
  });
  if (!isTagger) {
    aiHoodLight = new THREE.PointLight(
      PLAYER.taggerAccent,
      PLAYER.taggerHoodLightIntensity,
      PLAYER.taggerHoodLightDistance,
    );
    aiHoodLight.position.copy(aiMesh.position);
    aiHoodLight.position.y += PLAYER.height * 0.5;
    ctx.scene.add(aiHoodLight);
  }

  // 2026-08-15 v3: 컨트롤 개선 — 3D 방향 인디케이터
  // - 출구: 항상 보이는 빛 기둥 (도망자용)
  // - 상대 머리 위 깜빡임 표시 (도망자=술래 빨강, 술래=도망자 시안)
  // → 카메라 어디서든 방향 즉시 파악
  const indicatorGroup = new THREE.Group();
  ctx.scene.add(indicatorGroup);

  // 1) 출구 마커 — v28: 신호 깃발 (단순한 깃발 + 화살표)
  if (!isTagger) {
    const exitFlagHeight = 3.5;
    // 깃대 (작은 폴)
    const exitPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, exitFlagHeight, 6),
      new THREE.MeshLambertMaterial({ color: 0x6a4423 }),
    );
    exitPole.position.set(exitPos.x, exitFlagHeight / 2, exitPos.z);
    exitPole.castShadow = true;
    indicatorGroup.add(exitPole);
    // 깃발 (삼각형 Plane) — 골드
    const flagGeom = new THREE.PlaneGeometry(0.6, 0.4);
    const flag = new THREE.Mesh(
      flagGeom,
      new THREE.MeshLambertMaterial({ color: mapDef.exitColor, side: THREE.DoubleSide }),
    );
    flag.position.set(exitPos.x + 0.3, exitFlagHeight - 0.3, exitPos.z);
    indicatorGroup.add(flag);
  }

  // 2) 상대 머리 위 마커 (Cone, 아래 방향) — v34 Fall Guys 카툰 컬러
  const targetMarkerColor = isTagger ? 0x4dd0e1 : 0xff5c8a;
  const targetMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.9, 6),
    new THREE.MeshBasicMaterial({
      color: targetMarkerColor,
      transparent: true,
      opacity: 0.95,
    }),
  );
  targetMarker.position.copy(aiMesh.position);
  targetMarker.position.y += 2.2; // 머리 위
  targetMarker.rotation.x = Math.PI; // 아래 향하게
  indicatorGroup.add(targetMarker);
  // 마커 글로우 (작은 sphere)
  const targetGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 6),
    new THREE.MeshBasicMaterial({ color: targetMarkerColor, transparent: true, opacity: 0.7 }),
  );
  targetGlow.position.copy(targetMarker.position);
  indicatorGroup.add(targetGlow);

  // 2026-08-15: 사격 조준선 (술래만) — Space 누르고 있으면 짧은 레이저 표시
  let aimLaser: THREE.Mesh | null = null;
  let aimLaserMat: THREE.MeshBasicMaterial | null = null;
  let isAiming = false;
  if (isTagger) {
    // 길이 1m 박스 (실제 update에서 scale로 늘림)
    const laserGeom = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    laserGeom.translate(0, 0.5, 0); // 한쪽 끝이 원점
    aimLaserMat = new THREE.MeshBasicMaterial({
      color: 0xff3a3a,
      transparent: true,
      opacity: 0.55,
    });
    aimLaser = new THREE.Mesh(laserGeom, aimLaserMat);
    aimLaser.visible = false;
    ctx.scene.add(aimLaser);
  }

  // aim 방향 계산 (cameraFacing + yaw)
  function getAimDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    if (Math.abs(camState.yaw) > 0.0001) {
      const q = yawQuatTmp.setFromAxisAngle(yawAxis, camState.yaw);
      dir.applyQuaternion(q);
    }
    return dir.normalize();
  }

  // === PlayerController (자기) ===
  const player = new PlayerController({
    scene: ctx.scene,
    mesh: selfMesh,
    obstacles: mapObstacles, // 2026-08-15: 맵별 장애물
    mapHalfWidth: mapHalfW,
    mapHalfDepth: mapHalfD,
    inputTarget: window, // v6: window (포커스 무관, 캔버스/버튼 포커스 무관하게 안정)
    collisionMargin: !isTagger ? 0.4 : 0.6, // v5: 도망자만 좁은 틈 통과 가능 (반경 0.85)
    speedMultiplier: isTagger ? GAME.taggerPatrolSpeedMultiplier : 1.0, // v8: 술래 1.9배
  });
  game.player = player;
  updateSpeedButtons('run');

  // === AI: 술래면 술래(자기가 도망자 추격), 도망자면 술래(자기가 술래) ===
  // 단순화: role=tagger → AI는 도망자(자기가 술래라 추격 안 함). role=runner → AI는 술래(추격).
  // → Phase B에선 role과 무관하게 술래를 항상 만들어 추격/도망 시연.
  // role=tagger일 땐 자기가 술래이므로 AI는 정적 도망자로 두고, role=runner일 때만 술래 AI가 움직임.
  // (단일 플레이어 데모이므로 게임성 단순화)
  let taggerAI: TaggerAI | null = null;
  // v5: 술래 메쉬 참조 — 부스터 시스템이 scale 갱신할 대상
  // 자기가 도망자면 술래 = aiMesh, 자기가 술래면 술래 = selfMesh
  const taggerMeshForBoost = !isTagger ? aiMesh : selfMesh;

  // v5: 부스터 시스템 — 술래만 적용
  const boost = isTagger
    ? new BoostSystem({
        onVisualChange: (params) => {
          // scale 갱신 (정지 중 더 작게, 피로도 비례 shrink)
          taggerMeshForBoost.scale.setScalar(params.scale);
        },
      })
    : null;

  let runnerAI: RunnerAIStub | null = null;
  if (!isTagger) {
    // 자기가 도망자: AI 술래가 추격
    taggerAI = new TaggerAI({
      mesh: aiMesh,
      obstacles: mapObstacles, // 2026-08-15: 맵별 장애물
      mapHalfWidth: mapHalfW,
      mapHalfDepth: mapHalfD,
      target: selfMesh, // 자기를 추적
      boostSystem: boost ?? undefined,
    });
    game.tagger = taggerAI;
  } else {
    // 자기가 술래: AI 도망자는 단순 도주 (랜덤 + 자기와 거리 유지)
    runnerAI = new RunnerAIStub({
      mesh: aiMesh,
      obstacles: mapObstacles, // 2026-08-15: 맵별 장애물
      mapHalfWidth: mapHalfW,
      mapHalfDepth: mapHalfD,
      threat: selfMesh,
    });
    game.tagger = null;
  }

  // 자국 emitter: 술래 = 추적자, 도망자 = 술래 AI
  const trails = new TrailEmitter({
    scene: ctx.scene,
    tagger: !isTagger ? aiMesh : selfMesh,
    taggerSpeedTierRef: { current: 'run' },
  });
  game.trails = trails;

  // 2026-08-15: 먼지 파티클 (자기 발밑) — 이동 / 부스터 시 자동 생성
  const dust = new DustSystem({
    scene: ctx.scene,
    spawnPerSecond: 22,
    boostMultiplier: 2.2,
  });
  game.dust = dust;

  // 2026-08-15: 절차적 SFX (Web Audio API)
  const sound = new SoundManager();
  sound.ensureContext(); // 첫 인터랙션(데모 시작 버튼) 이후라 안전
  sound.startMusic(); // BGM 시작 (앰비언트 드론)
  game.sound = sound;

  // 2026-08-15: 자국 흡수 시스템 (도망자만 사용)
  const absorb = new AbsorbSystem({
    onComplete: (strength) => {
      // 흡수 완료: 자국 제거 + 가속 + 무적
      const consumed = trails.consumeNearest(selfMesh.position, 1.5);
      void consumed; // 1개 제거됨
      // 가속 적용
      player.setBoostSpeedMultiplier(GAME.absorbedSpeedMultiplier * Math.max(0.7, strength));
      // 4초 후 자동 해제 (AbsorbSystem 내부 타이머)
      void player; // already has ref
      // 캐릭터 색상 변화 (강도 색으로 잠시)
      const boostColor = strength > 0.7 ? 0xff1493 : strength > 0.4 ? 0x00e5ff : 0xffffff;
      const boostMat = selfMaterial;
      const origColor = boostMat.emissive.getHex();
      const origIntensity = boostMat.emissiveIntensity;
      boostMat.emissive.setHex(boostColor);
      boostMat.emissiveIntensity = 1.2;
      trackTimeout(() => {
        boostMat.emissive.setHex(origColor);
        boostMat.emissiveIntensity = origIntensity;
      }, GAME.boostSeconds * 1000);
      // SFX
      sound.playAbsorbComplete();
      // 버스트 (자기 주변)
      if (dust) dust.burst(selfMesh.position, 24, 1.2, 2.0, 2.5, 0.8);
      // 카메라 셰이크 (작은 임팩트)
      triggerShake(0.15);
      // 통계
      roundStats.absorbed += 1;
    },
    onCancel: () => {
      sound.playAbsorbCancel();
    },
  });
  game.absorb = absorb;

  // 2026-08-09 v2: 머리 위에 캔버스 라벨 스프라이트
  if (PLAYER.showPlayerLabels) {
    if (isTagger) {
      addPlayerLabel(
        ctx.scene,
        selfMesh.position,
        selfLabel,
        PLAYER.taggerAccent,
        PLAYER.labelOffsetY,
        true,
      );
      addPlayerLabel(ctx.scene, aiMesh.position, aiLabel, aiColor, PLAYER.labelOffsetY, false);
    } else {
      addPlayerLabel(ctx.scene, selfMesh.position, selfLabel, selfColor, PLAYER.labelOffsetY, true);
      addPlayerLabel(
        ctx.scene,
        aiMesh.position,
        aiLabel,
        PLAYER.taggerAccent,
        PLAYER.labelOffsetY,
        false,
      );
    }
  }

  // 2026-08-09 v4: 얼림 (Ice) 시스템 — 술래 메쉬의 색상 토글 (얼음 시안)
  // 도망자 모드일 때만 술래(aiMesh)가 있으므로 그때만 활성.
  const taggerMeshRef = !isTagger ? aiMesh : null;
  const taggerMaterialRef = !isTagger ? aiMaterial : null;
  const originalTaggerEmissive = taggerMaterialRef ? taggerMaterialRef.emissive.getHex() : 0;
  const originalTaggerIntensity = taggerMaterialRef ? taggerMaterialRef.emissiveIntensity : 0;

  const ice = new IceSystem({
    // 2026-08-15 v2: 도망자도 정지시키면 얼림 풀린 직후 같은 자리 → 즉시 OUT.
    // 도망자는 자유롭게 도망칠 수 있게 정지 안 함 (술래만 동결).
    setPlayerFrozen: (_frozen) => {
      // no-op: 도망자는 얼림 중 자유 이동
    },
    setTaggerFrozen: (frozen) => {
      if (taggerAI) taggerAI.setFrozen(frozen);
    },
    onTaggerVisual: (frozen) => {
      if (!taggerMaterialRef) return;
      if (frozen) {
        taggerMaterialRef.emissive.setHex(GAME.iceTaggerTint);
        taggerMaterialRef.emissiveIntensity = 2.0;
      } else {
        taggerMaterialRef.emissive.setHex(originalTaggerEmissive);
        taggerMaterialRef.emissiveIntensity = originalTaggerIntensity;
      }
    },
  });

  // F 키로 얼림 발동 (도망자만)
  const iceKeyHandler = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code !== 'KeyF') return;
    if (isTagger) return; // 술래는 얼림 사용 불가
    if (game.out) return;
    const dist = distVecToTagger();
    if (ice.triggerIfReady(dist)) {
      sound.playIce();
      // 2026-08-15: 술래 위치에 서리 버스트 (얼음 파티클)
      if (dust) dust.burst(aiMesh.position, 30, 1.5, 2.5, 2.5, 1.0);
      roundStats.iceUsed += 1; // 2026-08-16: 결과 화면 통계
    }
  };

  // 2026-08-15: E 키로 자국 흡수 (도망자만) — 자국 위에 있을 때 1초 유지
  // 흡수 시작은 키다운, 진행 중에는 cancel 감지만
  const absorbKeyHandler = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyE') return;
    if (isTagger) return; // 술래는 흡수 사용 불가
    if (game.out) return;
    if (e.type === 'keydown') {
      // 자국 위에 있는지 확인
      const query = trails.queryNearest(selfMesh.position, 1.5);
      if (query.hit) {
        absorb.setLastTrailPosition(query.position!.x, query.position!.z);
        absorb.setStrengthConsumed(query.strength);
        if (absorb.tryStart()) {
          player.setAbsorbing(true);
          sound.playAbsorbStart();
        }
      }
    } else if (e.type === 'keyup') {
      // 키 떼면 즉시 취소 (단, 이미 완료된 경우는 무시)
      if (absorb.isAbsorbing()) {
        absorb.reset();
        player.setAbsorbing(false);
        sound.playAbsorbCancel();
      }
    }
  };
  addTrackedListener(canvasHost, 'keydown', absorbKeyHandler);
  addTrackedListener(canvasHost, 'keyup', absorbKeyHandler);
  function distVecToTagger(): number {
    const dx = selfMesh.position.x - aiMesh.position.x;
    const dz = selfMesh.position.z - aiMesh.position.z;
    return Math.sqrt(dx * dx + dz * dz); // ES5 호환
  }
  // F 키로 얼림 발동 (도망자만) — 2026-08-09 v5: 캔버스에 등록 (포커스 안정)
  // 2026-08-16: addTrackedListener 사용 — teardownGame에서 자동 해제
  addTrackedListener(canvasHost, 'keydown', iceKeyHandler);

  // v5: 부스터 발동 (술래만) — Space 또는 B (두 키 모두)
  // 2026-08-15 v8: 사용자 요청 — Space = 부스터 (기본), B = 대안
  // 2026-08-16: addTrackedListener 사용 — teardownGame에서 자동 해제
  const boostKeyHandler = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code !== GAME.boostKey && e.code !== (GAME.boostKeyAlt ?? 'KeyB')) return;
    if (!isTagger || !boost) return; // 술래만 사용 가능
    if (game.out) return;
    if (boost.trigger()) {
      roundStats.boostUsed += 1; // 2026-08-16: 발동 성공 시만 카운트 (쿨다운/stall 중 실패 제외)
    }
    triggerShake(0.25); // 2026-08-15: 부스터 발동 시 작은 임팩트
    sound.playBoost(); // 2026-08-15: 부스터 whoosh SFX
    // 2026-08-15: 부스터 스파크 버스트 (자기 발밑)
    if (dust) dust.burst(selfMesh.position, 18, 0.8, 1.5, 2.0, 0.5);
  };
  addTrackedListener(canvasHost, 'keydown', boostKeyHandler);

  // 2026-08-15: 포박줄 발사 (술래만) — F 홀딩=조준, 떼면 발사
  // v2: keydown = 조준 ON, keyup = 발사
  // v8: shotKey F로 변경 (도망자 얼림과 충돌하지만 role별 분기)
  addTrackedListener(canvasHost, 'keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.code !== GAME.shotKey || !isTagger) return;
    if (roundState !== 'playing' || game.out) return;
    if (ke.repeat) return;
    isAiming = true;
  });
  addTrackedListener(canvasHost, 'keyup', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.code !== GAME.shotKey || !isTagger) return;
    if (isAiming) {
      isAiming = false;
      // 발사 (준비 안 됐으면 무시)
      if (roundState === 'playing' && !game.out) {
        fireShot();
      }
    }
  });
  // 2026-08-15: 마우스 왼쪽 클릭 = 즉시 사격 (조준 없이)
  addTrackedListener(canvasHost, 'click', (e: Event) => {
    if (!isTagger) return;
    if (roundState !== 'playing' || game.out) return;
    // UI 버튼 클릭은 무시
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('.joystick-base') ||
      target.closest('.speed-bar')
    )
      return;
    fireShot();
  });

  // v5: 부스터 게이지 HUD (술래만)
  let boostBar: HTMLElement | null = null;
  let boostFill: HTMLElement | null = null;
  let boostStatus: HTMLElement | null = null;
  // 2026-08-15: 포박줄 쿨다운 HUD (술래만)
  let shotBar: HTMLElement | null = null;
  let shotFill: HTMLElement | null = null;
  let shotStatus: HTMLElement | null = null;
  if (isTagger && boost) {
    const boostWrap = document.createElement('div');
    boostWrap.className = 'boost-wrap';
    boostWrap.innerHTML = `
      <div class="boost-label">BOOST <span class="boost-hint">Space / B</span></div>
      <div class="boost-bar"><div class="boost-fill" id="boost-fill"></div></div>
      <div class="boost-status" id="boost-status">대기</div>
    `;
    wrap.appendChild(boostWrap);
    boostBar = boostWrap.querySelector<HTMLElement>('.boost-bar');
    boostFill = boostWrap.querySelector<HTMLElement>('#boost-fill');
    boostStatus = boostWrap.querySelector<HTMLElement>('#boost-status');
  }

  // 2026-08-15: 포박줄 쿨다운 HUD (술래만, 부스터 아래)
  if (isTagger) {
    const shotWrap = document.createElement('div');
    shotWrap.className = 'shot-wrap';
    shotWrap.innerHTML = `
      <div class="boost-label">SHOT <span class="boost-hint">F (홀딩) · 클릭</span></div>
      <div class="boost-bar"><div class="boost-fill shot-fill" id="shot-fill"></div></div>
      <div class="boost-status" id="shot-status">준비</div>
    `;
    wrap.appendChild(shotWrap);
    shotBar = shotWrap.querySelector<HTMLElement>('.boost-bar');
    shotFill = shotWrap.querySelector<HTMLElement>('#shot-fill');
    shotStatus = shotWrap.querySelector<HTMLElement>('#shot-status');
  }

  // 2026-08-15 v3: 대시 HUD (콤보 게이지 통합 — 좌상단 작게)
  // - dashTimeLeft: 활성 중 (남은 시간)
  // - dashCooldownLeft: 쿨다운 (남은 시간)
  const dashWrap = document.createElement('div');
  dashWrap.className = 'dash-wrap';
  dashWrap.innerHTML = `
    <div class="boost-label">DASH <span class="boost-hint">Shift</span></div>
    <div class="boost-bar"><div class="boost-fill dash-fill" id="dash-fill"></div></div>
    <div class="boost-status" id="dash-status">대기</div>
  `;
  wrap.appendChild(dashWrap);
  const dashFill = dashWrap.querySelector<HTMLElement>('#dash-fill');
  const dashStatus = dashWrap.querySelector<HTMLElement>('#dash-status');

  // 2026-08-15 v3: 모바일 탭-사격 버튼 (술래, 우상단) — 화면 탭으로 즉시 사격
  let shotFireBtn: HTMLButtonElement | null = null;
  if (isTagger && mobileMode) {
    shotFireBtn = document.createElement('button');
    shotFireBtn.type = 'button';
    shotFireBtn.className = 'shot-fire-btn';
    shotFireBtn.innerHTML = '🔥<br><span class="shot-fire-hint">사격</span>';
    shotFireBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (roundState !== 'playing' || game.out) return;
      fireShot();
    });
    wrap.appendChild(shotFireBtn);
  }

  // 얼림 버튼 (좌하단, 도망자만)
  let iceBtn: HTMLButtonElement | null = null;
  let iceStatus: HTMLElement | null = null;
  if (!isTagger) {
    const iceWrap = document.createElement('div');
    iceWrap.className = 'ice-wrap';
    iceBtn = document.createElement('button');
    iceBtn.type = 'button';
    iceBtn.className = 'ice-btn';
    iceBtn.innerHTML = `<span class="ice-btn-label">얼림</span><span class="ice-btn-hint">F</span>`;
    iceBtn.addEventListener('click', () => {
      if (game.out) return;
      const dist = distVecToTagger();
      if (ice.triggerIfReady(dist)) {
        sound.playIce();
        if (dust) dust.burst(aiMesh.position, 30, 1.5, 2.5, 2.5, 1.0);
        roundStats.iceUsed += 1; // 2026-08-16: 결과 화면 통계
      }
    });
    iceWrap.appendChild(iceBtn);
    iceStatus = document.createElement('div');
    iceStatus.className = 'ice-status';
    iceStatus.textContent = '대기 중';
    iceWrap.appendChild(iceStatus);
    wrap.appendChild(iceWrap);
  }

  // 2026-08-15: 흡수 HUD (화면 하단 중앙) — 도망자만
  let absorbHud: HTMLElement | null = null;
  let absorbProgress: HTMLElement | null = null;
  let absorbLabel: HTMLElement | null = null;
  if (!isTagger) {
    const absorbWrap = document.createElement('div');
    absorbWrap.className = 'absorb-hud';
    absorbWrap.innerHTML = `
      <div class="absorb-bar"><div class="absorb-bar-fill" id="absorb-bar-fill"></div></div>
      <div class="absorb-label" id="absorb-label">자국 흡수 (E)</div>
    `;
    wrap.appendChild(absorbWrap);
    absorbHud = absorbWrap;
    absorbProgress = absorbWrap.querySelector<HTMLElement>('#absorb-bar-fill');
    absorbLabel = absorbWrap.querySelector<HTMLElement>('#absorb-label');
  }
  // v6: 모바일 가상 조이스틱 (터치 환경 / 좁은 너비에서 자동 표시)
  let joystick: Joystick | null = null;
  if (mobileMode) {
    joystick = new Joystick({
      host: wrap,
      onChange: (f, r) => {
        // 키보드 input은 그대로 두고, 조이스틱이 setInput으로 직접 주입
        // (키보드/터치 동시 사용 가능, 조이스틱 떼면 tick에서 자동 0)
        player.setInput(f, r);
      },
    });
    joystick.mount();
  }

  // === 카메라 팔로우 (2026-08-15: 오비팅 → 플레이어 뒤로) ===
  // 카메라가 플레이어 등 뒤에서 따라옴. 부드러운 lerp + 미세 호흡감.
  // 초기값을 플레이어 뒤로 즉시 맞춤 (튀는 것 방지)
  const initialFacing = new THREE.Vector3(0, 0, -1);
  const initialBack = initialFacing.clone().multiplyScalar(-SCENE.cameraFollowDistance);
  ctx.camera.position.copy(selfMesh.position).add(initialBack);
  ctx.camera.position.y = SCENE.cameraFollowHeight;
  ctx.camera.lookAt(selfMesh.position.x, 1.5, selfMesh.position.z);

  // 카메라 lerp용 작업 벡터
  const cameraDesired = new THREE.Vector3();
  const cameraLookAt = new THREE.Vector3();
  const cameraFacing = new THREE.Vector3();
  // 2026-08-15: 카메라 yaw 회전용 임시 객체 (할당 재사용)
  const yawQuatTmp = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0);
  // 2026-08-15: WASD 입력용 basis (캐릭터 forward / right, 월드)
  const charForward = new THREE.Vector3();
  const charRight = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  // 2026-08-15: 카메라 셰이크 (충격 이벤트 시 미세 진동)
  let cameraShake = 0; // 0~1, 감쇠됨
  const triggerShake = (amount: number): void => {
    cameraShake = Math.min(1, cameraShake + amount);
  };

  // 2026-08-15: OUT 슬로모 + 흑백 (드라마틱 연출)
  let slowmoTime = 0; // 남은 슬로모 시간 (초)
  let slowmoActive = false;
  const SLOWMO_FACTOR = 0.25; // 0.25x 속도
  const SLOWMO_FALLBACK_TIME = 0.7;

  // === OUT 오버레이 (Fall Guys 카툰) ===
  const outOverlay = document.createElement('div');
  outOverlay.className = 'out-overlay';
  outOverlay.innerHTML = `
    <div class="out-card">
      <div class="out-eyebrow">ELIMINATED</div>
      <div class="out-medal">💥</div>
      <div class="out-title" id="out-title">잡혔습니다</div>
      <div class="out-sub" id="out-sub">술래와 거리가 너무 가까워졌어요</div>
      <div class="out-actions">
        <button type="button" class="button primary" id="out-retry">🔄 다시 시도</button>
        <button type="button" class="button secondary" id="out-lobby">🏠 로비로</button>
      </div>
    </div>
  `;
  wrap.appendChild(outOverlay);
  game.outOverlay = outOverlay;

  // v34: WIN 컨페티 (DOM particle) — resultOverlay에 append해서 위에 표시
  function spawnConfetti(): void {
    const colors = ['#ff5c8a', '#4dd0e1', '#ffd83d', '#9b59b6', '#2ecc71', '#fff44a'];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.setProperty('--confetti-color', colors[i % colors.length]);
      piece.style.setProperty('--confetti-x', `${(Math.random() - 0.5) * 800}px`);
      piece.style.setProperty('--confetti-rotate', `${Math.random() * 720 - 360}deg`);
      piece.style.setProperty('--confetti-delay', `${Math.random() * 0.3}s`);
      piece.style.left = `${50 + (Math.random() - 0.5) * 30}%`;
      piece.style.top = '40%';
      resultOverlay.appendChild(piece);
      trackTimeout(() => piece.remove(), 2500);
    }
  }

  const outTitleEl = outOverlay.querySelector<HTMLElement>('#out-title');
  const outSubEl = outOverlay.querySelector<HTMLElement>('#out-sub');
  const outRetryBtn = outOverlay.querySelector<HTMLButtonElement>('#out-retry');
  const outLobbyBtn = outOverlay.querySelector<HTMLButtonElement>('#out-lobby');

  function showOut(reason: string): void {
    if (game.out) return;
    game.out = true;
    game.outReason = reason;
    // 2026-08-15 v29: OUT 타이틀 버그 수정
    // - 술래(유저): "도망자를 잡았습니다!" (자랑)
    // - 도망자(유저): "잡혔습니다" (패배)
    if (outTitleEl) outTitleEl.textContent = isTagger ? '도망자를 잡았습니다!' : '잡혔습니다';
    if (outSubEl) outSubEl.textContent = reason;
    // 술래는 OUT 오버레이 스킵 (결과 화면에서 승리 표시)
    if (!isTagger) {
      outOverlay.classList.add('show');
    }
    // 2026-08-15: OUT 빨간 비네트 플래시
    if (game.outFlash) {
      game.outFlash.classList.add('active');
      trackTimeout(() => game.outFlash?.classList.remove('active'), 800);
    }
    // 2026-08-15: 흡수 정리
    if (absorb) absorb.reset();
    if (player.isAbsorbing()) player.setAbsorbing(false);
  }

  if (outRetryBtn) {
    outRetryBtn.addEventListener('click', () => {
      setScreen('room'); // 재시작은 room → 3D 데모 시작 (Phase B 한계)
    });
  }
  if (outLobbyBtn) {
    outLobbyBtn.addEventListener('click', () => setScreen('lobby'));
  }

  // === 거리 비교 헬퍼 ===
  const distVec = new THREE.Vector3();

  // 2026-08-15: 이동 바운스 (Y 살짝 출렁임)
  const prevPos = new THREE.Vector3().copy(selfMesh.position);
  let bobPhase = 0;
  const baseY = PLAYER.height / 2;

  const stop = startRenderLoop(ctx, (dt, t) => {
    // 2026-08-15: 이동량 (먼지 파티클 / Y 바운스 공용)
    const moveDx = selfMesh.position.x - prevPos.x;
    const moveDz = selfMesh.position.z - prevPos.z;
    const moved = Math.sqrt(moveDx * moveDx + moveDz * moveDz);
    prevPos.copy(selfMesh.position);

    // 2026-08-15 v4: 일시정지 중 — 게임 시간 정지, 비네트만
    if (pauseOverlay.classList.contains('show')) {
      return;
    }

    // 2026-08-15: 카운트다운 중에는 입력 차단 (시각만 진행)
    if (roundState === 'countdown') {
      // 2026-08-16: 카운트다운 폴링 안전망 — setTimeout fire 안 해도 강제 전환
      pumpCountdownFallback();
      // 2026-08-15: 인트로 시네마틱 카메라 (고공 → 추적 위치)
      const introT = Math.min(1, (performance.now() - gameStartedAt) / (introDuration * 1000));
      // Easing: cubic ease-in-out
      const eased =
        introT < 0.5 ? 4 * introT * introT * introT : 1 - Math.pow(-2 * introT + 2, 3) / 2;
      // 카메라 위치 lerp (introStartPos → 정상 follow 위치)
      // 정상 follow 위치 계산 (임시로 간단히)
      const desiredFollowPos = new THREE.Vector3();
      // facing 계산
      selfMesh.getWorldDirection(cameraFacing);
      desiredFollowPos.copy(selfMesh.position);
      desiredFollowPos.addScaledVector(cameraFacing, -SCENE.cameraFollowDistance);
      desiredFollowPos.y = SCENE.cameraFollowHeight;

      // Easing 적용: introT=0이면 introStartPos, introT=1이면 desiredFollowPos
      const camX = introStartPos.x + (desiredFollowPos.x - introStartPos.x) * eased;
      const camY = introStartPos.y + (desiredFollowPos.y - introStartPos.y) * eased;
      const camZ = introStartPos.z + (desiredFollowPos.z - introStartPos.z) * eased;
      ctx.camera.position.set(camX, camY, camZ);

      // lookAt: 인트로 시작은 맵 중심 → 끝은 플레이어
      const lookX = introStartLook.x + (selfMesh.position.x - introStartLook.x) * eased;
      const lookY = introStartLook.y + (1.5 - introStartLook.y) * eased;
      const lookZ = introStartLook.z + (selfMesh.position.z - introStartLook.z) * eased;
      ctx.camera.lookAt(lookX, lookY, lookZ);

      // 캐릭터 미세 호흡 (살아있는 느낌) 정도만
      // v28: rain/네온 OFF
      return;
    }
    // 2026-08-15: 라운드 종료 후 — 입력/물리 정지
    if (roundState === 'ended') {
      return;
    }

    // 2026-08-15: 라운드 타이머 (playing 중)
    if (roundState === 'playing') {
      // v34: 시작 4초간 역할별 조작 힌트 (그레이스 끝나고 잠깐 더 표시)
      if (roundTime < GAME.roundSeconds - 0.5) {
        const elapsed = GAME.roundSeconds - roundTime;
        if (elapsed < 4.5) {
          const tipText = isTagger
            ? 'WASD 이동 · F 사격 · Space 부스터 · Shift 대시'
            : 'WASD 이동 · E 자국 흡수 · F 술래 동결 · Shift 대시';
          showActionPrompt(tipText, '🎮', '#2a1a4a');
        }
      }
      // 2026-08-15: 그레이스 시간 감소 (술래 동결)
      if (graceTimeLeft > 0) {
        graceTimeLeft -= dt;
        if (graceTimeLeft <= 0) {
          graceTimeLeft = 0;
          if (taggerAI) taggerAI.setFrozen(false);
        }
      }

      // 2026-08-15 v4: 액션 프롬프트 — 맥락별 안내 (3초 표시)
      // - 도망자: 자국 위 / 얼림 사거리 내
      // - 술래: 사격 사거리 내 / 부스터 준비
      if (!isTagger) {
        // 자국 위 (E 흡수)
        const q = trails.queryNearest(selfMesh.position, 1.5);
        if (q.hit && !absorb.isAbsorbing() && absorb.getCooldown() <= 0) {
          showActionPrompt('자국 흡수', 'E', '#54f0b1');
        } else if (ice.isReady() && aiMesh) {
          // 얼림 사거리 내
          const dx = selfMesh.position.x - aiMesh.position.x;
          const dz = selfMesh.position.z - aiMesh.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= GAME.iceRange) {
            showActionPrompt('술래 동결', 'F', '#66e0ff');
          }
        }
      } else if (isTagger) {
        // 사격 가능 (F 또는 클릭)
        if (!shotState.active && shotState.cooldownLeft <= 0) {
          if (aiMesh) {
            const dx = aiMesh.position.x - selfMesh.position.x;
            const dz = aiMesh.position.z - selfMesh.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= GAME.shotRange) {
              const isAimingNow = isAiming;
              showActionPrompt(
                isAimingNow ? '조준 중 — 떼면 발사' : '포박줄 사격',
                isAimingNow ? 'F' : 'F·클릭',
                '#ff3a5c',
              );
            }
          }
        }
        // 부스터 준비
        if (boost && !boost.isStalling() && boost.getCooldownRemaining() <= 0) {
          showActionPrompt('부스터', 'Space', '#ffb000');
        }
      }

      roundTime -= dt;
      if (roundTime <= 0) {
        roundTime = 0;
        // 시간 초과 → 술래 승리 (1:1 모드)
        showResult('tagger', '시간 초과');
        return;
      }
      // 출구 도달 판정 (도망자만)
      if (!isTagger) {
        const dx = selfMesh.position.x - exitPos.x;
        const dz = selfMesh.position.z - exitPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= exitRadius * exitRadius) {
          escapeHoldTime += dt;
          if (escapeHoldTime >= GAME.exitHoldSeconds) {
            // 탈출 성공
            showResult('runner', '출구에 도달했습니다');
            return;
          }
        } else {
          // 출구에서 벗어남 → 누적 시간 리셋
          escapeHoldTime = 0;
        }
      }
    }

    if (!game.out) {
      // 2026-08-15: 흡수 시스템 업데이트 (E 키 1초 유지)
      // 흡수 중 매 프레임: 자국 위에 있는지 확인 + progress 갱신
      if (absorb && !isTagger) {
        const inTrail = trails.queryNearest(selfMesh.position, 1.5).hit;
        const absorbEvent = absorb.update(dt, inTrail, ice.isActive() || player.isFrozen());
        if (absorbEvent === 'cancel') {
          player.setAbsorbing(false);
          sound.playAbsorbCancel();
        } else if (absorbEvent === 'complete') {
          // onComplete 콜백에서 이미 처리 (자국 제거, 가속, SFX, 버스트)
          player.setAbsorbing(false);
        }
        // 가속 종료 시 boost speed 해제
        if (absorb.getBoostRemaining() <= 0) {
          player.setBoostSpeedMultiplier(1.0);
        }
      }

      // 2026-08-15: 슬로모 (OUT 시) — 게임 상태만 슬로우, 시각 효과는 정상
      const effectiveDt = slowmoActive ? dt * SLOWMO_FACTOR : dt;
      player.update(effectiveDt);

      // 2026-08-15: 이동 바운스 — 속도 비례 phase 진행 + sin |sin|로 항상 양수
      // 흡수 중에는 발자국 정지 (정지 상태 유지)
      if (moved > 0.001 && !player.isFrozen() && !player.isAbsorbing()) {
        bobPhase += effectiveDt * (8 + moved * 30); // 빠를수록 더 빠른 보
        selfMesh.position.y = baseY + Math.abs(Math.sin(bobPhase)) * 0.08;
        // 2026-08-15: 발자국 SFX (속도 비례 간격/음량)
        if (sound) {
          sound.setFootstepInterval(Math.max(0.18, 0.42 - moved * 0.4));
          sound.playFootstep(Math.min(1.0, 0.4 + moved * 0.3));
        }
      } else {
        // v34: idle 호흡 — 가만히 있어도 살짝 떠다니는 생명감
        bobPhase += effectiveDt * 1.8;
        const idleBob = Math.sin(bobPhase * 0.5) * 0.02;
        selfMesh.position.y = baseY + idleBob + (selfMesh.position.y - baseY - idleBob) * 0.85;
      }
      if (taggerAI) taggerAI.update(effectiveDt);
      if (runnerAI) runnerAI.update(effectiveDt);
      if (boost) boost.update(effectiveDt);
      trails.update(effectiveDt, t);
      ice.update(effectiveDt);

      // === v33: 캐릭터 간 충돌 분리 — 떨림/합체 방지 ===
      // - 두 메시(자기/AI)가 가까이 붙으면 서로 밀어냄 (충돌 반경 = 반지름 합)
      // - 한쪽이 frozen이면 안 움직임 (얼려진 도망자는 못 밀어냄 — 잡힘)
      // - 부스터 중에는 살짝 더 강한 분리 (관성 표현)
      if (aiMesh && !game.out) {
        const dx = selfMesh.position.x - aiMesh.position.x;
        const dz = selfMesh.position.z - aiMesh.position.z;
        const distSq = dx * dx + dz * dz;
        const minDist = PLAYER.radius * 2 + 0.15; // 캡슐 반지름 합 + 약간의 여유
        if (distSq < minDist * minDist && distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          // 양쪽 동일하게 밀어냄. 단 frozen/얼려진 쪽은 안 움직임.
          const selfFrozen = player.isFrozen() || ice.isActive() || slowmoActive;
          // ice.isActive()는 술래를 얼리는 거라 도망자만 영향, 여기선 도망자=자기자신이 얼려진 경우
          if (!selfFrozen) {
            selfMesh.position.x += nx * overlap * 0.5;
            selfMesh.position.z += nz * overlap * 0.5;
          }
          // AI는 taggerAI/runnerAI의 update로 위치가 갱신되므로, 직접 보정하지 않고
          // 다음 프레임의 update에서 자연스럽게 분리되도록 함.
          // 대신 aiMesh의 위치를 살짝 보정해서 시각적 떨림 방지:
          aiMesh.position.x -= nx * overlap * 0.5;
          aiMesh.position.z -= nz * overlap * 0.5;
        }
      }

      // === 2026-08-15: 포박줄 발사체 업데이트 + 도망자 충돌 체크 ===
      // - 매 프레임 발사체 이동
      // - 사거리 초과 또는 도망자 충돌 시 disposeShot
      // - 도망자 충돌 시 OUT (사용자 의도: "몸에 닿는 거 말고 포박줄")
      if (shotState.cooldownLeft > 0) shotState.cooldownLeft -= dt;
      if (shotState.active && shotState.mesh) {
        const move = GAME.shotSpeed * dt;
        shotState.traveled += move;
        shotState.mesh.position.addScaledVector(shotState.direction, move);

        if (shotState.traveled >= GAME.shotRange) {
          // 사거리 초과
          disposeShot();
        } else if (isTagger && aiMesh) {
          // 도망자 충돌 체크 (selfMesh=술래, aiMesh=도망자)
          shotHitTmp.subVectors(aiMesh.position, shotState.mesh.position);
          const dist2 = shotHitTmp.lengthSq();
          const hitR = GAME.shotRadius + PLAYER.radius * GAME.taggerScale;
          if (dist2 < hitR * hitR) {
            // 충돌 — OUT
            if (absorb && absorb.isInvulnerable()) {
              // 2026-08-15: 흡수 후 가속 중이면 1회 무적 (포박줄도 무적)
              absorb.consumeInvulnerability();
              triggerShake(0.3);
              if (dust) dust.burst(aiMesh.position, 20, 1.0, 2.0, 2.5, 0.6);
              sound.playBoost();
            } else {
              triggerShake(0.6);
              sound.playOut();
              roundStats.outCount += 1;
              // 2026-08-15: 도망자 시각 효과 (작아지고 반투명) — 발사체에 맞은 거 시각화
              if (aiMaterial) {
                aiMaterial.opacity = 0.3;
                aiMaterial.transparent = true;
              }
              if (aiMesh) aiMesh.scale.set(0.6, 0.4, 0.6);
              // OUT 슬로모 + 흑백 (연출)
              slowmoTime = 0.7;
              slowmoActive = true;
              if (canvasHost) canvasHost.classList.add('slowmo');
              trackTimeout(() => {
                if (canvasHost) canvasHost.classList.remove('slowmo');
                slowmoActive = false;
              }, 700);
              // v8: 게임 일시정지 (player 안 움직이게) + 결과만 표시
              // - showOut 오버레이는 스킵 (결과 화면에 통합)
              // - showResult만 호출 (승/패 + 통계 + retry/lobby)
              game.out = true;
              game.outReason = '술래의 포박줄에 걸렸습니다';
              if (absorb) absorb.reset();
              if (player.isAbsorbing()) player.setAbsorbing(false);
              showResult('tagger', '술래의 포박줄에 걸렸습니다');
            }
            disposeShot();
          }
        }
      }

      // === OUT 판정 (구버전 — 2026-08-15 v6: 포박줄로 대체되어 제거) ===
    } else {
      trails.update(dt, t);
    }

    // 자국 개수 HUD
    if (game.statusTimer) {
      game.statusTimer.textContent = String(trails.getActiveCount());
    }

    // 2026-08-15 v4: 라운드 타이머 HUD — 큰 글씨 + 색상 그라데이션 (best practice: 시각적 계층)
    if (roundTimerEl) {
      const mm = Math.floor(roundTime / 60);
      const ss = Math.floor(roundTime % 60)
        .toString()
        .padStart(2, '0');
      const timeStr = `${mm}:${ss}`;
      roundTimerEl.textContent = timeStr;
      // 색상: green (safe) → yellow (warning) → red (critical) → flashing
      roundTimerEl.classList.remove('warn', 'critical', 'flash');
      if (roundTime < 10) {
        roundTimerEl.classList.add('flash');
      } else if (roundTime < 30) {
        roundTimerEl.classList.add('critical');
      } else if (roundTime < 60) {
        roundTimerEl.classList.add('warn');
      }
    }
    // v4: speedStatus는 dpad 아래 작은 게이지로 변경 (기존 코드와 호환 위해 유지)
    if (game.speedStatus) {
      game.speedStatus.textContent = ''; // 비움 (v4에서 큰 타이머로 이전됨)
    }

    // v5: 부스터 게이지 HUD (술래만)
    if (boost && boostFill && boostStatus) {
      const fatigue = boost.getFatigue();
      boostFill.style.width = `${fatigue}%`;
      boostFill.classList.toggle('critical', fatigue >= GAME.boostStallThreshold);
      if (boost.isStalling()) {
        boostStatus.textContent = '회복 중';
        boostStatus.className = 'boost-status stalling';
      } else if (boost.isBoosting()) {
        boostStatus.textContent = '가속!';
        boostStatus.className = 'boost-status boosting';
      } else if (boost.getCooldownRemaining() > 0) {
        boostStatus.textContent = `쿨다운 ${boost.getCooldownRemaining().toFixed(1)}s`;
        boostStatus.className = 'boost-status cooldown';
      } else {
        const mul = boost.getSpeedMultiplier();
        if (mul < 1) {
          boostStatus.textContent = `느려짐 ×${mul.toFixed(2)}`;
          boostStatus.className = 'boost-status tired';
        } else {
          boostStatus.textContent = '대기';
          boostStatus.className = 'boost-status ready';
        }
      }

      // 2026-08-15: 부스터 활성 시 스피드 라인 오버레이 토글
      if (game.speedlines) {
        game.speedlines.classList.toggle('active', boost.isBoosting());
      }
    }

    // 2026-08-15 v3: 대시 HUD 업데이트
    if (dashFill && dashStatus) {
      if (player.isDashing()) {
        const remain = player.getDashCooldownRemaining(); // not used, use dashTimeLeft
        void remain;
        dashFill.style.width = '100%';
        dashFill.classList.add('boosting');
        dashStatus.textContent = '대시!';
        dashStatus.className = 'boost-status boosting';
      } else {
        const cd = player.getDashCooldownRemaining();
        const cdMax = player.getDashCooldownMax();
        const ratio = 1 - cd / cdMax;
        dashFill.style.width = `${ratio * 100}%`;
        dashFill.classList.remove('boosting');
        if (cd > 0) {
          dashStatus.textContent = `쿨다운 ${cd.toFixed(1)}s`;
          dashStatus.className = 'boost-status cooldown';
        } else {
          dashStatus.textContent = '대기 (Shift)';
          dashStatus.className = 'boost-status ready';
        }
      }
    }

    // 2026-08-15: 포박줄 쿨다운 HUD 업데이트
    if (shotBar && shotFill && shotStatus) {
      if (shotState.active) {
        // 발사체 비행 중
        const remain = 1 - shotState.traveled / GAME.shotRange;
        shotFill.style.width = `${remain * 100}%`;
        shotFill.classList.remove('critical');
        shotStatus.textContent = '발사 중';
        shotStatus.className = 'boost-status boosting';
      } else if (shotState.cooldownLeft > 0) {
        // 쿨다운
        const ratio = 1 - shotState.cooldownLeft / GAME.shotCooldown;
        shotFill.style.width = `${ratio * 100}%`;
        shotStatus.textContent = `쿨다운 ${shotState.cooldownLeft.toFixed(1)}s`;
        shotStatus.className = 'boost-status cooldown';
      } else {
        // 준비
        shotFill.style.width = '100%';
        shotStatus.textContent = '준비 (F / 클릭)';
        shotStatus.className = 'boost-status ready';
      }
    }
    if (debugStatus) {
      // v5 디버그: 자기 위치 + 입력 상태 (캔버스에 키가 들어오는지 즉시 확인)
      const inp = player.getDebugInput();
      const px = selfMesh.position.x;
      const pz = selfMesh.position.z;
      const dirArrow =
        (inp.forward > 0 ? '↑' : inp.forward < 0 ? '↓' : '·') +
        (inp.right > 0 ? '→' : inp.right < 0 ? '←' : '·');
      const frozenTag = player.isFrozen() ? ' [얼림]' : '';
      debugStatus.textContent = `(${px.toFixed(1)}, ${pz.toFixed(1)}) 입력 ${dirArrow}${frozenTag}`;
    }

    // 얼림 버튼 상태 업데이트
    if (iceBtn) {
      if (ice.isActive()) {
        iceBtn.classList.add('frozen');
        iceBtn.classList.remove('ready', 'cooldown');
        iceBtn.disabled = true;
        iceBtn.querySelector('.ice-btn-label')!.textContent =
          `얼림 ${ice.getRemaining().toFixed(1)}s`;
      } else if (ice.getCooldown() > 0) {
        iceBtn.classList.remove('frozen', 'ready');
        iceBtn.classList.add('cooldown');
        iceBtn.disabled = true;
        iceBtn.querySelector('.ice-btn-label')!.textContent =
          `쿨다운 ${ice.getCooldown().toFixed(1)}s`;
      } else {
        iceBtn.classList.remove('frozen', 'cooldown');
        iceBtn.classList.add('ready');
        iceBtn.disabled = false;
        iceBtn.querySelector('.ice-btn-label')!.textContent = '얼림';
      }
    }
    if (iceStatus) {
      if (ice.isActive()) iceStatus.textContent = '술래 동결 중';
      else if (ice.getCooldown() > 0) iceStatus.textContent = '재사용 대기';
      else iceStatus.textContent = '준비됨 (F)';
    }

    // 2026-08-15: 흡수 HUD 갱신
    if (absorbHud && absorbProgress && absorbLabel) {
      if (absorb && absorb.isAbsorbing()) {
        absorbProgress.style.width = `${absorb.getProgress() * 100}%`;
        absorbHud.classList.add('active');
        absorbLabel.textContent = `흡수 중... (${(absorb.getProgress() * 100).toFixed(0)}%)`;
      } else if (absorb && absorb.getBoostRemaining() > 0) {
        absorbProgress.style.width = `${(absorb.getBoostRemaining() / GAME.boostSeconds) * 100}%`;
        absorbHud.classList.add('boost');
        absorbHud.classList.remove('active');
        absorbLabel.textContent = `가속! ${absorb.getBoostRemaining().toFixed(1)}초`;
      } else if (absorb && absorb.getCooldown() > 0) {
        absorbHud.classList.remove('active', 'boost');
        absorbLabel.textContent = `재사용 대기 ${absorb.getCooldown().toFixed(1)}초`;
      } else {
        absorbHud.classList.remove('active', 'boost');
        // 자국 위에 있는지 표시
        const query = trails.queryNearest(selfMesh.position, 1.5);
        if (query.hit) {
          absorbLabel.textContent = '자국 흡수 (E) — 준비';
        } else {
          absorbLabel.textContent = '자국 흡수 (E) — 자국 위에 서세요';
        }
      }
    }

    // v6: 조이스틱 자동 복귀 (떼면 0)
    if (joystick) joystick.tick();

    // 카메라 팔로우 (플레이어 등 뒤에서 따라옴) + 2026-08-15 사용자 회전/줌
    // 0) 2026-08-15 v2: yaw/pitch smoothing — target → actual lerp
    //    마우스 드래그 끝나도 카메라가 부드럽게 따라옴 (확확 안 넘어감)
    camState.yaw += (camState.yawTarget - camState.yaw) * CAM_ROT_SMOOTHING;
    camState.pitch += (camState.pitchTarget - camState.pitch) * CAM_ROT_SMOOTHING;

    // 1) 카메라 facing = 월드 -Z 고정 (캐릭터 진행 방향과 분리)
    //    WASD는 카메라 facing 기준으로 이동하므로, 캐릭터가 회전해도 카메라는 안 돌아감
    cameraFacing.set(0, 0, -1);

    // 1.4) 2026-08-15 v3: chase 모드 — 카메라가 캐릭터 진행 방향 자동 추적
    // - 캐릭터가 움직이는 방향으로 카메라 yaw가 천천히 따라옴
    // - 사용자가 드래그하면 orbit 모드로 자동 전환
    if (camState.mode === 'chase') {
      const moveDx2 = selfMesh.position.x - prevPos.x;
      const moveDz2 = selfMesh.position.z - prevPos.z;
      const movedNow = Math.sqrt(moveDx2 * moveDx2 + moveDz2 * moveDz2);
      if (movedNow > 0.05) {
        // 캐릭터 진행 방향의 yaw (월드)
        const charYaw = Math.atan2(moveDx2, moveDz2);
        // 카메라 facing이 -Z에서 시작하므로, 카메라가 보는 방향의 yaw = charYaw
        // 카메라 yaw는 "월드 -Z에서 얼마나 회전했나"이므로
        // charYaw (월드 forward = 0, 진행 방향) → camYaw
        camState.yawTarget = charYaw;
      }
    }

    // 1.5) yaw 회전 (사용자 우클릭 드래그) — 월드 Y축 기준
    if (Math.abs(camState.yaw) > 0.0001) {
      const yawQ = yawQuatTmp.setFromAxisAngle(yawAxis, camState.yaw);
      cameraFacing.applyQuaternion(yawQ);
    }

    // 2) desired camera position: player 뒤 + 거리 + pitch
    cameraDesired.copy(selfMesh.position);
    cameraDesired.addScaledVector(cameraFacing, -camState.distance);
    const baseFollowY = SCENE.cameraFollowHeight;
    const pitchOffset = Math.sin(camState.pitch) * camState.distance * 0.4;
    cameraDesired.y = baseFollowY + pitchOffset;

    // 3) 미세 호흡감
    cameraDesired.x += Math.sin(t * 0.6) * SCENE.cameraFollowShake;
    cameraDesired.y += Math.cos(t * 0.45) * SCENE.cameraFollowShake * 0.6;

    // 4) 2026-08-15: 카메라-장애물 충돌 (벽/박스에 파묻히지 않게)
    // - 카메라 desired 위치에서 캐릭터로 향하는 ray
    // - 사이에 벽/박스 있으면 hit 직전까지만 카메라를 당김
    const camRay = cameraDesired.clone().sub(selfMesh.position);
    camRay.y = 0;
    const camRayDist = camRay.length();
    const blockers: THREE.Object3D[] = [];
    for (const w of mapRefs.walls) blockers.push(w);
    for (const o of mapRefs.obstacles) blockers.push(o);
    if (camRayDist > 0.01) {
      camRay.normalize();
      const camRayOrigin = cameraDesired.clone();
      const ray = new THREE.Raycaster(camRayOrigin, camRay, 0, camRayDist);
      const hits = ray.intersectObjects(blockers, false);
      if (hits.length > 0) {
        // 2026-08-15 v2: min distance 1.0 → 0.5 — 더 강하게 캐릭터 가까이
        const safeDist = Math.max(0.5, hits[0].distance - 0.3);
        cameraDesired.x = selfMesh.position.x - camRay.x * safeDist;
        cameraDesired.z = selfMesh.position.z - camRay.z * safeDist;
      }
    }

    // 4.5) 2026-08-15 v2: lookAt raycast — 카메라가 보는 시야에 박스 있으면 보정
    // - 카메라 위치에서 lookAt 방향으로 ray
    // - hit 있으면 lookAt을 hit 직전(살짝 캐릭터 쪽)으로 → 캐릭터가 안 가려지도록
    const lookRay = cameraLookAt.clone().sub(ctx.camera.position);
    const lookRayDist = lookRay.length();
    if (lookRayDist > 0.01 && blockers.length > 0) {
      const lookDir = lookRay.clone().normalize();
      const lookRayObj = new THREE.Raycaster(ctx.camera.position.clone(), lookDir, 0, lookRayDist);
      const lookHits = lookRayObj.intersectObjects(blockers, false);
      if (lookHits.length > 0) {
        // lookAt을 hit의 살짝 위쪽(박스 위 +0.5m)으로 옮김 → 카메라가 박스 너머를 안 봄
        // 가장 가까운 hit의 distance보다 살짝 짧은 곳에서 lookAt
        // 또한 박스 위에서 캐릭터를 볼 수 있도록 y를 살짝 올림
        const hitDist = lookHits[0].distance;
        const safeLookDist = Math.max(0.5, hitDist - 0.5);
        cameraLookAt.copy(ctx.camera.position).addScaledVector(lookDir, safeLookDist);
      }
    }

    // 5) lerp
    ctx.camera.position.lerp(cameraDesired, SCENE.cameraFollowSmoothing);

    // 5.5) 2026-08-15 v26: 카메라 y 강제 하한 20.0 → 7.0 — 적당한 높이 (박스 위는 유지)
    // → 너무 위에서 보면 캐릭터 식별성 ↓, 게임성 ↓
    const CAMERA_MIN_Y = 7.0;
    if (ctx.camera.position.y < CAMERA_MIN_Y) {
      ctx.camera.position.y = CAMERA_MIN_Y;
    }

    // 4.5) 카메라 셰이크 (감쇠 + 무작위 오프셋)
    if (cameraShake > 0) {
      cameraShake = Math.max(0, cameraShake - dt * 3.0);
      const k = cameraShake * 0.5;
      ctx.camera.position.x += (Math.random() - 0.5) * k;
      ctx.camera.position.y += (Math.random() - 0.5) * k;
      ctx.camera.position.z += (Math.random() - 0.5) * k;
    }

    // 4.7) FOV — 부스터/role별 분기 (v33: 도망자 시야 확장)
    // - 술래: 좁고 정밀 (68) — 거리/타이밍 파악
    // - 도망자: 넓은 시야 (82) — 술래 위치/방향 조기 인식
    // - 부스터 활성 시: 추가로 확장
    const baseFov: number = isTagger ? SCENE.cameraFovTagger : SCENE.cameraFovRunner;
    let targetFov: number = baseFov;
    if (boost && boost.isBoosting()) targetFov = Math.max(baseFov, SCENE.boostFov);
    if (Math.abs(ctx.camera.fov - targetFov) > 0.05) {
      ctx.camera.fov += (targetFov - ctx.camera.fov) * Math.min(1, dt * SCENE.fovLerpSpeed);
      ctx.camera.updateProjectionMatrix();
    }

    // 5) look at: 플레이어 위쪽 + 정면 살짝 앞
    // 2026-08-15 v2: y += 1.5 → 2.5 — 카메라가 박스 너머를 안 보게 (lookAt 자체를 위로)
    cameraLookAt.copy(selfMesh.position);
    cameraLookAt.y += 2.5;
    cameraLookAt.addScaledVector(cameraFacing, SCENE.cameraFollowLookAhead);
    ctx.camera.lookAt(cameraLookAt);

    // 6) 2026-08-15 v29: WASD = 카메라-상대 (이전: 캐릭터-상대 → 빙글빙글 버그)
    // - 카메라가 보는 방향이 W, 그 좌우가 A/D
    // - W = 카메라 forward, S = 카메라 backward, A/D = 좌우 (카메라 기준)
    // - W+A = 카메라 forward-left 대각선 (빙글빙글 안 함)
    // - 카메라는 chase/orbit 모드, 사용자가 드래그하면 orbit으로 전환
    // - 캐릭터는 이동 방향으로 회전 (PlayerController.update 안의 slerp)
    // 카메라 forward (월드) 계산
    cameraFacing.set(0, 0, -1);
    if (Math.abs(camState.yaw) > 0.0001) {
      const q = yawQuatTmp.setFromAxisAngle(yawAxis, camState.yaw);
      cameraFacing.applyQuaternion(q);
    }
    charForward.copy(cameraFacing); // 카메라가 보는 방향 = W
    charRight.crossVectors(cameraFacing, worldUp).normalize();
    player.setMoveBasis(charForward, charRight);

    // v28: 비/네온/사인/가로등 OFF (daylight)
    // 먼지만 살짝 (자국/부스터 이펙트)
    if (dust) {
      const isBoostingNow = boost ? boost.isBoosting() : false;
      dust.update(dt, selfMesh.position, moved, isBoostingNow);
    }

    // 2026-08-15 v4: 미니맵 갱신
    if (Math.floor(t * 12) !== Math.floor((t - dt) * 12)) {
      drawMinimap();
    }

    // 2026-08-15: 3D 방향 인디케이터 업데이트
    // - 타겟 마커: AI 머리 위 따라가며 펄스 (위아래 흔들)
    // - 그레이스 중에는 빨갛게 깜빡임 (술래 동결 중 표시)
    targetMarker.position.x = aiMesh.position.x;
    targetMarker.position.z = aiMesh.position.z;
    targetGlow.position.copy(targetMarker.position);
    const pulseY = Math.sin(t * 4) * 0.18;
    targetMarker.position.y = 2.2 + pulseY;
    targetGlow.position.y = targetMarker.position.y;
    // 그레이스 중 색상 토글 (시안/노랑 ↔ 빨강)
    if (graceTimeLeft > 0 && taggerAI) {
      const k = 0.5 + 0.5 * Math.sin(t * 8);
      const mat = targetMarker.material as THREE.MeshBasicMaterial;
      mat.color.setHex(0xff5070);
      mat.opacity = 0.5 + 0.5 * k;
      const glowMat = targetGlow.material as THREE.MeshBasicMaterial;
      glowMat.color.setHex(0xff5070);
    } else {
      const mat = targetMarker.material as THREE.MeshBasicMaterial;
      mat.color.setHex(targetMarkerColor);
      mat.opacity = 0.95;
      const glowMat = targetGlow.material as THREE.MeshBasicMaterial;
      glowMat.color.setHex(targetMarkerColor);
    }

    // 2026-08-15: 사격 조준선 (Space 홀딩) — 술래가 조준 방향 확인용
    if (aimLaser && aimLaserMat && isTagger) {
      if (isAiming && !game.out && roundState === 'playing') {
        const dir = getAimDirection();
        const startY = selfMesh.position.y + PLAYER.height * 0.45;
        aimLaser.position.set(selfMesh.position.x, startY, selfMesh.position.z);
        // 길이: shotRange, 굵기 살짝 흔들림
        aimLaser.scale.set(1, GAME.shotRange, 1);
        // 회전: +Y 축 → dir로
        aimLaser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        // 살짝 펄스
        const lp = 0.4 + 0.15 * Math.sin(t * 12);
        aimLaserMat.opacity = lp;
        aimLaser.visible = true;
      } else {
        aimLaser.visible = false;
      }
    }
  });

  game.ctx = ctx;
  game.stopLoop = stop;
  game.ice = ice;
  game.iceKeyHandler = iceKeyHandler;
  game.boost = boost;
  game.boostKeyHandler = boostKeyHandler;
  game.joystick = joystick;
  game.dust = dust;
}

function teardownGame(): void {
  // 2026-08-16: 추적된 리스너/타이머 일괄 해제
  // (addTrackedListener/trackTimeout으로 등록된 모든 것)
  for (const dispose of game.disposers) {
    try {
      dispose();
    } catch (err) {
      console.warn('[teardownGame] dispose 실패', err);
    }
  }
  game.disposers = [];

  // 2026-08-16: 맵 자원 dispose (GPU 메모리 해제)
  if (game.mapRefs) {
    disposeMap(game.mapRefs);
    game.mapRefs = null;
  }
  if (game.exitDisc) {
    game.exitDisc.geometry.dispose();
    // material은 단일 또는 배열일 수 있음
    if (Array.isArray(game.exitDisc.material)) {
      game.exitDisc.material.forEach((m) => m.dispose());
    } else {
      game.exitDisc.material.dispose();
    }
    if (game.exitDisc.parent) game.exitDisc.parent.remove(game.exitDisc);
    game.exitDisc = null;
  }

  // 2026-08-15: 발사체는 renderGame 종료와 함께 GC되므로 별도 정리 불필요
  // (scene.dispose()에서 mesh 제거됨)
  if (game.player) {
    game.player.dispose();
    game.player = null;
  }
  if (game.trails) {
    game.trails.dispose();
    game.trails = null;
  }
  if (game.dust) {
    game.dust.dispose();
    game.dust = null;
  }
  if (game.sound) {
    game.sound.dispose();
    game.sound = null;
  }
  if (game.ice) {
    game.ice.reset();
    game.ice = null;
  }
  // 2026-08-16: iceKeyHandler/boostKeyHandler는 addTrackedListener로 등록 — disposers에서 자동 해제
  // (수동 removeEventListener 블록 제거)
  game.iceKeyHandler = null;
  game.boostKeyHandler = null;
  game.boost = null;
  game.joystick?.unmount();
  game.joystick = null;
  game.tagger = null;
  game.speedButtons = [];
  game.speedStatus = null;
  game.statusTimer = null;
  game.statusHud = null;
  if (game.stopLoop) {
    game.stopLoop();
    game.stopLoop = null;
  }
  if (game.ctx) {
    game.ctx.dispose();
    game.ctx = null;
  }
  // 캔버스 호스트가 있으면 정리
  const wrap = root.querySelector('.game-canvas-wrap');
  if (wrap) wrap.remove();
}

function render(): void {
  root.replaceChildren();
  root.dataset.screen = screen;
  switch (screen) {
    case 'intro':
      renderIntro();
      break;
    case 'login':
      renderLogin();
      break;
    case 'character':
      renderCharacter();
      break;
    case 'role':
      renderRole();
      break;
    case 'map-select':
      renderMapSelect();
      break;
    case 'lobby':
      renderLobby();
      break;
    case 'room':
      renderRoom();
      break;
    case 'game':
      renderGame();
      break;
  }
}

render();
