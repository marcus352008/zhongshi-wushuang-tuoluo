/**
 * 中史無雙 — 抽卡 Worker
 * VERSION: draw-app 0.5.5-owned-null-guard
 */

import cardsJson from "./cards_30.json";
import { loadCards, pickWeightedCard, cardPublicView, type Card } from "./cards";
import {
  summarizeStudy,
  emailPairMismatch,
  EMAIL_PAIR_MISMATCH_MSG,
  type StudyRow,
} from "./study";
import {
  createMemoryStore,
  createKvStore,
  newDrawId,
  nowHkIso,
  type DrawStore,
  type DrawLogEntry,
} from "./store";
import { resolveEmail, getEmailFromRequest, type EnvAuth } from "./auth";
import {
  assertAuthBridge,
  authBridgeConfigured,
  authBridgeUrl,
  type EnvAuthBridge,
} from "./authBridge";
import {
  fetchStudyRowsForEmail,
  appendDrawAndOwned,
  hasSheetsCreds,
  fetchRoster,
  pingSheetWebhook,
  fetchDrawCountForEmail,
  fetchOwnedIdsForEmail,
  fetchOwnedItemsForEmail,
  fetchDrawPrep,
  type EnvSheets,
} from "./sheets";

export interface Env extends EnvAuth, EnvSheets, EnvAuthBridge {
  ASSETS?: Fetcher;
  DRAW_KV?: KVNamespace;
  VERSION?: string;
  MOCK_STUDY_SEC?: string;
  ALLOW_MOCK_AUTH?: string;
  REQUIRE_ROSTER?: string;
}

const CARDS: Card[] = loadCards(cardsJson);
const memoryStore = createMemoryStore();

const CORS_HEADERS =
  "authorization, content-type, x-user-email, x-user-name, x-auth-proof";

/**
 * 有 SA 時核對學生名單 Email；若 client 有傳姓名則再對齊 trim 後姓名。
 * 無 SA（preview）跳過，走 mock 時數。
 */
async function assertRoster(
  email: string,
  providedName: string | null,
  env: Env
): Promise<Response | null> {
  if (env.REQUIRE_ROSTER === "0") return null;
  if (!hasSheetsCreds(env)) return null;
  try {
    const roster = await fetchRoster(env);
    if (!roster) return null;
    const entry = roster.get(email.trim().toLowerCase());
    if (!entry) {
      return json(
        {
          error:
            "此學校帳號不在學生名單，未能抽卡。請確認 email 或聯絡老師。",
        },
        403
      );
    }
    if (providedName) {
      const want = providedName.trim();
      const have = (entry.name || "").trim();
      if (have && want !== have) {
        return json(
          {
            error:
              "姓名與學生名單不符。請核對「姓名」欄（可留空只靠 email，但建議填寫以防亂填）。",
          },
          403
        );
      }
    }
  } catch (e) {
    console.error("roster check failed", e);
    return json({ error: "未能核對學生名單，請稍後再試。" }, 503);
  }
  return null;
}

/** 學習記錄兩邊 email 不符 → 拒登入／拒抽 */
function assertEmailPair(rows: StudyRow[], email: string): Response | null {
  if (emailPairMismatch(rows, email)) {
    return json({ error: EMAIL_PAIR_MISMATCH_MSG, code: "email_mismatch" }, 403);
  }
  return null;
}

function getStore(env: Env): DrawStore {
  if (env.DRAW_KV) return createKvStore(env.DRAW_KV);
  return memoryStore;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": CORS_HEADERS,
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": CORS_HEADERS,
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

/** mock 溫習列：MOCK_STUDY_SEC 或預設示範時數（ALLOW_MOCK_AUTH／無 SA 時用） */
function mockStudyRows(email: string, env: Env): StudyRow[] {
  const raw = (env.MOCK_STUDY_SEC || "").trim();
  if (raw !== "" && Number.isFinite(Number(raw))) {
    const sec = Number(raw);
    const rows: StudyRow[] = [];
    let left = sec;
    let day = 0;
    while (left > 0) {
      const chunk = Math.min(left, 3600);
      const d = new Date(Date.UTC(2026, 0, 1 + day, 4, 0, 0));
      rows.push({
        recordedAt: d.toISOString(),
        validSeconds: chunk,
        googleEmail: email,
      });
      left -= chunk;
      day += 1;
    }
    return rows;
  }
  return [
    {
      recordedAt: "2026-10-01T10:00:00+08:00",
      validSeconds: 5000,
      googleEmail: email,
    },
    {
      recordedAt: "2026-10-02T10:00:00+08:00",
      validSeconds: 1000,
      googleEmail: email,
    },
  ];
}

async function loadStudyRows(
  email: string,
  env: Env
): Promise<{ rows: StudyRow[]; source: string }> {
  if (hasSheetsCreds(env)) {
    try {
      const rows = await fetchStudyRowsForEmail(env, email);
      if (rows) return { rows, source: "sheets" };
    } catch (e) {
      console.error("sheets study failed, fallback mock", e);
    }
  }
  return { rows: mockStudyRows(email, env), source: "mock" };
}

async function handleMe(req: Request, env: Env): Promise<Response> {
  const who = await resolveEmail(req, env);
  if ("error" in who) return json({ error: who.error }, who.status);
  const bridgeBlocked = await assertAuthBridge(req, who.email, env);
  if (bridgeBlocked) return bridgeBlocked;
  const blocked = await assertRoster(who.email, who.name, env);
  if (blocked) return blocked;
  const store = getStore(env);
  let drawLogCount = await store.countDraws(who.email);
  // Parallel sheet reads after roster (cached) — cuts /api/me wall time roughly in half
  const [sheetCount, studyPack] = await Promise.all([
    hasSheetsCreds(env)
      ? fetchDrawCountForEmail(env, who.email).catch((e) => {
          console.error("sheet draw_count failed", e);
          return null as number | null;
        })
      : Promise.resolve(null as number | null),
    loadStudyRows(who.email, env),
  ]);
  if (sheetCount != null) drawLogCount = sheetCount;
  const { rows, source } = studyPack;
  // 0.5.0 學習記錄弱核對改次要（唔擋）；主規則＝GAS ActiveUser proof
  const studyPairMismatch = !!assertEmailPair(rows, who.email);
  const summary = summarizeStudy(rows, who.email, drawLogCount);
  return json({
    version: env.VERSION || "draw-app 0.5.5-owned-null-guard",
    email: who.email,
    authMode: who.mode,
    studySource: source,
    studyPairMismatch,
    ...summary,
    noStarterCards: true,
    cardsInPool: CARDS.length,
  });
}

async function handleDraw(req: Request, env: Env): Promise<Response> {
  const who = await resolveEmail(req, env);
  if ("error" in who) return json({ error: who.error }, who.status);
  const bridgeBlockedDraw = await assertAuthBridge(req, who.email, env);
  if (bridgeBlockedDraw) return bridgeBlockedDraw;
  // body 可帶 name 作核對（header 優先已在 resolveEmail）
  let bodyName: string | null = null;
  try {
    const body = (await req.clone().json()) as { name?: string };
    if (body && typeof body.name === "string" && body.name.trim()) {
      bodyName = body.name.trim();
    }
  } catch {
    /* no body */
  }
  const nameForCheck = who.name || bodyName;
  const blocked = await assertRoster(who.email, nameForCheck, env);
  if (blocked) return blocked;
  const store = getStore(env);
  let drawLogCount = await store.countDraws(who.email);
  let rows: StudyRow[] = [];
  let source = "mock";
  let owned = await store.ownedIds(who.email);

  // Prefer one GAS draw_prep; on failure fetchDrawPrep already parallelizes
  if (hasSheetsCreds(env)) {
    try {
      const prep = await fetchDrawPrep(env, who.email);
      if (prep) {
        if (prep.count != null) drawLogCount = prep.count;
        if (prep.rows) {
          rows = prep.rows;
          source = "sheets";
        } else {
          const studyPack = await loadStudyRows(who.email, env);
          rows = studyPack.rows;
          source = studyPack.source;
        }
        if (prep.ownedIds) owned = prep.ownedIds;
      } else {
        const studyPack = await loadStudyRows(who.email, env);
        rows = studyPack.rows;
        source = studyPack.source;
      }
    } catch (e) {
      console.error("draw prep failed; mock fallback", e);
      const studyPack = await loadStudyRows(who.email, env);
      rows = studyPack.rows;
      source = studyPack.source;
    }
  } else {
    const studyPack = await loadStudyRows(who.email, env);
    rows = studyPack.rows;
    source = studyPack.source;
  }

  // 學習記錄弱核對旁路；主擋＝auth bridge
  const summary = summarizeStudy(rows, who.email, drawLogCount);
  if (summary.remainingDraws < 1) {
    return json(
      {
        error:
          "未夠抽卡次數。請繼續用 Flash Card 溫習（累積 10 分鐘＝1 抽；每日最多入帳 60 分鐘）。",
        ...summary,
        studySource: source,
      },
      400
    );
  }
  const card = pickWeightedCard(CARDS, owned);
  const isDuplicate = owned.has(card.id);
  const entry: DrawLogEntry = {
    drawId: newDrawId(),
    email: who.email,
    drawnAt: nowHkIso(),
    cardId: card.id,
    cardName: card.name,
    slot: card.slot,
    cost: Number(card.cost),
    isDuplicate,
    creditedSecBefore: summary.creditedSec,
    entitledBefore: summary.entitledDraws,
    source: "flashcard_10min",
  };
  await store.appendDraw(entry);
  let sheetOk = false;
  try {
    const drawVals: (string | number | boolean)[] = [
      entry.drawId,
      entry.email,
      entry.drawnAt,
      entry.cardId,
      entry.cardName,
      entry.slot,
      entry.cost,
      entry.isDuplicate,
      entry.creditedSecBefore,
      entry.entitledBefore,
      entry.source,
    ];
    const ownedVals = entry.isDuplicate
      ? null
      : ([
          entry.email,
          entry.cardId,
          entry.cardName,
          entry.slot,
          entry.cost,
          1,
          entry.drawnAt,
          entry.drawnAt,
        ] as (string | number | boolean)[]);
    sheetOk = await appendDrawAndOwned(env, drawVals, ownedVals);
  } catch (e) {
    console.error("抽卡記錄／擁有卡 sheet webhook failed", e);
  }
  const afterCount = drawLogCount + 1;
  const after = summarizeStudy(rows, who.email, afterCount);
  return json({
    ok: true,
    card: cardPublicView(card),
    isDuplicate,
    draw: entry,
    remainingDraws: after.remainingDraws,
    entitledDraws: after.entitledDraws,
    creditedSec: after.creditedSec,
    studySource: source,
    persistedToSheet: sheetOk,
    store: env.DRAW_KV ? "kv" : "memory",
  });
}

async function handleCollection(req: Request, env: Env): Promise<Response> {
  const who = await resolveEmail(req, env);
  if ("error" in who) return json({ error: who.error }, who.status);
  const store = getStore(env);
  let col = await store.collection(who.email);
  if (hasSheetsCreds(env)) {
    try {
      const itemsSheet = await fetchOwnedItemsForEmail(env, who.email);
      // Only adopt Sheet result when it is a real array. Empty Sheet + non-empty
      // store keeps store (prevents webhook/GAS drift wiping student cards).
      if (Array.isArray(itemsSheet)) {
        if (itemsSheet.length > 0 || col.length === 0) {
          col = itemsSheet.map((o) => ({
            cardId: o.cardId,
            count: o.count,
            firstDrawnAt: "",
          }));
        }
      }
    } catch (e) {
      console.error("sheet owned items failed", e);
    }
  }
  const byId = new Map(CARDS.map((c) => [c.id, c]));
  const items = col.map((o) => {
    const c = byId.get(o.cardId);
    return {
      ...o,
      card: c ? cardPublicView(c) : null,
    };
  });
  return json({
    email: who.email,
    countUnique: items.length,
    items,
    message:
      items.length === 0
        ? "新號無起步卡。請溫習 Flash Card 滿 10 分鐘再抽。"
        : undefined,
  });
}

async function handleLog(req: Request, env: Env): Promise<Response> {
  const who = await resolveEmail(req, env);
  if ("error" in who) return json({ error: who.error }, who.status);
  const store = getStore(env);
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const all = await store.listDraws(who.email);
  return json({
    email: who.email,
    total: all.length,
    items: all.slice(0, limit),
  });
}

/**
 * GET /api/roster-check?email=
 * 不洩漏完整名單：在名單 → {ok:true, name, className}；否則 {ok:false}
 * 無 SA 時 {ok:true, preview:true}（preview 跳過白名單）
 */
async function handleRosterCheck(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const email =
    (url.searchParams.get("email") || getEmailFromRequest(req) || "")
      .trim()
      .toLowerCase();
  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "請提供 email" }, 400);
  }
  if (!hasSheetsCreds(env)) {
    return json({ ok: true, preview: true, email });
  }
  try {
    const roster = await fetchRoster(env);
    if (!roster) return json({ ok: true, preview: true, email });
    const entry = roster.get(email);
    if (!entry) return json({ ok: false, email });
    return json({
      ok: true,
      email,
      name: entry.name || undefined,
      className: entry.className || undefined,
    });
  } catch (e) {
    console.error("roster-check failed", e);
    return json({ ok: false, error: "未能查詢學生名單" }, 503);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return corsPreflight();

    if (url.pathname === "/api/health") {
      const sheetsConfigured = hasSheetsCreds(env);
      const bridgeOn = authBridgeConfigured(env);
      return json({
        ok: true,
        version: env.VERSION || "draw-app 0.5.5-owned-null-guard",
        authMode: bridgeOn ? "gas_active_user" : "school_email_preview",
        authBridge: bridgeOn,
        authBridgeUrl: bridgeOn ? authBridgeUrl(env) : "",
        mockStudy: !sheetsConfigured,
        sheets: sheetsConfigured,
        sheetMode: sheetsConfigured ? "gas_webhook" : "none",
        cards: CARDS.length,
      });
    }
    if (url.pathname === "/api/roster-check" && req.method === "GET") {
      return handleRosterCheck(req, env);
    }
    if (url.pathname === "/api/sheet-ping" && req.method === "GET") {
      const r = await pingSheetWebhook(env);
      return json({ ...r, configured: hasSheetsCreds(env) }, r.ok ? 200 : 503);
    }
    if (url.pathname === "/api/me" && req.method === "GET") {
      return handleMe(req, env);
    }
    if (url.pathname === "/api/draw" && req.method === "POST") {
      return handleDraw(req, env);
    }
    if (url.pathname === "/api/collection" && req.method === "GET") {
      return handleCollection(req, env);
    }
    if (url.pathname === "/api/log" && req.method === "GET") {
      return handleLog(req, env);
    }
    if (url.pathname === "/api/cards" && req.method === "GET") {
      return json({ cards: CARDS.map(cardPublicView) });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    return json({ error: "not found", path: url.pathname }, 404);
  },
};
