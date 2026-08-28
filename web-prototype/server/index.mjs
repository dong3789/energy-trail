import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8791);
const TICK_MS = 80;
const ROUND_SECONDS = 75;
const TRAIL_GOAL = 8;
const CATCH_DIST = 1.65;
const MAX_PLAYERS = 5;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

// 2026-08-25: 동료 살리기 (Revive) — 기획안 자국-동료살리기-밸런스
// - 승리용 자국을 깎아서 살리면 밸런스 안 깨진다
// - 시체 위치가 아닌 가장자리 → 술래 위에 던지지 않게
const REVIVE_ENABLED = true;
const REVIVE_TRAIL_COST = 3;
const REVIVE_NO_LAST_SECONDS = 10.0; // 남은 시간 ≤ 10초면 불가
const REVIVE_RANGE = 3.5; // 살리는 쪽 → 시체까지 최대 거리
const REVIVE_INVULNERABLE_SECONDS = 1.0; // 부활 후 무적
const REVIVE_EDGE_MARGIN = 3.0; // 가장자리 스폰 마진
const REVIVE_COOLDOWN_MS = 8000; // 2026-08-25: 같은 대상 재살리기 cooldown — 자국 3개 가치(≈8초)에 맞춰 서버 권위 가드
const SHIELD_MS = 8000; // 2026-08-25: 방어막 지속시간(클라 itemShieldDuration과 일치) — 서버 권위 catch 차단용
const ICE_RANGE = 8; // config.ts GAME.iceRange
const ICE_DURATION_MS = 2400; // GAME.iceDuration
const ICE_COOLDOWN_MS = 10000; // GAME.iceCooldown
const SCORE_MIN_INTERVAL_MS = 250; // 2026-08-25: 점수 연타 제한 — 배치 전송 클라이언트 기준
const SCORE_MAX_ADD = 10; // 2026-08-25: 한 메시지당 최대 가점 (배치 n 클램프)
// 2026-08-28: 세션 토큰 + 방 유지
// - RESUME_TTL_MS: 마지막 연결 끊김 후 이 시간 안이면 세션 복원 (같은 신원/방장/좌석)
// - EMPTY_ROOM_GRACE_MS: 플레이어가 모두 나간 뒤 방을 즉시 삭제하지 않고 유지 —
//   모바일 네트워크 블립으로 대기실이 증발하는 문제 방지
const RESUME_TTL_MS = Number(process.env.RESUME_TTL_MS || 5 * 60 * 1000);
const EMPTY_ROOM_GRACE_MS = Number(process.env.EMPTY_ROOM_GRACE_MS || 60 * 1000);

// 2026-08-25: 네트워크 시뮬레이션 (테스트/검증용) — 모바일 LTE/WiFi 전환의 가짜 재현
// - SIM_LATENCY_MS: 평균 지연 (ms). 0이면 비활성
// - SIM_JITTER_MS: ±분산 (ms). SIM_LATENCY_MS ±SIM_JITTER_MS 범위의 랜덤 지연
// - SIM_DROP_RATE: 0~1 사이 확률로 peers 메시지 완전 손실
// - peers 메시지에만 적용 — start/use/caught/score 같은 룰 메시지는 즉시 전송되어야 게임성 유지
// - 프로덕션에서는 절대 켜지 말 것 (모든 환경변수 기본값 0)
const SIM_LATENCY_MS = Number(process.env.SIM_LATENCY_MS || 0);
const SIM_JITTER_MS = Number(process.env.SIM_JITTER_MS || 0);
const SIM_DROP_RATE = Number(process.env.SIM_DROP_RATE || 0);
if (SIM_LATENCY_MS > 0 || SIM_JITTER_MS > 0 || SIM_DROP_RATE > 0) {
  console.log(
    `[sim] latency=${SIM_LATENCY_MS}ms ±${SIM_JITTER_MS}ms, drop=${(SIM_DROP_RATE * 100).toFixed(1)}%`,
  );
}
const MAP_WIDTH = 42; // config.ts의 MAP.width 와 일치
const MAP_DEPTH = 42;
const TAGGER_WIN_OUT_COUNT = 2; // 동시 다운 2명이면 술래 승 (기획안)

// 2026-08-25: 전역 예외 핸들러 — 단일 런타임 에러로 프로세스가 죽으면
// 활성 매치의 모든 유저가 일제히 끊긴다. 에러를 기록하고 서버를 유지한다.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

/** @typedef {{ id: string, name: string, char: string, wish: string, x: number, z: number, yaw: number, role: 'tagger'|'runner'|'', out: boolean, ws: import('ws').WebSocket, invulnUntil: number, shieldUntil?: number, lastScoreAt?: number, prevX?: number, prevZ?: number, vx?: number, vz?: number, token?: string, lastSeenAt?: number, roomId?: string }} Player */
/** @typedef {{ code: string, hostId: string, map: string, mode: string, phase: 'lobby'|'playing'|'ended', players: Map<string, Player>, roles: Record<string, string>, startedAt: number, score: number, createdAt: number, lastPeersRaw?: string, lastReviveAt: Map<string, number>, emptySince?: number }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<import('ws').WebSocket, { player: Player, room: Room | null }>} */
const sockets = new Map();
/** 2026-08-28: 세션 토큰 → { playerId, roomCode, expiresAt }. 연결 끊긴 플레이어의 좌석을 짧게 보존해 resume 한다. */
const sessions = new Map();

function genToken() {
  // 2026-08-28: 보안 강화 — Math.random()은 암호학적 안전성 없음. 토큰이 세션 신원+방장 권한을
  // 부여하므로 crypto.randomUUID() 기반 128비트 엔트로피로 교체. resume 핸들러의 40자 슬라이스
  // 한도 내 (현재 토큰 길이: s_ + 32 hex = 34자).
  return `s_${crypto.randomUUID().replace(/-/g, '')}`;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = '') {
  const raw = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    // 2026-08-28: ws가 null인 보존 좌석(resume 대기)은 건너뜀
    if (p.ws && p.ws.readyState === 1) p.ws.send(raw);
  }
}

/**
 * 2026-08-25: peers 메시지 전용 broadcast (네트워크 시뮬레이션 적용)
 * - SIM_DROP_RATE 확률로 완전 손실
 * - SIM_LATENCY_MS ± SIM_JITTER_MS 만큼 setTimeout으로 지연
 * - 룰 메시지(start/use/caught/score)는 즉시 전송 — 게임성 유지
 * - 비활성(모든 SIM_* 0)이면 기존 broadcast와 동일
 */
function broadcastPeersWithSim(room, payload) {
  if (SIM_LATENCY_MS === 0 && SIM_JITTER_MS === 0 && SIM_DROP_RATE === 0) {
    // 2026-08-25: 비활성 — 오버헤드 없이 즉시 broadcast
    for (const p of room.players.values()) {
      // 2026-08-28: ws가 null인 보존 좌석(resume 대기)은 건너뜀
      if (p.ws && p.ws.readyState === 1) p.ws.send(payload);
    }
    return;
  }
  for (const p of room.players.values()) {
    if (!p.ws || p.ws.readyState !== 1) continue;
    if (SIM_DROP_RATE > 0 && Math.random() < SIM_DROP_RATE) continue;
    const jitter = SIM_JITTER_MS > 0 ? (Math.random() * 2 - 1) * SIM_JITTER_MS : 0;
    const delay = Math.max(0, SIM_LATENCY_MS + jitter);
    if (delay === 0) {
      p.ws.send(payload);
    } else {
      setTimeout(() => {
        if (p.ws.readyState === 1) p.ws.send(payload);
      }, delay);
    }
  }
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    char: p.char,
    wish: p.wish,
    host: p.id === room.hostId,
    role: p.role || undefined,
    out: p.out,
  }));
}

function roomPayload(room) {
  return {
    t: 'room',
    code: room.code,
    hostId: room.hostId,
    map: room.map,
    mode: room.mode,
    phase: room.phase,
    players: publicPlayers(room),
  };
}

function genCode() {
  for (let i = 0; i < 20; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  // 2026-08-25: 기존 fallback(Date.now() % 9000)은 진행 중인 방 코드와 겹쳐
  // rooms.set이 그 방을 덮어써 유저들이 튕겼다. 미사용 코드를 전수 탐색해 충돌을 원천 차단.
  for (let c = 1000; c < 10000; c++) {
    if (!rooms.has(String(c))) return String(c);
  }
  return '';
}

function genId() {
  // 2026-08-28: genToken과 동일 패턴 — Math.random() → crypto.randomUUID().
  // player.id는 게임 세션 내 식별자이지만, 같은 함수 패밀리 일관성과 충돌 안전성 강화 차원에서 함께 정리.
  return `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function placePlayers(room) {
  const taggerAt = { x: 12, z: 12 };
  const runners = [
    { x: -12, z: -4 },
    { x: -10, z: 10 },
    { x: 10, z: -10 },
    { x: 0, z: -14 },
  ];
  let i = 0;
  /** @type {Record<string, { x: number, z: number }>} */
  const spawns = {};
  for (const p of room.players.values()) {
    const pos = p.role === 'tagger' ? taggerAt : runners[i++ % runners.length];
    p.x = pos.x;
    p.z = pos.z;
    p.yaw = 0;
    p.invulnUntil = 0;
    p.shieldUntil = 0; // 2026-08-25: 라운드 시작 시 무적 없음
    p.frozenUntil = 0;
    // 2026-08-25: 동기화용 prev/v 초기화 — 라운드 시작 시 점프 안 나게 velocity 0
    p.prevX = p.x;
    p.prevZ = p.z;
    p.vx = 0;
    p.vz = 0;
    spawns[p.id] = { x: p.x, z: p.z };
  }
  return spawns;
}

function assignRoles(players) {
  const list = [...players];
  const hopefuls = list.filter((p) => p.wish === 'tagger');
  const notRunner = list.filter((p) => p.wish !== 'runner');
  const pool = hopefuls.length ? hopefuls : notRunner.length ? notRunner : list;
  const tagger = pool[Math.floor(Math.random() * pool.length)];
  /** @type {Record<string, 'tagger'|'runner'>} */
  const roles = {};
  for (const p of list) roles[p.id] = p.id === tagger.id ? 'tagger' : 'runner';
  return roles;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** 2026-08-25: 가장자리 스폰 좌표 선택 — 시체가 아닌 가장자리 (살리는 쪽과 같은 변 우선) */
function pickEdgeSpawn(targetX, targetZ, helperX, helperZ) {
  const halfW = MAP_WIDTH / 2;
  const halfD = MAP_DEPTH / 2;
  const refX = helperX ?? targetX;
  const refZ = helperZ ?? targetZ;
  const dLeft = Math.abs(refX - -halfW);
  const dRight = Math.abs(refX - halfW);
  const dTop = Math.abs(refZ - -halfD);
  const dBottom = Math.abs(refZ - halfD);
  const m = REVIVE_EDGE_MARGIN;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { x: -halfW + m, z: clamp(refZ, -halfD + m, halfD - m) };
  if (min === dRight) return { x: halfW - m, z: clamp(refZ, -halfD + m, halfD - m) };
  if (min === dTop) return { x: clamp(refX, -halfW + m, halfW - m), z: -halfD + m };
  return { x: clamp(refX, -halfW + m, halfW - m), z: halfD - m };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** 2026-08-25: 술래 승 — 동시 다운 카운트 */
function taggerWinsByOutCount(downCount) {
  return downCount >= TAGGER_WIN_OUT_COUNT;
}

function resetRoomToLobby(room) {
  room.phase = 'lobby';
  room.score = 0;
  room.startedAt = 0;
  room.roles = {};
  room.lastReviveAt.clear(); // 2026-08-25: 다음 라운드를 위해 cooldown 리셋
  for (const p of room.players.values()) {
    p.out = false;
    p.role = '';
    p.invulnUntil = 0;
    p.shieldUntil = 0; // 2026-08-25: 다음 라운드 위해 무적 초기화
    p.frozenUntil = 0;
    // 2026-08-25: 동기화용 prev/v 리셋 — 다음 라운드 첫 tick에서 잘못된 Δ거리로 점프 방지
    p.prevX = p.x;
    p.prevZ = p.z;
    p.vx = 0;
    p.vz = 0;
  }
  broadcast(room, roomPayload(room));
}

function endRoom(room, winner, reason) {
  if (room.phase !== 'playing') return;
  room.phase = 'ended';
  broadcast(room, { t: 'end', winner, reason, score: room.score });
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.phase !== 'ended') return;
    resetRoomToLobby(room);
  }, 800);
}

function tickPlaying(room) {
  const now = Date.now();
  const elapsed = (now - room.startedAt) / 1000;
  const left = ROUND_SECONDS - elapsed;
  if (left <= 0) {
    endRoom(room, 'tagger', `자국 ${room.score}/${TRAIL_GOAL}`);
    return;
  }
  if (room.score >= TRAIL_GOAL) {
    endRoom(room, 'runner', `자국 ${TRAIL_GOAL}개 수집`);
    return;
  }
  const taggers = [...room.players.values()].filter((p) => p.role === 'tagger' && !p.out);
  const runners = [...room.players.values()].filter((p) => p.role === 'runner');
  // 2026-08-25: 술래가 매치 중 이탈하면 라운드가 끝나지 않고 타이머 만료 뒤
  // "나간 술래 승리"로 처리되던 문제 — 술래가 없으면 즉시 도망자 승으로 종료.
  // 2026-08-28: 단, 술래 좌석이 보존 중(ws=null, resume 대기)이면 RESUME_TTL 동안
  // 종료를 유보한다 — 순간 네트워크 블립으로 매치가 무효화되는 것 방지.
  // 좌석 정리(tick)가 RESUME_TTL 경과 후 좌석을 지우면 그때 자연 종료된다.
  const taggerLive = taggers.some((p) => p.ws !== null);
  const taggerPreserved = [...room.players.values()].some(
    (p) => p.role === 'tagger' && p.ws === null,
  );
  if (taggers.length === 0 || (!taggerLive && !taggerPreserved)) {
    endRoom(room, 'runner', '술래가 방을 나갔습니다');
    return;
  }
  const aliveRunners = runners.filter((p) => !p.out);
  if (aliveRunners.length === 0 && taggers.length > 0) {
    endRoom(room, 'tagger', '도망자를 모두 잡았습니다');
    return;
  }
  // 2026-08-25: 동시 다운 승리 — 살리기 도입으로 "한 명이라도 잡히면 끝"이 깨질 수 있어
  // TAGGER_WIN_OUT_COUNT(2) 명 동시 OUT면 즉시 술래 승
  const downCount = runners.filter((p) => p.out).length;
  if (taggerWinsByOutCount(downCount)) {
    endRoom(room, 'tagger', `도망자 ${downCount}명 동시 다운`);
    return;
  }
  for (const tag of taggers) {
    for (const run of aliveRunners) {
      // 2026-08-25: 부활 무적 (reviveInvulnerabilitySeconds) 적용
      if (run.invulnUntil > now) continue;
      // 2026-08-25: 방어막 서버 권위 — 잡힘 1회 무효 + 소모, 클라에 차단 브로드캐스트
      if (run.shieldUntil && run.shieldUntil > now) {
        broadcast(room, { t: 'shieldblock', id: run.id });
        continue;
      }
      if (tag.frozenUntil && tag.frozenUntil > now) continue;
      if (dist(tag, run) <= CATCH_DIST) {
        run.out = true;
        broadcast(room, { t: 'caught', id: run.id });
      }
    }
  }
  const still = [...room.players.values()].filter((p) => p.role === 'runner' && !p.out);
  if (still.length === 0) {
    endRoom(room, 'tagger', '도망자를 모두 잡았습니다');
    return;
  }
  // 2026-08-25: 위치 속도 계산 — 클라 보간/외삽이 정확한 Δ거리/dt로 부드러운 동기화 가능
  // 직전(prevX, prevZ)과 현재(x, z)의 차이를 직전 tick과의 Δt로 나누어 m/s 환산.
  // 첫 tick(prevX === x)이면 0 유지. Δt가 0에 가까우면 안전하게 0으로 fallback.
  // 2026-08-25: 첫 tick(lastTickAt 없음)은 velocity 계산 스킵 — now - 0 = 거대 dtSec이 되어
  // 1m 이동도 0.001 m/s처럼 보임. prev만 동기화하고 vx/vz는 0 유지.
  const lastTickAt = room.lastTickAt;
  if (lastTickAt) {
    const dtMs = Math.max(1, now - lastTickAt);
    const dtSec = dtMs / 1000;
    for (const p of room.players.values()) {
      const dx = p.x - p.prevX;
      const dz = p.z - p.prevZ;
      p.vx = dx / dtSec;
      p.vz = dz / dtSec;
      p.prevX = p.x;
      p.prevZ = p.z;
    }
  } else {
    // 2026-08-25: 첫 tick — prev를 현재로 동기화, vx/vz는 0 (placePlayers에서 이미 0이지만 명시)
    for (const p of room.players.values()) {
      p.prevX = p.x;
      p.prevZ = p.z;
      p.vx = 0;
      p.vz = 0;
    }
  }
  room.lastTickAt = now;
  // 2026-08-25: 변경 감지 스킵 — 위치/점수/상태 변화가 없으면 peers 전송 생략 (대역폭·CPU 절감).
  // left는 초 단위로 올림해 1초에 한 번만 갱신 (클라이언트는 left를 사용하지 않음).
  // invulnUntil(epoch ms)을 peers에 포함해 클라이언트가 무적 상태 표시/판정에 사용.
  // t(epoch ms) + vx/vz로 클라 보간/외삽의 기준을 제공 — "이 위치는 now 시점, 속도는 (vx,vz) m/s".
  // 2026-08-25: row에도 ts 명시 — 클라가 row.ts를 직접 사용 가능 (상위 msg.ts fallback도 유지)
  const payload = JSON.stringify({
    t: 'peers',
    ts: now,
    list: [...room.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      out: p.out,
      role: p.role,
      invulnUntil: p.invulnUntil || 0,
      vx: p.vx || 0,
      vz: p.vz || 0,
      ts: now,
    })),
    score: room.score,
    left: Math.ceil(left),
  });
  if (payload !== room.lastPeersRaw) {
    room.lastPeersRaw = payload;
    broadcastPeersWithSim(room, payload);
  }
}

function leave(ws) {
  const slot = sockets.get(ws);
  if (!slot) return;
  sockets.delete(ws);
  const { player, room } = slot;
  if (!room) return;
  // 2026-08-28: 즉시 삭제 대신 세션 보존 — 같은 토큰으로 resume 하면
  // 같은 id/방장 여부로 복귀. TTL 지나면 tick에서 정리.
  player.ws = null;
  player.lastSeenAt = Date.now();
  if (player.token) {
    sessions.set(player.token, {
      playerId: player.id,
      roomCode: room.code,
      expiresAt: player.lastSeenAt + RESUME_TTL_MS,
    });
  }
  if ([...room.players.values()].some((p) => p.ws !== null)) {
    room.emptySince = undefined;
    broadcast(room, roomPayload(room));
    return;
  }
  // 모두 연결 끊김 — 좌석은 keep, 방은 grace 후 삭제 (tick)
  if (room.emptySince === undefined) room.emptySince = Date.now();
}

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('energy-trail-ws');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  const player = {
    id: genId(),
    name: '손님',
    char: 'runner-cyan',
    wish: 'random',
    x: 0,
    z: 0,
    yaw: 0,
    role: '',
    out: false,
    ws,
    prevX: 0,
    prevZ: 0,
    vx: 0,
    vz: 0,
    token: genToken(),
    lastSeenAt: Date.now(),
  };
  sockets.set(ws, { player, room: null });
  // 2026-08-28: welcome에 token 포함 — 클라는 저장했다가 resume 때 사용
  send(ws, { t: 'welcome', id: player.id, token: player.token });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const slot = sockets.get(ws);
    if (!slot) return;
    const { t } = msg;
    if (t === 'hello') {
      if (typeof msg.name === 'string' && msg.name.trim())
        player.name = msg.name.trim().slice(0, 12);
      if (typeof msg.char === 'string') player.char = msg.char;
      if (typeof msg.wish === 'string') player.wish = msg.wish;
      if (typeof msg.map === 'string' && slot.room && slot.room.hostId === player.id) {
        slot.room.map = msg.map;
        broadcast(slot.room, roomPayload(slot.room));
      }
      return;
    }
    if (t === 'resume') {
      // 2026-08-28: 세션 복원 — 끊긴 연결의 같은 플레이어(id/방장/좌석)로 복귀.
      // hello로 닉네임 등을 갱신한 뒤 보내는 것을 권장 (클라가 그 순서로 보냄).
      if (slot.room) return;
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 40) : '';
      const session = sessions.get(token);
      if (!session || session.expiresAt <= Date.now()) {
        sessions.delete(token);
        send(ws, { t: 'resumeDenied' });
        return;
      }
      const room = rooms.get(session.roomCode);
      const seat = room?.players.get(session.playerId);
      if (!room || !seat || seat.ws !== null) {
        // 좌석이 이미 사라졌거나 다른 라이브 연결이 좌석을 사용 중
        sessions.delete(token);
        send(ws, { t: 'resumeDenied' });
        return;
      }
      sessions.delete(token);
      seat.ws = ws;
      player.token = token; // leave()에서 같은 토큰으로 다시 보존
      sockets.set(ws, { player: seat, room });
      send(ws, roomPayload(room));
      broadcast(room, roomPayload(room));
      return;
    }
    if (t === 'create') {
      if (slot.room) return;
      const code = genCode();
      if (!code) {
        send(ws, { t: 'err', msg: '서버가 가득 찼어요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      /** @type {Room} */
      const room = {
        code,
        hostId: player.id,
        map: typeof msg.map === 'string' ? msg.map : 'park',
        mode: 'items',
        phase: 'lobby',
        players: new Map([[player.id, player]]),
        roles: {},
        startedAt: 0,
        score: 0,
        createdAt: Date.now(),
        lastReviveAt: new Map(), // 2026-08-25: targetId → 마지막 부활 시각 (ms)
      };
      rooms.set(code, room);
      slot.room = room;
      send(ws, roomPayload(room));
      return;
    }
    if (t === 'join') {
      const code = String(msg.code || '')
        .replace(/\D/g, '')
        .slice(0, 4);
      const room = rooms.get(code);
      // 2026-08-28: 'ended'도 join 허용 — 종료 → 대기실 전환(800ms) 사이 재접속이
      // 에러로 떨어져 방을 잃는 문제 방지. ended 방은 resetRoomToLobby가 곧 lobby로 복귀시킴.
      if (!room || (room.phase !== 'lobby' && room.phase !== 'ended')) {
        send(ws, {
          t: 'err',
          msg: '대기 중인 방을 찾지 못했어요. 방장이 대기실에 있는지 확인해 주세요.',
        });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { t: 'err', msg: '방이 가득 찼어요.' });
        return;
      }
      room.players.set(player.id, player);
      slot.room = room;
      broadcast(room, roomPayload(room));
      return;
    }
    const room = slot.room;
    if (!room) return;
    if (t === 'wish' && typeof msg.wish === 'string') {
      player.wish = msg.wish;
      broadcast(room, roomPayload(room));
      return;
    }
    if (t === 'char' && typeof msg.char === 'string') {
      player.char = msg.char;
      broadcast(room, roomPayload(room));
      return;
    }
    if (
      t === 'map' &&
      typeof msg.map === 'string' &&
      room.hostId === player.id &&
      room.phase === 'lobby'
    ) {
      room.map = msg.map;
      broadcast(room, roomPayload(room));
      return;
    }
    // 2026-08-25: 게임 모드 — items(아이템 배틀) / classic(체급 대결). 호스트만 변경.
    if (
      t === 'mode' &&
      typeof msg.mode === 'string' &&
      room.hostId === player.id &&
      room.phase === 'lobby'
    ) {
      room.mode = msg.mode === 'classic' ? 'classic' : 'items';
      broadcast(room, roomPayload(room));
      return;
    }
    if (
      t === 'start' &&
      room.hostId === player.id &&
      (room.phase === 'lobby' || room.phase === 'ended')
    ) {
      room.roles = assignRoles([...room.players.values()]);
      for (const p of room.players.values()) {
        p.role = room.roles[p.id];
        p.out = false;
        p.invulnUntil = 0;
        p.shieldUntil = 0;
        p.frozenUntil = 0;
      }
      room.phase = 'playing';
      room.startedAt = Date.now();
      room.score = 0;
      const spawns = placePlayers(room);
      broadcast(room, {
        t: 'start',
        roles: room.roles,
        map: room.map,
        mode: room.mode,
        players: publicPlayers(room),
        spawns,
        roundSeconds: ROUND_SECONDS,
        trailGoal: TRAIL_GOAL,
        // 2026-08-25: 서버 epoch ms — 클라 카운트다운/left가 서버 시간 기준으로
        // 동작하도록 기준점 제공. 네트워크 지연으로 클라 Date.now()와 차이 날 수 있어
        // 서버가 권위 있는 시작 시각을 통보.
        roundStartedAt: room.startedAt,
      });
      return;
    }
    if (t === 'pos' && room.phase === 'playing') {
      if (typeof msg.x === 'number') player.x = msg.x;
      if (typeof msg.z === 'number') player.z = msg.z;
      if (typeof msg.yaw === 'number') player.yaw = msg.yaw;
      return;
    }
    if (
      t === 'score' &&
      room.phase === 'playing' &&
      player.role === 'runner' &&
      !player.out &&
      typeof msg.n === 'number' &&
      Number.isFinite(msg.n)
    ) {
      // 2026-08-25: 레이트 리밋 + 클램프 — 연타 점수 폭주 차단 (자석 배치 전송은 250ms 간격으로 통과)
      const nowScore = Date.now();
      if (nowScore - (player.lastScoreAt || 0) < SCORE_MIN_INTERVAL_MS) return;
      player.lastScoreAt = nowScore;
      const add = Math.max(1, Math.min(SCORE_MAX_ADD, Math.floor(msg.n)));
      room.score += add;
      broadcast(room, { t: 'score', n: room.score });
      if (room.score >= TRAIL_GOAL) endRoom(room, 'runner', `자국 ${TRAIL_GOAL}개 수집`);
      return;
    }
    // 2026-08-25: 아이템 사용 릴레이 — 다른 플레이어 화면에도 이펙트가 보이도록 (400ms 레이트 리밋)
    // 2026-08-26: ITEM_KINDS 화이트리스트로 kind 검증 (서버 권위 화이트리스트)
    // 10종(jelly, smoke, sticky, decoy, magnet, shield, dash, reversal, rocket, invis)
    const ALLOWED_ITEM_KINDS = new Set([
      'jelly',
      'smoke',
      'sticky',
      'decoy',
      'magnet',
      'shield',
      'dash',
      'reversal',
      'rocket',
      'invis',
    ]);
    if (t === 'use' && room.phase === 'playing' && player.role === 'runner' && !player.out) {
      // 2026-08-26: classic 모드는 아이템 없음 — use 시도 무시.
      // 모드는 items / classic (위 'mode' 핸들러에서 정규화).
      if (room.mode === 'classic') return;
      // 2026-08-28: kind 한 번만 슬라이스해 kind/kindUse 중복 제거 — 화이트리스트 검사·shield 가드·broadcast 모두 같은 값을 본다.
      const kind = String(msg.kind || '').slice(0, 12);
      // kind가 화이트리스트에 없거나 빈 문자열이면 무시 (silent)
      if (!ALLOWED_ITEM_KINDS.has(kind)) return;
      const nowUse = Date.now();
      if (nowUse - (player.lastUseAt || 0) < 400) return;
      player.lastUseAt = nowUse;
      // 2026-08-25: 방어막 — 서버 권위 추적 (catch 판정에서 차단에 사용)
      if (kind === 'shield') {
        player.shieldUntil = nowUse + SHIELD_MS;
      }
      broadcast(room, { t: 'use', id: player.id, kind }, player.id);
      return;
    }
    if (t === 'ice' && room.phase === 'playing' && player.role === 'runner' && !player.out) {
      const nowIce = Date.now();
      if (nowIce - (player.lastIceAt || 0) < ICE_COOLDOWN_MS) return;
      let tagger = null;
      for (const p of room.players.values()) {
        if (p.role === 'tagger') {
          tagger = p;
          break;
        }
      }
      if (!tagger) return;
      if (dist(player, tagger) > ICE_RANGE + 2) return;
      player.lastIceAt = nowIce;
      tagger.frozenUntil = nowIce + ICE_DURATION_MS;
      broadcast(room, { t: 'ice', id: player.id, until: tagger.frozenUntil });
      return;
    }
    if (t === 'catch' && room.phase === 'playing' && player.role === 'tagger') {
      if (player.frozenUntil && player.frozenUntil > Date.now()) return;
      const target = room.players.get(String(msg.id || ''));
      if (
        target &&
        target.role === 'runner' &&
        !target.out &&
        dist(player, target) <= CATCH_DIST + 2
      ) {
        // 2026-08-25: 방어막 서버 권위 — 메시지 캐치도 차단 + 소모
if (target.shieldUntil && target.shieldUntil > Date.now()) {
      broadcast(room, { t: 'shieldblock', id: target.id });
      return;
    }
        target.out = true;
        broadcast(room, { t: 'caught', id: target.id });
      }
      return;
    }
    // 2026-08-25: 동료 살리기 — 자국 3개를 써서 OUT된 사람 도망자를 가장자리로 부활
    if (
      t === 'revive' &&
      REVIVE_ENABLED &&
      room.phase === 'playing' &&
      player.role === 'runner' &&
      !player.out
    ) {
      const target = room.players.get(String(msg.id || ''));
      // 가드: 대상은 OUT된 사람 도망자만 (AI는 부활 안 함)
      if (!target) {
        send(ws, { t: 'reviveDenied', reason: 'no_target' });
        return;
      }
      if (target.role !== 'runner' || !target.out) {
        send(ws, { t: 'reviveDenied', reason: 'target_not_out' });
        return;
      }
      // AI 구별: 이름이 'AI-'로 시작하면 봇 (config.ts RunnerAIStub 패턴과 동일)
      if (target.id.startsWith('ai_') || target.name.startsWith('AI')) {
        send(ws, { t: 'reviveDenied', reason: 'target_is_ai' });
        return;
      }
      // 거리 가드: 살리는 쪽 → 시체(현재 위치)까지 REVIVE_RANGE 이내
      if (dist(player, target) > REVIVE_RANGE) {
        send(ws, { t: 'reviveDenied', reason: 'target_too_far' });
        return;
      }
      // 2026-08-25: 같은 대상 재살리기 cooldown — 자국 3개 가치(≈8초)에 맞춤.
      // 서버 권위: 클라가 빠르게 연타해도 이 가드를 못 넘김.
      const lastReviveAt = room.lastReviveAt.get(target.id);
      if (lastReviveAt && Date.now() - lastReviveAt < REVIVE_COOLDOWN_MS) {
        send(ws, { t: 'reviveDenied', reason: 'cooldown' });
        return;
      }
      // 점수 가드
      if (room.score < REVIVE_TRAIL_COST) {
        send(ws, { t: 'reviveDenied', reason: 'not_enough_trail' });
        return;
      }
      // 시간 가드: 남은 시간 > REVIVE_NO_LAST_SECONDS
      const now = Date.now();
      const left = ROUND_SECONDS - (now - room.startedAt) / 1000;
      if (left <= REVIVE_NO_LAST_SECONDS) {
        send(ws, { t: 'reviveDenied', reason: 'too_late' });
        return;
      }
      // 모든 가드 통과 — 부활 실행
      room.score -= REVIVE_TRAIL_COST;
      const edge = pickEdgeSpawn(target.x, target.z, player.x, player.z);
      target.x = edge.x;
      target.z = edge.z;
      target.yaw = 0;
      target.out = false;
      target.invulnUntil = now + REVIVE_INVULNERABLE_SECONDS * 1000;
      // 2026-08-25: 같은 대상 재살리기 cooldown 기록 — 다음 살리기 시도가
      // REVIVE_COOLDOWN_MS 이내면 서버가 거부.
      room.lastReviveAt.set(target.id, now);
      broadcast(room, { t: 'score', n: room.score });
      broadcast(room, {
        t: 'revived',
        id: target.id,
        x: target.x,
        z: target.z,
        invulnUntil: target.invulnUntil,
      });
      return;
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
  for (const [code, room] of rooms) {
    // 2026-08-28: 빈 방 grace 종료 — 모든 좌석이 RESUME_TTL 넘게 끊겨 있으면 삭제.
    // playing 중인 방은 30초 유예를 주고, 그 안에 아무도 resume 하지 않으면 종료 처리.
    if (room.emptySince !== undefined && now - room.emptySince > RESUME_TTL_MS) {
      if (room.phase === 'playing') {
        room.emptySince = undefined; // tickPlaying의 남은 시간/이탈 판정에 맡김
      } else {
        rooms.delete(code);
        continue;
      }
    }
    // 좌석 정리 — RESUME_TTL 지난 끊긴 플레이어는 방에서 제거 (방장이면 승계)
    let removed = false;
    for (const p of room.players.values()) {
      if (p.ws === null && p.lastSeenAt !== undefined && now - p.lastSeenAt > RESUME_TTL_MS) {
        room.players.delete(p.id);
        if (p.id === room.hostId) {
          room.hostId = [...room.players.keys()][0] ?? '';
        }
        removed = true;
      }
    }
    if (room.players.size === 0) {
      rooms.delete(code);
      continue;
    }
    if (removed) broadcast(room, roomPayload(room));
    // 2026-08-25: 룸 TTL 처리 — phase가 'lobby'이고 생성 후 2시간 지나면 삭제.
    // rooms.delete 도중에 같은 룸을 tickPlaying가 참조하지 않도록 continue로 분리.
    if (now - room.createdAt > ROOM_TTL_MS && room.phase === 'lobby') {
      rooms.delete(code);
      continue;
    }
    if (room.phase === 'playing') {
      // 2026-08-25: 한 룸의 tick 예외가 다른 룸의 tick과 setInterval 자체를 죽이지 않도록 격리.
      // uncaughtException 핸들러는 있지만 동기 throw를 먼저 잡아 로그 노이즈를 줄이고
      // 다른 활성 매치가 계속 진행되도록 보장.
      try {
        tickPlaying(room);
      } catch (err) {
        console.error('[tick] room', code, 'threw:', err);
      }
    }
  }
}, TICK_MS);

// 2026-08-25: heartbeat — 모바일 네트워크 전환 등으로 반쯤 죽은 연결(좀비 소켓) 정리.
// pong 미응답 소켓은 terminate → close 핸들러가 방/플레이어 정리를 수행.
const HEARTBEAT_MS = 30_000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[energy-trail-ws] :${PORT} /ws`);
});
