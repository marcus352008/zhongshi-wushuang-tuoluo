import { DurableObject } from 'cloudflare:workers';
import {
  hasSheetWebhookCreds,
  postAppendMatch,
  postAppendStudy60s,
  type EnvSheetWebhook,
} from './sheetWebhook';

export type FormLevel = 'F1' | 'F2' | 'F3';
export type RoomPhase = 'lobby' | 'ready' | 'playing' | 'ended';
export type PlayerRole = 'host' | 'guest';

export interface LoadoutIds {
  A: string;
  B: string;
  C: string;
}

export interface RoomPlayer {
  email: string;
  name: string;
  className?: string;
  form: FormLevel;
  role: PlayerRole;
  seat: 0 | 1;
  connected: boolean;
  joinedAt: number;
  disconnectedAt?: number;
  loadoutIds?: LoadoutIds;
}

export interface MatchEndPayload {
  t: 'end';
  reason: 'normal' | 'forfeit';
  winnerSeat: 0 | 1 | null;
  scores: [number, number];
  forfeitBySeat?: 0 | 1;
  msg: string;
}

export interface RoomState {
  code: string;
  hostForm: FormLevel;
  phase: RoomPhase;
  players: RoomPlayer[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  playsConsumed?: boolean;
  matchSeed?: number;
  matchReadySent?: boolean;
  lastSnap?: Record<string, unknown> | null;
  endResult?: MatchEndPayload | null;
  studyRewardLogged?: boolean;
}

export interface DailyPlayResult {
  ok: boolean;
  hkDate: string;
  used: number;
  remaining: number;
  limit: number;
  alreadyConsumed?: boolean;
  error?: string;
}

const MAX_MSG = 32768;
const DAILY_LIMIT = 3;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const DISCONNECT_FORFEIT_MS = 45 * 1000;

function getHkDate(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

function normalizeForm(raw: unknown): FormLevel | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'F1' || s === 'F2' || s === 'F3') return s;
  return null;
}

function isValidLoadoutIds(raw: any): raw is LoadoutIds {
  return (
    raw &&
    typeof raw === 'object' &&
    typeof raw.A === 'string' &&
    raw.A.trim().length > 0 &&
    typeof raw.B === 'string' &&
    raw.B.trim().length > 0 &&
    typeof raw.C === 'string' &&
    raw.C.trim().length > 0
  );
}

export class BattleRoom extends DurableObject {
  private S: RoomState | null = null;
  private rate = new Map<string, { count: number; resetAt: number }>();

  constructor(ctx: any, env: any) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.S = (await ctx.storage.get('S')) || null;
    });
  }

  // =========================================================================
  // 每日場次計數 RPC（當 DO 以 idFromName('plays:' + hkDate) 喚醒時使用）
  // =========================================================================

  async getDailyPlays(email: string, hkDate: string): Promise<DailyPlayResult> {
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const used = Number((await this.ctx.storage.get(`used:${cleanEmail}`)) ?? 0);
    return {
      ok: true,
      hkDate,
      used,
      remaining: Math.max(0, DAILY_LIMIT - used),
      limit: DAILY_LIMIT,
    };
  }

  async consumePlay(email: string, roomCode: string, hkDate: string): Promise<DailyPlayResult> {
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const cleanRoom = String(roomCode ?? '').trim().toUpperCase();
    const idemKey = `consumed:${cleanRoom}:${cleanEmail}`;

    const already = await this.ctx.storage.get(idemKey);
    let used = Number((await this.ctx.storage.get(`used:${cleanEmail}`)) ?? 0);

    if (already) {
      return {
        ok: true,
        hkDate,
        used,
        remaining: Math.max(0, DAILY_LIMIT - used),
        limit: DAILY_LIMIT,
        alreadyConsumed: true,
      };
    }

    if (used >= DAILY_LIMIT) {
      return {
        ok: false,
        hkDate,
        used,
        remaining: 0,
        limit: DAILY_LIMIT,
        error: `今日對戰次數已達上限（${DAILY_LIMIT} 場）。`,
      };
    }

    used += 1;
    await this.ctx.storage.put(`used:${cleanEmail}`, used);
    await this.ctx.storage.put(idemKey, Date.now());

    return {
      ok: true,
      hkDate,
      used,
      remaining: Math.max(0, DAILY_LIMIT - used),
      limit: DAILY_LIMIT,
    };
  }

  async consumeBatch(
    emails: string[],
    roomCode: string,
    hkDate: string,
  ): Promise<{ ok: boolean; error?: string; results?: Record<string, DailyPlayResult> }> {
    const cleanRoom = String(roomCode ?? '').trim().toUpperCase();
    const cleanEmails = Array.from(new Set(emails.map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean)));

    for (const em of cleanEmails) {
      const idemKey = `consumed:${cleanRoom}:${em}`;
      const already = await this.ctx.storage.get(idemKey);
      if (already) continue;
      const used = Number((await this.ctx.storage.get(`used:${em}`)) ?? 0);
      if (used >= DAILY_LIMIT) {
        return {
          ok: false,
          error: `玩家 ${em} 今日對戰次數已滿（${DAILY_LIMIT}/${DAILY_LIMIT}），無法開局。`,
        };
      }
    }

    const results: Record<string, DailyPlayResult> = {};
    for (const em of cleanEmails) {
      results[em] = await this.consumePlay(em, cleanRoom, hkDate);
    }
    return { ok: true, results };
  }

  // =========================================================================
  // 對戰房間 RPC（當 DO 以 idFromName(roomCode) 喚醒時使用）
  // =========================================================================

  async exists(): Promise<boolean> {
    return !!this.S;
  }

  async init(code: string, hostForm: FormLevel, _hostEmail?: string): Promise<{ ok: boolean; code?: string; error?: string }> {
    if (this.S) {
      return { ok: false, error: '房間已存在' };
    }
    const now = Date.now();
    const seedArr = new Uint32Array(1);
    crypto.getRandomValues(seedArr);
    this.S = {
      code,
      hostForm,
      phase: 'lobby',
      players: [],
      createdAt: now,
      updatedAt: now,
      playsConsumed: false,
      matchSeed: seedArr[0] || 135792468,
      matchReadySent: false,
      lastSnap: null,
      endResult: null,
      studyRewardLogged: false,
    };
    await this.ctx.storage.put('S', this.S);
    await this.scheduleNextAlarm(now);
    return { ok: true, code };
  }

  async checkJoinable(form: FormLevel | null, email?: string): Promise<{ ok: boolean; hostForm?: FormLevel; error?: string }> {
    if (!this.S) {
      return { ok: false, error: '找不到這個房間代碼，請檢查配對碼是否正確。' };
    }
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const existing = cleanEmail ? this.S.players.find((p) => p.email === cleanEmail) : null;

    if (!existing) {
      if (this.S.phase === 'playing' || this.S.phase === 'ended') {
        return { ok: false, error: '此房間對戰已經開始或已結束，無法加入。' };
      }
      if (this.S.players.length >= 2) {
        return { ok: false, error: '房間已滿（最多 2 人）。' };
      }
    }

    if (form && form !== this.S.hostForm) {
      return {
        ok: false,
        error: `年級不符：此房間只限 ${this.S.hostForm} 同學加入（你目前為 ${form}）。`,
      };
    }

    return { ok: true, hostForm: this.S.hostForm };
  }

  // =========================================================================
  // WebSocket 升級與 Hibernation 事件處理
  // =========================================================================

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, any];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ email: null, at: Date.now() });

    if (!this.S) {
      this.send(server, {
        t: 'fatal',
        code: 'no_room',
        msg: '找不到這個房間代碼。請檢查代碼，或開新房間。',
      });
      try {
        server.close(4404, 'no room');
      } catch {
        /* ignore */
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: any, raw: string | ArrayBuffer): Promise<void> {
    if (!this.S) {
      try {
        ws.close(4404, 'no room');
      } catch {
        /* ignore */
      }
      return;
    }
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    if (raw === 'ping') {
      ws.send('pong');
      return;
    }

    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() || {};
    const now = Date.now();

    const isRealtimeMsg = msg.t === 'input' || msg.t === 'snap';
    if (!this.allowRate(att.email || 'anon', now, isRealtimeMsg ? 160 : 25)) {
      if (!isRealtimeMsg) {
        this.send(ws, { t: 'toast', bad: true, msg: '操作太頻繁，請慢一點。' });
      }
      return;
    }

    if (msg.t === 'hello') {
      await this.onHello(ws, msg, now);
      return;
    }

    if (!att.email) {
      this.send(ws, { t: 'fatal', code: 'no_hello', msg: '連線未完成驗證，請重新加入房間。' });
      return;
    }

    switch (msg.t) {
      case 'start':
        await this.onStart(ws, att.email, now);
        break;
      case 'loadout':
        await this.onLoadout(ws, att.email, msg, now);
        break;
      case 'input':
        this.onInput(ws, att.email, msg);
        break;
      case 'snap':
        this.onSnap(ws, att.email, msg);
        break;
      case 'forfeit':
        await this.onForfeit(ws, att.email, now);
        break;
      case 'match_end':
        await this.onMatchEnd(ws, att.email, msg, now);
        break;
      case 'leave':
        await this.onLeave(ws, att.email, now);
        break;
      case 'sync':
        this.sendStateTo(ws, att.email);
        break;
    }
  }

  async webSocketClose(ws: any): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: any): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async alarm(): Promise<void> {
    if (!this.S) return;
    const now = Date.now();

    if (now - this.S.createdAt >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.S = null;
      return;
    }

    if (this.S.phase === 'playing' && !this.S.endResult) {
      for (const p of this.S.players) {
        if (!p.connected && p.disconnectedAt && now - p.disconnectedAt >= DISCONNECT_FORFEIT_MS) {
          const loserSeat: 0 | 1 = p.seat;
          const winnerSeat: 0 | 1 = loserSeat === 0 ? 1 : 0;
          const endPayload: MatchEndPayload = {
            t: 'end',
            reason: 'forfeit',
            winnerSeat,
            scores: winnerSeat === 0 ? [3, 0] : [0, 3],
            forfeitBySeat: loserSeat,
            msg: `玩家 ${p.name} 斷線逾 45 秒，系統裁定棄權，由對手獲勝！`,
          };
          await this.finalizeMatchEnd(endPayload, now);
          break;
        }
      }
    }

    await this.scheduleNextAlarm(now);
  }

  // =========================================================================
  // 房間內部邏輯與完場 +60s + 排行榜寫入
  // =========================================================================

  private async finalizeMatchEnd(endPayload: MatchEndPayload, now: number): Promise<void> {
    if (!this.S || this.S.endResult) return;

    this.S.phase = 'ended';
    this.S.endResult = endPayload;
    this.S.updatedAt = now;
    await this.ctx.storage.put('S', this.S);

    this.broadcastAll(endPayload as unknown as Record<string, unknown>);
    this.broadcastState();

    if (!this.S.studyRewardLogged && this.S.players.length >= 2) {
      this.S.studyRewardLogged = true;
      await this.ctx.storage.put('S', this.S);
      const snapshotPlayers = this.S.players.map((p) => ({ ...p }));
      const roomCode = this.S.code;
      const hostForm = this.S.hostForm;
      const startedAtMs = this.S.startedAt || this.S.createdAt;
      this.ctx.waitUntil(
        this.logPostMatchToSheet(snapshotPlayers, roomCode, hostForm, startedAtMs, now, endPayload),
      );
    }
  }

  private async logPostMatchToSheet(
    players: RoomPlayer[],
    roomCode: string,
    form: FormLevel,
    startedAtMs: number,
    finishedAtMs: number,
    endPayload: MatchEndPayload,
  ): Promise<void> {
    const env = (this as any).env as EnvSheetWebhook;
    if (!hasSheetWebhookCreds(env)) {
      console.info(`[BattleRoom ${roomCode}] skip GAS study/match webhook (no SHEET_WEBHOOK_URL/SHEET_SECRET)`);
      return;
    }

    const hkDate = getHkDate(finishedAtMs);
    const startedIso = new Date(startedAtMs).toISOString();
    const finishedIso = new Date(finishedAtMs).toISOString();

    for (const p of players) {
      const idemKey = `study_logged:${roomCode}:${p.email}`;
      const already = await this.ctx.storage.get(idemKey);
      if (already) continue;

      await this.ctx.storage.put(idemKey, finishedAtMs);

      // 1) 寫入「學習記錄」+60 秒（append_study）
      const studyRes = await postAppendStudy60s(env, {
        email: p.email,
        googleEmail: p.email,
        name: p.name,
        form,
        roomCode,
        validSeconds: 60,
      });
      console.info(`[BattleRoom ${roomCode}] append_study (${p.email}):`, studyRes);

      // 2) 寫入「對戰場次」並 upsert「對戰排行」（append_match）
      let resultTag: 'win' | 'loss' | 'forfeit' | 'draw' = 'draw';
      let winsDelta = 0;
      let lossesDelta = 0;
      if (endPayload.winnerSeat === null) {
        resultTag = 'draw';
      } else if (endPayload.winnerSeat === p.seat) {
        resultTag = 'win';
        winsDelta = 1;
      } else {
        resultTag = endPayload.reason === 'forfeit' && endPayload.forfeitBySeat === p.seat ? 'forfeit' : 'loss';
        lossesDelta = 1;
      }

      const matchRes = await postAppendMatch(env, {
        hkDate,
        email: p.email,
        name: p.name,
        className: p.className || '',
        roomCode,
        form,
        role: p.role,
        startedAt: startedIso,
        finishedAt: finishedIso,
        result: resultTag,
        winsDelta,
        lossesDelta,
      });
      console.info(`[BattleRoom ${roomCode}] append_match (${p.email}):`, matchRes);
    }
  }

  private async scheduleNextAlarm(now = Date.now()): Promise<void> {
    if (!this.S) return;
    let nextAt = this.S.createdAt + ROOM_TTL_MS;
    if (this.S.phase === 'playing' && !this.S.endResult) {
      for (const p of this.S.players) {
        if (!p.connected && p.disconnectedAt) {
          const forfeitAt = p.disconnectedAt + DISCONNECT_FORFEIT_MS;
          if (forfeitAt < nextAt) nextAt = forfeitAt;
        }
      }
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1000, nextAt));
  }

  private async onHello(ws: any, msg: Record<string, any>, now: number): Promise<void> {
    if (!this.S) return;

    const email = String(msg.email ?? '').trim().toLowerCase();
    const form = normalizeForm(msg.form);
    const name = String(msg.name ?? email.split('@')[0] ?? '玩家').trim();
    const className = String(msg.className ?? '').trim();

    if (!email || !email.includes('@')) {
      this.send(ws, { t: 'fatal', code: 'bad_email', msg: '電郵格式無效，請重新登入。' });
      try {
        ws.close(4400, 'bad email');
      } catch {
        /* ignore */
      }
      return;
    }

    if (!form) {
      this.send(ws, {
        t: 'fatal',
        code: 'bad_form',
        msg: '對戰房間只開放予中一至中三（F1／F2／F3）同學。',
      });
      try {
        ws.close(4403, 'bad form');
      } catch {
        /* ignore */
      }
      return;
    }

    if (form !== this.S.hostForm) {
      this.send(ws, {
        t: 'fatal',
        code: 'form_mismatch',
        msg: `年級不符：此房間為 ${this.S.hostForm} 專屬，你目前為 ${form}，無法跨級對戰。`,
      });
      try {
        ws.close(4403, 'form mismatch');
      } catch {
        /* ignore */
      }
      return;
    }

    let player = this.S.players.find((p) => p.email === email);

    if (!player) {
      if (this.S.phase === 'playing' || this.S.phase === 'ended') {
        this.send(ws, { t: 'fatal', code: 'already_started', msg: '對戰已經開始，無法中途加入。' });
        try {
          ws.close(4403, 'already started');
        } catch {
          /* ignore */
        }
        return;
      }

      if (this.S.players.length >= 2) {
        this.send(ws, { t: 'fatal', code: 'room_full', msg: '房間已滿（最多 2 人），無法作為第 3 人加入。' });
        try {
          ws.close(4403, 'room full');
        } catch {
          /* ignore */
        }
        return;
      }

      const hasHost = this.S.players.some((p) => p.role === 'host');
      const role: PlayerRole = hasHost ? 'guest' : 'host';
      const seat: 0 | 1 = role === 'host' ? 0 : 1;
      player = {
        email,
        name,
        className: className || undefined,
        form,
        role,
        seat,
        connected: true,
        joinedAt: now,
      };
      this.S.players.push(player);
    } else {
      player.connected = true;
      player.disconnectedAt = undefined;
      player.name = name || player.name;
      if (className) player.className = className;
      player.seat = player.role === 'host' ? 0 : 1;
    }

    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment() || {};
      if (a.email === email) {
        this.send(other, { t: 'fatal', code: 'replaced', msg: '你已在另一個分頁或裝置重新連線。' });
        try {
          other.close(4001, 'replaced');
        } catch {
          /* ignore */
        }
        other.serializeAttachment({ email: null });
      }
    }

    ws.serializeAttachment({ email, role: player.role, seat: player.seat, at: now });
    this.recomputePhase();
    this.S.updatedAt = now;
    await this.ctx.storage.put('S', this.S);
    await this.scheduleNextAlarm(now);

    this.send(ws, {
      t: 'welcome',
      code: this.S.code,
      role: player.role,
      seat: player.seat,
      form: this.S.hostForm,
      email: player.email,
    });

    this.broadcastState();

    if (this.S.matchReadySent) {
      const m = this.buildMatchReadyMsg();
      if (m) this.send(ws, m);
      if (this.S.lastSnap) {
        this.send(ws, this.S.lastSnap);
      }
    }
    if (this.S.endResult) {
      this.send(ws, this.S.endResult as unknown as Record<string, unknown>);
    }
  }

  private async onStart(ws: any, email: string, now: number): Promise<void> {
    if (!this.S) return;

    if (this.S.phase === 'playing') {
      this.broadcastState();
      return;
    }

    const connectedPlayers = this.S.players.filter((p) => p.connected);
    if (this.S.players.length < 2 || connectedPlayers.length < 2) {
      this.send(ws, { t: 'toast', bad: true, msg: '需要 2 位同級玩家同時在線方可開始對戰。' });
      return;
    }

    const caller = this.S.players.find((p) => p.email === email);
    if (!caller) return;

    if (!this.S.playsConsumed) {
      const hkDate = getHkDate(now);
      const env = (this as any).env;
      const meterStub = env.ROOMS.get(env.ROOMS.idFromName(`plays:${hkDate}`));
      const emails = this.S.players.map((p) => p.email);
      const consumeRes = await meterStub.consumeBatch(emails, this.S.code, hkDate);

      if (!consumeRes?.ok) {
        this.send(ws, {
          t: 'toast',
          bad: true,
          msg: consumeRes?.error || '有玩家今日對戰次數已滿（上限 3 場），無法開戰。',
        });
        return;
      }
      this.S.playsConsumed = true;
    }

    for (const p of this.S.players) {
      p.seat = p.role === 'host' ? 0 : 1;
      p.loadoutIds = undefined;
    }
    const seedArr = new Uint32Array(1);
    crypto.getRandomValues(seedArr);
    this.S.matchSeed = seedArr[0] || 987654321;
    this.S.matchReadySent = false;
    this.S.lastSnap = null;
    this.S.endResult = null;
    this.S.studyRewardLogged = false;
    this.S.phase = 'playing';
    this.S.startedAt = now;
    this.S.updatedAt = now;
    await this.ctx.storage.put('S', this.S);

    this.broadcastState();
    this.broadcastAll({
      t: 'started',
      code: this.S.code,
      startedAt: now,
      msg: '對戰開始！已扣除今日 1 次對戰配額，請組裝出戰陀螺。',
    });
  }

  private async onLoadout(ws: any, email: string, msg: Record<string, any>, now: number): Promise<void> {
    if (!this.S || this.S.phase !== 'playing') return;
    const player = this.S.players.find((p) => p.email === email);
    if (!player) return;

    if (!isValidLoadoutIds(msg.ids)) {
      this.send(ws, { t: 'toast', bad: true, msg: '陣容資料格式不正確，請重新選擇卡牌。' });
      return;
    }

    player.loadoutIds = {
      A: msg.ids.A.trim(),
      B: msg.ids.B.trim(),
      C: msg.ids.C.trim(),
    };
    this.S.updatedAt = now;

    const host = this.S.players.find((p) => p.role === 'host');
    const guest = this.S.players.find((p) => p.role === 'guest');

    this.broadcastState();

    if (host?.loadoutIds && guest?.loadoutIds && !this.S.matchReadySent) {
      this.S.matchReadySent = true;
      await this.ctx.storage.put('S', this.S);
      const readyPayload = this.buildMatchReadyMsg();
      if (readyPayload) {
        this.broadcastAll(readyPayload);
      }
    } else {
      await this.ctx.storage.put('S', this.S);
    }
  }

  private buildMatchReadyMsg(): Record<string, unknown> | null {
    if (!this.S) return null;
    const host = this.S.players.find((p) => p.role === 'host');
    const guest = this.S.players.find((p) => p.role === 'guest');
    if (!host?.loadoutIds || !guest?.loadoutIds) return null;
    return {
      t: 'match_ready',
      code: this.S.code,
      matchSeed: this.S.matchSeed || 123456789,
      hostSeat: 0,
      loadouts: [host.loadoutIds, guest.loadoutIds],
      players: [
        { email: host.email, name: host.name, form: host.form, role: 'host', seat: 0 },
        { email: guest.email, name: guest.name, form: guest.form, role: 'guest', seat: 1 },
      ],
    };
  }

  private onInput(ws: any, email: string, msg: Record<string, any>): void {
    if (!this.S || this.S.phase !== 'playing') return;
    const sender = this.S.players.find((p) => p.email === email);
    if (!sender) return;

    const payload: Record<string, unknown> = {
      t: 'input',
      seat: sender.seat,
      seq: Number(msg.seq ?? 0),
      steer:
        msg.steer && typeof msg.steer === 'object'
          ? { x: Number(msg.steer.x || 0), z: Number(msg.steer.z || 0) }
          : undefined,
      aim: typeof msg.aim === 'number' ? msg.aim : undefined,
      edges: msg.edges && typeof msg.edges === 'object' ? msg.edges : undefined,
      launch: msg.launch && typeof msg.launch === 'object' ? msg.launch : undefined,
      quizCharge: typeof msg.quizCharge === 'number' ? msg.quizCharge : undefined,
    };

    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment() || {};
      if (a.email && a.email !== email) {
        this.send(other, payload);
      }
    }
  }

  private onSnap(ws: any, email: string, msg: Record<string, any>): void {
    if (!this.S || this.S.phase !== 'playing') return;
    const sender = this.S.players.find((p) => p.email === email);
    if (!sender || sender.role !== 'host') return;

    const payload: Record<string, unknown> = {
      t: 'snap',
      seq: Number(msg.seq ?? 0),
      tHost: Number(msg.tHost ?? Date.now()),
      phase: msg.phase,
      round: msg.round,
      roundTime: msg.roundTime,
      scores: msg.scores,
      mode: msg.mode,
      bodies: msg.bodies,
      specialCharge: msg.specialCharge,
      hostAim: msg.hostAim,
      events: msg.events,
      roundResult: msg.roundResult,
    };

    this.S.lastSnap = payload;

    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment() || {};
      if (a.email && a.email !== email) {
        this.send(other, payload);
      }
    }
  }

  private async onForfeit(_ws: any, email: string, now: number): Promise<void> {
    if (!this.S || (this.S.phase !== 'playing' && this.S.phase !== 'ready')) return;
    if (this.S.endResult) return;

    const quitter = this.S.players.find((p) => p.email === email);
    if (!quitter) return;

    const loserSeat: 0 | 1 = quitter.seat;
    const winnerSeat: 0 | 1 = loserSeat === 0 ? 1 : 0;

    const endPayload: MatchEndPayload = {
      t: 'end',
      reason: 'forfeit',
      winnerSeat,
      scores: winnerSeat === 0 ? [3, 0] : [0, 3],
      forfeitBySeat: loserSeat,
      msg: `${quitter.name} 已宣布棄權，由對手獲勝！`,
    };

    await this.finalizeMatchEnd(endPayload, now);
  }

  private async onMatchEnd(_ws: any, email: string, msg: Record<string, any>, now: number): Promise<void> {
    if (!this.S || this.S.phase !== 'playing') return;
    if (this.S.endResult) return;

    const sender = this.S.players.find((p) => p.email === email);
    if (!sender || sender.role !== 'host') return;

    const scores: [number, number] = Array.isArray(msg.scores)
      ? [Number(msg.scores[0] || 0), Number(msg.scores[1] || 0)]
      : [0, 0];
    const winnerSeat: 0 | 1 | null =
      msg.winnerSeat === 0 || msg.winnerSeat === 1
        ? msg.winnerSeat
        : scores[0] > scores[1]
          ? 0
          : scores[1] > scores[0]
            ? 1
            : null;

    const endPayload: MatchEndPayload = {
      t: 'end',
      reason: 'normal',
      winnerSeat,
      scores,
      msg: '雙人對戰完場！',
    };

    await this.finalizeMatchEnd(endPayload, now);
  }

  private async onLeave(ws: any, email: string, now: number): Promise<void> {
    if (!this.S) return;
    if (this.S.phase === 'lobby' || this.S.phase === 'ready') {
      this.S.players = this.S.players.filter((p) => p.email !== email);
      if (this.S.players.length === 1 && this.S.players[0].role !== 'host') {
        this.S.players[0].role = 'host';
        this.S.players[0].seat = 0;
      }
      this.recomputePhase();
      this.S.updatedAt = now;
      await this.ctx.storage.put('S', this.S);
    }
    ws.serializeAttachment({ email: null });
    try {
      ws.close(1000, 'left');
    } catch {
      /* ignore */
    }
    this.broadcastState();
  }

  private async handleDisconnect(ws: any): Promise<void> {
    if (!this.S) return;
    const att = ws.deserializeAttachment() || {};
    if (!att.email) return;

    let stillLive = false;
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment() || {};
      if (a.email === att.email) {
        stillLive = true;
        break;
      }
    }

    if (!stillLive) {
      const p = this.S.players.find((x) => x.email === att.email);
      if (p) {
        const now = Date.now();
        p.connected = false;
        p.disconnectedAt = now;
        this.recomputePhase();
        this.S.updatedAt = now;
        await this.ctx.storage.put('S', this.S);
        await this.scheduleNextAlarm(now);
        this.broadcastState();

        if (this.S.phase === 'playing' && !this.S.endResult) {
          this.broadcastAll({
            t: 'toast',
            bad: true,
            msg: `玩家 ${p.name} 暫時斷線，若 45 秒內未重連將自動判負。`,
          });
        }
      }
    }
  }

  private recomputePhase(): void {
    if (!this.S) return;
    if (this.S.phase === 'playing' || this.S.phase === 'ended') return;
    const liveCount = this.S.players.filter((p) => p.connected).length;
    this.S.phase = this.S.players.length === 2 && liveCount === 2 ? 'ready' : 'lobby';
  }

  private sendStateTo(ws: any, email: string): void {
    if (!this.S) return;
    const you = this.S.players.find((p) => p.email === email) || null;
    this.send(ws, {
      t: 'state',
      phase: this.S.phase,
      code: this.S.code,
      hostForm: this.S.hostForm,
      players: this.S.players.map((p) => ({
        email: p.email,
        name: p.name,
        className: p.className,
        form: p.form,
        role: p.role,
        seat: p.seat,
        connected: p.connected,
        loadoutReady: !!p.loadoutIds,
      })),
      you: you
        ? {
            email: you.email,
            name: you.name,
            className: you.className,
            form: you.form,
            role: you.role,
            seat: you.seat,
            loadoutReady: !!you.loadoutIds,
          }
        : null,
    });
  }

  private broadcastState(): void {
    if (!this.S) return;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (att.email) {
        this.sendStateTo(ws, att.email);
      }
    }
  }

  private broadcastAll(payload: Record<string, unknown>): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, payload);
    }
  }

  private send(ws: any, payload: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  private allowRate(key: string, now: number, maxPerWindow = 25): boolean {
    const bucketKey = `${key}:${maxPerWindow}`;
    const cur = this.rate.get(bucketKey);
    if (!cur || now > cur.resetAt) {
      this.rate.set(bucketKey, { count: 1, resetAt: now + 2000 });
      return true;
    }
    cur.count += 1;
    return cur.count <= maxPerWindow;
  }
}
