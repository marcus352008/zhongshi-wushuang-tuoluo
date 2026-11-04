/**
 * Flash Card 溫習秒數 → 抽卡額度（純函式，可單測）
 *
 * 已鎖規則：
 * - 按香港日切，當日有效秒加總後 cap 3600（60 分）
 * - 跨日累積 creditedSec
 * - entitledDraws = floor(creditedSec / 600)  // 10 分＝1 抽
 * - remainingDraws = entitledDraws - drawLogCount
 */

export const SECONDS_PER_DAY_CAP = 3600;
export const SECONDS_PER_DRAW = 600; // 10 minutes

export type StudyRow = {
  /** ISO 或可被 Date 解析的時間；會轉 Asia/Hong_Kong 日 */
  recordedAt: string | Date;
  /** 有效秒數（單筆） */
  validSeconds: number;
  /** 主對帳 email（Google 驗證 Email），可空 */
  googleEmail?: string | null;
  /** 後備：輸入的 Email */
  inputEmail?: string | null;
};

/** 小寫 trim */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 取香港日 YYYY-MM-DD */
export function hkDateKey(d: Date): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseWhen(v: string | Date): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 從學習記錄列過濾出屬於該 email 的列（Google 驗證優先，空則 fallback 輸入）
 */
export function filterRowsForEmail(rows: StudyRow[], loginEmail: string): StudyRow[] {
  const key = normalizeEmail(loginEmail);
  return rows.filter((r) => {
    const g = r.googleEmail ? normalizeEmail(r.googleEmail) : "";
    const i = r.inputEmail ? normalizeEmail(r.inputEmail) : "";
    const match = g || i;
    return match === key;
  });
}

/**
 * 按香港日加總有效秒，每日 cap 3600，再跨日累積
 */
export const EMAIL_PAIR_MISMATCH_MSG =
  "輸入帳號與 Google 帳號不符，無法登入";

/**
 * 屬於該 login email 的學習記錄列上，若 inputEmail 與 googleEmail 都有值且 normalize 後不同 → true。
 * 一邊空、或無相關記錄 → false（唔當不符，避免舊資料全鎖死）。
 */
export function emailPairMismatch(rows: StudyRow[], loginEmail: string): boolean {
  const key = normalizeEmail(loginEmail);
  for (const r of rows) {
    const g = r.googleEmail ? normalizeEmail(String(r.googleEmail)) : "";
    const i = r.inputEmail ? normalizeEmail(String(r.inputEmail)) : "";
    if (g !== key && i !== key) continue;
    if (g && i && g !== i) return true;
  }
  return false;
}

export function computeCreditedSeconds(rows: StudyRow[]): number {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const when = parseWhen(r.recordedAt);
    if (!when) continue;
    const sec = Number(r.validSeconds);
    if (!Number.isFinite(sec) || sec <= 0) continue;
    const day = hkDateKey(when);
    byDay.set(day, (byDay.get(day) || 0) + sec);
  }
  let total = 0;
  for (const sum of byDay.values()) {
    total += Math.min(sum, SECONDS_PER_DAY_CAP);
  }
  return total;
}

export function entitledDrawsFromCredited(creditedSec: number): number {
  if (!Number.isFinite(creditedSec) || creditedSec < 0) return 0;
  return Math.floor(creditedSec / SECONDS_PER_DRAW);
}

export function remainingDraws(creditedSec: number, drawLogCount: number): number {
  const entitled = entitledDrawsFromCredited(creditedSec);
  const used = Math.max(0, Math.floor(drawLogCount));
  return Math.max(0, entitled - used);
}

export type StudySummary = {
  creditedSec: number;
  creditedMinutes: number;
  entitledDraws: number;
  remainingDraws: number;
  drawLogCount: number;
};

export function summarizeStudy(
  rows: StudyRow[],
  loginEmail: string,
  drawLogCount: number
): StudySummary {
  const mine = filterRowsForEmail(rows, loginEmail);
  const creditedSec = computeCreditedSeconds(mine);
  const entitled = entitledDrawsFromCredited(creditedSec);
  const remaining = remainingDraws(creditedSec, drawLogCount);
  return {
    creditedSec,
    creditedMinutes: Math.floor(creditedSec / 60),
    entitledDraws: entitled,
    remainingDraws: remaining,
    drawLogCount: Math.max(0, Math.floor(drawLogCount)),
  };
}
