/**
 * Google Sheets 讀寫 — 守邊模式：CF Worker / BattleRoom DO POST → Apps Script doPost
 * secrets: SHEET_WEBHOOK_URL + SHEET_SECRET（= Script Property SHARED_SECRET）
 * 對齊 draw-app webhookCall（手動跟隨 302 redirect 為 GET，避免 POST 重導向 405）
 */

export interface EnvSheetWebhook {
  SHEET_WEBHOOK_URL?: string;
  SHEET_SECRET?: string;
}

export interface AppendStudyParams {
  email: string;
  googleEmail?: string;
  name?: string;
  form?: string;
  roomCode: string;
  validSeconds?: number;
}

export interface AppendMatchParams {
  hkDate: string;
  email: string;
  name?: string;
  className?: string;
  roomCode: string;
  form: string;
  role: 'host' | 'guest';
  startedAt: string;
  finishedAt: string;
  result: 'win' | 'loss' | 'forfeit' | 'draw';
  winsDelta: number;
  lossesDelta: number;
}

export interface LeaderboardEntry {
  rank: number;
  email: string;
  name: string;
  className: string;
  form: string;
  wins: number;
  losses: number;
  updatedAt: string;
}

export interface LeaderboardApiResult {
  ok: boolean;
  rows: LeaderboardEntry[];
  count: number;
  formFilter: 'F1' | 'F2' | 'F3' | null;
  degraded?: boolean;
  error?: string;
}

export interface WebhookResponse {
  ok?: boolean;
  error?: string;
  appended?: number;
  updated?: number;
  validSeconds?: number;
  rows?: unknown[];
  count?: number;
  [k: string]: unknown;
}

const WEBHOOK_TIMEOUT_MS = 9000;
const WEBHOOK_RETRIES = 2;

export function hasSheetWebhookCreds(env?: EnvSheetWebhook | null): boolean {
  return Boolean(
    env &&
      env.SHEET_WEBHOOK_URL &&
      env.SHEET_SECRET &&
      String(env.SHEET_WEBHOOK_URL).includes('/exec'),
  );
}

function looksLikeHtml(text: string): boolean {
  const t = text.trim().slice(0, 32).toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 呼叫 GAS Web App doPost。
 * GAS doPost 成功後常回傳 302 Location (googleusercontent)，必須手動改用 GET 跟隨。
 */
export async function callSheetWebhook(
  env: EnvSheetWebhook,
  payload: Record<string, unknown>,
  maxAttempts = WEBHOOK_RETRIES,
): Promise<WebhookResponse> {
  const url = env.SHEET_WEBHOOK_URL;
  const secret = env.SHEET_SECRET;
  if (!url || !secret) {
    return { ok: false, error: 'SHEET_WEBHOOK_URL / SHEET_SECRET not configured' };
  }

  const body = JSON.stringify({
    secret,
    source: 'wushuang_pvp',
    ...payload,
  });

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          redirect: 'manual',
        },
        WEBHOOK_TIMEOUT_MS,
      );

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location') || res.headers.get('location');
        if (!loc) {
          throw new Error(`webhook redirect missing Location HTTP ${res.status}`);
        }
        res = await fetchWithTimeout(
          loc,
          {
            method: 'GET',
            redirect: 'follow',
          },
          WEBHOOK_TIMEOUT_MS,
        );
      }

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`webhook HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      if (looksLikeHtml(text)) {
        throw new Error('webhook returned HTML instead of JSON');
      }
      const parsed = JSON.parse(text) as WebhookResponse;
      return parsed;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn(`[sheetWebhook] attempt ${attempt}/${maxAttempts} failed:`, lastErr.message);
    }
  }

  return { ok: false, error: lastErr?.message || 'webhook failed' };
}

/**
 * 完場寫入「學習記錄」+60 秒（action: 'append_study'）。
 */
export async function postAppendStudy60s(
  env: EnvSheetWebhook,
  params: AppendStudyParams,
): Promise<WebhookResponse> {
  if (!hasSheetWebhookCreds(env)) {
    console.info('[sheetWebhook] skip append_study (no SHEET_WEBHOOK_URL/SHEET_SECRET)');
    return { ok: false, error: 'skipped_no_creds' };
  }
  const sec = params.validSeconds ?? 60;
  return callSheetWebhook(env, {
    action: 'append_study',
    email: params.email,
    googleEmail: params.googleEmail || params.email,
    name: params.name || params.email.split('@')[0] || '',
    grade: params.form || '',
    form: params.form || '',
    unit: 'wushuang_pvp',
    source: 'wushuang_pvp',
    validSeconds: sec,
    sessionId: `pvp_${params.roomCode}`,
    roomCode: params.roomCode,
  });
}

/**
 * 完場寫入「對戰場次」並更新排行榜累計（action: 'append_match'）。
 */
export async function postAppendMatch(
  env: EnvSheetWebhook,
  row: AppendMatchParams,
): Promise<WebhookResponse> {
  if (!hasSheetWebhookCreds(env)) {
    return { ok: false, error: 'skipped_no_creds' };
  }
  return callSheetWebhook(env, {
    action: 'append_match',
    row,
  });
}

/**
 * 讀取「對戰排行」頭 20 名（action: 'leaderboard_top20'）。
 * 排序規則：wins DESC → losses ASC → updatedAt ASC → email ASC。
 */
export async function fetchLeaderboardTop20(
  env: EnvSheetWebhook,
  opts?: { form?: 'F1' | 'F2' | 'F3' | null },
): Promise<LeaderboardApiResult> {
  const formFilter = opts?.form ?? null;
  if (!hasSheetWebhookCreds(env)) {
    return {
      ok: true,
      rows: [],
      count: 0,
      formFilter,
      degraded: true,
    };
  }

  const res = await callSheetWebhook(env, {
    action: 'leaderboard_top20',
    form: formFilter || '',
  });

  if (!res.ok || !Array.isArray(res.rows)) {
    return {
      ok: true,
      rows: [],
      count: 0,
      formFilter,
      degraded: true,
      error: res.error || 'leaderboard_unavailable',
    };
  }

  const normalized = res.rows
    .map((item) => {
      const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const email = String(r.email ?? '').trim().toLowerCase();
      const name = String(r.name ?? '').trim() || email.split('@')[0] || '';
      const className = String(r.className ?? '').trim();
      const form = String(r.form ?? '').trim().toUpperCase();
      const wins = Math.max(0, Number(r.wins ?? 0) || 0);
      const losses = Math.max(0, Number(r.losses ?? 0) || 0);
      const updatedAt = String(r.updatedAt ?? '').trim();
      return { email, name, className, form, wins, losses, updatedAt };
    })
    .filter((r) => r.email.includes('@'))
    .filter((r) => !formFilter || r.form === formFilter);

  normalized.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    const tCmp = a.updatedAt.localeCompare(b.updatedAt);
    if (tCmp !== 0) return tCmp;
    return a.email.localeCompare(b.email);
  });

  const top20: LeaderboardEntry[] = normalized.slice(0, 20).map((r, idx) => ({
    rank: idx + 1,
    ...r,
  }));

  return {
    ok: true,
    rows: top20,
    count: top20.length,
    formFilter,
  };
}
