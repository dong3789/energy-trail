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

/** @typedef {{ id: string, name: string, char: string, wish: string, x: number, z: number, yaw: number, role: 'tagger'|'runner'|'', out: boolean, ws: import('ws').WebSocket, invulnUntil: number }} Player */
/** @typedef {{ code: string, hostId: string, map: string, phase: 'lobby'|'playing'|'ended', players: Map<string, Player>, roles: Record<string, string>, startedAt: number, score: number, createdAt: number, lastPeersRaw?: string }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<import('ws').WebSocket, { player: Player, room: Room | null }>} */
const sockets = new Map();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = '') {
  const raw = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === 1) p.ws.send(raw);
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
  return { t: 'room', code: room.code, hostId: room.hostId, map: room.map, phase: room.phase, players: publicPlayers(room) };
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
  return `p_${Math.random().toString(36).slice(2, 10)}`;
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
    p.invulnUntil = 0; // 2026-08-25: 라운드 시작 시 무적 없음
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
  for (const p of room.players.values()) {
    p.out = false;
    p.role = '';
    p.invulnUntil = 0; // 2026-08-25: 다음 라운드 위해 무적 초기화
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
  // "나간 술래 승리"로 처리되던 문제 — 술래가 없으면 즉시 도망자 승으로 종료
  if (taggers.length === 0) {
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
  // 2026-08-25: 변경 감지 스킵 — 위치/점수/상태 변화가 없으면 peers 전송 생략 (대역폭·CPU 절감).
  // left는 초 단위로 올림해 1초에 한 번만 갱신 (클라이언트는 left를 사용하지 않음).
  // invulnUntil(epoch ms)을 peers에 포함해 클라이언트가 무적 상태 표시/판정에 사용.
  const payload = JSON.stringify({
    t: 'peers',
    list: [...room.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      out: p.out,
      role: p.role,
      invulnUntil: p.invulnUntil || 0,
    })),
    score: room.score,
    left: Math.ceil(left),
  });
  if (payload !== room.lastPeersRaw) {
    room.lastPeersRaw = payload;
    for (const p of room.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(payload);
    }
  }
}

function leave(ws) {
  const slot = sockets.get(ws);
  if (!slot) return;
  sockets.delete(ws);
  const { player, room } = slot;
  if (!room) return;
  room.players.delete(player.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (player.id === room.hostId) {
    room.hostId = [...room.players.keys()][0];
  }
  broadcast(room, roomPayload(room));
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
  };
  sockets.set(ws, { player, room: null });
  send(ws, { t: 'welcome', id: player.id });

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
      if (typeof msg.name === 'string' && msg.name.trim()) player.name = msg.name.trim().slice(0, 12);
      if (typeof msg.char === 'string') player.char = msg.char;
      if (typeof msg.wish === 'string') player.wish = msg.wish;
      if (typeof msg.map === 'string' && slot.room && slot.room.hostId === player.id) {
        slot.room.map = msg.map;
        broadcast(slot.room, roomPayload(slot.room));
      }
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
        phase: 'lobby',
        players: new Map([[player.id, player]]),
        roles: {},
        startedAt: 0,
        score: 0,
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      slot.room = room;
      send(ws, roomPayload(room));
      return;
    }
    if (t === 'join') {
      const code = String(msg.code || '').replace(/\D/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room || room.phase !== 'lobby') {
        send(ws, { t: 'err', msg: '대기 중인 방을 찾지 못했어요. 방장이 대기실에 있는지 확인해 주세요.' });
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
    if (t === 'map' && typeof msg.map === 'string' && room.hostId === player.id && room.phase === 'lobby') {
      room.map = msg.map;
      broadcast(room, roomPayload(room));
      return;
    }
    if (t === 'start' && room.hostId === player.id && (room.phase === 'lobby' || room.phase === 'ended')) {
      room.roles = assignRoles([...room.players.values()]);
      for (const p of room.players.values()) {
        p.role = room.roles[p.id];
        p.out = false;
        p.invulnUntil = 0;
      }
      room.phase = 'playing';
      room.startedAt = Date.now();
      room.score = 0;
      const spawns = placePlayers(room);
      broadcast(room, {
        t: 'start',
        roles: room.roles,
        map: room.map,
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
    if (t === 'score' && room.phase === 'playing' && player.role === 'runner' && !player.out) {
      room.score += 1;
      broadcast(room, { t: 'score', n: room.score });
      if (room.score >= TRAIL_GOAL) endRoom(room, 'runner', `자국 ${TRAIL_GOAL}개 수집`);
      return;
    }
    if (t === 'catch' && room.phase === 'playing' && player.role === 'tagger') {
      const target = room.players.get(String(msg.id || ''));
      if (target && target.role === 'runner' && !target.out && dist(player, target) <= CATCH_DIST + 2) {
        target.out = true;
        broadcast(room, { t: 'caught', id: target.id });
      }
      return;
    }
    // 2026-08-25: 동료 살리기 — 자국 3개를 써서 OUT된 사람 도망자를 가장자리로 부활
    if (t === 'revive' && REVIVE_ENABLED && room.phase === 'playing' && player.role === 'runner' && !player.out) {
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
  for (const [code, room] of rooms) {
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
