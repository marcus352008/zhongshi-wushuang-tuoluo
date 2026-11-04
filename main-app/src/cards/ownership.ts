import type { AuthSession } from '../auth/drawAuth';
import { authHeaders } from '../auth/drawAuth';
import { DRAW_BASE } from '../config/balance';
import type { Card } from './types';

export interface OwnedFetchOpts {
  email: string;
  proof?: string;
  session?: AuthSession | null;
  base?: string;
  /** Extra attempt after network / abort (default 1). */
  retries?: number;
}

export type OwnedFetchKind = 'ok' | 'empty' | 'network' | 'http' | 'parse';

export interface OwnedFetchResult {
  ok: boolean;
  kind: OwnedFetchKind;
  ids: string[];
  /** Traditional Chinese short message for UI. */
  message: string;
  status?: number;
}

function buildHeaders(opts: OwnedFetchOpts): Record<string, string> {
  if (opts.session) return authHeaders(opts.session);
  const h: Record<string, string> = { 'content-type': 'application/json' };
  h['x-user-email'] = opts.email;
  if (opts.proof) h['x-auth-proof'] = opts.proof;
  return h;
}

function parseOwnedIds(body: unknown): { ids: string[]; parseOk: boolean } {
  if (!body || typeof body !== 'object') return { ids: [], parseOk: false };
  const j = body as Record<string, unknown>;
  const raw = j.items ?? j.owned_ids ?? j.ownedIds ?? j.cards;
  if (!Array.isArray(raw)) {
    // Explicit empty success shapes
    if (j.ok === true || j.countUnique === 0 || j.count === 0) return { ids: [], parseOk: true };
    return { ids: [], parseOk: false };
  }
  const ids: string[] = [];
  for (const it of raw) {
    if (typeof it === 'string' && it) {
      ids.push(it);
      continue;
    }
    if (!it || typeof it !== 'object') continue;
    const row = it as Record<string, unknown>;
    const id =
      (typeof row.cardId === 'string' && row.cardId) ||
      (typeof row.card_id === 'string' && row.card_id) ||
      (typeof row.id === 'string' && row.id) ||
      '';
    if (id) ids.push(id);
  }
  return { ids, parseOk: true };
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message)))
  );
}

async function fetchOwnedOnce(opts: OwnedFetchOpts): Promise<OwnedFetchResult> {
  const base = opts.base ?? DRAW_BASE;
  const url = `${base}/api/collection?email=${encodeURIComponent(opts.email)}`;
  const headers = buildHeaders(opts);
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal, mode: 'cors' });
    } catch (e) {
      const msg = isAbortError(e)
        ? '載入擁有卡逾時，請檢查網絡後重試。'
        : '無法連線抽卡收藏，請檢查網絡後重試。';
      return { ok: false, kind: 'network', ids: [], message: msg };
    }
    if (!res.ok) {
      return {
        ok: false,
        kind: 'http',
        ids: [],
        message: `載入擁有卡失敗（伺服器 ${res.status}），請稍後重試。`,
        status: res.status,
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, kind: 'parse', ids: [], message: '擁有卡資料格式錯誤，請稍後重試。' };
    }
    const { ids, parseOk } = parseOwnedIds(body);
    if (!parseOk) {
      return { ok: false, kind: 'parse', ids: [], message: '擁有卡資料格式錯誤，請稍後重試。' };
    }
    if (ids.length === 0) {
      return { ok: true, kind: 'empty', ids: [], message: '你未有擁有卡。' };
    }
    return { ok: true, kind: 'ok', ids, message: `已載入 ${ids.length} 張擁有卡。` };
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Fetch owned card ids from draw-app collection API.
 * Distinguishes network / HTTP / parse failure from a true empty collection.
 * Does one automatic retry on network failures by default.
 */
export async function fetchOwnedCards(
  _pool: readonly Card[] = [],
  opts?: OwnedFetchOpts,
): Promise<OwnedFetchResult> {
  if (!opts?.email) {
    return { ok: true, kind: 'empty', ids: [], message: '未提供電郵，無法載入擁有卡。' };
  }
  const retries = opts.retries ?? 1;
  let last = await fetchOwnedOnce(opts);
  for (let i = 0; i < retries && !last.ok && last.kind === 'network'; i++) {
    await new Promise((r) => window.setTimeout(r, 400));
    last = await fetchOwnedOnce(opts);
  }
  return last;
}

/**
 * Compatibility helper: returns ids on success; throws on fetch failure
 * (caller must not treat throw as empty owned set).
 */
export async function getOwnedCardIds(
  pool: readonly Card[] = [],
  opts?: OwnedFetchOpts,
): Promise<string[]> {
  const r = await fetchOwnedCards(pool, opts);
  if (!r.ok) throw new Error(r.message);
  return r.ids;
}

/** Draw app URL for empty-collection prompt. */
export const DRAW_APP_URL = DRAW_BASE;
