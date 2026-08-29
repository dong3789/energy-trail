#!/usr/bin/env node
// 2026-08-28: 방 유지 (세션 토큰 resume) 통합 테스트
// 실행: node test-scripts/room-persistence.cjs (WS_URL 환경변수, 기본 ws://127.0.0.1:8791/ws)
//
// 시나리오:
//   H: welcome이 토큰을 발급하는가
//   I: 연결 끊김 후 resume → 같은 id + 방장 유지 (좌석 복원)
//   J: 모두 끊겨도 방 유지 (grace) → resume로 재합류 + join 폴백 동작
//   K: 잘못된 토큰 → resumeDenied
//   L: resume 후 방장 위임 없음 확인 (구 join은 방장을 잃었었음)
//   M: 끊김 후 join+token → 유령 좌석 회수 (같은 닉이 두 좌석이 되면 안 됨)
//   N: 같은 소켓 join 두 번 → 좌석 추가 없음
//   O: 방장 resume 후 start가 방에 방송되어야 함

const WebSocket = require('ws');
const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8791/ws';
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;

function assert(cond, msg) {
  if (cond) { pass++; log(`  ✓ ${msg}`); }
  else { fail++; log(`  ✗ ${msg}`); }
}

async function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const events = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', name, char: 'runner-cyan', wish: 'random', map: 'park' }));
    });
    ws.on('message', (data) => {
      const ev = JSON.parse(String(data));
      events.push(ev);
      if (ev.t === 'welcome') resolve({ ws, events, name, id: ev.id, token: ev.token || '' });
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitEvent(events, type, since = 0, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.slice(since).find((e) => e.t === type);
      if (found) { clearInterval(timer); resolve(found); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 25);
  });
}

async function scenarioH_welcomeToken() {
  log('\n=== H: welcome 토큰 발급 ===');
  const A = await client('P1');
  assert(typeof A.token === 'string' && A.token.length > 5, `welcome에 토큰 포함 (${A.token.slice(0, 6)}...)`);
  A.ws.close();
}

async function scenarioI_resumeKeepsHost() {
  log('\n=== I: 끊김 → resume → 같은 id + 방장 유지 ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  const roomMsg = await waitEvent(A.events, 'room');
  const code = roomMsg.code;
  const B = await client('P2');
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(200);

  // A 연결 끊김 → 좌석 보존
  const bBefore = B.events.length;
  A.ws.close();
  await sleep(300);
  const bRoomAfterLeave = B.events.slice(bBefore).find((e) => e.t === 'room');
  assert(!!bRoomAfterLeave, 'A 끊김 후 B가 room 갱신 수신');
  assert(bRoomAfterLeave && bRoomAfterLeave.players.some((p) => p.id === A.id), 'A 좌석이 보존됨 (삭제 안 됨)');

  // A가 resume
  const events2 = [];
  const ws2 = new WebSocket(WS_URL);
  await new Promise((res) => ws2.on('open', res));
  ws2.send(JSON.stringify({ t: 'hello', name: 'P1', char: 'runner-cyan', wish: 'random', map: 'park' }));
  ws2.on('message', (d) => events2.push(JSON.parse(String(d))));
  await sleep(150);
  ws2.send(JSON.stringify({ t: 'resume', token: A.token }));
  const resumedRoom = await waitEvent(events2, 'room');
  assert(!!resumedRoom, 'resume 응답 수신');
  assert(resumedRoom && resumedRoom.hostId === A.id, 'resume 후 방장 유지 (hostId 동일)');
  assert(resumedRoom && resumedRoom.players.some((p) => p.id === A.id), '같은 player id로 복원');

  ws2.close(); B.ws.close();
}

async function scenarioJ_emptyRoomGraceAndFallback() {
  log('\n=== J: 전원 끊김 → 방 유지 → resume 재합류 / resumeDenied 폴백 ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  const roomMsg = await waitEvent(A.events, 'room');
  const code = roomMsg.code;
  A.ws.close();
  await sleep(200); // grace(60s) 안이므로 방 유지

  // resume으로 재합류
  const events2 = [];
  const ws2 = new WebSocket(WS_URL);
  await new Promise((res) => ws2.on('open', res));
  ws2.on('message', (d) => events2.push(JSON.parse(String(d))));
  ws2.send(JSON.stringify({ t: 'hello', name: 'P1', char: 'runner-cyan', wish: 'random', map: 'park' }));
  await sleep(150);
  ws2.send(JSON.stringify({ t: 'resume', token: A.token }));
  const back = await waitEvent(events2, 'room');
  assert(!!back && back.code === code, '전원 끊김 후에도 방이 살아있고 resume 재합류 성공');

  // resumeDenied 폴백 — 가짜 토큰
  const events3 = [];
  const ws3 = new WebSocket(WS_URL);
  await new Promise((res) => ws3.on('open', res));
  ws3.on('message', (d) => events3.push(JSON.parse(String(d))));
  ws3.send(JSON.stringify({ t: 'hello', name: 'PX', char: 'runner-cyan', wish: 'random', map: 'park' }));
  await sleep(150);
  ws3.send(JSON.stringify({ t: 'resume', token: 's_nonexistent' }));
  const denied = await waitEvent(events3, 'resumeDenied');
  assert(!!denied, '잘못된 토큰 → resumeDenied');

  ws2.close(); ws3.close();
}

async function scenarioK_resumeTwiceDenied() {
  log('\n=== K: 좌석 독점 + 재블립 재복귀 ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  await waitEvent(A.events, 'room');
  A.ws.close();
  await sleep(200);

  const useToken = async () => {
    const events = [];
    const ws = new WebSocket(WS_URL);
    await new Promise((res) => ws.on('open', res));
    ws.on('message', (d) => events.push(JSON.parse(String(d))));
    ws.send(JSON.stringify({ t: 'hello', name: 'P1', char: 'runner-cyan', wish: 'random', map: 'park' }));
    await sleep(150);
    ws.send(JSON.stringify({ t: 'resume', token: A.token }));
    const room = await waitEvent(events, 'room');
    const denied = await waitEvent(events, 'resumeDenied', 0, 600);
    return { ws, room, denied };
  };
  const first = await useToken();
  assert(!!first.room && !first.denied, '첫 resume 성공');

  // 첫 연결이 살아있는 동안 두 번째 resume은 거부되어야 한다 (좌석 독점)
  const second = await useToken();
  assert(!second.room && !!second.denied, '라이브 연결 존재 시 resume 거부');
  second.ws.close();

  // 첫 연결이 끊긴 뒤엔 같은 토큰으로 재복귀 가능 (재블립 시나리오)
  first.ws.close();
  await sleep(300);
  const third = await useToken();
  assert(!!third.room && !third.denied, `재블립 후 같은 토큰으로 재복귀 성공 (room=${!!third.room}, denied=${!!third.denied})`);
  third.ws.close();
}

async function scenarioM_joinTokenReclaimsGhost() {
  log('\n=== M: 끊김 후 join+token → 유령 좌석 회수 (중복 없음) ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  const roomMsg = await waitEvent(A.events, 'room');
  const code = roomMsg.code;
  const B = await client('P2');
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(200);
  const tokenA = A.token;
  const idA = A.id;
  A.ws.close();
  await sleep(300);

  const events2 = [];
  const ws2 = new WebSocket(WS_URL);
  await new Promise((res) => ws2.on('open', res));
  ws2.on('message', (d) => events2.push(JSON.parse(String(d))));
  await waitEvent(events2, 'welcome');
  ws2.send(JSON.stringify({ t: 'hello', name: 'P1', char: 'runner-cyan', wish: 'random', map: 'park' }));
  ws2.send(JSON.stringify({ t: 'join', code, token: tokenA }));
  const room = await waitEvent(events2, 'room');
  assert(!!room, 'join 응답 수신');
  const n = room && room.players ? room.players.length : -1;
  const names = room && room.players ? room.players.map((p) => p.name).join(',') : '';
  assert(n === 2, `좌석 수 2 (got ${n}: ${names})`);
  assert(room && room.players.some((p) => p.id === idA), '원래 P1 id로 회수');
  assert(room && room.players.filter((p) => p.name === 'P1').length === 1, 'P1 닉 하나');
  ws2.close();
  B.ws.close();
}

async function scenarioO_hostResumeCanStart() {
  log('\n=== O: 방장 resume 후 start가 먹혀야 함 ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  const roomMsg = await waitEvent(A.events, 'room');
  const code = roomMsg.code;
  const B = await client('P2');
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(200);
  const tokenA = A.token;
  A.ws.close();
  await sleep(300);

  const events2 = [];
  const ws2 = new WebSocket(WS_URL);
  await new Promise((res) => ws2.on('open', res));
  ws2.on('message', (d) => events2.push(JSON.parse(String(d))));
  await waitEvent(events2, 'welcome');
  ws2.send(JSON.stringify({ t: 'hello', name: 'P1', char: 'runner-cyan', wish: 'random', map: 'park' }));
  ws2.send(JSON.stringify({ t: 'resume', token: tokenA }));
  const back = await waitEvent(events2, 'room');
  assert(!!back && back.hostId, '방장 resume 후 room 수신');

  const bBefore = B.events.length;
  ws2.send(JSON.stringify({ t: 'start' }));
  const started = await waitEvent(B.events, 'start', bBefore, 2000);
  assert(!!started, '방장 resume 후 start가 방에 방송됨');
  ws2.close();
  B.ws.close();
}

async function scenarioN_doubleJoinSameSocket() {
  log('\n=== N: 같은 소켓 join 두 번 → 좌석 추가 없음 ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  const roomMsg = await waitEvent(A.events, 'room');
  const code = roomMsg.code;
  const B = await client('P2');
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(150);
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(150);
  const lastRoom = [...B.events].reverse().find((e) => e.t === 'room');
  assert(!!lastRoom && lastRoom.players.length === 2, `재join해도 2명 (got ${lastRoom && lastRoom.players.length})`);
  A.ws.close();
  B.ws.close();
}

async function main() {
  log(`WS: ${WS_URL}`);
  try {
    await scenarioH_welcomeToken(); await sleep(300);
    await scenarioI_resumeKeepsHost(); await sleep(300);
    await scenarioJ_emptyRoomGraceAndFallback(); await sleep(300);
    await scenarioK_resumeTwiceDenied(); await sleep(300);
    await scenarioM_joinTokenReclaimsGhost(); await sleep(300);
    await scenarioO_hostResumeCanStart(); await sleep(300);
    await scenarioN_doubleJoinSameSocket();
    log(`\n=== 결과: ${pass} pass, ${fail} fail ===`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    log('FATAL:', err.message);
    process.exit(1);
  }
}

main();
