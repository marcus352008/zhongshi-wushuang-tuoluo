/**
 * Google Sheets 讀寫 — 守邊模式：CF Worker POST → Apps Script doPost
 * secrets: SHEET_WEBHOOK_URL + SHEET_SECRET（= Script Property SHARED_SECRET）
 * 唔再用 Service Account。
 * VERSION: draw-app 0.5.5-owned-null-guard sheets
 */

import type { StudyRow } from "./study";

export type EnvSheets = {
  SHEET_WEBHOOK_URL?: string;
  SHEET_SECRET?: string;
  /** @deprecated 已改 webhook；保留相容 */
  GOOGLE_SA_JSON?: string;
  STUDY_SHEET_ID?: string;
  DRAW_SHEET_ID?: string;
};

export type RosterEntry = {
  name: string;
  className: string;
};

type WhJson = {
  ok?: boolean;
  error?: string;
  rows?: StudyRow[];
  entries?: { email: string; name: string; className: string }[];
  appended?: number;
  updated?: number;
  owned?: { ok?: boolean; error?: string; count?: number };
  count?: number;
  ids?: string[];
  ownedIds?: string[];
  items?: { cardId: string; count: number }[];
};

export function hasSheetsCreds(env: EnvSheets): boolean {
  return Boolean(
    env.SHEET_WEBHOOK_URL &&
      env.SHEET_SECRET &&
      String(env.SHEET_WEBHOOK_URL).includes("/exec")
  );
}

const WEBHOOK_TIMEOUT_MS = 9000;
const WEBHOOK_RETRIES = 2;

function isAbortError(e: unknown): boolean {
  const name = String((e as { name?: string })?.name || "");
  const msg = String((e as Error)?.message || e || "");
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /aborted|timed?\s*out|timeout/i.test(msg)
  );
}

function looksLikeHtml(text: string): boolean {
  const t = text.trim().slice(0, 32).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const signal =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (signal) {
    return fetch(url, { ...init, signal });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Apps Script doPost returns 302 → googleusercontent echo URL.
 * redirect:"follow" may re-POST and get 405/HTML; follow manually with GET.
 * Timeout + one retry: echo URL intermittently returns HTML shell.
 */
async function webhookCall(
  env: EnvSheets,
  payload: Record<string, unknown>,
  opts?: { maxAttempts?: number }
): Promise<WhJson> {
  const url = env.SHEET_WEBHOOK_URL;
  const secret = env.SHEET_SECRET;
  if (!url || !secret) throw new Error("SHEET_WEBHOOK_URL / SHEET_SECRET missing");
  const body = JSON.stringify({
    secret,
    source: "wushuang-tuoluo-draw",
    ...payload,
  });

  const maxAttempts = Math.max(
    1,
    Math.min(
      4,
      typeof opts?.maxAttempts === "number" ? opts.maxAttempts : WEBHOOK_RETRIES
    )
  );
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          redirect: "manual",
        },
        WEBHOOK_TIMEOUT_MS
      );
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("Location") || res.headers.get("location");
        if (!loc) {
          throw new Error(`webhook redirect missing Location HTTP ${res.status}`);
        }
        res = await fetchWithTimeout(
          loc,
          { method: "GET", redirect: "follow" },
          WEBHOOK_TIMEOUT_MS
        );
      }
      const text = await res.text();
      if (looksLikeHtml(text)) {
        throw new Error(
          `webhook html-shell HTTP ${res.status} (attempt ${attempt})`
        );
      }
      let j: WhJson = {};
      try {
        j = JSON.parse(text) as WhJson;
      } catch {
        throw new Error(
          `webhook non-json HTTP ${res.status}: ${text.slice(0, 160)}`
        );
      }
      if (!res.ok || j.ok !== true) {
        const errMsg = `webhook failed HTTP ${res.status}: ${j.error || text.slice(0, 160)}`;
        // unknown action: fail fast (no retry) so callers can fall back
        if (/unknown action/i.test(String(j.error || ""))) {
          throw new Error(errMsg);
        }
        throw new Error(errMsg);
      }
      return j;
    } catch (e) {
      lastErr = e as Error;
      if (isAbortError(e)) {
        lastErr = new Error(
          `webhook timeout after ${WEBHOOK_TIMEOUT_MS}ms (action=${String(payload.action || "")})`
        );
      }
      const msg = String((lastErr && lastErr.message) || e || "");
      if (/unknown action/i.test(msg)) break; // no retry
      if (attempt >= maxAttempts) break;
    }
  }
  throw lastErr || new Error("webhook failed");
}

/** 讀「學習記錄」；無 webhook 回 null */
export async function fetchStudyRows(env: EnvSheets): Promise<StudyRow[] | null> {
  if (!hasSheetsCreds(env)) return null;
  const j = await webhookCall(env, { action: "study", email: "" });
  return (j.rows || []).map((r) => ({
    recordedAt: String(r.recordedAt || ""),
    validSeconds: Number(r.validSeconds || 0),
    inputEmail: String((r as StudyRow).inputEmail || ""),
    googleEmail: String((r as StudyRow).googleEmail || ""),
  }));
}

/** 讀某 email 溫習列（較輕） */
export async function fetchStudyRowsForEmail(
  env: EnvSheets,
  email: string
): Promise<StudyRow[] | null> {
  if (!hasSheetsCreds(env)) return null;
  const key = email.trim().toLowerCase();
  const cached = await cacheGetJson<StudyRow[]>(`/study/${key}`);
  if (cached && Array.isArray(cached)) return cached;
  const j = await webhookCall(env, {
    action: "study",
    email: key,
  });
  const rows = (j.rows || []).map((r) => ({
    recordedAt: String(r.recordedAt || ""),
    validSeconds: Number(r.validSeconds || 0),
    inputEmail: String((r as StudyRow).inputEmail || ""),
    googleEmail: String((r as StudyRow).googleEmail || ""),
  }));
  await cachePutJson(`/study/${key}`, rows, EMAIL_SHEET_TTL_SEC);
  return rows;
}

export async function appendDrawLogRow(
  env: EnvSheets,
  row: (string | number | boolean)[]
): Promise<boolean> {
  if (!hasSheetsCreds(env)) return false;
  const obj = {
    drawId: row[0],
    email: row[1],
    drawnAt: row[2],
    cardId: row[3],
    cardName: row[4],
    slot: row[5],
    cost: row[6],
    isDuplicate: row[7],
    creditedSecBefore: row[8],
    entitledBefore: row[9],
    source: row[10],
  };
  await webhookCall(env, { action: "append_draw", row: obj });
  return true;
}

/** 追加／更新「擁有卡」 */
export async function appendOwnedRow(
  env: EnvSheets,
  row: (string | number | boolean)[]
): Promise<boolean> {
  if (!hasSheetsCreds(env)) return false;
  const obj = {
    email: row[0],
    cardId: row[1],
    cardName: row[2],
    slot: row[3],
    cost: row[4],
    count: row[5],
    firstDrawnAt: row[6],
    lastDrawnAt: row[7],
  };
  await webhookCall(env, { action: "append_owned", row: obj });
  return true;
}

/**
 * 一次寫抽卡記錄＋（新卡時）擁有卡 — 減少 webhook round-trips
 */
export async function appendDrawAndOwned(
  env: EnvSheets,
  drawRow: (string | number | boolean)[],
  ownedRow: (string | number | boolean)[] | null
): Promise<boolean> {
  if (!hasSheetsCreds(env)) return false;
  const draw = {
    drawId: drawRow[0],
    email: drawRow[1],
    drawnAt: drawRow[2],
    cardId: drawRow[3],
    cardName: drawRow[4],
    slot: drawRow[5],
    cost: drawRow[6],
    isDuplicate: drawRow[7],
    creditedSecBefore: drawRow[8],
    entitledBefore: drawRow[9],
    source: drawRow[10],
  };
  const owned = ownedRow
    ? {
        email: ownedRow[0],
        cardId: ownedRow[1],
        cardName: ownedRow[2],
        slot: ownedRow[3],
        cost: ownedRow[4],
        count: ownedRow[5],
        firstDrawnAt: ownedRow[6],
        lastDrawnAt: ownedRow[7],
      }
    : undefined;
  await webhookCall(env, {
    action: "append_draw",
    row: draw,
    owned: owned || undefined,
  });
  await invalidateEmailSheetCaches(String(draw.email || ""));
  return true;
}

/** Cloudflare Cache API keys (cross-isolate); soft in-memory as L1 */
const ROSTER_TTL_MS = 20 * 60 * 1000; // 20 min fresh
const ROSTER_STALE_MS = 6 * 60 * 60 * 1000; // 6h serve-stale on GAS failure
/** Cache-Control max-age seconds for per-email study / draw_count */
const EMAIL_SHEET_TTL_SEC = 120;
const CACHE_ORIGIN = "https://wushuang-draw-sheet-cache.internal";
let rosterCache: {
  at: number;
  map: Map<string, RosterEntry>;
  entries: { email: string; name: string; className: string }[];
} | null = null;

function cacheReq(path: string): Request {
  return new Request(`${CACHE_ORIGIN}${path}`);
}

async function cacheGetJson<T>(path: string): Promise<T | null> {
  try {
    const hit = await caches.default.match(cacheReq(path));
    if (!hit) return null;
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}

async function cachePutJson(
  path: string,
  data: unknown,
  maxAgeSec: number
): Promise<void> {
  try {
    await caches.default.put(
      cacheReq(path),
      new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${maxAgeSec}`,
        },
      })
    );
  } catch {
    /* cache optional */
  }
}

async function invalidateEmailSheetCaches(email: string): Promise<void> {
  const k = email.trim().toLowerCase();
  try {
    await caches.default.delete(cacheReq(`/study/${k}`));
    await caches.default.delete(cacheReq(`/draw_count/${k}`));
  } catch {
    /* ignore */
  }
}

function mapFromEntries(
  entries: { email: string; name: string; className: string }[]
): Map<string, RosterEntry> {
  const map = new Map<string, RosterEntry>();
  for (const e of entries) {
    const email = String(e.email || "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    map.set(email, {
      name: String(e.name || "").trim(),
      className: String(e.className || "").trim(),
    });
  }
  return map;
}

function staleRosterIfAny(now: number): Map<string, RosterEntry> | null {
  if (rosterCache && now - rosterCache.at < ROSTER_STALE_MS) {
    return rosterCache.map;
  }
  return null;
}

export async function fetchRoster(
  env: EnvSheets
): Promise<Map<string, RosterEntry> | null> {
  if (!hasSheetsCreds(env)) return null;
  const now = Date.now();
  if (rosterCache && now - rosterCache.at < ROSTER_TTL_MS) {
    return rosterCache.map;
  }
  const cached = await cacheGetJson<{
    entries: { email: string; name: string; className: string }[];
    at?: number;
  }>("/roster");
  if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
    const map = mapFromEntries(cached.entries);
    rosterCache = { at: now, map, entries: cached.entries };
    return map;
  }
  try {
    const j = await webhookCall(env, { action: "roster" });
    const entries: { email: string; name: string; className: string }[] = [];
    for (const e of j.entries || []) {
      const email = String(e.email || "").trim().toLowerCase();
      if (!email.includes("@")) continue;
      entries.push({
        email,
        name: String(e.name || "").trim(),
        className: String(e.className || "").trim(),
      });
    }
    const map = mapFromEntries(entries);
    rosterCache = { at: now, map, entries };
    await cachePutJson(
      "/roster",
      { entries, at: now },
      Math.floor(ROSTER_TTL_MS / 1000)
    );
    return map;
  } catch (e) {
    const stale = staleRosterIfAny(now);
    if (stale) {
      console.error("roster webhook failed; serving stale", e);
      return stale;
    }
    // CF Cache may still hold entries even if L1 empty (isolate cold)
    if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
      console.error("roster webhook failed; serving CF cache", e);
      return mapFromEntries(cached.entries);
    }
    throw e;
  }
}

export async function fetchRosterEmails(
  env: EnvSheets
): Promise<Set<string> | null> {
  const roster = await fetchRoster(env);
  if (!roster) return null;
  return new Set(roster.keys());
}

/** 健康檢查 ping */
export async function pingSheetWebhook(
  env: EnvSheets
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSheetsCreds(env)) return { ok: false, error: "not configured" };
  try {
    await webhookCall(env, { action: "ping" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}

/** 抽卡記錄筆數（按 email） */
export async function fetchDrawCountForEmail(
  env: EnvSheets,
  email: string
): Promise<number | null> {
  if (!hasSheetsCreds(env)) return null;
  const key = email.trim().toLowerCase();
  const cached = await cacheGetJson<{ count: number }>(`/draw_count/${key}`);
  if (cached && typeof cached.count === "number") return cached.count;
  const j = await webhookCall(env, {
    action: "draw_count",
    email: key,
  });
  const count = Number((j as { count?: number }).count || 0);
  await cachePutJson(`/draw_count/${key}`, { count }, EMAIL_SHEET_TTL_SEC);
  return count;
}

export async function fetchOwnedIdsForEmail(
  env: EnvSheets,
  email: string
): Promise<Set<string> | null> {
  if (!hasSheetsCreds(env)) return null;
  const j = await webhookCall(env, {
    action: "owned_ids",
    email: email.trim().toLowerCase(),
  }) as { ids?: string[] };
  return new Set((j.ids || []).map(String));
}

export async function fetchOwnedItemsForEmail(
  env: EnvSheets,
  email: string
): Promise<{ cardId: string; count: number }[] | null> {
  if (!hasSheetsCreds(env)) return null;
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return [];

  let j: WhJson;
  try {
    j = await webhookCall(env, {
      action: "owned_ids",
      email: cleanEmail,
    });
  } catch (e) {
    console.warn("[sheets] fetchOwnedItemsForEmail failed:", e);
    return null;
  }

  // webhookCall already requires ok===true, but keep an explicit guard.
  if (!j || j.ok === false) {
    console.warn(
      "[sheets] fetchOwnedItemsForEmail non-ok response:",
      j && (j as WhJson).error
    );
    return null;
  }

  if (Array.isArray(j.items)) {
    const out: { cardId: string; count: number }[] = [];
    for (const it of j.items) {
      const cardId = typeof it?.cardId === "string" ? it.cardId.trim() : "";
      const count = Number(it?.count ?? 1);
      if (cardId && count > 0) {
        out.push({ cardId, count });
      }
    }
    return out;
  }

  // Older / partial GAS shapes may return only ids[].
  if (Array.isArray(j.ids)) {
    const counts = new Map<string, number>();
    for (const rawId of j.ids) {
      const cardId = typeof rawId === "string" ? rawId.trim() : "";
      if (!cardId) continue;
      counts.set(cardId, (counts.get(cardId) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([cardId, count]) => ({
      cardId,
      count,
    }));
  }

  // Ambiguous success without items/ids — do NOT treat as empty collection.
  return null;
}


export type DrawPrep = {
  count: number | null;
  rows: StudyRow[] | null;
  ownedIds: Set<string> | null;
};

/**
 * One GAS round-trip for draw pre-reads (count + study + owned).
 * Falls back to Promise.all of the three actions if draw_prep unknown/fails.
 */
export async function fetchDrawPrep(
  env: EnvSheets,
  email: string
): Promise<DrawPrep | null> {
  if (!hasSheetsCreds(env)) return null;
  const key = email.trim().toLowerCase();
  try {
    const j = await webhookCall(
      env,
      {
        action: "draw_prep",
        email: key,
      },
      { maxAttempts: 1 }
    );
    const rows = (j.rows || []).map((r) => ({
      recordedAt: String(r.recordedAt || ""),
      validSeconds: Number(r.validSeconds || 0),
      inputEmail: String((r as StudyRow).inputEmail || ""),
      googleEmail: String((r as StudyRow).googleEmail || ""),
    }));
    const ids = (j.ownedIds || j.ids || []).map(String);
    const count = Number(j.count || 0);
    await cachePutJson(`/study/${key}`, rows, EMAIL_SHEET_TTL_SEC);
    await cachePutJson(`/draw_count/${key}`, { count }, EMAIL_SHEET_TTL_SEC);
    return { count, rows, ownedIds: new Set(ids) };
  } catch (e) {
    console.error("draw_prep failed; falling back to parallel reads", e);
    const [count, rows, owned] = await Promise.all([
      fetchDrawCountForEmail(env, key).catch((err) => {
        console.error("sheet draw_count failed", err);
        return null as number | null;
      }),
      fetchStudyRowsForEmail(env, key).catch((err) => {
        console.error("sheet study failed", err);
        return null as StudyRow[] | null;
      }),
      fetchOwnedIdsForEmail(env, key).catch((err) => {
        console.error("sheet owned_ids failed", err);
        return null as Set<string> | null;
      }),
    ]);
    if (count == null && rows == null && owned == null) return null;
    return { count, rows, ownedIds: owned };
  }
}

