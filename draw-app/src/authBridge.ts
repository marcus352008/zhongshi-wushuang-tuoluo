/**
 * GAS ActiveUser 登入核對 proof（HMAC-SHA256）
 * payload: v1|{typedEmail}|{googleEmail}|{exp}
 * token:   {hexSig}.{exp}
 * VERSION: draw-app 0.5.4
 */

export type EnvAuthBridge = {
  AUTH_BRIDGE_URL?: string;
  AUTH_BRIDGE_SECRET?: string;
  /** 未設橋時，ALLOW_MOCK_AUTH=1 先准 preview（唔過 GAS） */
  ALLOW_MOCK_AUTH?: string;
};

export const AUTH_BRIDGE_MISMATCH_MSG =
  "輸入帳號與 Google 帳號不符，無法登入";
export const AUTH_BRIDGE_REQUIRED_MSG =
  "請先完成 Google 登入核對（彈窗）。";
export const AUTH_BRIDGE_PENDING_MSG =
  "Google 登入核對橋尚未啟用。請聯絡老師完成 GAS Deploy。";

function normalizeEmail(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase();
}

export function authBridgeConfigured(env: EnvAuthBridge): boolean {
  const url = String(env.AUTH_BRIDGE_URL || "").trim();
  const secret = String(env.AUTH_BRIDGE_SECRET || "").trim();
  return Boolean(url && url.includes("/exec") && secret);
}

export function authBridgeUrl(env: EnvAuthBridge): string {
  return String(env.AUTH_BRIDGE_URL || "").trim();
}

async function hmacHex(
  secret: string,
  message: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * 從 header 取 proof：
 * x-auth-proof: typed|google|token
 * 或 Authorization: Bearer typed|google|token（少用）
 */
export function parseAuthProofHeader(
  req: Request
): { typedEmail: string; googleEmail: string; token: string } | null {
  const raw =
    req.headers.get("x-auth-proof") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!raw || !raw.includes("|")) return null;
  const parts = raw.split("|");
  if (parts.length < 3) return null;
  const typedEmail = normalizeEmail(parts[0]);
  const googleEmail = normalizeEmail(parts[1]);
  const token = parts.slice(2).join("|").trim();
  if (!typedEmail || !googleEmail || !token) return null;
  return { typedEmail, googleEmail, token };
}

export async function verifyAuthProof(
  env: EnvAuthBridge,
  typedEmail: string,
  googleEmail: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const secret = String(env.AUTH_BRIDGE_SECRET || "").trim();
  if (!secret) {
    return { ok: false, error: AUTH_BRIDGE_PENDING_MSG, status: 503 };
  }
  const typed = normalizeEmail(typedEmail);
  const google = normalizeEmail(googleEmail);
  if (!typed || !google) {
    return { ok: false, error: AUTH_BRIDGE_REQUIRED_MSG, status: 401 };
  }
  if (typed !== google) {
    return { ok: false, error: AUTH_BRIDGE_MISMATCH_MSG, status: 403 };
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return { ok: false, error: AUTH_BRIDGE_REQUIRED_MSG, status: 401 };
  }
  const sig = token.slice(0, dot);
  const expStr = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) {
    return { ok: false, error: AUTH_BRIDGE_REQUIRED_MSG, status: 401 };
  }
  const now = Math.floor(Date.now() / 1000);
  if (exp < now) {
    return {
      ok: false,
      error: "登入核對已過期，請重新核對 Google 帳號。",
      status: 401,
    };
  }
  const payload = `v1|${typed}|${google}|${exp}`;
  const expect = await hmacHex(secret, payload);
  if (expect !== sig.toLowerCase()) {
    return { ok: false, error: AUTH_BRIDGE_REQUIRED_MSG, status: 401 };
  }
  return { ok: true };
}

/**
 * 主規則：有橋 → 必須 valid proof 且 typed===login email。
 * 無橋：ALLOW_MOCK_AUTH=1 先准 preview；否則 503。
 */
export async function assertAuthBridge(
  req: Request,
  loginEmail: string,
  env: EnvAuthBridge
): Promise<Response | null> {
  const configured = authBridgeConfigured(env);
  const proof = parseAuthProofHeader(req);

  if (!configured) {
    const allowMock =
      env.ALLOW_MOCK_AUTH === "1" || env.ALLOW_MOCK_AUTH === "true";
    if (allowMock) return null; // preview stub
    return new Response(
      JSON.stringify({
        error: AUTH_BRIDGE_PENDING_MSG,
        code: "auth_bridge_pending",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }

  if (!proof) {
    return new Response(
      JSON.stringify({
        error: AUTH_BRIDGE_REQUIRED_MSG,
        code: "auth_bridge_required",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }

  if (normalizeEmail(proof.typedEmail) !== normalizeEmail(loginEmail)) {
    return new Response(
      JSON.stringify({
        error: AUTH_BRIDGE_MISMATCH_MSG,
        code: "email_mismatch",
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }

  const v = await verifyAuthProof(
    env,
    proof.typedEmail,
    proof.googleEmail,
    proof.token
  );
  if (!v.ok) {
    return new Response(
      JSON.stringify({
        error: v.error,
        code:
          v.status === 403
            ? "email_mismatch"
            : v.status === 503
              ? "auth_bridge_pending"
              : "auth_bridge_required",
      }),
      {
        status: v.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }
  return null;
}
