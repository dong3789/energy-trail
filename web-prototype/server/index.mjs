import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8791);
const TICK_MS = 80;
const ROUND_SECONDS = 75;
const TRAIL_GOAL = 8;
const CATCH_DIST = 1.65;
const MAX_PLAYERS = 5;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

/** @typedef {{ id: string, name: string, char: string, wish: string, x: number, z: number, yaw: number, role: 'tagger'|'runner'|'', out: boolean, ws: import('ws').WebSocket }} Player */
/** @typedef {{ code: string, hostId: string, map: string, phase: 'lobby'|'playing'|'ended', players: Map<string, Player>, roles: Record<string, string>, startedAt: number, score: number, createdAt: number }} Room */

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
  return String(Date.now() % 9000).padStart(4, '0');
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

function resetRoomToLobby(room) {
  room.phase = 'lobby';
  room.score = 0;
  room.startedAt = 0;
  room.roles = {};
  for (const p of room.players.values()) {
    p.out = false;
    p.role = '';
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
  const runners = [...room.players.values()].filter((p) => p.role === 'runner' && !p.out);
  // 2026-08-25: 술래가 매치 중 이탈하면 라운드가 끝나지 않고 타이머 만료 뒤
  // "나간 술래 승리"로 처리되던 문제 — 술래가 없으면 즉시 도망자 승으로 종료
  if (taggers.length === 0) {
    endRoom(room, 'runner', '술래가 방을 나갔습니다');
    return;
  }
  if (runners.length === 0 && taggers.length > 0) {
    endRoom(room, 'tagger', '도망자를 모두 잡았습니다');
    return;
  }
  for (const tag of taggers) {
    for (const run of runners) {
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
  broadcast(room, {
    t: 'peers',
    list: [...room.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      out: p.out,
      role: p.role,
    })),
    score: room.score,
    left,
  });
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
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS && room.phase === 'lobby') {
      rooms.delete(code);
      continue;
    }
    if (room.phase === 'playing') tickPlaying(room);
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
