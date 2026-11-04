import { BattleRoom } from './BattleRoom';
import {
  getHkClock,
  isLoginHoursOpen,
  LOGIN_CLOSE_HOUR,
  LOGIN_OPEN_HOUR,
  MAINTENANCE_MSG,
} from './loginHours';
import { fetchLeaderboardTop20, type LeaderboardApiResult } from './sheetWebhook';

export { BattleRoom };

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  ROOMS: any;
  VERSION?: string;
  /** 可選：Apps Script Web App URL (/exec)，用於完場寫入 +60s 學習記錄、對戰場次與讀取排行榜 */
  SHEET_WEBHOOK_URL?: string;
  /** 可選：Apps Script Shared Secret (SHARED_SECRET) */
  SHEET_SECRET?: string;
}

const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DAILY_LIMIT = 3;
const LEADERBOARD_CACHE_TTL_MS = 20 * 1000; // 20 秒短效快取，減輕 GAS 壓力

const leaderboardCache = new Map<string, { expiresAt: number; data: LeaderboardApiResult }>();

export function getHkDate(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

function generateRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += SAFE_CHARS[bytes[i] % SAFE_CHARS.length];
  }
  return out;
}

function normalizeRoomCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeForm(raw: unknown): 'F1' | 'F2' | 'F3' | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'F1' || s === 'F2' || s === 'F3') return s;
  return null;
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-user-email, x-auth-proof',
  };
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(),
    },
  });
}

function loginClosedResp(): Response {
  const clock = getHkClock();
  return jsonResp(
    {
      ok: false,
      loginOpen: false,
      error: MAINTENANCE_MSG,
      message: MAINTENANCE_MSG,
      hkDate: clock.date,
      hkTime: clock.timeLabel,
      openHour: LOGIN_OPEN_HOUR,
      closeHour: LOGIN_CLOSE_HOUR,
      tz: 'Asia/Hong_Kong',
    },
    403,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS' && (pathname.startsWith('/api/') || pathname.startsWith('/ws/'))) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 0. GET /api/access — login window (HKT 07:00–23:00)
    if (pathname === '/api/access' && request.method === 'GET') {
      const clock = getHkClock();
      const open = isLoginHoursOpen();
      return jsonResp({
        ok: true,
        loginOpen: open,
        message: open ? '' : MAINTENANCE_MSG,
        hkDate: clock.date,
        hkTime: clock.timeLabel,
        openHour: LOGIN_OPEN_HOUR,
        closeHour: LOGIN_CLOSE_HOUR,
        tz: 'Asia/Hong_Kong',
      });
    }

    // 1. WebSocket Upgrade: /ws/pvp/:code
    if (pathname.startsWith('/ws/pvp/')) {
      const code = normalizeRoomCode(pathname.slice('/ws/pvp/'.length));
      if (code.length !== 5) {
        return new Response('無效的房間代碼', { status: 400 });
      }
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    // 2. POST /api/pvp/create-room
    if (pathname === '/api/pvp/create-room' && request.method === 'POST') {
      if (!isLoginHoursOpen()) return loginClosedResp();
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResp({ ok: false, error: '請求格式錯誤。' }, 400);
      }

      const email = String(body.email ?? '').trim().toLowerCase();
      const form = normalizeForm(body.form);
      if (!email || !email.includes('@')) {
        return jsonResp({ ok: false, error: '請提供有效的學校電郵。' }, 400);
      }
      if (!form) {
        return jsonResp({ ok: false, error: '只限中一至中三（F1／F2／F3）開房對戰。' }, 400);
      }

      const hkDate = getHkDate();
      const meterStub = env.ROOMS.get(env.ROOMS.idFromName(`plays:${hkDate}`));
      const quota = await meterStub.getDailyPlays(email, hkDate);
      if (quota.remaining <= 0) {
        return jsonResp(
          {
            ok: false,
            error: `今日對戰次數已用完（${DAILY_LIMIT}/${DAILY_LIMIT}），請明日再戰或選擇「對電腦」。`,
          },
          403,
        );
      }

      let roomCode = '';
      for (let i = 0; i < 8; i++) {
        const candidate = generateRoomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(candidate));
        const exists = await stub.exists();
        if (!exists) {
          const res = await stub.init(candidate, form, email);
          if (res?.ok) {
            roomCode = candidate;
            break;
          }
        }
      }

      if (!roomCode) {
        return jsonResp({ ok: false, error: '系統繁忙，未能建立房間，請再試一次。' }, 503);
      }

      return jsonResp({ ok: true, roomCode, form });
    }

    // 3. POST /api/pvp/join-room
    if (pathname === '/api/pvp/join-room' && request.method === 'POST') {
      if (!isLoginHoursOpen()) return loginClosedResp();
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResp({ ok: false, error: '請求格式錯誤。' }, 400);
      }

      const email = String(body.email ?? '').trim().toLowerCase();
      const form = normalizeForm(body.form);
      const roomCode = normalizeRoomCode(body.roomCode);

      if (roomCode.length !== 5) {
        return jsonResp({ ok: false, error: '請輸入 5 位房間配對碼。' }, 400);
      }
      if (email && email.includes('@')) {
        const hkDate = getHkDate();
        const meterStub = env.ROOMS.get(env.ROOMS.idFromName(`plays:${hkDate}`));
        const quota = await meterStub.getDailyPlays(email, hkDate);
        if (quota.remaining <= 0) {
          return jsonResp(
            {
              ok: false,
              error: `今日對戰次數已用完（${DAILY_LIMIT}/${DAILY_LIMIT}），無法加入對戰房。`,
            },
            403,
          );
        }
      }

      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
      const check = await stub.checkJoinable(form, email);
      if (!check?.ok) {
        return jsonResp({ ok: false, error: check?.error || '無法加入此房間。' }, 400);
      }

      return jsonResp({ ok: true, roomCode, hostForm: check.hostForm });
    }

    // 4. GET /api/pvp/daily-plays?email=
    if (pathname === '/api/pvp/daily-plays' && request.method === 'GET') {
      const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
      const hkDate = getHkDate();
      if (!email) {
        return jsonResp({ ok: false, error: '缺少 email 參數。' }, 400);
      }
      const meterStub = env.ROOMS.get(env.ROOMS.idFromName(`plays:${hkDate}`));
      const stat = await meterStub.getDailyPlays(email, hkDate);
      return jsonResp(stat);
    }

    // 5. POST /api/pvp/consume-play
    if (pathname === '/api/pvp/consume-play' && request.method === 'POST') {
      if (!isLoginHoursOpen()) return loginClosedResp();
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResp({ ok: false, error: '請求格式錯誤。' }, 400);
      }
      const email = String(body.email ?? '').trim().toLowerCase();
      const roomCode = normalizeRoomCode(body.roomCode);
      if (!email || !roomCode) {
        return jsonResp({ ok: false, error: '缺少 email 或 roomCode。' }, 400);
      }
      const hkDate = getHkDate();
      const meterStub = env.ROOMS.get(env.ROOMS.idFromName(`plays:${hkDate}`));
      const res = await meterStub.consumePlay(email, roomCode, hkDate);
      return jsonResp(res, res.ok ? 200 : 400);
    }

    // 6. GET /api/pvp/leaderboard?form=F1|F2|F3&fresh=1
    if (pathname === '/api/pvp/leaderboard' && request.method === 'GET') {
      const formFilter = normalizeForm(url.searchParams.get('form'));
      const forceFresh = url.searchParams.get('fresh') === '1';
      const cacheKey = formFilter || 'ALL';
      const now = Date.now();

      if (!forceFresh) {
        const hit = leaderboardCache.get(cacheKey);
        if (hit && now < hit.expiresAt) {
          return jsonResp({ ...hit.data, cached: true });
        }
      }

      const result = await fetchLeaderboardTop20(env, { form: formFilter });
      if (result.ok && !result.degraded) {
        leaderboardCache.set(cacheKey, {
          expiresAt: now + LEADERBOARD_CACHE_TTL_MS,
          data: result,
        });
      }
      return jsonResp(result);
    }

    // 7. 其他路徑交由 ASSETS 處理（SPA fallback）
    return env.ASSETS.fetch(request);
  },
};
