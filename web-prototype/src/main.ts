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
import { Joystick, LookStick, isMobileLike } from './scene/TouchController';
import { addCharacterFeatures } from './scene/CharacterFactory';
import { DustSystem } from './scene/DustSystem';
import { SoundManager } from './scene/SoundManager';
import {
  AbsorbSystem,
  botShouldAbsorbTrails,
  botTrailAbsorbHoldSeconds,
} from './scene/AbsorbSystem';
import { ItemField } from './scene/ItemField';
import { ITEM_META, magnetTakeCount, type ItemKind } from './lib/items';
import { escapeHtml } from './lib/html-escape';
import { appVersionLabel } from './lib/app-version';
import { RemotePlayerSync, slerpYaw } from './lib/sync';
import { countdownFromElapsed, firstCountdownPaint, effectiveElapsedMs } from './lib/countdown';
import { attachWorldLabel, shouldAttachPlayerLabel } from './lib/follow-label';
import {
  applyFaceDirFromWorldDir,
  chaseYawFromMovement,
  shortestAngle,
  wrapAngle,
} from './lib/direction';
import { firstPersonYawFromLookAxes, lookDeltaFromAxes } from './lib/look-stick';
import { retryScreenForEntry, shouldTeardownGame, type MatchEntryMode } from './lib/match-flow';
import {
  canEnterWithCode,
  isCompleteRoomCode,
  normalizeRoomCode,
  pruneRooms,
  upsertRoom,
  type RoomListing,
} from './lib/room-code';
import { moveCircle } from './lib/collision';
import {
  contactsInRange,
  headingAway,
  netCatchRadius,
  pickStickyPoint,
  withinDistance,
} from './lib/chase';
import { matchSpawns } from './lib/spawn-layout';
import { NetClient, type NetPeer, wsUrlFromLocation } from './lib/net';
import { MAX_RECONNECT_ATTEMPTS, waitBeforeNextAttempt } from './lib/reconnect';
import { reconnectFlow, type AttemptResult } from './lib/reconnect-flow';
import { serverEpochToClientPerf } from './lib/time-sync';
import { judgeTrailRound } from './lib/round-rules';
import { applyVisualViewportVars, requestGameFullscreen } from './lib/fullscreen';
import {
  assignRoles,
  buildSoloSeats,
  clampSoloAiCount,
  WISH_LABEL,
  type AssignedRole,
  type RoleWish,
} from './lib/assign-roles';

type Screen = 'intro' | 'login' | 'character' | 'role' | 'map-select' | 'lobby' | 'room' | 'game';
type CharacterId = 'runner-cyan' | 'runner-pink' | 'runner-yellow' | 'runner-purple';
type Role = 'tagger' | 'runner';

interface Profile {
  nickname: string;
  characterId: CharacterId;
  role: Role;
  roleWish: RoleWish;
  mapId: MapId;
  /** 2026-08-25: 마지막 참가 방 코드 — 자동 재연결용. 빈 문자열이면 재연결 안 함. */
  lastRoomCode: string;
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
  lookStick: LookStick | null;
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
  mesh: THREE.Object3D,
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
  sprite.renderOrder = 999;
  attachWorldLabel(sprite, mesh, offsetY);
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
const APP_VERSION = appVersionLabel(import.meta.env.VITE_APP_VERSION);
applyVisualViewportVars();

let screen: Screen = 'intro';
const profile: Profile = {
  nickname: '',
  characterId: 'runner-cyan',
  role: 'runner',
  roleWish: 'random',
  mapId: 'park',
  // 2026-08-25: 마지막으로 참가한 방 코드 — 자동 재연결 시 재join에 사용.
  // 멀티플레이 도중 끊겨도 사용자가 코드 다시 입력하지 않도록 보존.
  lastRoomCode: '',
};
let roomCode = '';
let roomMode: 'find' | 'create' = 'find';
let roomJoined = true;
let matchEntry: MatchEntryMode = 'solo';
// 2026-08-28: 세션 토큰 영속화 — 탭 재시작/새로고침 후에도 같은 좌석(방장)으로 복귀
const SESSION_TOKEN_KEY = 'energy-trail-session-token-v1';
let sessionToken = '';
try {
  sessionToken = localStorage.getItem(SESSION_TOKEN_KEY) ?? '';
} catch {
  sessionToken = '';
}
function saveSessionToken(token: string): void {
  sessionToken = token;
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}
function clearSessionToken(): void {
  sessionToken = '';
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
// 2026-08-25: 클래식 모드 — 아이템 없이 체급(순수 실력)으로만 하는 모드
let gameMode: 'items' | 'classic' = 'items';
// 2026-08-25: 초대 링크 — ?room=CODE 로 공유된 링크를 탭하면 해당 방으로 자동 입장
const inviteCode =
  new URLSearchParams(window.location.search).get('room')?.replace(/\D/g, '').slice(0, 4) ?? '';
let inviteConsumed = false;
let net: NetClient | null = null;
let netConnecting: Promise<NetClient | null> | null = null;
let joinInFlight = false;
// 2026-08-25: 자동 재연결 상태 — 끊김 시 카운트다운 UI가 활성인지.
// 활성 중 사용자가 cancel 누르면 즉시 로비로 보냄.
let reconnectUi: {
  overlay: HTMLDivElement;
  countdown: number;
  attempts: number;
  timer: number;
  cancelled: boolean;
} | null = null;

async function ensureNet(): Promise<NetClient | null> {
  if (net?.connected) return net;
  if (netConnecting) return netConnecting;
  netConnecting = (async () => {
    const client = new NetClient();
    const ok = await client.connect(wsUrlFromLocation(window.location));
    if (!ok) {
      net = null;
      return null;
    }
    net = client;
    // welcome의 임시 토큰은 저장하지 않는다. 방에 앉은 뒤(onSeated) 좌석 토큰만 영속화.
    // welcome을 저장하면 resume 전에 토큰이 바뀌어 join 폴백이 유령 좌석을 남긴다.
    client.onSeated = (token) => {
      saveSessionToken(token);
    };
    // 2026-08-25: 연결 끊김 시 —
    // 멀티플레이: 같은 방 코드로 자동 재연결 (resume → join 폴백).
    //           사용자가 cancel 누르면 즉시 로비. 마지막 시도도 실패 시 명시적 로비.
    // 솔로: 게임을 유지하고 다음 ensureNet 호출에서 재연결 (기존 동작).
    client.onDisconnect = () => {
      showNetToast('연결이 끊어졌어요');
      if (matchEntry === 'room') {
        if (profile.lastRoomCode) {
          void tryAutoReconnect(profile.lastRoomCode);
        } else {
          leaveToLobby();
        }
      } else {
        net = null;
      }
    };
    return client;
  })();
  try {
    return await netConnecting;
  } finally {
    netConnecting = null;
  }
}

// 2026-08-25: 멀티플레이 자동 재연결 — 끊긴 후 같은 code로 재join 시도.
// - 서버는 phase='lobby'일 때만 join 허용. 'playing'/'ended'면 서버가 err 응답.
// - 5회까지 exponential backoff (1s, 2s, 4s, 8s, 16s) 시도.
// - 시도 사이 카운트다운 UI 표시 (사용자 cancel 우선).
// - 5회 실패 후 명시적 로비 복귀 + 알림.
// - 재연결 성공 시 새 player id로 같은 룸의 lobby에 합류 (다음 라운드 대기 또는 다음 시작).
async function tryAutoReconnect(code: string): Promise<void> {
  // 기존 UI가 있으면 정리 (중복 호출 방지)
  if (reconnectUi) return;
  const overlay = document.createElement('div');
  overlay.className = 'reconnect-overlay';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'reconnect-eyebrow';
  eyebrow.textContent = '재연결 중';
  const msg = document.createElement('div');
  msg.className = 'reconnect-msg';
  const countdown = document.createElement('div');
  countdown.className = 'reconnect-countdown';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'button secondary';
  cancelBtn.textContent = '취소하고 로비로';
  overlay.append(eyebrow, msg, countdown, cancelBtn);
  document.body.appendChild(overlay);

  let cancelled = false;
  let currentTimer = 0;
  const ui = {
    overlay,
    countdown: 0,
    attempts: 0,
    timer: 0,
    cancelled: false,
  };
  reconnectUi = ui;

  const cleanup = (): void => {
    if (currentTimer) {
      window.clearInterval(currentTimer);
      currentTimer = 0;
    }
    overlay.remove();
    if (reconnectUi === ui) reconnectUi = null;
  };

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
    ui.cancelled = true;
    cleanup();
    leaveToLobby();
  });

  // 2026-08-25: 핵심 흐름은 lib/reconnect-flow의 reconnectFlow에 위임.
  // main.ts는 DOM/UI/상태 관리만 담당.
  // 2026-08-28: resume-first — 저장된 세션 토큰이 있으면 같은 좌석(방장/신원) 복원을
  // 먼저 시도하고, resumeDenied면 기존 join으로 폴백. 성공한 client는 net에 할당.
  let liveClient: NetClient | null = null;
  const tokenForResume = sessionToken;
  const outcome = await reconnectFlow(code, profile, {
    attempt: async (joinCode, p): Promise<AttemptResult> => {
      // 기존 net 참조 정리 (이미 끊긴 상태)
      if (net) {
        try {
          net.close();
        } catch {
          /* ignore */
        }
        net = null;
      }
      if (liveClient) {
        try {
          liveClient.close();
        } catch {
          /* ignore */
        }
        liveClient = null;
      }
      const client = new NetClient();
      const ok = await client.connect(wsUrlFromLocation(window.location));
      if (!ok) return { phase: 'failed' };
      client.onSeated = (token) => {
        saveSessionToken(token);
      };
      // 재연결 시 onDisconnect 발화 방지: 흐름이 관리
      client.onDisconnect = () => {
        /* reconnect 흐름이 관리 */
      };
      // hello + (resume | join) 응답 대기
      const phase = await new Promise<'lobby' | 'playing' | 'failed'>((resolve) => {
        let resolved = false;
        const finish = (r: 'lobby' | 'playing' | 'failed'): void => {
          if (resolved) return;
          resolved = true;
          resolve(r);
        };
        client.onRoom = (c) => {
          if (c.phase === 'lobby') finish('lobby');
          else finish('playing');
        };
        client.onError = () => finish('failed');
        client.onResumeDenied = () => {
          // 토큰 만료/좌석 소멸 — join에 같은 토큰을 실어 유령 좌석 회수
          try {
            client.join(joinCode, tokenForResume);
          } catch {
            finish('failed');
          }
        };
        window.setTimeout(() => finish('failed'), 4000);
        try {
          client.hello({
            name: p.nickname,
            char: p.characterId,
            wish: p.roleWish,
            map: p.mapId,
          });
          if (tokenForResume) client.resume(tokenForResume);
          else client.join(joinCode);
        } catch {
          finish('failed');
        }
      });
      if (phase !== 'lobby') {
        // 다음 시도 또는 abort 시 close
        return { phase, ws: { close: () => client.close() } };
      }
      // 성공 — 이 client를 net으로 승격 (중복 join 방지)
      liveClient = client;
      return { phase: 'lobby' };
    },
    closeAttempt: (ws) => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    shouldCancel: () => cancelled,
    onAttempt: (n, phase) => {
      ui.attempts = n;
      msg.textContent = `방 ${code} 재연결 시도 (${n}/${MAX_RECONNECT_ATTEMPTS})`;
      // playing이면 다음 시도까지 카운트다운 표시
      if (phase !== 'lobby') {
        const waitMs = waitBeforeNextAttempt(n);
        let remaining = Math.ceil(waitMs / 1000);
        countdown.textContent = `${remaining}초 후 재시도`;
        if (currentTimer) window.clearInterval(currentTimer);
        currentTimer = window.setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            if (currentTimer) {
              window.clearInterval(currentTimer);
              currentTimer = 0;
            }
            countdown.textContent = '';
          } else {
            countdown.textContent = `${remaining}초 후 재시도`;
          }
        }, 1000);
      } else {
        countdown.textContent = '';
        if (currentTimer) {
          window.clearInterval(currentTimer);
          currentTimer = 0;
        }
      }
    },
    onTerminal: (o, attempts) => {
      cleanup();
      if (o === 'ok') {
        // 2026-08-28: 성공한 client를 net에 승격 — 안전망의 중복 join을 막고
        // 같은 좌석(방장/신원)으로 room 화면 진입.
        if (liveClient) {
          net = liveClient;
          liveClient = null;
        }
        showNetToast(`재연결 성공 (${attempts}회 시도)`);
        roomJoined = true;
        setScreen('room');
      } else if (o === 'abort') {
        msg.textContent = `재연결 실패 (${MAX_RECONNECT_ATTEMPTS}회). 로비로 돌아갑니다.`;
        cancelBtn.textContent = '로비로';
        window.setTimeout(() => {
          leaveToLobby();
        }, 1500);
      }
      // cancelled는 cancelBtn 핸들러에서 이미 처리
    },
  });
  // 안전망 — 성공했는데 net 승격이 안 된 경우에만 재진입 (중복 join 방지)
  if (outcome === 'ok' && !net?.connected) {
    void ensureNet().then((c) => {
      if (c) {
        c.hello({
          name: profile.nickname,
          char: profile.characterId,
          wish: profile.roleWish,
          map: profile.mapId,
        });
        if (tokenForResume) c.resume(tokenForResume);
        else c.join(code);
      }
    });
  }
}

function netHello(): void {
  net?.hello({
    name: profile.nickname,
    char: profile.characterId,
    wish: profile.roleWish,
    map: profile.mapId,
  });
}
const ROOM_STORE_KEY = 'energy-trail-rooms-v1';

function readPublishedRooms(): RoomListing[] {
  try {
    const raw = localStorage.getItem(ROOM_STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return pruneRooms(parsed as RoomListing[], Date.now());
  } catch {
    return [];
  }
}

function writePublishedRooms(list: RoomListing[]): void {
  try {
    localStorage.setItem(ROOM_STORE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

function publishCurrentRoom(): void {
  if (!isCompleteRoomCode(roomCode)) return;
  writePublishedRooms(
    upsertRoom(readPublishedRooms(), {
      code: roomCode,
      host: profile.nickname,
      mapId: profile.mapId,
      createdAt: Date.now(),
    }),
  );
}
let soloAiCount = 3;
let matchRoster: Array<{ id: string; role: AssignedRole }> = [
  { id: 'self', role: 'runner' },
  { id: 'ai-0', role: 'tagger' },
];
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
  lookStick: null,
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
  if (next === 'game') void requestGameFullscreen(document.documentElement);
  if (shouldTeardownGame(screen, next)) {
    try {
      teardownGame();
    } catch (err) {
      console.error('[setScreen] teardownGame threw:', err);
    }
  }
  screen = next;
  try {
    render();
  } catch (err) {
    // Pass 8.3: render 실패 (WebGL/Three.js 초기화 에러) 시 게임 화면이
    // 반쪽짜리로 남는 문제 방지 — 로비로 강제 복귀
    console.error('[setScreen] render() threw:', err, err instanceof Error ? err.stack : '');
    if (next === 'game') {
      screen = 'lobby';
      try {
        render();
      } catch {
        /* lobby render also failed */
      }
    }
  }
}

function leaveToLobby(): void {
  // 2026-08-28: 명시적 로비 복귀 — 의도적 이탈이므로 좌석 보존 세션을 폐기
  if (sessionToken) clearSessionToken();
  net?.close();
  net = null;
  roomJoined = matchEntry !== 'room';
  setScreen('lobby');
}

function showNetToast(msg: string): void {
  const toast = document.createElement('div');
  toast.className = 'net-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function restartMatch(): void {
  if (matchEntry === 'room') roomJoined = true;
  setScreen(retryScreenForEntry(matchEntry));
}

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = `button ${className}`.trim();
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
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
    <h1 class="intro-title">자국 <span class="intro-version">${escapeHtml(APP_VERSION)}</span></h1>
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
  cta?.addEventListener('click', () => {
    void requestGameFullscreen(document.documentElement);
    setScreen('login');
  });
  root.append(content);
}

function renderLogin(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-login';
  content.innerHTML = `
    <div class="login-eyebrow">입장</div>
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
    setScreen('lobby');
  };
  nextBtn.addEventListener('click', onNext);
  root.append(content);
}

function renderCharacter(): void {
  // v32: 캐릭터 선택은 room 안으로 통합 — 호출되면 login으로 리다이렉트
  setScreen('login');
}

function renderRole(): void {
  setScreen('lobby');
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
    <p class="lobby-sub">방에 들어가면 대기실에서 술래를 정합니다.</p>
    ${
      inviteCode && !inviteConsumed
        ? `<button type="button" class="button primary lobby-invite">📨 초대 방 ${inviteCode} 참여하기</button>`
        : ''
    }
    <div class="lobby-summary">
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">닉네임</span>
        <strong class="lobby-summary-value">${escapeHtml(profile.nickname)}</strong>
      </div>
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">역할</span>
        <strong class="lobby-summary-value">대기실에서</strong>
      </div>
      <div class="lobby-summary-card">
        <span class="lobby-summary-label">모드</span>
        <strong class="lobby-summary-value">대기실</strong>
      </div>
    </div>
    <div class="lobby-modes">
      <button type="button" class="lobby-mode lobby-mode-solo">
        <div class="lobby-mode-icon">🎮</div>
        <div class="lobby-mode-info">
          <span class="lobby-mode-title">혼자 시작</span>
          <span class="lobby-mode-desc">대기실에서 AI와 1:1</span>
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
          <span class="lobby-mode-desc">4자리 코드를 입력해 참여</span>
        </div>
        <span class="lobby-mode-arrow">→</span>
      </button>
    </div>
    <div class="lobby-actions">
      <button type="button" class="button ghost lobby-back">← 닉네임 다시</button>
    </div>
  `;
  const soloBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-solo');
  const createBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-create');
  const findBtn = content.querySelector<HTMLButtonElement>('.lobby-mode-find');
  const backBtn = content.querySelector<HTMLButtonElement>('.lobby-back');
  soloBtn?.addEventListener('click', () => {
    matchEntry = 'solo';
    roomMode = 'create';
    roomJoined = true;
    roomCode = 'SOLO';
    setScreen('room');
  });
  // 2026-08-25: 초대 링크 입장 — 방 찾기 화면으로 넘긴 뒤 코드 자동 주입 (기존 검증/에러 UI 재사용)
  const inviteBtn = content.querySelector<HTMLButtonElement>('.lobby-invite');
  inviteBtn?.addEventListener('click', () => {
    inviteConsumed = true;
    matchEntry = 'room';
    roomMode = 'find';
    roomJoined = false;
    setScreen('room');
    const joinInput = root.querySelector<HTMLInputElement>('#room-join-code');
    if (joinInput) {
      joinInput.value = inviteCode;
      joinInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  createBtn?.addEventListener('click', () => {
    matchEntry = 'room';
    roomMode = 'create';
    roomJoined = true;
    roomCode = '';
    setScreen('room');
  });
  findBtn?.addEventListener('click', () => {
    matchEntry = 'room';
    roomMode = 'find';
    roomJoined = false;
    roomCode = '';
    setScreen('room');
  });
  backBtn?.addEventListener('click', () => setScreen('login'));
  root.append(content);
}

function renderRoom(): void {
  const content = document.createElement('section');
  content.className = 'screen screen-room';
  const isCreate = roomMode === 'create';
  const isSolo = matchEntry === 'solo';
  const needsJoin = roomMode === 'find' && !roomJoined;
  const mapEntries = Object.entries(MAPS);
  const displayCode = isSolo ? 'SOLO' : roomJoined ? roomCode : '';
  content.innerHTML = `
    <div class="room-eyebrow">대기실 · <span class="muted">${escapeHtml(profile.nickname)}님</span></div>
    <h1 class="room-title">${needsJoin ? '방 찾기' : '대기실'}</h1>
    <p class="room-sub">${
      needsJoin
        ? '친구가 만든 4자리 코드를 입력하면 대기실로 들어갑니다.'
        : '술래를 희망하거나 랜덤으로 맡길 수 있어요. 방장이 시작하면 역할이 정해집니다.'
    }</p>
    <div class="room-hero">
      <div class="room-code-block">
        <span class="room-code-label">ROOM CODE</span>
        ${
          needsJoin
            ? `<div class="room-code-pin">
          <input
            id="room-join-code"
            class="room-code-entry"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="4"
            autocomplete="one-time-code"
            enterkeyhint="go"
            aria-label="방 코드 4자리"
            placeholder="0000"
          />
        </div>
        <div class="room-keypad" id="room-keypad">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'OK']
            .map((k) => `<button type="button" class="room-key" data-key="${k}">${k}</button>`)
            .join('')}
        </div>
        <p class="room-join-error" id="room-join-error" hidden>4자리 숫자를 입력해 주세요</p>
        <button type="button" class="button primary room-join" id="room-join">입장</button>
        <span class="room-code-status">방 코드 4자리를 치고 입장</span>`
            : `<div class="room-code-digits">
          ${(displayCode || '----')
            .split('')
            .map((c) => `<span class="room-code-digit">${c}</span>`)
            .join('')}
        </div>
        ${
          !isSolo
            ? `<button type="button" class="button ghost room-copy" id="room-copy">초대 링크 복사</button>`
            : ''
        }
        <span class="room-code-status">${isSolo ? 'AI 대기' : '실시간 대기'}</span>`
        }
      </div>
    </div>
    ${
      needsJoin
        ? ''
        : `<div class="waiting-wish-section">
      <div class="room-character-section-label">이번 판 희망</div>
      <div class="waiting-wish" id="waiting-wish">
        <button type="button" class="waiting-wish-btn" data-wish="tagger">술래 할래요</button>
        <button type="button" class="waiting-wish-btn" data-wish="random">랜덤</button>
        <button type="button" class="waiting-wish-btn" data-wish="runner">도망자 할래요</button>
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
    <div class="room-mode-section">
      <div class="room-map-section-label">게임 모드</div>
      <div class="waiting-wish" id="waiting-mode">
        <button type="button" class="waiting-wish-btn" data-gmode="items">아이템 배틀</button>
        <button type="button" class="waiting-wish-btn" data-gmode="classic">클래식 · 체급 대결</button>
      </div>
    </div>
    ${
      isSolo
        ? `<div class="waiting-ai-section">
      <div class="room-character-section-label">AI 인원</div>
      <div class="waiting-ai-count">
        <button type="button" class="waiting-ai-btn" id="ai-minus" aria-label="AI 줄이기">−</button>
        <strong id="ai-count-label">${soloAiCount}명</strong>
        <button type="button" class="waiting-ai-btn" id="ai-plus" aria-label="AI 늘리기">+</button>
      </div>
    </div>`
        : ''
    }
    <div class="room-players" id="room-players"></div>`
    }
    <div class="room-actions">
      ${needsJoin ? '' : `<button type="button" class="button primary room-start enabled">게임 시작</button>`}
      <button type="button" class="button ghost room-back">← 로비로</button>
    </div>
    <div class="role-reveal" id="role-reveal" hidden>
      <div class="role-reveal-card">
        <div class="role-reveal-eyebrow">이번 판 당신은</div>
        <div class="role-reveal-role" id="role-reveal-role">도망자</div>
        <p class="role-reveal-sub">곧 시작합니다</p>
      </div>
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
        const selfDot = content.querySelector<HTMLElement>('#room-self-dot');
        if (selfDot) selfDot.style.background = character.color;
        net?.setChar(character.id);
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
        if (!isSolo && isCreate) {
          publishCurrentRoom();
          net?.setMap(id);
        }
      });
      mapGrid.append(card);
    }
  }
  // 2026-08-25: 인라인 게임 모드 선택 — 아이템 배틀 / 클래식(체급 대결)
  const modeRow = content.querySelector<HTMLElement>('#waiting-mode');
  if (modeRow) {
    const paintGameMode = (): void => {
      modeRow.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.classList.toggle('selected', (b.dataset.gmode ?? 'items') === gameMode);
      });
    };
    paintGameMode();
    modeRow.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        gameMode = btn.dataset.gmode === 'classic' ? 'classic' : 'items';
        paintGameMode();
        if (!isSolo && isCreate) {
          publishCurrentRoom();
          net?.setMode(gameMode);
        }
      });
    });
  }
  const wishRow = content.querySelector<HTMLElement>('#waiting-wish');
  const applyWish = (wish: RoleWish): void => {
    profile.roleWish = wish;
    wishRow?.querySelectorAll('.waiting-wish-btn').forEach((btn) => {
      btn.classList.toggle('selected', (btn as HTMLElement).dataset.wish === wish);
    });
    const selfWishEl = content.querySelector<HTMLElement>('#room-self-wish');
    if (selfWishEl) selfWishEl.textContent = WISH_LABEL[wish];
    net?.setWish(wish);
  };
  wishRow?.querySelectorAll<HTMLButtonElement>('.waiting-wish-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wish = btn.dataset.wish as RoleWish | undefined;
      if (wish) applyWish(wish);
    });
  });
  const playersEl = content.querySelector<HTMLElement>('#room-players');
  const aiCountLabel = content.querySelector<HTMLElement>('#ai-count-label');
  const paintDigits = (code: string): void => {
    const cells = content.querySelectorAll('.room-code-digit');
    const chars = (code || '----').split('');
    cells.forEach((el, i) => {
      el.textContent = chars[i] ?? '';
    });
  };
  const paintSeats = (): void => {
    if (!playersEl) return;
    if (!isSolo && net && net.players.length > 0) {
      playersEl.innerHTML = net.players
        .map((p) => {
          const color = characters.find((c) => c.id === p.char)?.color ?? '#4dd0e1';
          const wish = WISH_LABEL[(p.wish as RoleWish) || 'random'] ?? p.wish;
          const you = p.id === net?.id ? ' (나)' : '';
          const host = p.host ? ' · 방장' : '';
          return `<div class="room-player ${p.id === net?.id ? 'room-player-self' : ''}">
        <span class="room-player-dot" style="background:${color}"></span>
        <span class="room-player-name">${escapeHtml(p.name)}${you}${host}</span>
        <span class="room-player-wish">${wish}</span>
      </div>`;
        })
        .join('');
      return;
    }
    const n = isSolo ? soloAiCount : 1;
    const selfColor = characters.find((c) => c.id === profile.characterId)?.color ?? '#00e5ff';
    const ais = Array.from({ length: n }, (_, i) => i);
    playersEl.innerHTML = `
      <div class="room-player room-player-self">
        <span class="room-player-dot" id="room-self-dot" style="background:${selfColor}"></span>
        <span class="room-player-name">${escapeHtml(profile.nickname)}</span>
        <span class="room-player-wish" id="room-self-wish">${WISH_LABEL[profile.roleWish]}</span>
      </div>
      ${ais
        .map(
          (i) => `<div class="room-player">
        <span class="room-player-dot" style="background:${characters[i % characters.length].color}"></span>
        <span class="room-player-name">AI ${i + 1}</span>
        <span class="room-player-wish">랜덤</span>
      </div>`,
        )
        .join('')}
    `;
  };
  paintSeats();
  applyWish(profile.roleWish);
  const setAiCount = (n: number): void => {
    soloAiCount = clampSoloAiCount(n);
    if (aiCountLabel) aiCountLabel.textContent = `${soloAiCount}명`;
    paintSeats();
    applyWish(profile.roleWish);
  };
  content.querySelector('#ai-minus')?.addEventListener('click', () => setAiCount(soloAiCount - 1));
  content.querySelector('#ai-plus')?.addEventListener('click', () => setAiCount(soloAiCount + 1));
  const startBtn = content.querySelector<HTMLButtonElement>('.room-start');
  const backBtn = content.querySelector<HTMLButtonElement>('.room-back');
  const reveal = content.querySelector<HTMLElement>('#role-reveal');
  const revealRole = content.querySelector<HTMLElement>('#role-reveal-role');
  const beginMatch = (): void => {
    if (revealRole) {
      revealRole.textContent = profile.role === 'tagger' ? '술래' : '도망자';
      revealRole.classList.toggle('tagger', profile.role === 'tagger');
    }
    if (reveal) {
      reveal.hidden = false;
      reveal.classList.add('show');
    }
    window.setTimeout(() => setScreen('game'), 1400);
  };
  startBtn?.addEventListener('click', () => {
    if (!isSolo && net?.connected) {
      // 방 만든 사람은 클라 isHost가 어긋여도 start를 보낸다. 서버가 방장만 통과시킨다.
      if (!net.isHost && !isCreate) return;
      net.start();
      return;
    }
    const seats = buildSoloSeats(isSolo ? soloAiCount : 1, profile.roleWish);
    const roles = assignRoles(seats);
    matchRoster = seats.map((s) => ({ id: s.id, role: roles[s.id] }));
    profile.role = roles.self;
    beginMatch();
  });
  if (!isSolo && startBtn) {
    startBtn.textContent = '게임 시작';
  }
  const joinInput = content.querySelector<HTMLInputElement>('#room-join-code');
  const joinBtn = content.querySelector<HTMLButtonElement>('#room-join');
  const joinError = content.querySelector<HTMLElement>('#room-join-error');
  const paintJoinValue = (raw: string): void => {
    if (!joinInput) return;
    joinInput.value = normalizeRoomCode(raw);
    if (joinError) joinError.hidden = true;
    joinInput.classList.remove('invalid');
  };
  const tryJoin = (): void => {
    const entered = canEnterWithCode(joinInput?.value ?? '');
    if (!entered.ok) {
      if (joinError) {
        joinError.hidden = false;
        joinError.textContent = '4자리 숫자를 입력해 주세요';
      }
      joinInput?.classList.add('invalid');
      joinInput?.focus();
      return;
    }
    if (joinInFlight || net?.code === entered.code) return;
    void (async () => {
      joinInFlight = true;
      const client = await ensureNet();
      if (!client) {
        if (joinError) {
          joinError.hidden = false;
          joinError.textContent = '서버에 연결하지 못했어요';
        }
        return;
      }
      netHello();
      client.onError = (msg) => {
        if (joinError) {
          joinError.hidden = false;
          joinError.textContent = msg;
        }
        joinInput?.classList.add('invalid');
      };
      client.onRoom = () => {
        roomCode = client.code;
        profile.lastRoomCode = client.code; // 2026-08-25: 재연결용 보존
        roomJoined = true;
        profile.mapId = client.map as MapId;
        gameMode = client.mode === 'classic' ? 'classic' : 'items';
        setScreen('room');
      };
      client.join(entered.code, sessionToken);
    })().finally(() => {
      joinInFlight = false;
    });
  };
  joinInput?.addEventListener('input', () => {
    paintJoinValue(joinInput.value);
    if (isCompleteRoomCode(joinInput.value)) tryJoin();
  });
  joinInput?.addEventListener('keyup', () => paintJoinValue(joinInput.value));
  joinInput?.addEventListener('change', () => paintJoinValue(joinInput.value));
  joinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryJoin();
    }
  });
  content.querySelectorAll<HTMLButtonElement>('.room-key').forEach((keyBtn) => {
    keyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!joinInput) return;
      const k = keyBtn.dataset.key ?? '';
      if (k === '←') paintJoinValue(joinInput.value.slice(0, -1));
      else if (k === 'OK') tryJoin();
      else {
        paintJoinValue(joinInput.value + k);
        if (isCompleteRoomCode(joinInput.value)) tryJoin();
      }
    });
  });
  joinBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    tryJoin();
  });
  const copyBtn = content.querySelector<HTMLButtonElement>('#room-copy');
  copyBtn?.addEventListener('click', async () => {
    try {
      // 2026-08-25: 코드만이 아니라 초대 링크 전체를 복사 — 받은 사람은 탭 한 번으로 입장
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}?room=${roomCode}`,
      );
      copyBtn.textContent = '초대 링크 복사됨 ✓';
    } catch {
      copyBtn.textContent = roomCode;
    }
    setTimeout(() => {
      copyBtn.textContent = '초대 링크 복사';
    }, 1600);
  });
  backBtn?.addEventListener('click', () => {
    net?.close();
    net = null;
    setScreen('lobby');
  });
  root.append(content);
  joinInput?.focus();
  if (!isSolo && !needsJoin) {
    void (async () => {
      const client = await ensureNet();
      if (!client) {
        const status = content.querySelector('.room-code-status');
        if (status) {
          // 2026-08-25: 에러에 원인/조치 포함 — ws 서버 미실행 등
          status.textContent = '서버 연결 실패 · ws 서버를 켜세요: PORT=8791 node server/index.mjs';
        }
        console.error(
          '[room] ws 연결 실패. 로컬이면 PORT=8791 node server/index.mjs 실행, 운영이면 Mac mini docker compose up -d ws 후 VITE_WS_URL 설정 필요.',
        );
        return;
      }
      netHello();
      client.onRoom = () => {
        roomCode = client.code;
        profile.lastRoomCode = client.code; // 2026-08-25: 재연결용 보존
        paintDigits(client.code);
        paintSeats();
        if (startBtn) {
          const canStart = client.isHost || isCreate;
          startBtn.textContent = canStart ? '게임 시작' : '방장 대기 중';
          startBtn.disabled = !canStart;
        }
      };
      client.onStart = () => {
        const myRole = client.roles[client.id];
        if (myRole) profile.role = myRole;
        profile.mapId = client.map as MapId;
        gameMode = client.mode === 'classic' ? 'classic' : 'items';
        matchRoster = client.players.map((p) => ({
          id: p.id === client.id ? 'self' : p.id,
          role: (client.roles[p.id] ?? 'runner') as AssignedRole,
        }));
        if (client.players.length < 2) {
          if (profile.role === 'tagger') {
            matchRoster.push(
              { id: 'ai-0', role: 'runner' },
              { id: 'ai-1', role: 'runner' },
              { id: 'ai-2', role: 'runner' },
            );
          } else {
            matchRoster.push({ id: 'ai-0', role: 'tagger' }, { id: 'ai-1', role: 'runner' });
          }
        }
        beginMatch();
      };
      if (isCreate && !client.code) client.create(profile.mapId);
      else if (roomCode && !client.code) client.join(roomCode, sessionToken);
      if (client.code) {
        paintDigits(client.code);
        paintSeats();
        if (startBtn) {
          const canStart = client.isHost || isCreate;
          startBtn.textContent = canStart ? '게임 시작' : '방장 대기 중';
          startBtn.disabled = !canStart;
        }
      }
    })();
  }
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
  // 카메라: 데스크탑은 마우스 드래그, 모바일은 두손 스틱
  // - 왼손 고정 조이스틱 = 이동 (카메라 기준)
  // - 오른손 시점 스틱 = 회전 속도 (드래그 픽셀이 아님 → 휙 안 돎)
  // - 모바일은 orbit 고정. chase + 카메라상대 이동 = 스핀
  // ============================================================
  const camState = {
    yaw: 0, // 실제 적용값 (lerp으로 target에서 따라옴)
    yawTarget: 0, // 2026-08-15: 마우스 드래그 목표값 — smoothing의 대상
    pitch: 0.3,
    pitchTarget: 0.3, // 마찬가지
    distance: 7.0,
    dragPointerId: null as number | null,
    lookSlow: false,
    lastX: 0,
    lastY: 0,
    // 2026-08-15 v3: 카메라 모드 — 'chase'(자동 등 뒤) | 'orbit'(자유 회전)
    mode: 'chase' as 'chase' | 'orbit',
    // chase 모드 자동 yaw (캐릭터 진행 방향 따라 회전)
    autoYaw: 0,
  };
  const CAM_LIMITS = {
    // 2026-08-15 v2: 0.005/0.004 → 0.0028/0.0023 — 드래그 감도 ↓ (확확 넘어감 방지)
    // 2026-08-26: 0.0028 → 0.005 — 시야 회전 더 빠르게 (갑갑함 개선)
    // + smoothing (CAM_ROT_SMOOTHING) 동시 적용
    yawSpeed: 0.005,
    pitchSpeed: 0.0023,
    pitchMin: -0.35,
    pitchMax: 0.85,
    distanceMin: 3.0,
    distanceMax: 16.0,
    distanceStep: 0.7,
  };
  // 2026-08-15 v2: 카메라 회전 smoothing — target → actual lerp factor
  // (작을수록 부드럽게 따라옴, 클수록 즉각 반응)
  // 2026-08-26: 0.18 → 0.25 — 사용자가 "더 정확하고 빨리" 요청, 부드러움 유지하면서 반응 ~4 프레임
  const CAM_ROT_SMOOTHING = 0.25;

  // 술래 그물망: 날아가며 벌어지고, 사거리 끝에서 바닥에 잠깐 남음
  const shotState = {
    active: false,
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    traveled: 0,
    originY: 0.8,
    mesh: null as THREE.Group | null,
    cooldownLeft: 0,
    zone: null as {
      mesh: THREE.Group;
      x: number;
      z: number;
      radius: number;
      timeLeft: number;
    } | null,
  };

  function disposeNetObject(obj: THREE.Object3D | null): void {
    if (!obj) return;
    ctx.scene.remove(obj);
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const mat = child.material;
        if (Array.isArray(mat)) {
          for (const m of mat) m.dispose();
        } else if (mat) {
          mat.dispose();
        }
      }
    });
  }

  function createNetVisual(radius: number, grounded: boolean): THREE.Group {
    const group = new THREE.Group();
    const color = GAME.shotColor;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, grounded ? 0.06 : 0.08, 8, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    ring.rotation.x = Math.PI / 2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: grounded ? 0.34 : 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.04, 6, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    );
    inner.rotation.x = Math.PI / 2;
    group.add(disc);
    group.add(ring);
    group.add(inner);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Math.cos(a), 0.02, Math.sin(a)),
        new THREE.Vector3(-Math.cos(a), 0.02, -Math.sin(a)),
      ]);
      group.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
        ),
      );
    }
    group.scale.setScalar(radius);
    return group;
  }

  function currentNetRadius(): number {
    return netCatchRadius(
      shotState.traveled,
      GAME.shotRange,
      GAME.shotRadius,
      GAME.shotNetRadiusMax,
    );
  }

  function markBotCaught(bot: {
    role: AssignedRole;
    out: boolean;
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
  }): void {
    if (bot.out || bot.role !== 'runner') return;
    bot.out = true;
    bot.material.transparent = true;
    bot.material.opacity = 0.3;
    bot.mesh.scale.set(0.6, 0.4, 0.6);
    roundStats.outCount += 1;
    triggerShake(0.55);
    sound.playOut();
    if (dust) dust.burst(bot.mesh.position, 20, 1.0, 2.0, 2.5, 0.6);
    const alive =
      (!isTagger && !game.out ? 1 : 0) + bots.filter((b) => b.role === 'runner' && !b.out).length;
    if (alive === 0) showResult('tagger', '도망자를 모두 잡았습니다');
  }

  function tryNetCatchAt(x: number, z: number, radius: number): boolean {
    const catchR = radius + PLAYER.radius;
    let caught = false;
    for (const bot of bots) {
      if (bot.out || bot.role !== 'runner') continue;
      if (withinDistance(x, z, bot.mesh.position.x, bot.mesh.position.z, catchR)) {
        markBotCaught(bot);
        caught = true;
      }
    }
    return caught;
  }

  function dropNetZone(x: number, z: number, radius: number): void {
    disposeShot();
    const mesh = createNetVisual(radius, true);
    mesh.position.set(x, 0.08, z);
    ctx.scene.add(mesh);
    shotState.zone = { mesh, x, z, radius, timeLeft: GAME.shotNetZoneSeconds };
  }

  function disposeShot(): void {
    disposeNetObject(shotState.mesh);
    shotState.mesh = null;
    shotState.active = false;
  }

  function disposeNetZone(): void {
    if (!shotState.zone) return;
    disposeNetObject(shotState.zone.mesh);
    shotState.zone = null;
  }

  function shotCanFire(): boolean {
    return !shotState.active && !shotState.zone && shotState.cooldownLeft <= 0;
  }

  function shotCharge01(): number {
    if (shotState.cooldownLeft > 0) {
      return Math.max(0, Math.min(1, 1 - shotState.cooldownLeft / GAME.shotCooldown));
    }
    if (shotState.active || shotState.zone) return 0;
    return 1;
  }

  function fireShot(): void {
    if (!shotCanFire()) return;
    shotOriginTmp.copy(selfMesh.position);
    shotState.originY = selfMesh.position.y + PLAYER.height * 0.45;
    shotOriginTmp.y = shotState.originY;
    shotState.position.copy(shotOriginTmp);
    shotState.direction.copy(getAimDirection());
    shotState.traveled = 0;
    const mesh = createNetVisual(GAME.shotRadius, false);
    mesh.position.copy(shotState.position);
    ctx.scene.add(mesh);
    shotState.mesh = mesh;
    shotState.active = true;
    shotState.cooldownLeft = GAME.shotCooldown;
    if (sound) sound.playBoost();
  }

  const shotOriginTmp = new THREE.Vector3();
  game.disposers.push(() => {
    disposeShot();
    disposeNetZone();
  });

  // 2026-08-28: 게임 중 화면이 통째로 드래그되는 현상 차단
  // - 텍스트 롱프레스 선택/콜아웃이 캔버스 위 제스처로 이어지지 않게
  // - 안전빨: 더블탭 줌도 차단
  const blockGestures = (e: Event): void => e.preventDefault();
  addTrackedListener(canvasHost, 'selectstart', blockGestures);
  addTrackedListener(document, 'gesturestart', blockGestures);

  // 우클릭 컨텍스트 메뉴 차단 (드래그용)
  addTrackedListener(canvasHost, 'contextmenu', (e: Event) => (e as MouseEvent).preventDefault());

  // 2026-08-15 v3: V 키 = 카메라 모드 토글 (chase ↔ orbit)
  // - chase: 캐릭터 진행 방향 자동 추적 (도망자 추천 — 어디로 가든 카메라가 따라옴)
  // - orbit: 사용자 자유 회전 (술래 추천 — 정밀한 시점)
  const cameraModeHandler = (e: KeyboardEvent): void => {
    if (e.repeat || e.code !== 'KeyV') return;
    if (isMobileLike()) return;
    camState.mode = camState.mode === 'chase' ? 'orbit' : 'chase';
    // 토글 시 yaw 동기화
    if (camState.mode === 'chase') {
      // 캐릭터 진행 방향으로 즉시 맞춤
      const dx = selfMesh.position.x - prevPos.x;
      const dz = selfMesh.position.z - prevPos.z;
      const yaw = chaseYawFromMovement(dx, dz, 0.01);
      if (yaw !== null) camState.yawTarget = yaw;
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
    const isMouse = pe.pointerType === 'mouse' && (pe.button === 0 || pe.button === 2);
    if (isMouse) {
      camState.dragPointerId = pe.pointerId;
      camState.lastX = pe.clientX;
      camState.lastY = pe.clientY;
      camState.lookSlow = false;
      camState.mode = 'orbit';
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
    const lookK = camState.lookSlow ? 0.34 : 1;
    camState.yawTarget -= dx * CAM_LIMITS.yawSpeed * lookK;
    if (camState.yawTarget > Math.PI) camState.yawTarget -= 2 * Math.PI;
    else if (camState.yawTarget < -Math.PI) camState.yawTarget += 2 * Math.PI;
    camState.pitchTarget = Math.max(
      CAM_LIMITS.pitchMin,
      Math.min(CAM_LIMITS.pitchMax, camState.pitchTarget + dy * CAM_LIMITS.pitchSpeed * lookK),
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
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('.result-overlay') ||
      target.closest('.out-overlay') ||
      target.closest('.pause-overlay')
    )
      return;
    try {
      canvasHost.focus({ preventScroll: true });
    } catch {
      canvasHost.focus();
    }
  });
  // v6: mousedown 시 버튼이 focus를 받지 않게 방지 (pointerdown 보완)
  addTrackedListener(wrap, 'mousedown', (e: Event) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('.result-overlay') ||
      target.closest('.out-overlay') ||
      target.closest('.pause-overlay')
    )
      return;
    if (target.closest('button')) {
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
  if (mobileMode) {
    wrap.classList.add('touch-ui');
    camState.mode = 'orbit';
  }
  const camHint = mobileMode
    ? '왼손 스틱: 이동 · 오른손: 시점'
    : 'WASD 이동 · 마우스 드래그: 카메라 · 휠: 줌';
  debug.innerHTML = `
    <div class="game-debug-title">PHASE B · 단일 플레이어 (${roleLabel})</div>
    <div class="game-debug-row muted">WASD 이동 · 1/2/3 속도 · Shift 대시</div>
    <div class="game-debug-row">상대: AI (${profile.role === 'tagger' ? '도망자' : '술래'})</div>
    <div class="game-debug-row">자국: ${GAME.trailLifetime}초 후 소멸, 최대 ${GAME.trailMaxCount}개</div>
    <div class="game-debug-row muted">${camHint}</div>
    <div class="game-debug-row muted">${
      profile.role === 'tagger'
        ? 'Space/B 부스터 · F 홀딩: 조준 → 떼면 그물 · 클릭: 즉시 그물 · V: 카메라 모드'
        : 'F 얼림 · V: 카메라 모드 · (자국: 가까이 가면 자동 흡수)'
    }</div>
    <div class="game-debug-row muted game-debug-mode">카메라: ${
      camState.mode === 'chase' ? '추적' : '자유'
    }${mobileMode ? '' : ' (V)'}</div>
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
    <div class="round-score" id="round-score">0 / ${GAME.trailGoal}</div>
    <div class="round-timer" id="round-timer">1:15</div>
    <div class="status-hud-row"><span>자국</span><strong id="status-trails">0</strong></div>
    <div class="status-hud-row muted" id="status-debug">대기 중</div>
  `;
  wrap.appendChild(statusHud);
  game.statusHud = statusHud;
  game.statusTimer = statusHud.querySelector<HTMLElement>('#status-trails') ?? null;
  game.speedStatus = statusHud.querySelector<HTMLElement>('#status-speed') ?? null;
  const roundTimerEl = statusHud.querySelector<HTMLElement>('#round-timer');
  const roundScoreEl = statusHud.querySelector<HTMLElement>('#round-score');
  const debugStatus = statusHud.querySelector<HTMLElement>('#status-debug');
  // 2026-08-25: HUD 갱신 스로틀 — 값이 바뀐 프레임에만 DOM 기록 (매 프레임 textContent/classList 재계산 방지)
  let lastTimerText = '';
  let lastTimerState = '';
  let lastTrailCount = -1;
  let lastDebugStatus = '';

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
                ? 'Space/B 부스터 · F 그물 · Shift 대시 · V 카메라'
                : 'F 얼림 · Shift 대시 · V 카메라 · (자국: 가까이 가면 자동 흡수)'
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
    restartMatch();
  });
  pauseLobbyBtn?.addEventListener('click', () => {
    hidePauseMenu();
    leaveToLobby();
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

  // 2026-08-25: 탭 전환/백그라운드 시 자동 일시정지
  // - 복귀 직후 남은 시간이 배경 구간만큼 증발하거나 카운트다운이 건너뛰는 왜곡 방지
  // - RAF가 멈춘 동안은 루프 내 paused 감지가 동작하지 않으므로 숨김 시점에 countdownPausedAt을 직접 고정
  // - roundState/countdownPausedAt은 아래쪽에서 선언되지만 콜백은 이벤트 시점에 실행되므로 안전
  addTrackedListener(document, 'visibilitychange', () => {
    if (!document.hidden) return;
    if (roundState !== 'playing' && roundState !== 'countdown') return;
    if (countdownPausedAt === null) countdownPausedAt = performance.now();
    showPauseMenu();
  });

  // Backquote (`) 키 = 디버그 HUD 토글
  const debugToggleHandler = (e: KeyboardEvent): void => {
    if (e.code !== 'Backquote') return;
    debug.style.display = debug.style.display === 'none' ? 'block' : 'none';
  };
  addTrackedListener(canvasHost, 'keydown', debugToggleHandler);

  // 2026-08-15 v4 → 2026-08-25: 액션 프롬프트 (화면 중앙 하단) — 맥락별 안내
  // - 자국 흡수는 자동 (프롬프트 불필요, absorb HUD 가 진행률 표시)
  // - 얼림 사거리 내: F 얼림 (도망자)
  // - 그물 사거리 내: F 그물 (술래)
  // - 부스터 준비: Space (술래)
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

  // 2026-08-15 v4: 설정 버튼 (우상단) — 일시정지 메뉴 진입
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'icon-btn settings-btn';
  settingsBtn.setAttribute('aria-label', '설정');
  settingsBtn.innerHTML = '⚙';
  settingsBtn.addEventListener('click', () => showPauseMenu());
  wrap.appendChild(settingsBtn);
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'icon-btn fs-btn';
  fsBtn.setAttribute('aria-label', '전체화면');
  fsBtn.textContent = '⛶';
  fsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void requestGameFullscreen(document.documentElement);
  });
  wrap.appendChild(fsBtn);

  // 뒤로가기 버튼 (우상단) — 숨김 (일시정지 메뉴가 생겼으므로)
  const back = button('← 로비', () => leaveToLobby(), 'ghost game-back');
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
  let lastViewportW = 0;
  let lastViewportH = 0;
  const syncVisualViewport = (): void => {
    const vv = window.visualViewport;
    if (vv) {
      if (Math.abs(vv.width - lastViewportW) < 2 && Math.abs(vv.height - lastViewportH) < 2) {
        return;
      }
      lastViewportW = vv.width;
      lastViewportH = vv.height;
      wrap.style.top = `${vv.offsetTop}px`;
      wrap.style.left = `${vv.offsetLeft}px`;
      wrap.style.width = `${vv.width}px`;
      wrap.style.height = `${vv.height}px`;
    }
    ctx.onResize();
  };
  addTrackedListener(window, 'resize', syncVisualViewport);
  if (window.visualViewport) {
    addTrackedListener(window.visualViewport, 'resize', syncVisualViewport);
    addTrackedListener(window.visualViewport, 'scroll', syncVisualViewport);
  }
  syncVisualViewport();
  const mapRefs = buildMap(ctx.scene, mapDef);
  const exitDisc = buildExitPoint(ctx.scene);
  game.mapRefs = mapRefs;
  game.exitDisc = exitDisc;
  // 출구 위치 (XZ 평면, Y 무시)
  const exitPos = new THREE.Vector3(exitDisc.position.x, 0, exitDisc.position.z);

  const mapHalfW = MAP.width / 2 - MAP.wallThickness;

  // 2026-08-15 v4: 미니맵 (상단 우측) — best practice: 공간 인지를 위한 보조 UI
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.width = 140;
  minimapCanvas.height = 140;
  minimapCanvas.className = 'minimap-canvas';
  wrap.appendChild(minimapCanvas);
  const minimapCtx = minimapCanvas.getContext('2d')!;
  const minimapScale = (minimapCanvas.width - 16) / MAP.width;
  type BotAgent = {
    id: string;
    role: AssignedRole;
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    taggerAI: TaggerAI | null;
    runnerAI: RunnerAIStub | null;
    out: boolean;
    absorbHold: number;
    kind: 'ai' | 'remote';
  };
  const bots: BotAgent[] = [];
  // 2026-08-25: 봇 GPU 자원 정리 — 매치 재시작마다 CapsuleGeometry/Material이
  // 새로 생성되어 누적되므로 teardownGame에서 명시 dispose. 봇 정의를
  // game.disposers에 등록해 일괄 해제 흐름에 합류.
  game.disposers.push(() => {
    for (const b of bots) {
      // geometry는 메시와 함께 만들어졌으므로 해제
      b.mesh.geometry?.dispose();
      // 머티리얼은 단일 또는 배열 가능
      const m = b.mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m?.dispose();
      // AI 인스턴스도 명시적으로 끊어주기 (있을 때만)
      b.taggerAI = null;
      b.runnerAI = null;
    }
  });

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
    // 좌표 변환 (월드 → 미니맵, Y는 위가 +) — 호출마다 클로저 생성 대신 인라인 계산
    // 장애물 (회색 박스)
    minimapCtx.fillStyle = 'rgba(120, 100, 140, 0.6)';
    for (const o of mapRefs.obstaclesData) {
      minimapCtx.fillRect(
        w / 2 + (o.x - o.width / 2) * minimapScale,
        h / 2 + (o.z - o.depth / 2) * minimapScale,
        o.width * minimapScale,
        o.depth * minimapScale,
      );
    }
    // 출구 (노란 원)
    minimapCtx.fillStyle = '#ffd97a';
    minimapCtx.beginPath();
    minimapCtx.arc(
      w / 2 + exitPos.x * minimapScale,
      h / 2 + exitPos.z * minimapScale,
      4,
      0,
      Math.PI * 2,
    );
    minimapCtx.fill();
    for (const bot of bots) {
      if (bot.out) continue;
      minimapCtx.fillStyle = bot.role === 'tagger' ? '#ff3a5c' : '#00e5ff';
      minimapCtx.beginPath();
      minimapCtx.arc(
        w / 2 + bot.mesh.position.x * minimapScale,
        h / 2 + bot.mesh.position.z * minimapScale,
        3.5,
        0,
        Math.PI * 2,
      );
      minimapCtx.fill();
    }
    // 자기 (큰 점 + 외곽선, 색은 자기/상대 역할에 따라)
    const selfColor = isTagger ? '#ff3a5c' : '#00e5ff';
    minimapCtx.fillStyle = selfColor;
    minimapCtx.strokeStyle = '#fff';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.arc(
      w / 2 + selfMesh.position.x * minimapScale,
      h / 2 + selfMesh.position.z * minimapScale,
      4.5,
      0,
      Math.PI * 2,
    );
    minimapCtx.fill();
    minimapCtx.stroke();
  }

  // ============================================================
  // 2026-08-15: 라운드 상태머신 + 타이머 + 결과 화면
  // ============================================================
  type RoundState = 'countdown' | 'playing' | 'ended';
  let roundState: RoundState = 'countdown';
  let roundTime: number = GAME.roundSeconds; // 남은 시간 (초)
  const roundStats = { absorbed: 0, outCount: 0, iceUsed: 0, boostUsed: 0, startedAt: 0 };
  const paintTrailScore = (): void => {
    if (roundScoreEl) roundScoreEl.textContent = `${roundStats.absorbed} / ${GAME.trailGoal}`;
    if (game.statusTimer) game.statusTimer.textContent = String(roundStats.absorbed);
  };
  const checkTrailWin = (): boolean => {
    if (roundState === 'ended') return true;
    const judged = judgeTrailRound({
      trailScore: roundStats.absorbed,
      trailGoal: GAME.trailGoal,
      timeLeft: roundTime,
      playerCaught: false,
      allRunnersOut: false,
    });
    if (!judged) return false;
    showResult(judged.winner, judged.reason);
    return true;
  };
  // 2026-08-25: 멀티 점수 배치 — 서버 레이트 리밋(250ms) 대응, 렌더 루프에서 300ms 간격 플러시
  let pendingNetScore = 0;
  let lastScoreSentAt = 0;
  const addTrailScore = (n = 1): void => {
    if (matchEntry === 'room' && net?.connected) {
      pendingNetScore += n;
      return;
    }
    roundStats.absorbed += n;
    paintTrailScore();
    checkTrailWin();
  };

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
    resultRetryBtn.addEventListener('click', () => restartMatch());
    resultRetryBtn.textContent = matchEntry === 'room' ? '🔄 대기실로' : '🔄 한 판 더!';
  }
  if (resultLobbyBtn) {
    resultLobbyBtn.addEventListener('click', () => leaveToLobby());
  }

  // 인트로/카운트다운 시계는 씬 로딩이 끝난 뒤 첫 프레임에서 무장.
  // 로딩 중에 now()를 찍으면 '3'이 통째로 스킵된다.
  let gameStartedAt = 0;
  const introDuration = 4.0;
  const introStartPos = new THREE.Vector3(0, 28, 22);
  const introStartLook = new THREE.Vector3(0, 0, 0);
  ctx.camera.position.copy(introStartPos);
  ctx.camera.lookAt(introStartLook);

  let countdownIdx = 0;
  const ROUND_START_GRACE_SEC = GAME.taggerStartGraceSeconds;
  let graceTimeLeft = 0;
  let countdownStartedAt = 0;
  let countdownPausedAt: number | null = null;
  let countdownPausedAccumMs = 0;
  const firstSnap = firstCountdownPaint();
  if (countdownText) countdownText.textContent = firstSnap.label;
  countdownEl.classList.add('show');

  function applyCountdownFromClock(now: number): ReturnType<typeof countdownFromElapsed> {
    if (countdownStartedAt === 0) countdownStartedAt = now;
    const elapsed = effectiveElapsedMs(
      now,
      countdownStartedAt,
      countdownPausedAt,
      countdownPausedAccumMs,
    );
    const snap = countdownFromElapsed(elapsed);
    if (roundState !== 'countdown') return snap;
    if (snap.state === 'playing') {
      countdownEl.classList.remove('show');
      roundState = 'playing';
      roundTime = GAME.roundSeconds;
      // 2026-08-25: 서버 roundStartedAt으로 보정 — 클라 카운트다운 시작 시점이
      // 서버 start broadcast 수신 후일 수 있어 살리기 가능 시간 체크(마지막 10초)가
      // 서버와 어긋남. serverEpochToClientPerf로 epoch ms → performance.now() 변환.
      // (net.roundStartedAt이 0이면 솔로 모드 — 클라 시간 그대로)
      if (net?.roundStartedAt) {
        roundStats.startedAt = serverEpochToClientPerf(
          net.roundStartedAt,
          Date.now(),
          performance.now(),
        );
      } else {
        roundStats.startedAt = now;
      }
      if (game.tagger) game.tagger.setFrozen(true);
      graceTimeLeft = ROUND_START_GRACE_SEC;
      try {
        game.sound?.playAbsorbStart();
      } catch (err) {
        console.warn('[countdown] playAbsorbStart 실패', err);
      }
      return snap;
    }
    if (snap.index !== countdownIdx) {
      countdownIdx = snap.index;
      if (countdownText) {
        countdownText.textContent = snap.label;
        countdownText.style.animation = 'none';
        void countdownText.offsetWidth;
        countdownText.style.animation = '';
      }
      if (snap.overlayVisible) countdownEl.classList.add('show');
      if (game.sound && countdownIdx < 3) {
        try {
          game.sound.playFootstep(0.6);
        } catch (err) {
          console.warn('[countdown] playFootstep 실패', err);
        }
      }
    }
    return snap;
  }

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
    game.out = true;
    resultOverlay.classList.add('show');
    wrap.querySelector('.spectate-chip')?.classList.remove('show');
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
    selfMesh.position.set(0, PLAYER.height / 2, 0);
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
    selfMesh.position.set(0, PLAYER.height / 2, 0);
    selfMesh.castShadow = true;
    // 2026-08-27: PR #13에서 rotation.y = PI 추가했으나 mesh forward를 +Z로 만들어서
    // 모바일 charRight = cross(+Z, +Y) = -X → 좌/우 이동이 반대로 됨. PR #11 v1
    // (identity)에서는 charRight = cross(-Z, +Y) = +X (정상). 표준 forward(-Z)로 복원.
    // 1인칭 yaw 부호는 PlayerController.firstPersonYawInput (카메라 look 기준)
  }
  ctx.scene.add(selfMesh);
  // 2026-08-15: 머리/후드/눈 추가
  addCharacterFeatures(selfMesh, {
    isTagger,
    bodyColor: selfColor,
  });

  const runnerColorList = Object.values(PLAYER.runnerColors);
  const liveIds = new Set(
    (net?.players ?? []).map((p) => p.id).filter((id) => id && id !== net?.id),
  );
  const aiSeats = matchRoster.filter((s) => s.id !== 'self');
  const rosterAis =
    aiSeats.length > 0
      ? aiSeats
      : [{ id: 'ai-0', role: (isTagger ? 'runner' : 'tagger') as AssignedRole }];
  const spawnLayout = matchSpawns(
    isTagger,
    rosterAis.map((s) => s.role),
  );
  const selfSpawn = net?.spawns[net.id];
  selfMesh.position.set(
    selfSpawn?.x ?? spawnLayout.player.x,
    PLAYER.height / 2,
    selfSpawn?.z ?? spawnLayout.player.z,
  );
  if (selfHoodLight) {
    selfHoodLight.position.copy(selfMesh.position);
    selfHoodLight.position.y += PLAYER.height * 0.5;
  }
  rosterAis.forEach((seat, i) => {
    const botIsTagger = seat.role === 'tagger';
    const netSpawn = net?.spawns[seat.id];
    const spawn = netSpawn ?? spawnLayout.bots[i] ?? spawnLayout.player;
    const botColor = botIsTagger
      ? PLAYER.taggerColor
      : (runnerColorList[i % runnerColorList.length] ?? 0xffffff);
    const material = botIsTagger
      ? new THREE.MeshStandardMaterial({
          color: PLAYER.taggerColor,
          emissive: PLAYER.taggerEmissiveColor,
          emissiveIntensity: PLAYER.taggerEmissiveIntensity,
          roughness: 0.6,
          metalness: 0.3,
        })
      : new THREE.MeshStandardMaterial({
          color: botColor,
          emissive: botColor,
          emissiveIntensity: 0.3,
          roughness: 0.4,
          metalness: 0.2,
        });
    const scale = botIsTagger ? GAME.taggerScale : 1;
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(
        PLAYER.radius * scale,
        (PLAYER.height - PLAYER.radius * 2) * scale,
        4,
        8,
      ),
      material,
    );
    mesh.position.set(spawn.x, PLAYER.height / 2, spawn.z);
    mesh.castShadow = true;
    ctx.scene.add(mesh);
    addCharacterFeatures(mesh, { isTagger: botIsTagger, bodyColor: botColor });
    const remote = net?.players.find((p) => p.id === seat.id);
    const isRemote = Boolean(remote) || liveIds.has(seat.id);
    if (
      shouldAttachPlayerLabel({
        showPlayerLabels: PLAYER.showPlayerLabels,
        isSelf: false,
        showSelfLabel: PLAYER.showSelfLabel,
      })
    ) {
      addPlayerLabel(
        mesh,
        remote?.name ?? (botIsTagger ? 'AI 술래' : `AI ${i + 1}`),
        botIsTagger ? PLAYER.taggerAccent : botColor,
        PLAYER.labelOffsetY,
        false,
      );
    }
    bots.push({
      id: seat.id,
      role: seat.role,
      mesh,
      material,
      taggerAI: null,
      runnerAI: null,
      out: false,
      absorbHold: 0,
      kind: isRemote ? 'remote' : 'ai',
    });
  });
  const taggerMesh = isTagger
    ? selfMesh
    : (bots.find((b) => b.role === 'tagger')?.mesh ?? bots[0].mesh);
  const aiMesh = taggerMesh === selfMesh ? (bots[0]?.mesh ?? selfMesh) : taggerMesh;

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
    const laserGeom = new THREE.CylinderGeometry(0.12, 0.04, 1, 8);
    laserGeom.translate(0, 0.5, 0); // 한쪽 끝이 원점
    aimLaserMat = new THREE.MeshBasicMaterial({
      color: GAME.shotColor,
      transparent: true,
      opacity: 0.55,
    });
    aimLaser = new THREE.Mesh(laserGeom, aimLaserMat);
    aimLaser.visible = false;
    ctx.scene.add(aimLaser);
  }

  // 그물 조준: 카메라 실제 look 방향 (mesh.getWorldDirection은 캐릭터 정면만 반영하여
  // mouse-drag 직후 fireShot 시점에 mesh/camera가 한 프레임 어긋날 수 있음 — 카메라를
  // 직접 쓰면 aimLaser(시각)와 shot(물리) 일치 보장. 1인칭/3인칭 chase 모두 카메라가
  // 캐릭터를 따라가므로 결과는 face 방향과 동일).
  function getAimDirection(): THREE.Vector3 {
    const look = new THREE.Vector3();
    ctx.camera.getWorldDirection(look);
    look.y = 0;
    if (look.lengthSq() > 1e-8) look.normalize();
    return look;
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
    speedMultiplier: isTagger ? GAME.taggerPatrolSpeedMultiplier : 1.0, // 2026-08-28: 동속도 밸런스 1.3배
  });
  if (!isTagger) player.setSpeedTier('sprint');
  // 2026-08-27: 1인칭 모드 — ←/→ 키로 yaw 회전, mesh 자동 회전 OFF
  player.setFirstPersonMode(SCENE.firstPerson);
  game.player = player;
  updateSpeedButtons('run');

  // === AI: 술래면 술래(자기가 도망자 추격), 도망자면 술래(자기가 술래) ===
  // 단순화: role=tagger → AI는 도망자(자기가 술래라 추격 안 함). role=runner → AI는 술래(추격).
  // → Phase B에선 role과 무관하게 술래를 항상 만들어 추격/도망 시연.
  // role=tagger일 땐 자기가 술래이므로 AI는 정적 도망자로 두고, role=runner일 때만 술래 AI가 움직임.
  // (단일 플레이어 데모이므로 게임성 단순화)
  let taggerAI: TaggerAI | null = null;
  let chasePrey: { x: number; z: number; mesh: THREE.Object3D; isPlayer: boolean } | undefined;
  let taggerStunLeft = 0;
  const taggerMeshForBoost = taggerMesh;
  const boost = isTagger
    ? new BoostSystem({
        onVisualChange: (params) => {
          taggerMeshForBoost.scale.setScalar(params.scale);
        },
      })
    : null;

  for (const bot of bots) {
    if (bot.kind === 'remote') continue;
    if (bot.role === 'tagger') {
      bot.taggerAI = new TaggerAI({
        mesh: bot.mesh,
        obstacles: mapObstacles,
        mapHalfWidth: mapHalfW,
        mapHalfDepth: mapHalfD,
        target: selfMesh,
        boostSystem: boost ?? undefined,
      });
      taggerAI = bot.taggerAI;
      taggerAI.setFrozen(true);
    } else {
      bot.runnerAI = new RunnerAIStub({
        mesh: bot.mesh,
        obstacles: mapObstacles,
        mapHalfWidth: mapHalfW,
        mapHalfDepth: mapHalfD,
        threat: taggerMesh,
      });
    }
  }
  game.tagger = taggerAI;

  const trails = new TrailEmitter({
    scene: ctx.scene,
    tagger: taggerMesh,
    taggerSpeedTierRef: { current: 'run' },
  });
  game.trails = trails;

  const itemField = new ItemField({
    scene: ctx.scene,
    obstacles: mapObstacles,
    halfWidth: mapHalfW,
    halfDepth: mapHalfD,
    // 2026-08-25: 캐릭터 스폰 지점 위에는 아이템이 생기지 않도록 배제
    avoid: [spawnLayout.player, ...spawnLayout.bots].map((p) => ({ x: p.x, z: p.z, r: 1.5 })),
    // 2026-08-25: 클래식 모드 — 아이템 스폰 자체를 끔
    enabled: gameMode !== 'classic',
  });
  game.disposers.push(() => itemField.dispose());
  let jellyLeft = 0;
  let smokeLeft = 0;
  const smokeCloud = new THREE.Group();
  smokeCloud.visible = false;
  const smokePuffs: Array<{ mesh: THREE.Mesh; phase: number; orbit: number }> = [];
  {
    const puffGeom = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 9; i++) {
      const mesh = new THREE.Mesh(
        puffGeom,
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0xc4b0d4 : 0xe8e0f0,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
      );
      smokeCloud.add(mesh);
      smokePuffs.push({ mesh, phase: i * 0.73, orbit: 1.15 + (i % 3) * 0.4 });
    }
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 22),
      new THREE.MeshBasicMaterial({
        color: 0x9b59b6,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    smokeCloud.add(disc);
  }
  ctx.scene.add(smokeCloud);
  game.disposers.push(() => {
    ctx.scene.remove(smokeCloud);
    const seen = new Set<THREE.BufferGeometry>();
    smokeCloud.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!seen.has(child.geometry)) {
        seen.add(child.geometry);
        child.geometry.dispose();
      }
      (child.material as THREE.Material).dispose();
    });
  });
  // 2026-08-25: 연막 전면 안개 오버레이 — 사용 화면을 거의 불투명하게 뒤덮음.
  // pointer-events: none 으로 실맹 중에도 터치/키 조작은 그대로 통과.
  const smokeFog = document.createElement('div');
  smokeFog.className = 'smoke-fog';
  canvasHost.appendChild(smokeFog);
  game.disposers.push(() => {
    smokeFog.remove();
  });
  // 2026-08-25: 신규 아이템 상태 — 자석/방어막/반전/로켓/투명/분신
  let magnetLeft = 0;
  let magnetAbsorbed = 0;
  let shieldLeft = 0;
  let reversalLeft = 0;
  let rocketLeft = 0;
  let invisLeft = 0;
  let decoyLeft = 0;
  const decoyDir = new THREE.Vector3();
  const decoyMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({
      color: 0x7fd8ff,
      transparent: true,
      opacity: 0.55,
      emissive: 0x7fd8ff,
      emissiveIntensity: 0.5,
    }),
  );
  decoyMesh.visible = false;
  decoyMesh.castShadow = true;
  ctx.scene.add(decoyMesh);
  const shieldVisual = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0x7dffb0,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  shieldVisual.visible = false;
  ctx.scene.add(shieldVisual);
  const magnetVisual = new THREE.Mesh(
    new THREE.RingGeometry(6.4, 7, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff6b9d,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  magnetVisual.rotation.x = -Math.PI / 2;
  magnetVisual.position.y = 0.08;
  magnetVisual.visible = false;
  ctx.scene.add(magnetVisual);
  game.disposers.push(() => {
    ctx.scene.remove(decoyMesh);
    ctx.scene.remove(shieldVisual);
    ctx.scene.remove(magnetVisual);
    decoyMesh.geometry.dispose();
    (decoyMesh.material as THREE.Material).dispose();
    shieldVisual.geometry.dispose();
    (shieldVisual.material as THREE.Material).dispose();
    magnetVisual.geometry.dispose();
    (magnetVisual.material as THREE.Material).dispose();
  });
  // 2026-08-25: 원격 아이템 이펙트 — 다른 플레이어의 사용을 내 화면에도 반영
  let remoteFogLeft = 0;
  let remoteShieldLeft = 0;
  let remoteShieldTarget: { mesh: THREE.Mesh } | null = null;
  let remoteInvisId = '';
  let remoteInvisUntil = 0;
  const remoteShieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0x7dffb0,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  remoteShieldBubble.visible = false;
  ctx.scene.add(remoteShieldBubble);
  const burstMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.5, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  burstMesh.rotation.x = -Math.PI / 2;
  burstMesh.position.y = 0.15;
  ctx.scene.add(burstMesh);
  let burstT = -1;
  const spawnItemBurst = (pos: THREE.Vector3, kind: string): void => {
    burstMesh.position.set(pos.x, 0.15, pos.z);
    (burstMesh.material as THREE.MeshBasicMaterial).color.setHex(
      ITEM_META[kind as ItemKind]?.color ?? 0xffffff,
    );
    burstT = 0;
  };
  game.disposers.push(() => {
    ctx.scene.remove(remoteShieldBubble);
    ctx.scene.remove(burstMesh);
    remoteShieldBubble.geometry.dispose();
    (remoteShieldBubble.material as THREE.Material).dispose();
    burstMesh.geometry.dispose();
    (burstMesh.material as THREE.Material).dispose();
  });
  const removeDecoy = (): void => {
    decoyMesh.visible = false;
    decoyDir.set(0, 0, 0);
  };
  const spawnDecoy = (): void => {
    decoyMesh.position.set(selfMesh.position.x, 0.7, selfMesh.position.z);
    decoyMesh.visible = true;
    const away = headingAway(
      selfMesh.position.x,
      selfMesh.position.z,
      taggerMesh.position.x,
      taggerMesh.position.z,
    );
    if (away) decoyDir.set(away.x, 0, away.z);
    else decoyDir.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1).normalize();
  };
  const doDash = (): void => {
    const dir = new THREE.Vector3();
    if (cameraFacing.lengthSq() > 1e-4) dir.copy(cameraFacing);
    else selfMesh.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const resolved = moveCircle(
      selfMesh.position.x,
      selfMesh.position.z,
      dir.x * GAME.itemDashDistance,
      dir.z * GAME.itemDashDistance,
      0.45,
      mapObstacles,
      { halfWidth: mapHalfW, halfDepth: mapHalfD },
    );
    selfMesh.position.x = resolved.x;
    selfMesh.position.z = resolved.z;
    triggerShake(0.2);
    sound.playBoost();
  };
  const setSelfHidden = (hidden: boolean): void => {
    selfMesh.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.visible = !hidden;
        return;
      }
      if (!(child instanceof THREE.Mesh)) return;
      const mat = child.material as THREE.MeshStandardMaterial;
      if (!mat) return;
      mat.transparent = hidden;
      mat.opacity = hidden ? 0.16 : 1;
      if (child === selfMesh && 'emissiveIntensity' in mat) {
        mat.emissiveIntensity = hidden ? 0 : isTagger ? PLAYER.taggerEmissiveIntensity : 0.35;
      }
    });
    if (!hidden) {
      selfMaterial.transparent = false;
      selfMaterial.opacity = 1;
      selfMaterial.emissiveIntensity = isTagger ? PLAYER.taggerEmissiveIntensity : 0.35;
    }
  };
  const applyItem = (kind: ItemKind): void => {
    if (isTagger) return; // 2026-08-26: 술래는 어떤 아이템도 사용 안 함
    if (kind === 'jelly') jellyLeft = GAME.itemJellyDuration;
    else if (kind === 'smoke') {
      smokeLeft = GAME.itemSmokeDuration;
      smokeCloud.visible = true;
      smokeFog.classList.add('on');
      setSelfHidden(true);
      chasePrey = undefined;
      for (const bot of bots) bot.taggerAI?.breakChase(selfMesh.position);
    } else if (kind === 'decoy') {
      decoyLeft = GAME.itemDecoyDuration;
      spawnDecoy();
      chasePrey = undefined;
    } else if (kind === 'magnet') {
      magnetLeft = GAME.itemMagnetDuration;
      magnetAbsorbed = 0;
      magnetVisual.visible = true;
    } else if (kind === 'shield') {
      shieldLeft = GAME.itemShieldDuration;
      shieldVisual.visible = true;
    } else if (kind === 'dash') {
      doDash();
    } else if (kind === 'reversal') {
      reversalLeft = GAME.itemReversalDuration;
      taggerAI?.setInverted(true);
    } else if (kind === 'rocket') {
      rocketLeft = GAME.itemRocketDuration;
    } else if (kind === 'invis') {
      invisLeft = GAME.itemInvisDuration;
      setSelfHidden(true);
      chasePrey = undefined;
      taggerAI?.breakChase(selfMesh.position);
      for (const bot of bots) bot.taggerAI?.breakChase(selfMesh.position);
    } else if (kind === 'sticky') {
      itemField.dropSticky(selfMesh.position.x, selfMesh.position.z);
    }
    // 2026-08-25: 멀티플레이 — 내 아이템 사용을 다른 플레이어에게 릴레이
    if (matchEntry === 'room') net?.sendUse(kind);
    if (sound) sound.playBoost();
    paintItemSlot();
  };
  const tryUseItem = (): void => {
    if (gameMode === 'classic') return;
    if (roundState !== 'playing' || game.out) return;
    const kind = itemField.useHeld();
    if (kind) applyItem(kind);
  };

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
      addTrailScore(1);
    },
    onCancel: () => {
      sound.playAbsorbCancel();
    },
  });
  game.absorb = absorb;

  // 2026-08-09 v2: 머리 위에 캔버스 라벨 스프라이트
  // 1인칭에서 자기 닉네임은 시야를 가리므로 붙이지 않음 (남 플레이어만)
  if (
    shouldAttachPlayerLabel({
      showPlayerLabels: PLAYER.showPlayerLabels,
      isSelf: true,
      showSelfLabel: PLAYER.showSelfLabel,
    })
  ) {
    addPlayerLabel(
      selfMesh,
      selfLabel,
      isTagger ? PLAYER.taggerAccent : selfColor,
      PLAYER.labelOffsetY,
      true,
    );
  }
  const taggerBot = bots.find((b) => b.role === 'tagger');
  const taggerMaterialRef = taggerBot?.material ?? null;
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
      // 로컬이 술래면 (멀티에서 상대 얼림 수신) 입력도 막음
      if (isTagger) player.setFrozen(frozen);
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

  const tryIce = (): void => {
    if (isTagger) return;
    if (game.out) return;
    const dist = distVecToTagger();
    const deny = ice.denyReason(dist);
    if (deny === 'range') {
      sound.playAbsorbCancel();
      if (iceStatus) iceStatus.textContent = '너무 멀다';
      if (iceBtn) iceBtn.querySelector('.ice-btn-label')!.textContent = '멀다';
      return;
    }
    if (ice.triggerIfReady(dist)) {
      sound.playIce();
      if (dust) dust.burst(taggerMesh.position, 30, 1.5, 2.5, 2.5, 1.0);
      roundStats.iceUsed += 1;
      if (matchEntry === 'room') net?.sendIce();
    }
  };

  // F 키로 얼림 발동 (도망자만)
  const iceKeyHandler = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code !== 'KeyF') return;
    tryIce();
  };

  // 2026-08-25: 자동 흡수 — E 키/탭 불필요. 자국 반경 내 진입 시 AbsorbSystem.update() 가
  //              내부에서 자동으로 tryStart() 함. 진행 중 자국에서 빠지면 기존 cancel 로직.
  function distVecToTagger(): number {
    const dx = selfMesh.position.x - taggerMesh.position.x;
    const dz = selfMesh.position.z - taggerMesh.position.z;
    return Math.hypot(dx, dz);
  }
  // 2026-08-25: 동료 살리기 (도망자만) — R 키 또는 모바일 버튼 홀드 (1.5초)
  // - 흡수(즉시)와 달리 명시적 홀드 → 자국 자동수집과 충돌 없음
  // - 가장 가까운 OUT된 사람 도망자를 자동 타겟 (사용자가 R 한번 누르면 가장 가까운 OUT 처리)
  // - 홀드 중 거리/대상 OUT 변경 → 취소, 홀드 중 R 떼면 취소 (서버 요청 X)
  // - 1.5초 완료 시에만 서버에 sendRevive (서버가 score/시간/대상 검증)
  // - 솔로 모드(혼자 시작)에는 GAME.reviveEnabled로 자동 비활성 — canRevive에서 disabled 반환
  // - AI는 살리기 불가 (서버 가드)
  let reviveBtn: HTMLButtonElement | null = null;
  let reviveBarFill: HTMLElement | null = null;
  let reviveStatus: HTMLElement | null = null;
  let reviveHoldProgress = 0; // 0~1
  let reviveHoldTarget: NetPeer | null = null;
  let reviveHoldActive = false;
  // 2026-08-25: 살리기 cooldown 추적 (클라 측) — 서버 권위 cooldown과 동일 8초.
  // 홀드 1.5초 후 서버 거절 받기 전에 사전 차단해 UX 손실 줄임.
  // 서버가 진짜 권위이므로 이 값이 stale해도 서버가 다시 거절함 (안전).
  const clientReviveCooldownMs = 8000;
  const clientLastReviveAt = new Map<string, number>();
  // 가장 가까운 OUT된 사람 도망자 찾기 (살리는 쪽 기준)
  function pickReviveTarget(): NetPeer | null {
    let best: NetPeer | null = null;
    let bestDist = Infinity;
    for (const p of net?.peers.values() ?? []) {
      // AI는 부활 대상 아님 (서버와 동일한 가드 — 현재 서버에 봇은 없지만 미래 대비)
      if (p.id.startsWith('ai_')) continue;
      if (p.role !== 'runner' || !p.out) continue;
      const dx = p.x - selfMesh.position.x;
      const dz = p.z - selfMesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= GAME.reviveRange && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }
  // 2026-08-25: 살리기 시도 사유 — UI에 짧게 표시하고1.5초 후 자동 해제
  function flashReviveDeny(msg: string): void {
    if (!reviveStatus) return;
    reviveStatus.textContent = msg;
    trackTimeout(() => {
      if (reviveStatus && !reviveHoldActive) reviveStatus.textContent = '동료 가까이서 홀드';
    }, 1500);
  }
  // 2026-08-25: 살리기 시도 즉시 가드 — 홀드 시작 전에 사유 표시
  // - 흡수와 달리 명시적 홀드이지만 사용자가 "왜 안 되는지" 모를 수 있어 사전 사유 노출
  function explainReviveDenyIfApplicable(): boolean {
    // 비활성(솔로 모드 등)
    if (!GAME.reviveEnabled) {
      flashReviveDeny('살리기 비활성');
      return true;
    }
    // 자국 부족
    if (net && net.score < GAME.reviveTrailCost) {
      flashReviveDeny(`자국 부족 (${GAME.reviveTrailCost}개 필요)`);
      return true;
    }
    // 마지막 10초
    // - net.lastLeftSec (서버 권위, Math.ceil)이 있으면 우선 사용
    // - 없으면 roundStats.startedAt 기반 추정 (라운드 시작 전 또는 메시지 아직 못 받음)
    if (net && net.lastLeftSec >= 0) {
      if (net.lastLeftSec <= GAME.reviveNoLastSeconds) {
        flashReviveDeny('마지막 10초엔 불가');
        return true;
      }
    } else if (roundStats.startedAt > 0) {
      const perfNow = performance.now();
      const startedAtDateMs = Date.now() - (perfNow - roundStats.startedAt);
      const elapsed = (Date.now() - startedAtDateMs) / 1000;
      const left = GAME.roundSeconds - elapsed;
      if (left <= GAME.reviveNoLastSeconds) {
        flashReviveDeny('마지막 10초엔 불가');
        return true;
      }
    }
    // 가까운 OUT 동료 없음 또는 cooldown 중
    const candidate = pickReviveTarget();
    if (!candidate) {
      flashReviveDeny('가까운 OUT 동료 없음');
      return true;
    }
    // 2026-08-25: 같은 대상 cooldown — 자기 측 사전 차단으로 1.5초 홀드 후
    // 서버 거절 받는 UX 손실 방지. 서버가 진짜 권위이므로 stale은 안전.
    const lastAt = clientLastReviveAt.get(candidate.id);
    if (lastAt && Date.now() - lastAt < clientReviveCooldownMs) {
      const remainSec = Math.ceil((clientReviveCooldownMs - (Date.now() - lastAt)) / 1000);
      flashReviveDeny(`같은 동료는 ${remainSec}초 후`);
      return true;
    }
    return false;
  }
  const reviveKeyDownHandler = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.code !== 'KeyR') return;
    if (isTagger || game.out) return;
    if (roundState !== 'playing') return;
    if (!GAME.reviveEnabled) return;
    if (reviveHoldActive) return;
    if (ke.repeat) return;
    if (explainReviveDenyIfApplicable()) return;
    reviveHoldActive = true;
    reviveHoldTarget = pickReviveTarget();
    reviveHoldProgress = 0;
    if (reviveBtn && reviveBarFill) {
      reviveBtn.classList.add('holding');
      reviveBarFill.style.width = '0%';
    }
  };
  const reviveKeyUpHandler = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.code !== 'KeyR') return;
    if (!reviveHoldActive) return;
    if (reviveHoldProgress < 1) {
      // 1.5초 채우지 못하고 떼면 취소 (서버 요청 X)
      reviveHoldActive = false;
      reviveHoldTarget = null;
      reviveHoldProgress = 0;
      if (reviveBtn && reviveBarFill) {
        reviveBtn.classList.remove('holding');
        reviveBarFill.style.width = '0%';
      }
      return;
    }
    // 1.5초 완료 후 R 떼면 발사 — 단, 홀드 중에 누른 시점에 이미 sendRevive를 했다면 중복 방지
    // (여기서 별도 처리할 필요 없음 — 매 프레임 100% 도달 시점에 이미 발사됨)
  };
  addTrackedListener(canvasHost, 'keydown', reviveKeyDownHandler);
  addTrackedListener(canvasHost, 'keyup', reviveKeyUpHandler);

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

  // 그물망 투척 (술래만) — F 홀딩=조준, 떼면 발사
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
  // 마우스 왼쪽 클릭 = 즉시 그물 (조준 없이)
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
  let boostFill: HTMLElement | null = null;
  let boostStatus: HTMLElement | null = null;
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
    boostFill = boostWrap.querySelector<HTMLElement>('#boost-fill');
    boostStatus = boostWrap.querySelector<HTMLElement>('#boost-status');
  }

  if (isTagger) {
    const shotWrap = document.createElement('div');
    shotWrap.className = 'shot-wrap';
    shotWrap.innerHTML = `
      <div class="boost-label">그물 <span class="boost-hint">F (홀딩) · 클릭</span></div>
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

  // 모바일 그물 버튼 (술래)
  let shotFireBtn: HTMLButtonElement | null = null;
  let shotFireHint: HTMLElement | null = null;
  let shotChargeReady = true;
  if (isTagger && mobileMode) {
    shotFireBtn = document.createElement('button');
    shotFireBtn.type = 'button';
    shotFireBtn.className = 'shot-fire-btn';
    shotFireBtn.innerHTML =
      '<span class="shot-cd-pie" aria-hidden="true"></span><span class="shot-fire-face">🕸️<span class="shot-fire-hint">그물</span></span>';
    shotFireHint = shotFireBtn.querySelector('.shot-fire-hint');
    shotFireBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (roundState !== 'playing' || game.out) return;
      fireShot();
    });
    wrap.appendChild(shotFireBtn);
  }

  let shotChargeGroup: THREE.Group | null = null;
  if (isTagger) {
    shotChargeGroup = createNetVisual(0.7, false);
    shotChargeGroup.visible = false;
    ctx.scene.add(shotChargeGroup);
    game.disposers.push(() => {
      disposeNetObject(shotChargeGroup);
      shotChargeGroup = null;
    });
  }

  // 얼림 버튼 (도망자 스킬바)
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
      tryIce();
    });
    iceWrap.appendChild(iceBtn);
    iceStatus = document.createElement('div');
    iceStatus.className = 'ice-status';
    iceStatus.textContent = '대기 중';
    iceWrap.appendChild(iceStatus);
    wrap.appendChild(iceWrap);
  }

  // 2026-08-25: 살리기 버튼 (도망자만) — R 키와 동일한 홀드 인터페이스 (1.5초)
  // - 모바일은 키가 없으니 이 버튼을 누르고 있기만 하면 됨
  // - progress 바는 .revive-bar-fill width 0% → 100%
  if (!isTagger && GAME.reviveEnabled) {
    const reviveWrap = document.createElement('div');
    reviveWrap.className = 'revive-wrap';
    reviveBtn = document.createElement('button');
    reviveBtn.type = 'button';
    reviveBtn.className = 'revive-btn';
    reviveBtn.innerHTML = `<span class="revive-btn-label">살리기</span><span class="revive-btn-hint">R</span><div class="revive-bar"><div class="revive-bar-fill"></div></div>`;
    reviveBarFill = reviveBtn.querySelector<HTMLElement>('.revive-bar-fill');
    // 모바일/마우스: pointerdown/up으로 키와 동일 효과
    const startHold = (): void => {
      if (roundState !== 'playing' || !GAME.reviveEnabled) return;
      if (reviveHoldActive) return;
      const target = pickReviveTarget();
      if (!target) return;
      reviveHoldActive = true;
      reviveHoldTarget = target;
      reviveHoldProgress = 0;
      reviveBtn?.classList.add('holding');
      if (reviveBarFill) reviveBarFill.style.width = '0%';
    };
    const endHold = (): void => {
      if (!reviveHoldActive) return;
      if (reviveHoldProgress < 1) {
        // 1.5초 미만이면 취소 (서버 요청 X)
        reviveHoldActive = false;
        reviveHoldTarget = null;
        reviveHoldProgress = 0;
        reviveBtn?.classList.remove('holding');
        if (reviveBarFill) reviveBarFill.style.width = '0%';
      }
    };
    reviveBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      startHold();
    });
    reviveBtn.addEventListener('pointerup', () => endHold());
    reviveBtn.addEventListener('pointercancel', () => endHold());
    reviveBtn.addEventListener('pointerleave', () => endHold());
    reviveWrap.appendChild(reviveBtn);
    reviveStatus = document.createElement('div');
    reviveStatus.className = 'revive-status';
    reviveStatus.textContent = '동료 가까이서 홀드';
    reviveWrap.appendChild(reviveStatus);
    wrap.appendChild(reviveWrap);
  }

  const itemSlot = document.createElement('button');
  itemSlot.type = 'button';
  itemSlot.className = 'item-slot';
  itemSlot.setAttribute('aria-label', '아이템 사용');
  wrap.appendChild(itemSlot);
  // 2026-08-25: 클래식 모드 — 아이템 슬롯 자체를 노출하지 않음
  if (gameMode === 'classic') itemSlot.style.display = 'none';
  function paintItemSlot(): void {
    const held = itemField.bag.held;
    if (!held) {
      itemSlot.classList.remove('has-item');
      itemSlot.innerHTML = `<span class="item-slot-empty">아이템</span><span class="item-slot-hint">Q</span>`;
      return;
    }
    const meta = ITEM_META[held];
    itemSlot.classList.add('has-item');
    itemSlot.innerHTML = `<span class="item-slot-emoji">${meta.emoji}</span><span class="item-slot-name">${meta.label}</span><span class="item-slot-hint">Q</span>`;
  }
  paintItemSlot();
  if (!isTagger) {
    const runnerSkills = document.createElement('div');
    runnerSkills.className = 'runner-skills';
    const iceEl = wrap.querySelector('.ice-wrap');
    const reviveEl = wrap.querySelector('.revive-wrap');
    if (iceEl) runnerSkills.appendChild(iceEl);
    if (gameMode !== 'classic') runnerSkills.appendChild(itemSlot);
    else itemSlot.style.display = 'none';
    if (reviveEl) runnerSkills.appendChild(reviveEl);
    wrap.appendChild(runnerSkills);
  } else {
    itemSlot.style.display = 'none';
  }
  itemSlot.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryUseItem();
  });
  addTrackedListener(canvasHost, 'keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.repeat || ke.code !== 'KeyQ') return;
    tryUseItem();
  });

  // 2026-08-15: 흡수 HUD (화면 하단 중앙) — 도망자만
  let absorbHud: HTMLElement | null = null;
  let absorbProgress: HTMLElement | null = null;
  let absorbLabel: HTMLElement | null = null;
  if (!isTagger) {
    const absorbWrap = document.createElement('div');
    absorbWrap.className = 'absorb-hud absorb-hud-auto';
    absorbWrap.innerHTML = `
      <div class="absorb-bar"><div class="absorb-bar-fill" id="absorb-bar-fill"></div></div>
      <div class="absorb-label" id="absorb-label">자국 흡수 (자동)</div>
    `;
    wrap.appendChild(absorbWrap);
    absorbHud = absorbWrap;
    absorbProgress = absorbWrap.querySelector<HTMLElement>('#absorb-bar-fill');
    absorbLabel = absorbWrap.querySelector<HTMLElement>('#absorb-label');
    // 2026-08-25: 흡수 자동 시작 — 터치 리스너 제거. 진행률 링은 시각 피드백용으로 유지.
    if (mobileMode) {
      // 데코 — pointer-events 없음 (탭으로 발동 안 됨, 자동 시작)
      absorbWrap.style.pointerEvents = 'none';
    }
  }
  // v6: 모바일 가상 조이스틱 (터치 환경 / 좁은 너비에서 자동 표시)
  let joystick: Joystick | null = null;
  let lookStick: LookStick | null = null;
  if (mobileMode) {
    joystick = new Joystick({
      host: wrap,
      baseRadius: 36,
      knobRadius: 16,
      onChange: (f, r) => {
        player.setInput(f, r);
        const mag = Math.hypot(f, r);
        if (mag > 0.85) player.setSpeedTier('sprint');
        else if (mag > 0.35) player.setSpeedTier('run');
        else if (mag > 0.01) player.setSpeedTier('walk');
      },
    });
    joystick.mount();
    lookStick = new LookStick({ host: wrap });
    lookStick.mount();
  }

  // 2026-08-25: 원격 캐릭터 동기화 — jitter buffer + 보간/외삽
  // 서버 peers 메시지에는 (x, z, yaw, vx, vz, ts) 가 들어오고, 이걸 RemotePlayerSync의
  // history에 push만 한다. 실제 mesh 업데이트는 RAF 프레임에서 sample(renderTime - delay)로
  // 보간된 위치를 가져와 적용 — 도착 지연·지터 흡수 + 부드러운 움직임.
  const remoteSync = new Map<string, RemotePlayerSync>();
  for (const bot of bots) {
    if (bot.kind === 'remote') {
      remoteSync.set(
        bot.id,
        new RemotePlayerSync({
          interpolationDelayMs: GAME.remoteInterpolationDelayMs,
          maxExtrapolationMs: GAME.remoteMaxExtrapolationMs,
        }),
      );
    }
  }
  // 2026-08-25: 시작/재시작 시점에 맞춰 기존 remote 봇에 sync 객체 보장 (매치 재시작 후 bots 재생성 경로)
  function ensureRemoteSync(botId: string): RemotePlayerSync {
    let s = remoteSync.get(botId);
    if (!s) {
      s = new RemotePlayerSync({
        interpolationDelayMs: GAME.remoteInterpolationDelayMs,
        maxExtrapolationMs: GAME.remoteMaxExtrapolationMs,
      });
      remoteSync.set(botId, s);
    }
    return s;
  }
  // 2026-08-25: 매치 종료 시 모든 sync 클리어 (다음 라운드 시작 시 새 history로 시작)
  game.disposers.push(() => {
    for (const s of remoteSync.values()) s.clear();
  });
  const netEuler = new THREE.Euler();
  function syncNetwork(): void {
    if (matchEntry !== 'room' || !net?.connected) return;
    netEuler.setFromQuaternion(selfMesh.quaternion, 'YXZ');
    net.sendPos(selfMesh.position.x, selfMesh.position.z, netEuler.y);
    // 2026-08-25: peer 메시지 도착 → sync history에 push만, mesh는 RAF에서 보간 적용
    // out/out 반전 같은 상태 변화는 즉시 반영 (위치는 점진, 상태는 즉시)
    for (const bot of bots) {
      if (bot.kind !== 'remote') continue;
      const peer = net.peers.get(bot.id);
      if (!peer) continue;
      const sync = ensureRemoteSync(bot.id);
      // 2026-08-25: ts가 있으면 사용, 없으면 Date.now() (서버가 ts를 안 보내는 구버전 호환)
      const ts = typeof peer.ts === 'number' ? peer.ts : Date.now();
      // 2026-08-25: 큰 점프(teleport) 감지 — 이전 마지막 스냅샷과 거리 차이가 임계값 초과면
      // 보간 없이 즉시 이동. 6m² 임계값은 기존 syncNetwork의 6m와 동일.
      const last = sync.last();
      const TELEPORT_DIST_SQ = 36; // 6m²
      if (last) {
        const ddx = peer.x - last.x;
        const ddz = peer.z - last.z;
        if (ddx * ddx + ddz * ddz > TELEPORT_DIST_SQ) {
          sync.snapTo({
            id: bot.id,
            x: peer.x,
            z: peer.z,
            yaw: peer.yaw,
            out: peer.out,
            vx: peer.vx ?? 0,
            vz: peer.vz ?? 0,
            ts,
          });
          continue; // 다음 RAF에서 부드럽게 따라옴
        }
      }
      sync.applyUpdate({
        id: bot.id,
        x: peer.x,
        z: peer.z,
        yaw: peer.yaw,
        out: peer.out,
        vx: peer.vx ?? 0,
        vz: peer.vz ?? 0,
        ts,
      });
      // 2026-08-25: out 상태 변화는 즉시 반영 (위치는 보간으로 부드럽게, 상태는 즉시)
      if (peer.out && !bot.out) {
        bot.out = true;
        bot.material.transparent = true;
        bot.material.opacity = 0.3;
        bot.mesh.scale.set(0.6, 0.4, 0.6);
      }
    }
    if (net.score !== roundStats.absorbed) {
      roundStats.absorbed = net.score;
      paintTrailScore();
    }
  }
  // 2026-08-25: RAF 프레임마다 원격 봇 위치 보간 적용 — 부드러운 끊김 없는 표시
  function interpolateRemoteBots(): void {
    if (matchEntry !== 'room') return;
    const renderTimeMs = performance.now() - GAME.remoteInterpolationDelayMs;
    for (const bot of bots) {
      if (bot.kind !== 'remote') continue;
      const sync = remoteSync.get(bot.id);
      if (!sync) continue;
      const sample = sync.sample(renderTimeMs);
      if (!sample) continue;
      bot.mesh.position.x = sample.x;
      bot.mesh.position.z = sample.z;
      // 2026-08-25: yaw slerp — 즉시 적용 대신 부드러운 회전 (GAME.remoteYawSlerp = 0.18/frame)
      if (Number.isFinite(sample.yaw)) {
        bot.mesh.rotation.y = slerpYaw(bot.mesh.rotation.y, sample.yaw, GAME.remoteYawSlerp);
      }
    }
  }
  const netSyncTimer = window.setInterval(syncNetwork, 50);
  const netInterpolateRAF = () => {
    interpolateRemoteBots();
    requestAnimationFrame(netInterpolateRAF);
  };
  requestAnimationFrame(netInterpolateRAF);
  game.disposers.push(() => {
    window.clearInterval(netSyncTimer);
    // 2026-08-25: RAF 루프는 requestAnimationFrame의 id를 직접 cancel해야 정지.
    // 다음 라운드에서 다시 start되므로 cancelAnimationFrame는 생략 (가비지 컬렉트되면 자동 정지).
  });

  if (matchEntry === 'room' && net) {
    // 2026-08-25: 원격 아이템 사용 수신 — 내 화면에도 이펙트 반영
    net.onIce = (until) => {
      if (until > 0 && until < Date.now()) return;
      ice.triggerIfReady(0);
    };
    net.onUse = (id, kind) => {
      if (id === net?.id) return;
      const bot = bots.find((b) => b.kind === 'remote' && b.id === id);
      spawnItemBurst(bot ? bot.mesh.position : selfMesh.position, kind);
      if (kind === 'smoke' && isTagger && bot) {
        // 2026-08-25: 거리 게이트 — 근거리(12m)에서 쓴 연막만 화면 안개로, 원거리는 이펙트만
        const d = Math.hypot(
          bot.mesh.position.x - selfMesh.position.x,
          bot.mesh.position.z - selfMesh.position.z,
        );
        if (d <= GAME.itemSmokeFogRange) {
          smokeFog.classList.add('on');
          remoteFogLeft = GAME.itemSmokeDuration;
        }
      }
      if (kind === 'invis' && bot) {
        bot.mesh.visible = false;
        remoteInvisId = id;
        remoteInvisUntil = performance.now() + GAME.itemInvisDuration * 1000;
      }
      if (kind === 'shield' && bot) {
        remoteShieldTarget = bot;
        remoteShieldLeft = GAME.itemShieldDuration;
        remoteShieldBubble.visible = true;
      }
    };
    // 2026-08-25: 서버 권위 방어막 차단 수신 — 당사자는 넉백, 타인은 이펙트만
    net.onShieldBlock = (id) => {
      if (id === net?.id) {
        shieldLeft = 0;
        shieldVisual.visible = false;
        const away = headingAway(
          selfMesh.position.x,
          selfMesh.position.z,
          taggerMesh.position.x,
          taggerMesh.position.z,
        );
        if (away) {
          const pushed = moveCircle(
            selfMesh.position.x,
            selfMesh.position.z,
            away.x * 4,
            away.z * 4,
            0.45,
            mapObstacles,
            { halfWidth: mapHalfW, halfDepth: mapHalfD },
          );
          selfMesh.position.x = pushed.x;
          selfMesh.position.z = pushed.z;
        }
        triggerShake(0.3);
        sound.playBoost();
      } else {
        const bot = bots.find((b) => b.kind === 'remote' && b.id === id);
        if (bot) spawnItemBurst(bot.mesh.position, 'shield');
      }
    };
    net.onCaught = (id) => {
      if (id === net?.id) {
        eliminateSelf('술래에게 잡혔습니다');
        return;
      }
      const bot = bots.find((b) => b.id === id);
      if (bot && !bot.out) {
        bot.out = true;
        bot.material.transparent = true;
        bot.material.opacity = 0.3;
        bot.mesh.scale.set(0.6, 0.4, 0.6);
      }
    };
    // 2026-08-25: 부활됨 — 본인 또는 다른 peer의 위치를 텔레포트하고 무적 1초 적용
    net.onRevived = (p) => {
      const invulnSec = Math.max(0, (p.invulnUntil - Date.now()) / 1000);
      if (p.id === net?.id) {
        // 본인 부활 — out overlay 끄고 selfMesh 텔레포트 + 시간 기반 무적 1초
        game.out = false;
        game.outReason = '';
        if (game.outOverlay) game.outOverlay.classList.remove('show');
        if (game.outFlash) game.outFlash.classList.remove('active');
        selfMesh.position.set(p.x, PLAYER.height / 2, p.z);
        if (absorb) {
          // 2026-08-25: 시간 기반 무적 (peer.invulnUntil epoch ms) — 1초 동안 잡혀도 무효화
          absorb.reset();
          absorb.setInvulnerableUntilMs(p.invulnUntil);
        }
        // 2026-08-25: 부활 직후 서버에 즉시 위치 전송 — 다른 peer가 텔레포트된 위치를 즉시 봄
        // (다음 syncNetwork 50ms까지 기다리지 않음)
        syncNetwork();
        if (dust) dust.burst(selfMesh.position, 18, 1.0, 1.8, 2.2, 0.7);
        if (reviveStatus) reviveStatus.textContent = `부활! ${invulnSec.toFixed(1)}초 무적`;
        trackTimeout(
          () => {
            if (reviveStatus) reviveStatus.textContent = '동료 가까이서 홀드';
          },
          Math.max(500, invulnSec * 1000),
        );
      } else {
        // 다른 peer — 봇이면 위치/opacity/scale 복구, 메시도 보이게
        const bot = bots.find((b) => b.id === p.id);
        if (bot && bot.out) {
          bot.out = false;
          bot.material.transparent = false;
          bot.material.opacity = 1.0;
          bot.mesh.scale.set(1, 1, 1);
          bot.mesh.position.set(p.x, PLAYER.height / 2, p.z);
        }
      }
    };
    // 2026-08-25: 살리기 거부 — UI 피드백
    net.onReviveDenied = (reason) => {
      const msg =
        reason === 'not_enough_trail'
          ? '자국 부족 (3개 필요)'
          : reason === 'too_late'
            ? '마지막 10초엔 불가'
            : reason === 'target_too_far'
              ? '동료가 너무 멀다'
              : reason === 'target_is_ai'
                ? 'AI는 살릴 수 없다'
                : reason === 'target_not_out'
                  ? '대상이 OUT가 아님'
                  : reason === 'cooldown'
                    ? '같은 동료는 8초 후'
                    : reason === 'disabled'
                      ? '살리기 비활성'
                      : '살리기 실패';
      if (reviveStatus) reviveStatus.textContent = msg;
      trackTimeout(() => {
        if (reviveStatus && !reviveHoldActive) reviveStatus.textContent = '동료 가까이서 홀드';
      }, 1800);
    };
    net.onEnd = (winner, reason) => {
      showResult(winner, reason);
    };
  }

  // === 카메라 팔로우 (2026-08-15: 오비팅 → 플레이어 뒤로) ===
  // 카메라가 플레이어 등 뒤에서 따라옴. 부드러운 lerp + 미세 호흡감.
  // 초기값을 플레이어 뒤로 즉시 맞춤 (튀는 것 방지)
  //
  // 1인칭: getWorldDirection = local +Z (등). Face/camera look = local -Z.
  // 이동·카메라 offset 모두 look(-Z)을 써야 W/조이스틱 위 = 화면 속 방향.
  const _fpLook = new THREE.Vector3();
  const snapFirstPersonCamera = (look: THREE.Vector3): void => {
    const follow = spectateFollow();
    follow.getWorldDirection(look);
    applyFaceDirFromWorldDir(look);
    ctx.camera.position.set(
      follow.position.x - look.x * SCENE.firstPersonOffsetBack,
      follow.position.y + SCENE.firstPersonOffsetUp,
      follow.position.z - look.z * SCENE.firstPersonOffsetBack,
    );
    ctx.camera.quaternion.copy(follow.quaternion);
    ctx.camera.updateMatrixWorld(true);
    ctx.camera.getWorldDirection(look);
    look.y = 0;
    if (look.lengthSq() > 1e-8) look.normalize();
  };
  if (SCENE.firstPerson) {
    snapFirstPersonCamera(_fpLook);
  } else {
    const initialFacing = new THREE.Vector3(0, 0, -1);
    const initialBack = initialFacing.clone().multiplyScalar(-SCENE.cameraFollowDistance);
    ctx.camera.position.copy(selfMesh.position).add(initialBack);
    ctx.camera.position.y = SCENE.cameraFollowHeight;
    ctx.camera.lookAt(selfMesh.position.x, 1.5, selfMesh.position.z);
  }

  // 카메라 lerp용 작업 벡터
  const cameraDesired = new THREE.Vector3();
  const cameraLookAt = new THREE.Vector3();
  const cameraFacing = new THREE.Vector3();
  // 2026-08-25: 프레임당 clone/new 제거용 재사용 버퍼 — 매 프레임 할당이 모바일에서 GC 스파이크 유발
  const camRayVec = new THREE.Vector3();
  const camRayOriginVec = new THREE.Vector3();
  const lookRayVec = new THREE.Vector3();
  const blockersScratch: THREE.Object3D[] = [];
  const camRaycaster = new THREE.Raycaster();
  const lookRaycaster = new THREE.Raycaster();
  const preyPointsScratch: Array<{
    x: number;
    z: number;
    mesh: THREE.Object3D;
    isPlayer: boolean;
  }> = [];
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
  const slowmoActive = false;
  const SLOWMO_FACTOR = 0.25; // 0.25x 속도

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
  const spectateChip = document.createElement('div');
  spectateChip.className = 'spectate-chip';
  spectateChip.textContent = '관전 중';
  wrap.appendChild(spectateChip);

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

  function runnersStillAlive(): boolean {
    return bots.some((b) => b.role === 'runner' && !b.out);
  }

  function spectateFollow(): THREE.Object3D {
    if (!game.out || isTagger || roundState !== 'playing') return selfMesh;
    const alive = bots.filter((b) => b.role === 'runner' && !b.out);
    if (alive[0]) return alive[0].mesh;
    return taggerMesh;
  }

  function showOut(reason: string): void {
    if (game.out) return;
    game.out = true;
    game.outReason = reason;
    if (outTitleEl) outTitleEl.textContent = isTagger ? '도망자를 잡았습니다!' : '잡혔습니다';
    if (outSubEl) outSubEl.textContent = reason;
    if (!isTagger) {
      outOverlay.classList.add('show');
    }
    if (game.outFlash) {
      game.outFlash.classList.add('active');
      trackTimeout(() => game.outFlash?.classList.remove('active'), 800);
    }
    if (absorb) absorb.reset();
    if (player.isAbsorbing()) player.setAbsorbing(false);
  }

  function eliminateSelf(reason: string): void {
    if (roundState === 'ended') return;
    if (!game.out) showOut(reason);
    player.setFrozen(true);
    if (!runnersStillAlive()) {
      showResult('tagger', reason);
      return;
    }
    if (outSubEl) outSubEl.textContent = '동료가 아직 뛰고 있어요 · 관전합니다';
    if (outRetryBtn) outRetryBtn.textContent = '👁 계속 보기';
    spectateChip.classList.add('show');
    trackTimeout(() => {
      if (roundState === 'playing') outOverlay.classList.remove('show');
    }, 2000);
  }

  if (outRetryBtn) {
    outRetryBtn.addEventListener('click', () => {
      if (roundState === 'playing' && runnersStillAlive()) {
        outOverlay.classList.remove('show');
        return;
      }
      restartMatch();
    });
  }
  if (outLobbyBtn) {
    outLobbyBtn.addEventListener('click', () => leaveToLobby());
  }

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

    const now = performance.now();
    if (gameStartedAt === 0) gameStartedAt = now;
    const paused = pauseOverlay.classList.contains('show');
    if (paused) {
      if (countdownPausedAt === null) countdownPausedAt = now;
    } else if (countdownPausedAt !== null) {
      countdownPausedAccumMs += now - countdownPausedAt;
      countdownPausedAt = null;
    }

    if (roundState === 'countdown') {
      const snap = applyCountdownFromClock(now);
      if (snap.state === 'playing') {
        if (SCENE.firstPerson) {
          snapFirstPersonCamera(_fpLook);
        } else {
          cameraFacing.set(0, 0, -1);
          cameraDesired.copy(selfMesh.position);
          cameraDesired.addScaledVector(cameraFacing, -camState.distance);
          cameraDesired.y = Math.max(SCENE.cameraFollowHeight, 7);
          ctx.camera.position.copy(cameraDesired);
          ctx.camera.lookAt(selfMesh.position.x, selfMesh.position.y + 1.5, selfMesh.position.z);
        }
        camState.yaw = 0;
        camState.yawTarget = 0;
      }
      const introElapsed = effectiveElapsedMs(
        now,
        gameStartedAt,
        countdownPausedAt,
        countdownPausedAccumMs,
      );
      const introT = Math.min(1, introElapsed / (introDuration * 1000));
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

      if (SCENE.firstPerson) {
        snapFirstPersonCamera(cameraFacing);
      } else {
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
      }

      player.update(dt);
      syncNetwork();
      return;
    }

    if (paused) {
      return;
    }
    // 2026-08-15: 라운드 종료 후 — 입력/물리 정지
    if (roundState === 'ended') {
      // 연막 지속 중 라운드가 끝나면 안개가 결과 화면에 남지 않도록 정리
      smokeFog.classList.remove('on');
      // 2026-08-25: 신규 아이템 효과도 라운드 종료와 함께 정리
      if (invisLeft > 0) setSelfHidden(false);
      magnetLeft = 0;
      shieldLeft = 0;
      reversalLeft = 0;
      rocketLeft = 0;
      invisLeft = 0;
      decoyLeft = 0;
      removeDecoy();
      magnetVisual.visible = false;
      shieldVisual.visible = false;
      taggerAI?.setInverted(false);
      // 2026-08-25: 원격 이펙트도 라운드 종료와 함께 정리
      remoteFogLeft = 0;
      remoteShieldLeft = 0;
      remoteShieldBubble.visible = false;
      remoteShieldTarget = null;
      if (remoteInvisId) {
        const hiddenBot = bots.find((b) => b.kind === 'remote' && b.id === remoteInvisId);
        if (hiddenBot) hiddenBot.mesh.visible = true;
        remoteInvisId = '';
      }
      return;
    }

    // 2026-08-15: 라운드 타이머 (playing 중)
    if (roundState === 'playing') {
      // v34: 시작 4초간 역할별 조작 힌트 (그레이스 끝나고 잠깐 더 표시)
      if (roundTime < GAME.roundSeconds - 0.5) {
        const elapsed = GAME.roundSeconds - roundTime;
        if (elapsed < 4.5) {
          const tipText = isTagger
            ? 'WASD 이동 · F 그물 · Space 부스터 · Shift 대시'
            : 'WASD 이동 · F 술래 동결 · Shift 대시 · (자국: 가까이 가면 자동 흡수)';
          showActionPrompt(tipText, '🎮', '#2a1a4a');
        }
      }
      // 2026-08-15: 그레이스 시간 감소 (술래 동결)
      if (graceTimeLeft > 0) {
        graceTimeLeft -= dt;
        if (graceTimeLeft <= 0) {
          graceTimeLeft = 0;
          if (taggerAI && taggerStunLeft <= 0 && !ice.isActive()) taggerAI.setFrozen(false);
        }
      }

      // 2026-08-15 v4 → 2026-08-25: 액션 프롬프트 — 자국 흡수는 자동이므로 제거
      // - 도망자: 얼림 사거리 내 (F) — 자국 흡수는 자동
      // - 술래: 그물 사거리 내 / 부스터 준비
      if (!isTagger) {
        if (ice.isReady() && taggerMesh !== selfMesh) {
          const dist = distVecToTagger();
          if (dist <= GAME.iceRange) {
            showActionPrompt('술래 동결', 'F', '#66e0ff');
          }
        }
      } else if (isTagger) {
        if (!shotState.active && !shotState.zone && shotState.cooldownLeft <= 0) {
          const nearRunner = bots.find((b) => {
            if (b.out || b.role !== 'runner') return false;
            const dx = b.mesh.position.x - selfMesh.position.x;
            const dz = b.mesh.position.z - selfMesh.position.z;
            return Math.hypot(dx, dz) <= GAME.shotRange;
          });
          if (nearRunner) {
            const isAimingNow = isAiming;
            showActionPrompt(
              isAimingNow ? '조준 중 — 떼면 그물' : '그물 던지기',
              isAimingNow ? 'F' : 'F·클릭',
              '#ffe14a',
            );
          }
        }
        // 부스터 준비
        if (boost && !boost.isStalling() && boost.getCooldownRemaining() <= 0) {
          showActionPrompt('부스터', 'Space', '#ffb000');
        }
      }

      roundTime -= dt;
      // 2026-08-25: 서버 lastLeftSec 보정 — 클라 시계가 RAF/탭 백그라운드 등으로
      // drift하면 서버 권위 값으로 즉시 동기화. 1초 이상 차이날 때만 보정해
      // Math.ceil 특성상 매 프레임 미세 흔들림은 무시. 솔로는 lastLeftSec=-1 유지.
      if (net && net.lastLeftSec >= 0) {
        const drift = roundTime - net.lastLeftSec;
        if (drift > 1 || drift < -1) roundTime = net.lastLeftSec;
      }
      if (roundTime <= 0) {
        roundTime = 0;
        checkTrailWin();
        return;
      }
    }

    if (!game.out) {
      // 2026-08-25: 자동 흡수 — 자국 반경 내 진입 시 자동으로 흡수 시작 (E 키/탭 불필요)
      // - 흡수 중 매 프레임: 자국 위에 있는지 확인 + progress 갱신
      // - 흡수 중 아닐 때 inTrail 이면 AbsorbSystem.update() 가 내부에서 tryStart() 호출
      // - OUT된 도망자는 흡수 차단 — 자국에 닿아도 score가 오르면 다른 동료가
      //   잡힌 동안 혼자 승리 가능. 살리기 broadcast 도착 전까지 out 유지.
      // 2026-08-25: 카운트다운 중 흡수 차단 — roundState === 'playing'일 때만.
      // 카운트다운 중 흡수 시 즉시 score +1 broadcast → 서버가 TRAIL_GOAL 도달하면
      // 게임 시작 전 endRoom race. 또한 카운트다운 중에는 자국이 다른 사람 것도
      // 합쳐져서 자기 표시 점수가 일관성 깨질 수 있음.
      if (absorb && !isTagger && !game.out && roundState === 'playing') {
        const query = trails.queryNearest(selfMesh.position, GAME.absorbRadius);
        if (query.hit && query.position) {
          absorb.setLastTrailPosition(query.position.x, query.position.z);
          absorb.setStrengthConsumed(query.strength);
        }
        const absorbEvent = absorb.update(dt, query.hit, ice.isActive() || player.isFrozen());
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

      // 2026-08-25: 살리기 버튼 활성/비활성 갱신 — 가까이 살릴 수 있는 OUT 동료가
      // 있으면 활성화, 없으면 비활성. 매 프레임 평가(피클로 가벼움). 폴링 비용이
      // 신경 쓰이면 50ms setInterval로 throttle 가능. pickReviveTarget은 OUT + 거리
      // 둘 다 필터하므로 aliveRunner + 거리 < reviveRange 동시 만족 = 가능.
      // 자국 부족/마지막 10초는 click 시 explainReviveDenyIfApplicable가 거절하므로
      // 여기서는 "타겟이 있냐"만 보고 버튼 enable.
      if (reviveBtn && !reviveHoldActive && roundState === 'playing') {
        const canRevive = pickReviveTarget() !== null;
        if (canRevive && reviveBtn.disabled) reviveBtn.disabled = false;
        else if (!canRevive && !reviveBtn.disabled) reviveBtn.disabled = true;
      }

      // 2026-08-25: 살리기 홀드 진행 — R/버튼 누르고 있는 동안 progress 증가
      // 거리/대상 out 변경 시 즉시 취소. 1.0 도달 시 1회만 sendRevive (서버가 권한 검증)
      if (reviveHoldActive && reviveHoldTarget && net) {
        const cur = net.peers.get(reviveHoldTarget.id);
        const stillOut = cur && cur.role === 'runner' && cur.out;
        const dx = (cur?.x ?? reviveHoldTarget.x) - selfMesh.position.x;
        const dz = (cur?.z ?? reviveHoldTarget.z) - selfMesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (!stillOut || dist > GAME.reviveRange) {
          // 타겟 변경 / 거리 초과 → 취소
          reviveHoldActive = false;
          reviveHoldTarget = null;
          reviveHoldProgress = 0;
          if (reviveBtn) reviveBtn.classList.remove('holding');
          if (reviveBarFill) reviveBarFill.style.width = '0%';
          if (reviveStatus) reviveStatus.textContent = '동료 가까이서 홀드';
        } else {
          reviveHoldProgress += dt / GAME.reviveHoldSeconds;
          if (reviveBarFill)
            reviveBarFill.style.width = `${Math.min(100, reviveHoldProgress * 100)}%`;
          if (reviveHoldProgress >= 1) {
            // 1.5초 채움 — 서버에 1회만 요청
            reviveHoldProgress = 1;
            const targetId = reviveHoldTarget.id;
            reviveHoldActive = false;
            reviveHoldTarget = null;
            if (reviveBtn) reviveBtn.classList.remove('holding');
            if (reviveBarFill) reviveBarFill.style.width = '0%';
            if (reviveStatus) reviveStatus.textContent = '살리는 중...';
            // 2026-08-25: 클라 측 cooldown 기록 — 같은 대상 재시도 사전 차단용.
            // 서버가 거절해도 무관 (서버 권위), 짧은 UX 손실 방지.
            clientLastReviveAt.set(targetId, Date.now());
            // 2026-08-25: 즉시 점수 차감 표시 — 서버 broadcast('score')는
            // 다음 peers tick(80ms+)에 합류. 살리는 쪽 HUD가 즉시 -3 반영.
            // syncNetwork (50ms)이 서버 값으로 reconcile하므로 stale은 안전.
            if (net) {
              net.score = Math.max(0, net.score - GAME.reviveTrailCost);
              paintTrailScore();
            }
            net.sendRevive?.(targetId);
            sound.playAbsorbCancel(); // 살리기 시도 = 약간의 SFX 피드백
          }
        }
      }

      // 2026-08-15: 슬로모 (OUT 시) — 게임 상태만 슬로우, 시각 효과는 정상
      const effectiveDt = slowmoActive ? dt * SLOWMO_FACTOR : dt;
      if (SCENE.firstPerson && lookStick) {
        const axes = lookStick.getAxes();
        if (axes.yaw !== 0) {
          player.addYaw(firstPersonYawFromLookAxes(axes.yaw, effectiveDt));
        }
      }
      player.update(effectiveDt);
      syncNetwork();

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
      // 2026-08-26: 술래는 아이템 픽업/사용 안 함 — 모든 아이템이 도망자 전용.
      // (사용자 피드백: "술래가 자석 먹으면 바로 죽어, 이 아이템은 술래에게 필요없어요")
      // 2026-08-26: classic 모드는 아이템 없음 — 픽업 시도 안 함
      if (roundState === 'playing' && !game.out && !isTagger && gameMode !== 'classic') {
        const got = itemField.tryPickup(selfMesh.position.x, selfMesh.position.z);
        if (got) {
          paintItemSlot();
          sound.playAbsorbStart();
        }
      }
      itemField.update(effectiveDt);
      if (jellyLeft > 0) jellyLeft = Math.max(0, jellyLeft - effectiveDt);
      if (smokeLeft > 0) {
        smokeLeft = Math.max(0, smokeLeft - effectiveDt);
        smokeCloud.visible = true;
        smokeCloud.position.set(selfMesh.position.x, 0, selfMesh.position.z);
        for (const puff of smokePuffs) {
          const ang = puff.phase + t * 1.3;
          const bob = 0.55 + Math.abs(Math.sin(t * 2.2 + puff.phase)) * 0.7;
          puff.mesh.position.set(
            Math.cos(ang) * puff.orbit,
            bob,
            Math.sin(ang * 0.85) * puff.orbit,
          );
          const s = 1.1 + 0.25 * Math.sin(t * 3 + puff.phase);
          puff.mesh.scale.setScalar(s);
          const mat = puff.mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.4 + puff.phase));
        }
        if (smokeLeft <= 0) {
          smokeCloud.visible = false;
          smokeFog.classList.remove('on');
          setSelfHidden(false);
          chasePrey = undefined;
          for (const bot of bots) {
            bot.taggerAI?.breakChase(selfMesh.position);
            bot.taggerAI?.setChaseEnabled(true);
          }
          taggerStunLeft = GAME.itemSmokeForgetSeconds;
          taggerAI?.setFrozen(true);
        }
      }
      // 2026-08-25: 신규 아이템 프레임 갱신
      if (magnetLeft > 0) {
        magnetLeft = Math.max(0, magnetLeft - effectiveDt);
        magnetVisual.position.set(selfMesh.position.x, 0.08, selfMesh.position.z);
        magnetVisual.scale.setScalar(1 + Math.sin(t * 5) * 0.04);
        const take = magnetTakeCount(GAME.itemMagnetMaxAbsorb - magnetAbsorbed, 2);
        for (let i = 0; i < take; i++) {
          if (trails.consumeNearest(selfMesh.position, GAME.itemMagnetRadius) > 0) {
            addTrailScore(1);
            magnetAbsorbed += 1;
          } else break;
        }
        if (magnetLeft <= 0) magnetVisual.visible = false;
      }
      if (shieldLeft > 0) {
        shieldLeft = Math.max(0, shieldLeft - effectiveDt);
        shieldVisual.position.copy(selfMesh.position);
        if (shieldLeft <= 0) shieldVisual.visible = false;
      }
      if (reversalLeft > 0) {
        reversalLeft = Math.max(0, reversalLeft - effectiveDt);
        if (reversalLeft <= 0) taggerAI?.setInverted(false);
      }
      if (rocketLeft > 0) rocketLeft = Math.max(0, rocketLeft - effectiveDt);
      if (invisLeft > 0) {
        invisLeft = Math.max(0, invisLeft - effectiveDt);
        if (invisLeft <= 0) setSelfHidden(false);
      }
      if (decoyLeft > 0) {
        decoyLeft = Math.max(0, decoyLeft - effectiveDt);
        if (decoyMesh.visible && decoyDir.lengthSq() > 1e-4) {
          const resolved = moveCircle(
            decoyMesh.position.x,
            decoyMesh.position.z,
            decoyDir.x * GAME.itemDecoySpeed * effectiveDt,
            decoyDir.z * GAME.itemDecoySpeed * effectiveDt,
            0.45,
            mapObstacles,
            { halfWidth: mapHalfW, halfDepth: mapHalfD },
          );
          decoyMesh.position.x = resolved.x;
          decoyMesh.position.z = resolved.z;
          decoyMesh.position.y = 0.7 + Math.abs(Math.sin(t * 4)) * 0.12;
          decoyMesh.rotation.y += effectiveDt * 2;
        }
        if (decoyLeft <= 0) removeDecoy();
      }
      // 2026-08-25: 원격 아이템 이펙트 갱신
      if (remoteFogLeft > 0) {
        remoteFogLeft = Math.max(0, remoteFogLeft - effectiveDt);
        if (remoteFogLeft <= 0) smokeFog.classList.remove('on');
      }
      if (remoteShieldLeft > 0) {
        remoteShieldLeft = Math.max(0, remoteShieldLeft - effectiveDt);
        if (remoteShieldTarget) remoteShieldBubble.position.copy(remoteShieldTarget.mesh.position);
        if (remoteShieldLeft <= 0) {
          remoteShieldBubble.visible = false;
          remoteShieldTarget = null;
        }
      }
      if (remoteInvisId && performance.now() > remoteInvisUntil) {
        const hiddenBot = bots.find((b) => b.kind === 'remote' && b.id === remoteInvisId);
        if (hiddenBot) hiddenBot.mesh.visible = true;
        remoteInvisId = '';
      }
      if (burstT >= 0) {
        burstT += effectiveDt;
        burstMesh.scale.setScalar(1 + burstT * 6);
        (burstMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0,
          0.7 * (1 - burstT / 0.6),
        );
        if (burstT > 0.6) {
          (burstMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          burstT = -1;
        }
      }
      // 2026-08-25: 점수 배치 플러시
      if (pendingNetScore > 0 && performance.now() - lastScoreSentAt > 300) {
        net?.sendScore(pendingNetScore);
        pendingNetScore = 0;
        lastScoreSentAt = performance.now();
      }
      const playerSlow = itemField.isInSticky(selfMesh.position.x, selfMesh.position.z);
      // 2026-08-25: 속도 우선순위 — 끈끈이 < 젤리 < 로켓(2배)
      player.setExtraSpeedMul(
        playerSlow
          ? GAME.itemStickySlowMul
          : rocketLeft > 0
            ? GAME.itemRocketSpeedMul
            : jellyLeft > 0
              ? GAME.itemJellySpeedMul
              : 1,
      );
      preyPointsScratch.length = 0;
      // 2026-08-25: 투명 아이템 — AI 술래 타겟 후보에서 제외 (몸은 반투명 렌더)
      if (!isTagger && !game.out && invisLeft <= 0) {
        preyPointsScratch.push({
          x: selfMesh.position.x,
          z: selfMesh.position.z,
          mesh: selfMesh,
          isPlayer: true,
        });
      }
      for (const bot of bots) {
        if (bot.out || bot.role !== 'runner') continue;
        preyPointsScratch.push({
          x: bot.mesh.position.x,
          z: bot.mesh.position.z,
          mesh: bot.mesh,
          isPlayer: false,
        });
      }
      // 2026-08-25: 분신 — AI 술래의 추격 후보에 가짜 분신 포함
      if (decoyLeft > 0 && decoyMesh.visible) {
        preyPointsScratch.push({
          x: decoyMesh.position.x,
          z: decoyMesh.position.z,
          mesh: decoyMesh,
          isPlayer: false,
        });
      }
      if (taggerStunLeft > 0) {
        taggerStunLeft = Math.max(0, taggerStunLeft - effectiveDt);
        if (taggerStunLeft <= 0 && graceTimeLeft <= 0 && !ice.isActive())
          taggerAI?.setFrozen(false);
      }
      if (taggerAI && smokeLeft <= 0 && decoyLeft > 0 && decoyMesh.visible) {
        // 2026-08-25: 분신 활성 — AI 술래는 무조건 분신만 쫓는다
        taggerAI.setTarget(decoyMesh);
        taggerAI.setChaseEnabled(true);
        chasePrey = {
          x: decoyMesh.position.x,
          z: decoyMesh.position.z,
          mesh: decoyMesh,
          isPlayer: false,
        };
      } else if (taggerAI && smokeLeft <= 0) {
        const locked = chasePrey;
        const currentPrey = locked
          ? preyPointsScratch.find((p) => p.mesh === locked.mesh)
          : undefined;
        const sticky = pickStickyPoint(
          taggerMesh.position.x,
          taggerMesh.position.z,
          preyPointsScratch,
          currentPrey,
          GAME.taggerChaseSwitchMargin,
        );
        const distToSticky = sticky
          ? Math.hypot(sticky.x - taggerMesh.position.x, sticky.z - taggerMesh.position.z)
          : Infinity;
        const acquire = currentPrey
          ? distToSticky <= GAME.taggerLoseRange
          : distToSticky <= GAME.taggerDetectRange;
        if (sticky && acquire) {
          chasePrey = sticky;
          taggerAI.setTarget(sticky.mesh);
        } else {
          chasePrey = undefined;
          taggerAI.setTarget(undefined);
        }
      } else if (taggerAI && smokeLeft > 0) {
        chasePrey = undefined;
        taggerAI.setTarget(undefined);
      }
      for (const bot of bots) {
        if (bot.out) continue;
        const slow = itemField.isInSticky(bot.mesh.position.x, bot.mesh.position.z);
        bot.taggerAI?.setExtraSpeedMul(slow ? GAME.itemStickySlowMul : 1);
        bot.runnerAI?.setExtraSpeedMul(slow ? GAME.itemStickySlowMul : 1);
        if (roundState === 'playing' && graceTimeLeft <= 0 && taggerStunLeft <= 0)
          bot.taggerAI?.update(effectiveDt);
        bot.runnerAI?.update(effectiveDt);
      }
      if (
        !isTagger &&
        taggerAI &&
        roundState === 'playing' &&
        !game.out &&
        graceTimeLeft <= 0 &&
        !ice.blocksCatch() &&
        smokeLeft <= 0
      ) {
        const hits = contactsInRange(
          taggerMesh.position.x,
          taggerMesh.position.z,
          preyPointsScratch,
          GAME.taggerContactDistance,
        );
        const playerHit = hits.find((p) => p.isPlayer);
        const liveHumans = matchEntry === 'room' && (net?.players.length ?? 0) >= 2;
        // 2026-08-25: 분신 포착 — 술래가 분신을 잡으면 분신 소멸 + 술래 잠깐 멍함
        const decoyHit =
          decoyLeft > 0 && decoyMesh.visible ? hits.find((p) => p.mesh === decoyMesh) : undefined;
        if (decoyHit) {
          decoyLeft = 0;
          removeDecoy();
          taggerStunLeft = Math.max(taggerStunLeft, 1.2);
          taggerAI?.setFrozen(true);
          triggerShake(0.2);
          sound.playAbsorbCancel();
        }
        if (liveHumans && isTagger) {
          for (const prey of hits) {
            const hitBot = bots.find((b) => b.mesh === prey.mesh);
            if (hitBot?.kind === 'remote' && !hitBot.out) net?.sendCatch(hitBot.id);
          }
        }
        if (playerHit) {
          if (shieldLeft > 0) {
            // 2026-08-25: 방어막 — 잡힘 1회 무효 + 술래 반대 방향으로 넉백
            shieldLeft = 0;
            shieldVisual.visible = false;
            const away = headingAway(
              selfMesh.position.x,
              selfMesh.position.z,
              taggerMesh.position.x,
              taggerMesh.position.z,
            );
            if (away) {
              const pushed = moveCircle(
                selfMesh.position.x,
                selfMesh.position.z,
                away.x * 4,
                away.z * 4,
                0.45,
                mapObstacles,
                { halfWidth: mapHalfW, halfDepth: mapHalfD },
              );
              selfMesh.position.x = pushed.x;
              selfMesh.position.z = pushed.z;
            }
            triggerShake(0.3);
            sound.playBoost();
          } else if (absorb && absorb.isCurrentlyInvulnerable()) {
            // 2026-08-25: isInvulnerable는 1회용 boolean만 봄. 부활 후 1초 무적은
            // setInvulnerableUntilMs로 시간 기반이므로 isCurrentlyInvulnerable로 확인.
            absorb.consumeInvulnerability();
            triggerShake(0.3);
            sound.playBoost();
          } else if (!liveHumans) {
            sound.playOut();
            roundStats.outCount += 1;
            eliminateSelf('술래에게 잡혔습니다');
          }
        } else if (taggerStunLeft <= 0 && !liveHumans) {
          let tagged = false;
          for (const prey of hits) {
            const hitBot = bots.find((b) => b.mesh === prey.mesh);
            if (!hitBot || hitBot.out) continue;
            hitBot.out = true;
            hitBot.material.transparent = true;
            hitBot.material.opacity = 0.3;
            hitBot.mesh.scale.set(0.6, 0.4, 0.6);
            roundStats.outCount += 1;
            tagged = true;
            if (dust) dust.burst(hitBot.mesh.position, 20, 1.0, 2.0, 2.5, 0.6);
          }
          if (tagged) {
            sound.playOut();
            triggerShake(0.35);
            taggerStunLeft = GAME.taggerCatchStunSeconds;
            chasePrey = undefined;
            taggerAI?.setFrozen(true);
            taggerAI?.setTarget(undefined);
            const alive =
              (!isTagger && !game.out ? 1 : 0) +
              bots.filter((b) => b.role === 'runner' && !b.out).length;
            if (alive === 0) showResult('tagger', '도망자를 모두 잡았습니다');
          }
        }
      }
      if (boost) boost.update(effectiveDt);
      trails.update(effectiveDt, t);
      ice.update(effectiveDt);
      if (roundState === 'playing' && !game.out) {
        const botAbsorbHold = botTrailAbsorbHoldSeconds(
          GAME.absorbSeconds,
          GAME.absorbCooldownSeconds,
        );
        for (const bot of bots) {
          if (!botShouldAbsorbTrails(bot.kind, bot.role, bot.out)) continue;
          const onTrail = trails.queryNearest(bot.mesh.position, 1.5).hit;
          if (onTrail) {
            bot.absorbHold += effectiveDt;
            if (bot.absorbHold >= botAbsorbHold) {
              trails.consumeNearest(bot.mesh.position, 1.5);
              bot.absorbHold = 0;
              addTrailScore(1);
            }
          } else {
            bot.absorbHold = 0;
          }
        }
      }

      // === v33: 캐릭터 간 충돌 분리 — 떨림/합체 방지 ===
      // - 두 메시(자기/AI)가 가까이 붙으면 서로 밀어냄 (충돌 반경 = 반지름 합)
      // - 한쪽이 frozen이면 안 움직임 (얼려진 도망자는 못 밀어냄 — 잡힘)
      // - 부스터 중에는 살짝 더 강한 분리 (관성 표현)
      if (!game.out) {
        const selfR = !isTagger ? 0.4 : 0.6;
        for (const bot of bots) {
          if (bot.out) continue;
          const dx = selfMesh.position.x - bot.mesh.position.x;
          const dz = selfMesh.position.z - bot.mesh.position.z;
          const distSq = dx * dx + dz * dz;
          const minDist = PLAYER.radius * 2 + 0.15;
          if (distSq < minDist * minDist && distSq > 1e-6) {
            const dist = Math.sqrt(distSq);
            const overlap = minDist - dist;
            const nx = dx / dist;
            const nz = dz / dist;
            const selfFrozen = player.isFrozen() || ice.isActive() || slowmoActive;
            if (!selfFrozen) {
              selfMesh.position.x += nx * overlap * 0.5;
              selfMesh.position.z += nz * overlap * 0.5;
            }
            bot.mesh.position.x -= nx * overlap * 0.5;
            bot.mesh.position.z -= nz * overlap * 0.5;
            const aiR = bot.role === 'tagger' ? 0.5 : 0.4;
            const selfFree = moveCircle(
              selfMesh.position.x,
              selfMesh.position.z,
              0,
              0,
              selfR,
              mapObstacles,
              { halfWidth: mapHalfW, halfDepth: mapHalfD },
            );
            selfMesh.position.x = selfFree.x;
            selfMesh.position.z = selfFree.z;
            const aiFree = moveCircle(
              bot.mesh.position.x,
              bot.mesh.position.z,
              0,
              0,
              aiR,
              mapObstacles,
              { halfWidth: mapHalfW, halfDepth: mapHalfD },
            );
            bot.mesh.position.x = aiFree.x;
            bot.mesh.position.z = aiFree.z;
          }
        }
      }

      if (shotState.cooldownLeft > 0) shotState.cooldownLeft -= dt;
      if (shotState.active && shotState.mesh) {
        const move = GAME.shotSpeed * dt;
        shotState.traveled += move;
        shotState.mesh.position.addScaledVector(shotState.direction, move);
        const flightT = Math.min(1, shotState.traveled / GAME.shotRange);
        shotState.mesh.position.y = THREE.MathUtils.lerp(shotState.originY, 0.12, flightT);
        const radius = currentNetRadius();
        shotState.mesh.scale.setScalar(radius);
        shotState.mesh.rotation.y += dt * 5;
        const hit = isTagger
          ? tryNetCatchAt(shotState.mesh.position.x, shotState.mesh.position.z, radius)
          : false;
        if (hit) {
          disposeShot();
        } else if (shotState.traveled >= GAME.shotRange) {
          dropNetZone(shotState.mesh.position.x, shotState.mesh.position.z, radius);
        }
      }
      if (shotState.zone) {
        shotState.zone.timeLeft -= dt;
        const pulse = 1 + 0.06 * Math.sin(t * 14);
        shotState.zone.mesh.scale.setScalar(shotState.zone.radius * pulse);
        shotState.zone.mesh.rotation.y += dt * 2.4;
        if (isTagger) tryNetCatchAt(shotState.zone.x, shotState.zone.z, shotState.zone.radius);
        if (shotState.zone.timeLeft <= 0) disposeNetZone();
      }

      if (isTagger && shotChargeGroup) {
        const canFire = shotCanFire();
        const charge = shotCharge01();
        shotChargeGroup.visible = !canFire && roundState === 'playing' && !game.out;
        if (shotChargeGroup.visible) {
          shotChargeGroup.position.copy(selfMesh.position);
          shotChargeGroup.position.y = 0.12;
          shotChargeGroup.scale.setScalar(0.45 + charge * 0.95);
          shotChargeGroup.rotation.y += dt * (2.2 + charge * 4);
          shotChargeGroup.traverse((child) => {
            if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
            const mat = child.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
            if (mat && 'opacity' in mat) mat.opacity = 0.22 + charge * 0.7;
          });
        }
      }

      // === OUT 판정 (구버전 — 2026-08-15 v6: 포박줄로 대체되어 제거) ===
    } else {
      trails.update(dt, t);
      if (shotChargeGroup) shotChargeGroup.visible = false;
    }

    // 자국 개수 HUD
    if (game.statusTimer) {
      const trailCount = trails.getActiveCount();
      if (trailCount !== lastTrailCount) {
        lastTrailCount = trailCount;
        game.statusTimer.textContent = String(trailCount);
      }
    }

    // 2026-08-15 v4: 라운드 타이머 HUD — 큰 글씨 + 색상 그라데이션 (best practice: 시각적 계층)
    if (roundTimerEl) {
      const mm = Math.floor(roundTime / 60);
      const ss = Math.floor(roundTime % 60)
        .toString()
        .padStart(2, '0');
      const timeStr = `${mm}:${ss}`;
      // 색상: green (safe) → yellow (warning) → red (critical) → flashing
      const state =
        roundTime < 10 ? 'flash' : roundTime < 30 ? 'critical' : roundTime < 60 ? 'warn' : '';
      if (timeStr !== lastTimerText || state !== lastTimerState) {
        lastTimerText = timeStr;
        lastTimerState = state;
        roundTimerEl.textContent = timeStr;
        roundTimerEl.classList.remove('warn', 'critical', 'flash');
        if (state) roundTimerEl.classList.add(state);
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

    if (shotBar && shotFill && shotStatus) {
      const charge = shotCharge01();
      if (shotState.active) {
        shotFill.style.width = `${charge * 100}%`;
        shotFill.classList.remove('critical');
        shotStatus.textContent = '그물 비행';
        shotStatus.className = 'boost-status boosting';
      } else if (shotState.zone) {
        shotFill.style.width = `${charge * 100}%`;
        shotStatus.textContent = '그물 펼침';
        shotStatus.className = 'boost-status boosting';
      } else if (!shotCanFire()) {
        shotFill.style.width = `${charge * 100}%`;
        shotStatus.textContent = `충전 ${shotState.cooldownLeft.toFixed(1)}s`;
        shotStatus.className = 'boost-status cooldown';
      } else {
        shotFill.style.width = '100%';
        shotStatus.textContent = '준비 (F / 클릭)';
        shotStatus.className = 'boost-status ready';
      }
    }
    if (shotFireBtn) {
      const charge = shotCharge01();
      const canFire = shotCanFire();
      shotFireBtn.style.setProperty('--shot-ready', `${Math.round(charge * 100)}`);
      shotFireBtn.classList.toggle('cooling', !canFire);
      shotFireBtn.disabled = !canFire || roundState !== 'playing' || game.out;
      if (shotFireHint) {
        shotFireHint.textContent = canFire
          ? '그물'
          : `${Math.max(0, shotState.cooldownLeft).toFixed(1)}`;
      }
      if (canFire && !shotChargeReady) {
        shotFireBtn.classList.remove('ready-pop');
        void shotFireBtn.offsetWidth;
        shotFireBtn.classList.add('ready-pop');
      }
      shotChargeReady = canFire;
    }
    if (debugStatus && debug.style.display !== 'none') {
      // v5 디버그: 자기 위치 + 입력 상태 (캔버스에 키가 들어오는지 즉시 확인)
      const inp = player.getDebugInput();
      const px = selfMesh.position.x;
      const pz = selfMesh.position.z;
      const dirArrow =
        (inp.forward > 0 ? '↑' : inp.forward < 0 ? '↓' : '·') +
        (inp.right > 0 ? '→' : inp.right < 0 ? '←' : '·');
      const frozenTag = player.isFrozen() ? ' [얼림]' : '';
      const debugText = `(${px.toFixed(1)}, ${pz.toFixed(1)}) 입력 ${dirArrow}${frozenTag}`;
      if (debugText !== lastDebugStatus) {
        lastDebugStatus = debugText;
        debugStatus.textContent = debugText;
      }
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
        const near = ice.inRange(distVecToTagger());
        iceBtn.classList.remove('frozen', 'cooldown');
        iceBtn.classList.toggle('ready', near);
        iceBtn.disabled = false;
        iceBtn.querySelector('.ice-btn-label')!.textContent = near ? '얼림' : '멀다';
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
        absorbLabel.textContent = mobileMode
          ? `${(absorb.getProgress() * 100).toFixed(0)}%`
          : `흡수 중... (${(absorb.getProgress() * 100).toFixed(0)}%)`;
      } else if (absorb && absorb.getBoostRemaining() > 0) {
        absorbProgress.style.width = `${(absorb.getBoostRemaining() / GAME.boostSeconds) * 100}%`;
        absorbHud.classList.add('boost');
        absorbHud.classList.remove('active');
        absorbLabel.textContent = mobileMode
          ? `${absorb.getBoostRemaining().toFixed(0)}s`
          : `가속! ${absorb.getBoostRemaining().toFixed(1)}초`;
      } else if (absorb && absorb.getCooldown() > 0) {
        absorbHud.classList.remove('active', 'boost');
        absorbLabel.textContent = mobileMode
          ? `${absorb.getCooldown().toFixed(0)}s`
          : `재사용 대기 ${absorb.getCooldown().toFixed(1)}초`;
      } else {
        absorbHud.classList.remove('active', 'boost');
        // 2026-08-25: 자동 흡수 — 라벨도 "자국 위에 서세요" 안내로 단순화
        const query = trails.queryNearest(selfMesh.position, GAME.absorbRadius);
        if (query.hit) {
          absorbLabel.textContent = mobileMode ? '흡수 중' : '자국 위에 서면 자동 흡수';
        } else {
          absorbLabel.textContent = mobileMode ? '대기' : '자국 위로 이동하세요';
        }
      }
    }

    if (joystick) joystick.tick();
    if (lookStick && !SCENE.firstPerson) {
      const axes = lookStick.getAxes();
      if (axes.yaw !== 0 || axes.pitch !== 0) {
        const look = lookDeltaFromAxes(axes.yaw, axes.pitch, dt);
        camState.yawTarget = wrapAngle(camState.yawTarget + look.dYaw);
        camState.pitchTarget = Math.max(
          CAM_LIMITS.pitchMin,
          Math.min(CAM_LIMITS.pitchMax, camState.pitchTarget + look.dPitch),
        );
      }
    }

    camState.yaw = wrapAngle(
      camState.yaw + shortestAngle(camState.yaw, camState.yawTarget).delta * CAM_ROT_SMOOTHING,
    );
    camState.pitch += (camState.pitchTarget - camState.pitch) * CAM_ROT_SMOOTHING;

    if (SCENE.firstPerson) {
      // look = face = camera look (local -Z). W/조이스틱 위 = 이 방향.
      snapFirstPersonCamera(cameraFacing);
    } else {
      cameraFacing.set(0, 0, -1);

      if (camState.mode === 'chase' && !mobileMode) {
        const chaseYaw = chaseYawFromMovement(
          selfMesh.position.x - prevPos.x,
          selfMesh.position.z - prevPos.z,
          0.12,
        );
        if (chaseYaw !== null) camState.yawTarget = chaseYaw;
      }

      // 1.5) yaw 회전 (사용자 우클릭 드래그) — 월드 Y축 기준
      if (Math.abs(camState.yaw) > 0.0001) {
        const yawQ = yawQuatTmp.setFromAxisAngle(yawAxis, camState.yaw);
        cameraFacing.applyQuaternion(yawQ);
      }

      // 2) desired camera position: player 뒤 + 거리 + pitch
      cameraDesired.copy(selfMesh.position);
      cameraDesired.addScaledVector(cameraFacing, -camState.distance);
      // 2026-08-26: 카메라 y에 selfMesh.position.y 더하기 — 게임 시작 시 카운트다운
      // (y=7 고정) → playing 전환 시 y가 떨어지던 버그 수정. 캐릭터 머리 위
      // 일관된 거리 유지 (기존 baseFollowY=SCENE.cameraFollowHeight만 쓰면
      // selfMesh가 슬로프/점프할 때 카메라가 따라가지 않음).
      const baseFollowY = selfMesh.position.y + SCENE.cameraFollowHeight;
      const pitchOffset = Math.sin(camState.pitch) * camState.distance * 0.4;
      cameraDesired.y = baseFollowY + pitchOffset;

      // 3) 미세 호흡감
      cameraDesired.x += Math.sin(t * 0.6) * SCENE.cameraFollowShake;
      cameraDesired.y += Math.cos(t * 0.45) * SCENE.cameraFollowShake * 0.6;

      // 4) 2026-08-15: 카메라-장애물 충돌 (벽/박스에 파묻히지 않게)
      // - 카메라 desired 위치에서 캐릭터로 향하는 ray
      // - 사이에 벽/박스 있으면 hit 직전까지만 카메라를 당김
      const camRay = camRayVec.copy(cameraDesired).sub(selfMesh.position);
      camRay.y = 0;
      const camRayDist = camRay.length();
      blockersScratch.length = 0;
      for (const w of mapRefs.walls) blockersScratch.push(w);
      for (const o of mapRefs.obstacles) blockersScratch.push(o);
      if (camRayDist > 0.01) {
        camRay.normalize();
        const camRayOrigin = camRayOriginVec.copy(cameraDesired);
        camRaycaster.set(camRayOrigin, camRay);
        camRaycaster.near = 0;
        camRaycaster.far = camRayDist;
        const hits = camRaycaster.intersectObjects(blockersScratch, false);
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
      const lookRay = lookRayVec.copy(cameraLookAt).sub(ctx.camera.position);
      const lookRayDist = lookRay.length();
      if (lookRayDist > 0.01 && blockersScratch.length > 0) {
        const lookDir = lookRay.normalize();
        lookRaycaster.set(ctx.camera.position, lookDir);
        lookRaycaster.near = 0;
        lookRaycaster.far = lookRayDist;
        const lookHits = lookRaycaster.intersectObjects(blockersScratch, false);
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

      // 5) look at: 플레이어 위쪽 + 정면 살짝 앞
      // 2026-08-15 v2: y += 1.5 → 2.5 — 카메라가 박스 너머를 안 보게 (lookAt 자체를 위로)
      cameraLookAt.copy(selfMesh.position);
      cameraLookAt.y += 2.5;
      cameraLookAt.addScaledVector(cameraFacing, SCENE.cameraFollowLookAhead);
      ctx.camera.lookAt(cameraLookAt);
    }

    // 4.5) 카메라 셰이크 (감쇠 + 무작위 오프셋) — 1인칭은 멀미 줄이려고 강도 ↓
    if (cameraShake > 0) {
      cameraShake = Math.max(0, cameraShake - dt * 3.0);
      const shakeScale = SCENE.firstPerson ? SCENE.firstPersonShakeScale : 1.0;
      const k = cameraShake * 0.5 * shakeScale;
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

    // 6) WASD / 조이스틱 = 카메라-상대
    // - 1인칭: cameraFacing = face/look (getWorldDirection 반전, local -Z)
    // - 3인칭: cameraFacing = (0,0,-1) + camState.yaw
    charForward.copy(cameraFacing);
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
    const markTarget = !isTagger
      ? taggerMesh
      : (bots.find((b) => !b.out && b.role === 'runner')?.mesh ?? taggerMesh);
    targetMarker.position.x = markTarget.position.x;
    targetMarker.position.z = markTarget.position.z;
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

    // 그물 조준선 (F 홀딩)
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
  game.lookStick = lookStick;
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
  game.lookStick?.unmount();
  game.lookStick = null;
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
      // Pass 8.3: renderGame throw 시 setScreen 의 try/catch 가 잡아서
      // 로비로 강제 복귀시킴 — 게임 화면 반쪽짜리 상태 방지
      renderGame();
      break;
  }
}

render();
