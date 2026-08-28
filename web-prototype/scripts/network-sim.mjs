// 2026-08-25: 네트워크 시뮬레이션 자동 측정 — 모바일 LTE/WiFi 전환의 가짜 재현 + 검증
//
// 4가지 조건에서 서버 spawn → 두 ws 클라이언트 연결 → host 진동으로 매 tick peer broadcast
// → guest 측 도착 시점 측정 → 통계 assert.
//
// 시나리오:
//   baseline       (0ms / ±0ms / 0%)  — localhost 기준선
//   mobile-lte     (100ms / ±30ms / 0%) — 일반 모바일 LTE
//   unstable       (300ms / ±100ms / 0%) — 불안정 구간 (지하철, 엘리베이터)
//   extreme-drop   (500ms / ±100ms / 5%) — 극단 + 패킷 손실 (와이파이 전환 직후)
//
// 실행: node scripts/network-sim.mjs
// 종료 코드: 0 = ALL PASS, 1 = FAIL
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'server', 'index.mjs');

const SCENARIOS = [
  {
    name: 'baseline',
    sim: { SIM_LATENCY_MS: 0, SIM_JITTER_MS: 0, SIM_DROP_RATE: 0 },
    expect: { minAvg: 0, maxAvg: 30, maxDelay: 100, minCount: 25 },
  },
  {
    name: 'mobile-lte',
    sim: { SIM_LATENCY_MS: 100, SIM_JITTER_MS: 30, SIM_DROP_RATE: 0 },
    expect: { minAvg: 60, maxAvg: 180, maxDelay: 250, minCount: 25 },
  },
  {
    name: 'unstable',
    sim: { SIM_LATENCY_MS: 300, SIM_JITTER_MS: 100, SIM_DROP_RATE: 0 },
    expect: { minAvg: 180, maxAvg: 500, maxDelay: 700, minCount: 25 },
  },
  {
    name: 'extreme-drop',
    sim: { SIM_LATENCY_MS: 500, SIM_JITTER_MS: 100, SIM_DROP_RATE: 0.05 },
    // 2026-08-25: 드롭 시나리오는 minCount를 expected * 0.7 이상으로 느슨하게
    expect: { minAvg: 350, maxAvg: 750, maxDelay: 1000, minCount: 18 },
  },
];

const DURATION_MS = 3000;
const TICK_MS = 80;
const HOST_OSCILLATION_MS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws._msgs = [];
    ws.on('message', (d) => {
      try {
        const msg = JSON.parse(String(d));
        ws._msgs.push(msg);
        if (ws._onMessage) ws._onMessage(msg);
      } catch {
        // 무시 — 손상된 메시지
      }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function runScenario(scenario, port) {
  console.log(
    `\n[${scenario.name}] latency=${scenario.sim.SIM_LATENCY_MS}ms ±${scenario.sim.SIM_JITTER_MS}ms drop=${(scenario.sim.SIM_DROP_RATE * 100).toFixed(0)}%`,
  );

  // 2026-08-25: stderr 캡처 — 서버 로그가 stderr로 새면 출력 노이즈가 큼.
  // stdout도 캡처해서 [sim] 같은 서버 부트 로그만 콘솔에 흘림.
  const server = spawn('node', [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      SIM_LATENCY_MS: String(scenario.sim.SIM_LATENCY_MS),
      SIM_JITTER_MS: String(scenario.sim.SIM_JITTER_MS),
      SIM_DROP_RATE: String(scenario.sim.SIM_DROP_RATE),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {
    /* 서버 출력 무시 (테스트 노이즈 방지) */
  });
  server.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error(`  [server stderr] ${msg}`);
  });

  // 2026-08-25: 서버 부트 대기 — 8791 기본이지만 8791 점유 시 PORT 환경변수로 바뀜
  await sleep(1500);

  try {
    const url = `ws://127.0.0.1:${port}/ws`;
    const host = await connect(url);
    const guest = await connect(url);

    // 2026-08-25: 룸 셋업 — hello → create → join → start
    host.send(JSON.stringify({ t: 'hello', name: 'h', wish: 'tagger' }));
    guest.send(JSON.stringify({ t: 'hello', name: 'g', wish: 'runner' }));
    await sleep(150);

    // 2026-08-25: create는 room 메시지를 반환 — wait으로 도달 대기
    host.send(JSON.stringify({ t: 'create', map: 'park' }));
    await sleep(200);
    const createMsg = host._msgs.find((m) => m.t === 'room' && m.code);
    if (!createMsg) {
      console.log('  FAIL: host가 room 메시지를 받지 못함');
      console.log('  host.msgs:', JSON.stringify(host._msgs.map((m) => m.t)));
      return false;
    }

    guest.send(JSON.stringify({ t: 'join', code: createMsg.code }));
    await sleep(200);

    host.send(JSON.stringify({ t: 'start' }));
    await sleep(400); // 첫 tick 안정화

    // 2026-08-25: peer 도착 시점 수집 — guest 측에서 msg.ts(서버 epoch ms)와
    // Date.now() 비교로 delay(ms) 계산.
    const peerArrivals = [];
    guest._onMessage = (msg) => {
      if (msg.t === 'peers' && typeof msg.ts === 'number') {
        peerArrivals.push({ serverTs: msg.ts, arrivalTs: Date.now() });
      }
    };

    // 2026-08-25: host 진동 — 매 HOST_OSCILLATION_MS마다 pos 전송.
    // 서버의 변경 감지 스킵(lastPeersRaw !== payload)을 깨기 위해 x를 ±0.1m 흔들어 매 tick broadcast.
    let baseX = 12;
    for (let i = 0; i < DURATION_MS / HOST_OSCILLATION_MS; i++) {
      const t = i * HOST_OSCILLATION_MS;
      const x = baseX + Math.sin(t / 200) * 0.3;
      host.send(JSON.stringify({ t: 'pos', x, z: 12 }));
      await sleep(HOST_OSCILLATION_MS);
    }
    await sleep(300); // 마지막 broadcast 여유

    // 2026-08-25: 통계 계산
    if (peerArrivals.length === 0) {
      console.log('  FAIL: peer 메시지 0개');
      return false;
    }
    const delays = peerArrivals.map((p) => p.arrivalTs - p.serverTs);
    delays.sort((a, b) => a - b);
    const sum = delays.reduce((a, b) => a + b, 0);
    const avg = sum / delays.length;
    const p50 = delays[Math.floor(delays.length * 0.5)];
    const p95 = delays[Math.floor(delays.length * 0.95)];
    const max = delays[delays.length - 1];
    const min = delays[0];

    // 2026-08-25: 기대치 — DURATION_MS / TICK_MS × (1 - DROP_RATE)
    const expectedCount = Math.floor(DURATION_MS / TICK_MS) * (1 - scenario.sim.SIM_DROP_RATE);
    const received = peerArrivals.length;

    console.log(
      `  received=${received}/${expectedCount.toFixed(0)} (${((received / expectedCount) * 100).toFixed(0)}%)`,
    );
    console.log(
      `  delay min=${min.toFixed(0)}ms p50=${p50.toFixed(0)}ms avg=${avg.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms`,
    );

    // 2026-08-25: assert — 평균 지연이 기대 범위, 최대 지연이 한계 이내, 최소 수신량 충족
    const avgOK = avg >= scenario.expect.minAvg && avg <= scenario.expect.maxAvg;
    const maxOK = max <= scenario.expect.maxDelay;
    const countOK = received >= scenario.expect.minCount;

    const tag = (ok) => (ok ? '✓' : '✗');
    console.log(
      `  ${tag(avgOK)} avg ${scenario.expect.minAvg}~${scenario.expect.maxAvg}ms`,
    );
    console.log(`  ${tag(maxOK)} max ≤ ${scenario.expect.maxDelay}ms`);
    console.log(`  ${tag(countOK)} count ≥ ${scenario.expect.minCount}`);

    return avgOK && maxOK && countOK;
  } finally {
    server.kill('SIGTERM');
    await sleep(300); // 포트 해제 대기
  }
}

async function main() {
  let basePort = 8800;
  let allPass = true;
  for (const scenario of SCENARIOS) {
    const port = basePort++;
    const ok = await runScenario(scenario, port);
    if (!ok) allPass = false;
  }

  console.log('\n' + (allPass ? '✓ ALL PASS' : '✗ FAIL'));
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
