import { authHeaders, type AuthSession } from '../auth/drawAuth';
import type { Card, Loadout } from '../cards/types';
import { DRAW_BASE } from '../config/balance';
import type { RoundResult } from '../game/match';
import { validateLoadout } from '../rules/validateLoadout';
import { loadCachedClassName, saveCachedClassName, type FormLevel } from './form';

export interface DailyPlaysInfo {
  ok: boolean;
  hkDate: string;
  used: number;
  remaining: number;
  limit: number;
  error?: string;
}

export interface LeaderboardRow {
  rank: number;
  email: string;
  name: string;
  className: string;
  form: string;
  wins: number;
  losses: number;
  updatedAt: string;
}

export interface LeaderboardResponse {
  ok: boolean;
  rows: LeaderboardRow[];
  count: number;
  formFilter?: FormLevel | null;
  degraded?: boolean;
  cached?: boolean;
  error?: string;
}

export interface LoadoutIds {
  A: string;
  B: string;
  C: string;
}

export interface RoomPlayerInfo {
  email: string;
  name: string;
  className?: string;
  form: FormLevel;
  role: 'host' | 'guest';
  seat?: 0 | 1;
  connected: boolean;
  loadoutReady?: boolean;
}

export interface RoomStateMsg {
  t: 'state';
  phase: 'lobby' | 'ready' | 'playing' | 'ended';
  code: string;
  hostForm: FormLevel;
  players: RoomPlayerInfo[];
  you: {
    email: string;
    name: string;
    className?: string;
    form: FormLevel;
    role: 'host' | 'guest';
    seat?: 0 | 1;
    loadoutReady?: boolean;
  } | null;
}

export interface RoomWelcomeMsg {
  t: 'welcome';
  code: string;
  role: 'host' | 'guest';
  seat?: 0 | 1;
  form: FormLevel;
  email: string;
}

export interface RoomStartedMsg {
  t: 'started';
  code: string;
  startedAt: number;
  msg: string;
}

export interface RoomMatchReadyMsg {
  t: 'match_ready';
  code: string;
  matchSeed: number;
  hostSeat: 0;
  loadouts: [LoadoutIds, LoadoutIds];
  players: [
    { email: string; name: string; form: FormLevel; role: 'host'; seat: 0 },
    { email: string; name: string; form: FormLevel; role: 'guest'; seat: 1 },
  ];
}

export interface PvpInputPacket {
  t?: 'input';
  seat?: 0 | 1;
  seq: number;
  steer?: { x: number; z: number };
  aim?: number;
  edges?: {
    dash?: boolean;
    special?: boolean;
  };
  launch?: {
    round: number;
    aim: number;
    power: number;
  };
  quizCharge?: number;
}

export interface SnapBodyState {
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  spin: number;
  spin0: number;
  out: 'ring' | 'spin' | null;
}

export interface SnapEvents {
  launch?: boolean;
  clash?: number;
  wall?: number;
  ringOut?: boolean;
  specialActivated?: {
    seat: 0 | 1;
    skill: 'attack' | 'guard' | 'heal';
    cardName: string;
  } | null;
}

export interface PvpSnapPacket {
  t?: 'snap';
  seq: number;
  tHost: number;
  phase: 'launch' | 'quiz' | 'fight' | 'score';
  round: number;
  roundTime: number;
  scores: [number, number];
  mode: 'C' | 'S';
  bodies: [SnapBodyState, SnapBodyState] | null;
  specialCharge: [number, number];
  hostAim?: number;
  events?: SnapEvents;
  roundResult?: RoundResult | null;
}

export interface RoomEndMsg {
  t: 'end';
  reason: 'normal' | 'forfeit';
  winnerSeat: 0 | 1 | null;
  scores: [number, number];
  forfeitBySeat?: 0 | 1;
  msg: string;
}

export interface RoomToastMsg {
  t: 'toast';
  msg: string;
  bad?: boolean;
}

export interface RoomFatalMsg {
  t: 'fatal';
  code: string;
  msg: string;
}

export type ServerWsMsg =
  | RoomStateMsg
  | RoomWelcomeMsg
  | RoomStartedMsg
  | RoomMatchReadyMsg
  | (PvpInputPacket & { t: 'input'; seat: 0 | 1 })
  | (PvpSnapPacket & { t: 'snap' })
  | RoomEndMsg
  | RoomToastMsg
  | RoomFatalMsg;

export interface ConnectRoomCallbacks {
  onWelcome?: (msg: RoomWelcomeMsg) => void;
  onState?: (msg: RoomStateMsg) => void;
  onStarted?: (msg: RoomStartedMsg) => void;
  onMatchReady?: (msg: RoomMatchReadyMsg) => void;
  onInput?: (msg: PvpInputPacket & { t: 'input'; seat: 0 | 1 }) => void;
  onSnap?: (msg: PvpSnapPacket & { t: 'snap' }) => void;
  onEnd?: (msg: RoomEndMsg) => void;
  onToast?: (msg: RoomToastMsg) => void;
  onFatal?: (msg: RoomFatalMsg) => void;
  onClose?: (ev: CloseEvent) => void;
}

export interface RoomConnection {
  code: string;
  sendStart: () => void;
  sendLoadout: (ids: LoadoutIds) => void;
  sendInput: (pkt: PvpInputPacket) => void;
  sendSnap: (snap: PvpSnapPacket) => void;
  sendForfeit: () => void;
  sendMatchEnd: (scores: [number, number], winnerSeat: 0 | 1 | null) => void;
  sendLeave: () => void;
  sendSync: () => void;
  setCallbacks: (next: Partial<ConnectRoomCallbacks>) => void;
  close: () => void;
}

/** 將 Loadout 序列化為只含卡牌 ID 的物件。 */
export function serializeLoadoutIds(l: Loadout): LoadoutIds {
  return {
    A: l.A.id,
    B: l.B.id,
    C: l.C.id,
  };
}

/** 由卡牌 ID 物件從本地卡池還原完整 Loadout；若缺卡或無效則回傳錯誤原因。 */
export function loadoutFromCardIds(
  pool: readonly Card[],
  ids: LoadoutIds,
): { ok: true; loadout: Loadout } | { ok: false; error: string } {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const A = byId.get(ids.A);
  const B = byId.get(ids.B);
  const C = byId.get(ids.C);
  if (!A || !B || !C) {
    const missing = [
      !A ? `A(${ids.A})` : '',
      !B ? `B(${ids.B})` : '',
      !C ? `C(${ids.C})` : '',
    ]
      .filter(Boolean)
      .join('、');
    return { ok: false, error: `本地卡池找不到卡牌：${missing}` };
  }
  const loadout: Loadout = { A, B, C };
  const v = validateLoadout(loadout);
  if (!v.ok) {
    return { ok: false, error: v.errors[0]?.message || '無效的陀螺陣容組合' };
  }
  return { ok: true, loadout };
}

export async function fetchDailyPlays(email: string): Promise<DailyPlaysInfo> {
  const res = await fetch(`/api/pvp/daily-plays?email=${encodeURIComponent(email)}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  const data = (await res.json()) as DailyPlaysInfo;
  return data;
}

export async function fetchLeaderboard(
  form?: FormLevel | null,
  fresh = false,
): Promise<LeaderboardResponse> {
  const qs = new URLSearchParams();
  if (form) qs.set('form', form);
  if (fresh) qs.set('fresh', '1');
  const query = qs.toString();
  const url = `/api/pvp/leaderboard${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  return (await res.json()) as LeaderboardResponse;
}

export async function createRoom(
  email: string,
  form: FormLevel,
): Promise<{ ok: boolean; roomCode?: string; form?: FormLevel; error?: string }> {
  const res = await fetch('/api/pvp/create-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, form }),
  });
  return (await res.json()) as { ok: boolean; roomCode?: string; form?: FormLevel; error?: string };
}

export async function joinRoom(
  email: string,
  form: FormLevel,
  roomCode: string,
): Promise<{ ok: boolean; roomCode?: string; hostForm?: FormLevel; error?: string }> {
  const res = await fetch('/api/pvp/join-room', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, form, roomCode }),
  });
  return (await res.json()) as { ok: boolean; roomCode?: string; hostForm?: FormLevel; error?: string };
}

export async function consumePlay(
  email: string,
  roomCode: string,
): Promise<DailyPlaysInfo> {
  const res = await fetch('/api/pvp/consume-play', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, roomCode }),
  });
  return (await res.json()) as DailyPlaysInfo;
}

export async function fetchRosterClassName(session: AuthSession): Promise<string> {
  try {
    const res = await fetch(
      `${DRAW_BASE}/api/state?email=${encodeURIComponent(session.email)}`,
      {
        headers: authHeaders(session),
      },
    );
    if (!res.ok) return '';
    const data = (await res.json()) as Record<string, any>;
    const cls = String(
      data?.className ?? data?.user?.className ?? data?.profile?.className ?? data?.class ?? '',
    ).trim();
    if (cls) {
      saveCachedClassName(cls);
    }
    return cls;
  } catch {
    return '';
  }
}

export function connectRoomWs(
  roomCode: string,
  helloPayload: {
    email: string;
    form: FormLevel;
    name?: string;
    className?: string;
    roleHint?: 'host' | 'guest';
  },
  initialCallbacks: ConnectRoomCallbacks,
): RoomConnection {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const cleanCode = roomCode.trim().toUpperCase();
  const wsUrl = `${proto}//${window.location.host}/ws/pvp/${encodeURIComponent(cleanCode)}`;
  const ws = new WebSocket(wsUrl);

  let callbacks: ConnectRoomCallbacks = { ...initialCallbacks };
  let pingTimer: number | null = null;

  const safeSend = (obj: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  ws.addEventListener('open', () => {
    safeSend({
      t: 'hello',
      email: helloPayload.email,
      form: helloPayload.form,
      name: helloPayload.name,
      className: helloPayload.className || loadCachedClassName() || '',
      roleHint: helloPayload.roleHint,
    });
    pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
      }
    }, 15000);
  });

  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string' || ev.data === 'pong') return;
    let parsed: ServerWsMsg;
    try {
      parsed = JSON.parse(ev.data) as ServerWsMsg;
    } catch {
      return;
    }
    switch (parsed.t) {
      case 'welcome':
        callbacks.onWelcome?.(parsed);
        break;
      case 'state':
        callbacks.onState?.(parsed);
        break;
      case 'started':
        callbacks.onStarted?.(parsed);
        break;
      case 'match_ready':
        callbacks.onMatchReady?.(parsed);
        break;
      case 'input':
        callbacks.onInput?.(parsed);
        break;
      case 'snap':
        callbacks.onSnap?.(parsed);
        break;
      case 'end':
        callbacks.onEnd?.(parsed);
        break;
      case 'toast':
        callbacks.onToast?.(parsed);
        break;
      case 'fatal':
        callbacks.onFatal?.(parsed);
        break;
    }
  });

  ws.addEventListener('close', (ev) => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    callbacks.onClose?.(ev);
  });

  return {
    code: cleanCode,
    sendStart: () => safeSend({ t: 'start' }),
    sendLoadout: (ids: LoadoutIds) => safeSend({ t: 'loadout', ids }),
    sendInput: (pkt: PvpInputPacket) => safeSend({ ...pkt, t: 'input' }),
    sendSnap: (snap: PvpSnapPacket) => safeSend({ ...snap, t: 'snap' }),
    sendForfeit: () => safeSend({ t: 'forfeit' }),
    sendMatchEnd: (scores: [number, number], winnerSeat: 0 | 1 | null) =>
      safeSend({ t: 'match_end', scores, winnerSeat }),
    sendLeave: () => safeSend({ t: 'leave' }),
    sendSync: () => safeSend({ t: 'sync' }),
    setCallbacks: (next: Partial<ConnectRoomCallbacks>) => {
      callbacks = { ...callbacks, ...next };
    },
    close: () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      try {
        ws.close(1000, 'client close');
      } catch {
        /* ignore */
      }
    },
  };
}
