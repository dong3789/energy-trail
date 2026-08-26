export type NetWish = 'tagger' | 'runner' | 'random';
export type NetRole = 'tagger' | 'runner';

export interface NetPlayerInfo {
  id: string;
  name: string;
  char: string;
  wish: string;
  host?: boolean;
  role?: string;
  out?: boolean;
}

export interface NetPeer {
  id: string;
  x: number;
  z: number;
  yaw: number;
  out: boolean;
  role: string;
  /** 2026-08-25: 부활 무적 (reviveInvulnerabilitySeconds) — 0이면 무적 아님 */
  invulnUntil?: number;
}

export interface NetHello {
  name: string;
  char: string;
  wish: string;
  map: string;
}

export function wsUrlFromLocation(loc: { protocol: string; host: string }): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

export class NetClient {
  ws: WebSocket | null = null;
  id = '';
  code = '';
  hostId = '';
  map = 'park';
  mode = 'items';
  phase = 'lobby';
  players: NetPlayerInfo[] = [];
  peers = new Map<string, NetPeer>();
  roles: Record<string, NetRole> = {};
  spawns: Record<string, { x: number; z: number }> = {};
  score = 0;
  /** 2026-08-25: 서버 roundStartedAt (epoch ms) — start 메시지에서 수신. */
  roundStartedAt = 0;
  /** 2026-08-25: 마지막으로 받은 서버 left(초, 올림) — 카운트다운 drift 보정. */
  lastLeftSec = -1;
  connected = false;
  lastError = '';
  private pending: Array<(ok: boolean) => void> = [];
  onRoom: ((c: NetClient) => void) | null = null;
  onStart: ((c: NetClient) => void) | null = null;
  onCaught: ((id: string) => void) | null = null;
  onUse: ((id: string, kind: string) => void) | null = null;
  /** 2026-08-25: 부활됨 (id, x, z, invulnUntil) — 메인 루프에서 위치 텔레포트 + 무적 적용 */
  onRevived: ((p: { id: string; x: number; z: number; invulnUntil: number }) => void) | null = null;
  /** 2026-08-25: 살리기 실패 (사유) — UI 피드백 */
  onReviveDenied: ((reason: string) => void) | null = null;
  onEnd: ((winner: NetRole, reason: string) => void) | null = null;
  onLobby: ((c: NetClient) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  // 2026-08-25: 연결 끊김 전파 — 끊겨도 유저가 인지 못 하고 멈춘 방에 남아있던 문제 방지.
  // 성공적인 연결 이후 close/error/무음(15초) 감지 시 소켓 수명당 정확히 1회 호출.
  onDisconnect: ((reason: 'closed' | 'error' | 'timeout') => void) | null = null;
  private lastReceivedAt = 0;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectFired = false;
  private intentionalClose = false;

  get isHost(): boolean {
    return this.id !== '' && this.id === this.hostId;
  }

  connect(url: string): Promise<boolean> {
    if (this.ws && this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      this.disconnectFired = false;
      this.intentionalClose = false;
      const timer = setTimeout(() => {
        if (!this.connected) {
          ws.close();
          resolve(false);
        }
      }, 4000);
      ws.onopen = () => {
        this.connected = true;
        clearTimeout(timer);
        this.startSilenceCheck();
        resolve(true);
      };
      ws.onerror = () => {
        const wasConnected = this.connected;
        this.connected = false;
        clearTimeout(timer);
        resolve(false);
        if (wasConnected) this.notifyDisconnect('error');
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.stopSilenceCheck();
        if (wasConnected && !this.intentionalClose) this.notifyDisconnect('closed');
      };
      ws.onmessage = (ev) => this.handle(String(ev.data));
    });
  }

  hello(info: NetHello): void {
    this.send({ t: 'hello', name: info.name, char: info.char, wish: info.wish, map: info.map });
  }

  create(map: string): void {
    this.send({ t: 'create', map });
  }

  join(code: string): void {
    this.send({ t: 'join', code });
  }

  setWish(wish: NetWish): void {
    this.send({ t: 'wish', wish });
  }

  setChar(char: string): void {
    this.send({ t: 'char', char });
  }

  setMap(map: string): void {
    this.send({ t: 'map', map });
  }

  setMode(mode: 'items' | 'classic'): void {
    this.send({ t: 'mode', mode });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  sendPos(x: number, z: number, yaw: number): void {
    this.send({ t: 'pos', x, z, yaw });
  }

  sendScore(): void {
    // 2026-08-25: 서버가 n(유한한 숫자)을 필수 검증 — NaN 주입 차단. 미전송 시 점수가 무시된다.
    this.send({ t: 'score', n: 1 });
  }

  sendCatch(id: string): void {
    this.send({ t: 'catch', id });
  }

  sendUse(kind: string): void {
    this.send({ t: 'use', kind });
  }

  /** 2026-08-25: 살리기 요청 — 서버가 score/거리/시간 검증 후 응답 */
  sendRevive(targetId: string): void {
    this.send({ t: 'revive', id: targetId });
  }

  close(): void {
    this.intentionalClose = true;
    this.stopSilenceCheck();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.players = [];
    this.peers.clear();
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handle(raw: string): void {
    this.lastReceivedAt = Date.now();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    // 2026-08-25: 메시지 처리 throw 격리 — 한 메시지의 버그가 ws 큐의
    // 나머지 메시지 처리를 막거나 onDisconnect 같은 상태 변경을 누락시키지 않도록.
    // onCaught/onRevived 같은 콜백 throw도 포함.
    try {
      this.processMessage(msg);
    } catch (err) {
      console.error('[net.handle] processMessage threw:', err, msg);
    }
  }

  private processMessage(msg: Record<string, unknown>): void {
    const t = msg.t;
    if (t === 'welcome' && typeof msg.id === 'string') this.id = msg.id;
    if (t === 'err' && typeof msg.msg === 'string') {
      this.lastError = msg.msg;
      this.onError?.(msg.msg);
      const wait = this.pending.shift();
      wait?.(false);
    }
    if (t === 'room') {
      const wasMatch = this.phase === 'playing' || this.phase === 'ended';
      this.code = String(msg.code || '');
      this.hostId = String(msg.hostId || '');
      this.map = String(msg.map || this.map);
      this.mode = String(msg.mode || this.mode);
      this.phase = String(msg.phase || 'lobby');
      this.players = Array.isArray(msg.players) ? (msg.players as NetPlayerInfo[]) : [];
      this.onRoom?.(this);
      if (wasMatch && this.phase === 'lobby') this.onLobby?.(this);
      const wait = this.pending.shift();
      wait?.(true);
    }
    if (t === 'start') {
      this.roles = (msg.roles as Record<string, NetRole>) || {};
      this.players = Array.isArray(msg.players) ? (msg.players as NetPlayerInfo[]) : this.players;
      this.spawns =
        msg.spawns && typeof msg.spawns === 'object'
          ? (msg.spawns as Record<string, { x: number; z: number }>)
          : {};
      this.map = String(msg.map || this.map);
      this.roundStartedAt = typeof msg.roundStartedAt === 'number' ? msg.roundStartedAt : 0;
      // 2026-08-25: lastLeftSec도 라운드 시작 시 roundSeconds로 리셋
      // (이전 라운드 left 값이 새 라운드에 잔존하는 것 방지)
      if (typeof msg.roundSeconds === 'number') this.lastLeftSec = msg.roundSeconds;
      this.mode = String(msg.mode || this.mode);
      this.phase = 'playing';
      this.onStart?.(this);
    }
    if (t === 'peers' && Array.isArray(msg.list)) {
      this.score = typeof msg.score === 'number' ? msg.score : this.score;
      // 2026-08-25: 서버 roundSeconds 기준 남은 시간(초, 올림) — 클라 카운트다운
      // drift를 매 peers broadcast마다 보정. roundTime - dt로 흐르는 클라 자체
      // 시계가 RAF/탭 백그라운드로 어긋날 수 있어 서버 권위 값으로 동기화.
      this.lastLeftSec = typeof msg.left === 'number' ? msg.left : this.lastLeftSec;
      for (const row of msg.list as NetPeer[]) this.peers.set(row.id, row);
    }
    if (t === 'score' && typeof msg.n === 'number') this.score = msg.n;
    if (t === 'caught' && typeof msg.id === 'string') this.onCaught?.(msg.id);
    if (t === 'use' && typeof msg.id === 'string') this.onUse?.(msg.id, String(msg.kind || ''));
    // 2026-08-25: 부활됨 — 위치 텔레포트 + 무적 적용
    if (t === 'revived' && typeof msg.id === 'string') {
      const inv = typeof msg.invulnUntil === 'number' ? msg.invulnUntil : 0;
      const x = typeof msg.x === 'number' ? msg.x : 0;
      const z = typeof msg.z === 'number' ? msg.z : 0;
      this.onRevived?.({ id: msg.id, x, z, invulnUntil: inv });
    }
    // 2026-08-25: 살리기 거부 — 사유를 그대로 클라에 통보
    if (t === 'reviveDenied' && typeof msg.reason === 'string') this.onReviveDenied?.(msg.reason);
    if (t === 'end') {
      this.phase = 'ended';
      this.lastLeftSec = 0; // 2026-08-25: 라운드 종료 — 다음 라운드 시작 전까지 보정 무력화
      this.onEnd?.((msg.winner as NetRole) || 'tagger', String(msg.reason || ''));
    }
  }

  private startSilenceCheck(): void {
    this.stopSilenceCheck();
    this.lastReceivedAt = Date.now();
    this.silenceTimer = setInterval(() => {
      if (Date.now() - this.lastReceivedAt > 15_000) {
        this.notifyDisconnect('timeout');
        this.ws?.close();
      }
    }, 5_000);
  }

  private stopSilenceCheck(): void {
    if (this.silenceTimer !== null) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private notifyDisconnect(reason: 'closed' | 'error' | 'timeout'): void {
    if (this.disconnectFired) return;
    this.disconnectFired = true;
    this.onDisconnect?.(reason);
  }
}
