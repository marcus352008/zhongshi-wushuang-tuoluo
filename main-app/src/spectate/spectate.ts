/**
 * Teacher spectate MVP: same-machine second tab via BroadcastChannel + localStorage.
 * Cross-machine needs a server Durable Object (P1) — documented in README Notes.
 */

export interface SpectateSnapshot {
  v: 1;
  room: string;
  t: number;
  phase: string;
  scores: [number, number];
  round: number;
  names: [string, string];
  /** HP-like spin fraction 0..1 */
  spin: [number, number];
  /** Special charge 0..1 */
  charge: [number, number];
  skillHints: [string, string];
  status: string;
  out: [boolean, boolean];
}

const LS_PREFIX = 'wushuang-spectate-snap-';

export function channelName(room: string): string {
  return `wushuang-spectate-${room.toUpperCase()}`;
}

/** Short room code (A–Z0–9). */
export function generateRoomCode(len = 5): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += alphabet[arr[i] % alphabet.length];
  return s;
}

export function spectateUrl(room: string): string {
  const u = new URL(window.location.href);
  u.searchParams.set('spectate', room.toUpperCase());
  // Drop host-only room param if present
  u.searchParams.delete('room');
  return u.toString();
}

export class SpectateHost {
  readonly room: string;
  private bc: BroadcastChannel | null = null;
  private lastPost = 0;

  constructor(room?: string) {
    this.room = (room || generateRoomCode()).toUpperCase();
    try {
      this.bc = new BroadcastChannel(channelName(this.room));
    } catch {
      this.bc = null;
    }
  }

  post(snap: Omit<SpectateSnapshot, 'v' | 'room' | 't'>, minIntervalMs = 200): void {
    const now = performance.now();
    if (now - this.lastPost < minIntervalMs) return;
    this.lastPost = now;
    const full: SpectateSnapshot = {
      v: 1,
      room: this.room,
      t: Date.now(),
      ...snap,
    };
    try {
      this.bc?.postMessage(full);
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(LS_PREFIX + this.room, JSON.stringify(full));
      // storage event needs a change — flip a tick key
      localStorage.setItem(LS_PREFIX + this.room + '-tick', String(full.t));
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    try {
      this.bc?.close();
    } catch {
      /* ignore */
    }
    this.bc = null;
  }
}

export type SpectateListener = (snap: SpectateSnapshot) => void;

export class SpectateClient {
  readonly room: string;
  private bc: BroadcastChannel | null = null;
  private onStorage: ((e: StorageEvent) => void) | null = null;
  private listener: SpectateListener | null = null;

  constructor(room: string) {
    this.room = room.toUpperCase();
  }

  start(listener: SpectateListener): void {
    this.listener = listener;
    try {
      this.bc = new BroadcastChannel(channelName(this.room));
      this.bc.onmessage = (ev) => {
        const d = ev.data as SpectateSnapshot;
        if (d && d.v === 1 && d.room === this.room) listener(d);
      };
    } catch {
      this.bc = null;
    }
    this.onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === LS_PREFIX + this.room || e.key === LS_PREFIX + this.room + '-tick') {
        this.readLatest();
      }
    };
    window.addEventListener('storage', this.onStorage);
    this.readLatest();
  }

  private readLatest(): void {
    try {
      const raw = localStorage.getItem(LS_PREFIX + this.room);
      if (!raw || !this.listener) return;
      const d = JSON.parse(raw) as SpectateSnapshot;
      if (d && d.v === 1 && d.room === this.room) this.listener(d);
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    try {
      this.bc?.close();
    } catch {
      /* ignore */
    }
    this.bc = null;
    if (this.onStorage) window.removeEventListener('storage', this.onStorage);
    this.onStorage = null;
    this.listener = null;
  }
}

/**
 * Mount read-only spectate HUD (projection-friendly).
 */
export function mountSpectateView(root: HTMLElement, room: string): () => void {
  const client = new SpectateClient(room);
  const screen = document.createElement('div');
  screen.className = 'screen spectate-screen';
  root.append(screen);

  const render = (snap: SpectateSnapshot | null) => {
    screen.replaceChildren();
    const inner = document.createElement('div');
    inner.className = 'screen-inner spectate-inner';

    const title = document.createElement('h1');
    title.textContent = '老師觀戰';
    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = `房間 ${room}　｜　唯讀投影（無操作）`;

    if (!snap) {
      const wait = document.createElement('div');
      wait.className = 'box';
      wait.textContent = '等待對戰畫面……請確認學生已開同一房間，並用同一部裝置的第二分頁開啟此連結。';
      inner.append(title, sub, wait);
      screen.append(inner);
      return;
    }

    const score = document.createElement('div');
    score.className = 'spectate-score';
    score.textContent = `${snap.scores[0]} : ${snap.scores[1]}`;

    const phase = document.createElement('div');
    phase.className = 'spectate-phase';
    phase.textContent = `第 ${snap.round + 1} 回合　｜　${snap.phase}　｜　${snap.status}`;

    const row = document.createElement('div');
    row.className = 'spectate-row';

    for (const s of [0, 1] as const) {
      const card = document.createElement('div');
      card.className = `spectate-card side-${s}`;
      const name = document.createElement('div');
      name.className = 'spectate-name';
      name.textContent = snap.names[s] + (snap.out[s] ? '（出局）' : '');
      const spinLab = document.createElement('div');
      spinLab.className = 'spectate-lab';
      spinLab.textContent = '轉速';
      const spinBar = document.createElement('div');
      spinBar.className = 'spectate-bar';
      const spinFill = document.createElement('div');
      spinFill.className = 'spectate-bar-fill spin';
      spinFill.style.width = `${Math.round(Math.max(0, Math.min(1, snap.spin[s])) * 100)}%`;
      spinBar.append(spinFill);
      const chLab = document.createElement('div');
      chLab.className = 'spectate-lab';
      chLab.textContent = '儲力';
      const chBar = document.createElement('div');
      chBar.className = 'spectate-bar';
      const chFill = document.createElement('div');
      chFill.className = 'spectate-bar-fill charge';
      chFill.style.width = `${Math.round(Math.max(0, Math.min(1, snap.charge[s])) * 100)}%`;
      chBar.append(chFill);
      const skill = document.createElement('div');
      skill.className = 'spectate-skill';
      skill.textContent = snap.skillHints[s] || '—';
      card.append(name, spinLab, spinBar, chLab, chBar, skill);
      row.append(card);
    }

    const note = document.createElement('p');
    note.className = 'spectate-note';
    note.textContent = '觀戰模式：唔可以發射、答 MC、或開特技。跨機同步需後端（見 README Notes）。';

    inner.append(title, sub, score, phase, row, note);
    screen.append(inner);
  };

  render(null);
  client.start(render);

  return () => {
    client.dispose();
    screen.remove();
  };
}
