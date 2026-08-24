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
  phase = 'lobby';
  players: NetPlayerInfo[] = [];
  peers = new Map<string, NetPeer>();
  roles: Record<string, NetRole> = {};
  spawns: Record<string, { x: number; z: number }> = {};
  score = 0;
  connected = false;
  lastError = '';
  private pending: Array<(ok: boolean) => void> = [];
  onRoom: ((c: NetClient) => void) | null = null;
  onStart: ((c: NetClient) => void) | null = null;
  onCaught: ((id: string) => void) | null = null;
  onEnd: ((winner: NetRole, reason: string) => void) | null = null;
  onLobby: ((c: NetClient) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  get isHost(): boolean {
    return this.id !== '' && this.id === this.hostId;
  }

  connect(url: string): Promise<boolean> {
    if (this.ws && this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!this.connected) {
          ws.close();
          resolve(false);
        }
      }, 4000);
      ws.onopen = () => {
        this.connected = true;
        clearTimeout(timer);
        resolve(true);
      };
      ws.onerror = () => {
        this.connected = false;
        clearTimeout(timer);
        resolve(false);
      };
      ws.onclose = () => {
        this.connected = false;
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

  start(): void {
    this.send({ t: 'start' });
  }

  sendPos(x: number, z: number, yaw: number): void {
    this.send({ t: 'pos', x, z, yaw });
  }

  sendScore(): void {
    this.send({ t: 'score' });
  }

  sendCatch(id: string): void {
    this.send({ t: 'catch', id });
  }

  close(): void {
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
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
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
      this.phase = 'playing';
      this.onStart?.(this);
    }
    if (t === 'peers' && Array.isArray(msg.list)) {
      this.score = typeof msg.score === 'number' ? msg.score : this.score;
      for (const row of msg.list as NetPeer[]) this.peers.set(row.id, row);
    }
    if (t === 'score' && typeof msg.n === 'number') this.score = msg.n;
    if (t === 'caught' && typeof msg.id === 'string') this.onCaught?.(msg.id);
    if (t === 'end') {
      this.phase = 'ended';
      this.onEnd?.((msg.winner as NetRole) || 'tagger', String(msg.reason || ''));
    }
  }
}
