/**
 * Auth：學校 email 輸入（x-user-email）；姓名用 query/body（唔放 CJK 入 header）
 * 唔再要 Google OAuth／GIS。ALLOW_MOCK_AUTH 只影響 mock 時數語意，唔再閘 email 登入。
 */

export type EnvAuth = {
  ALLOW_MOCK_AUTH?: string;
  /** @deprecated 已唔用；保留類型相容 */
  GOOGLE_CLIENT_ID?: string;
};

export function mockAuthAllowed(env: EnvAuth): boolean {
  return env.ALLOW_MOCK_AUTH === "1" || env.ALLOW_MOCK_AUTH === "true";
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** 從 header／query 取學校 email（唔再要求 ALLOW_MOCK_AUTH） */
export function getEmailFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("email");
  const h = req.headers.get("x-user-email");
  const raw = (h || q || "").trim().toLowerCase();
  if (!raw || !looksLikeEmail(raw)) return null;
  return raw;
}

/**
 * 可選姓名核對：優先 query `name`（UTF-8），其次 body 由呼叫端處理，
 * 最後先 legacy header（僅 ASCII；CJK 唔應放 header）。
 */
export function getNameFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("name");
  if (q && q.trim()) return q.trim();
  const h = req.headers.get("x-user-name");
  if (h && h.trim()) return h.trim();
  return null;
}

export async function resolveEmail(
  req: Request,
  _env: EnvAuth
): Promise<
  | { email: string; name: string | null; mode: "school_email" }
  | { error: string; status: number }
> {
  const email = getEmailFromRequest(req);
  if (!email) {
    return {
      error: "請輸入學校帳號 email。",
      status: 401,
    };
  }
  return { email, name: getNameFromRequest(req), mode: "school_email" };
}
