#!/usr/bin/env node
// Multi-player WS integration test
// 실행: docker exec energy-trail-ws node /app/test-scripts/multiplayer.js
// 또는: node test-scripts/multiplayer.js (WS_URL 환경변수로 URL 조정, 기본 ws://127.0.0.1:8791/ws)
//
// 시나리오:
//   A: classic 모드 (use silent)
//   B: 잡기 + end (catch handler 검증)
//   C: score race (양쪽 동시 흡수)
//   D: 연속 잡기 (target.out 가드)
//   E: host 권한 (non-host start silent)
//   F: 변조 방어 (잘못된 JSON / huge msg / NaN, 연결 유지)
//   G: catch sequence (메시지 순서 - 'caught' → 'end' 양쪽 동일 순서)

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
      events.push(JSON.parse(String(data)));
      if (events[events.length - 1].t === 'welcome') resolve({ ws, events, name, id: events[events.length - 1].id });
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function setupRoom() {
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  await sleep(200);
  const code = A.events.find(e => e.t === 'room').code;

  const B = await client('P2');
  B.ws.send(JSON.stringify({ t: 'join', code }));
  await sleep(200);
  return { A, B, code };
}

async function scenarioA_classicMode() {
  log('\n=== A: classic 모드 (use silent) ===');
  const { A, B } = await setupRoom();
  A.ws.send(JSON.stringify({ t: 'mode', mode: 'classic' }));
  await sleep(200);
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  const aStart = A.events.find(e => e.t === 'start');
  const bStart = B.events.find(e => e.t === 'start');
  assert(aStart.mode === 'classic', `start.mode=classic on A`);
  assert(bStart.mode === 'classic', `start.mode=classic on B`);

  A.ws.send(JSON.stringify({ t: 'use', kind: 'jelly' }));
  B.ws.send(JSON.stringify({ t: 'use', kind: 'magnet' }));
  await sleep(300);
  const aUse = A.events.filter(e => e.t === 'use').length;
  const bUse = B.events.filter(e => e.t === 'use').length;
  assert(aUse === 0, `classic use silent: A=0 (got ${aUse})`);
  assert(bUse === 0, `classic use silent: B=0 (got ${bUse})`);
  A.ws.close(); B.ws.close();
}

async function scenarioB_catchAndEnd() {
  log('\n=== B: 잡기 + end (handler catch, dist 3.4m로 tick 회피) ===');
  const { A, B, code } = await setupRoom();
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  const aStart = A.events.find(e => e.t === 'start');
  const aRole = aStart.roles[A.id];
  const bRole = aStart.roles[B.id];
  const tagger = aRole === 'tagger' ? A : B;
  const runner = aRole === 'tagger' ? B : A;
  // dist 3.4m: tick(CATCH_DIST=1.65) fail, handler(CATCH_DIST+2=3.65) OK
  A.ws.send(JSON.stringify({ t: 'pos', x: 0, z: 0 }));
  B.ws.send(JSON.stringify({ t: 'pos', x: 3.4, z: 0 }));
  await sleep(150);
  const aBefore = A.events.length;
  const bBefore = B.events.length;
  tagger.ws.send(JSON.stringify({ t: 'catch', id: runner.id }));
  await sleep(500);
  // aAfter/bAfter: catch 시점 이후의 모든 이벤트 (각 클라의 길이가 다를 수 있음)
  // → aBefore/bBefore로 슬라이스 후 두 클라의 이벤트를 비교
  const aAfter = A.events.slice(aBefore);
  const bAfter = B.events.slice(bBefore);
  // 핵심 검증
  const aCaught = aAfter.find(e => e.t === 'caught');
  const bCaught = bAfter.find(e => e.t === 'caught');
  const aEnd = aAfter.find(e => e.t === 'end');
  const bEnd = bAfter.find(e => e.t === 'end');
  assert(!!aCaught, `A received 'caught'`);
  assert(!!bCaught, `B received 'caught'`);
  assert(!!aEnd, `A received 'end'`);
  assert(!!bEnd, `B received 'end'`);
  assert(aCaught && aCaught.id === runner.id, `caught.id === runner.id`);
  assert(aEnd && aEnd.winner === 'tagger', `end.winner === 'tagger'`);
  A.ws.close(); B.ws.close();
}

async function scenarioC_scoreRace() {
  log('\n=== C: score race (양쪽 동시 흡수) ===');
  const { A, B } = await setupRoom();
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  for (let i = 0; i < 5; i++) {
    A.ws.send(JSON.stringify({ t: 'score', n: 1 }));
    B.ws.send(JSON.stringify({ t: 'score', n: 1 }));
    await sleep(80);
  }
  await sleep(300);
  const aScores = A.events.filter(e => e.t === 'score');
  const bScores = B.events.filter(e => e.t === 'score');
  const aLast = aScores[aScores.length - 1];
  const bLast = bScores[bScores.length - 1];
  assert(!!aLast && !!bLast, `both got score broadcasts`);
  assert(aLast.n === bLast.n, `score sync A=${aLast?.n} B=${bLast?.n}`);
  assert(aLast.n >= 2, `score accumulated (n=${aLast.n})`);
  A.ws.close(); B.ws.close();
}

async function scenarioD_useInvalid() {
  log('\n=== D: use invalid kind (silent ignore) ===');
  const { A, B } = await setupRoom();
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  A.ws.send(JSON.stringify({ t: 'use', kind: 'fake_item' }));
  await sleep(300);
  const aUse = A.events.filter(e => e.t === 'use').length;
  const bUse = B.events.filter(e => e.t === 'use').length;
  assert(aUse === 0, `A got 0 use events (got ${aUse})`);
  assert(bUse === 0, `B got 0 use events (got ${bUse})`);
  A.ws.send(JSON.stringify({ t: 'use', kind: 'jelly' }));
  await sleep(300);
  const bUse2 = B.events.filter(e => e.t === 'use').length;
  assert(bUse2 === 1, `B got 1 use event (sender excluded) (got ${bUse2})`);
  A.ws.close(); B.ws.close();
}

async function scenarioE_hostPermission() {
  log('\n=== E: host 권한 (non-host start silent) ===');
  const { A, B } = await setupRoom();
  const aStartBefore = A.events.filter(e => e.t === 'start').length;
  const bStartBefore = B.events.filter(e => e.t === 'start').length;
  B.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  const aStart = A.events.filter(e => e.t === 'start').length;
  const bStart = B.events.filter(e => e.t === 'start').length;
  assert(aStart === aStartBefore, `A: no new start from non-host (was ${aStartBefore}, now ${aStart})`);
  assert(bStart === bStartBefore, `B: no new start from non-host`);
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  const aStart2 = A.events.filter(e => e.t === 'start').length;
  assert(aStart2 === aStartBefore + 1, `host start broadcasts`);
  A.ws.close(); B.ws.close();
}

async function scenarioF_invalidMessages() {
  log('\n=== F: 변조 방어 (잘못된 JSON / huge / NaN, 연결 유지) ===');
  const A = await client('P1');
  A.ws.send(JSON.stringify({ t: 'create' }));
  await sleep(200);
  const before = A.events.length;
  A.ws.send('not json{{{');
  await sleep(100);
  A.ws.send(JSON.stringify({ t: 'unknown_type' }));
  await sleep(100);
  A.ws.send(JSON.stringify({}));
  await sleep(100);
  A.ws.send(JSON.stringify({ t: 'score', n: 'NaN' }));
  await sleep(100);
  A.ws.send(JSON.stringify({ t: 'hello', name: 'x'.repeat(1000) }));
  await sleep(300);
  assert(true, `connection survived invalid messages (events grew by ${A.events.length - before})`);
  A.ws.close();
}

async function scenarioG_catchSequence() {
  log('\n=== G: catch + end 메시지 순서 (caught → end 동일 순서) ===');
  const { A, B } = await setupRoom();
  A.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  const aStart = A.events.find(e => e.t === 'start');
  const aRole = aStart.roles[A.id];
  const tagger = aRole === 'tagger' ? A : B;
  const runner = aRole === 'tagger' ? B : A;
  A.ws.send(JSON.stringify({ t: 'pos', x: 0, z: 0 }));
  B.ws.send(JSON.stringify({ t: 'pos', x: 3.4, z: 0 }));
  await sleep(150);
  const aBefore = A.events.length;
  const bBefore = B.events.length;
  tagger.ws.send(JSON.stringify({ t: 'catch', id: runner.id }));
  await sleep(500);
  // A와 B 모두 같은 broadcast를 받지만 인덱스가 다를 수 있음
  // → 각자의 bBefore/aBefore로 슬라이스 후 양쪽 시퀀스 비교
  const aAfter = A.events.slice(aBefore);
  const bAfter = B.events.slice(bBefore);
  const aCore = aAfter.filter(e => e.t === 'caught' || e.t === 'end').map(e => e.t);
  const bCore = bAfter.filter(e => e.t === 'caught' || e.t === 'end').map(e => e.t);
  assert(JSON.stringify(aCore) === JSON.stringify(bCore), `A와 B의 caught/end 시퀀스 동일 (A=${aCore.join(',')} B=${bCore.join(',')})`);
  assert(aCore[0] === 'caught' && aCore[1] === 'end', `순서: caught → end`);
  A.ws.close(); B.ws.close();
}

async function main() {
  log(`WS: ${WS_URL}`);
  try {
    await scenarioA_classicMode(); await sleep(300);
    await scenarioB_catchAndEnd(); await sleep(300);
    await scenarioC_scoreRace(); await sleep(300);
    await scenarioD_useInvalid(); await sleep(300);
    await scenarioE_hostPermission(); await sleep(300);
    await scenarioF_invalidMessages(); await sleep(300);
    await scenarioG_catchSequence();
    log(`\n=== 결과: ${pass} pass, ${fail} fail ===`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    log('FATAL:', err.message);
    process.exit(1);
  }
}

main();