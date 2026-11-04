/**
 * 中史無雙 · 登入核對橋（輕量 GAS）
 * 只用 Session.getActiveUser().getEmail() 攞 Chrome／Google 帳，
 * 同輸入 email 對比，寫入「中史無雙 登入核對」Sheet，並簽發短命 HMAC proof 畀 CF Worker。
 *
 * Deploy 必須：Execute as → User accessing the web app；Anyone with Google account（或校內允許）。
 * Script Properties：AUTH_HMAC_SECRET（同 CF wrangler secret AUTH_BRIDGE_SECRET 一致）
 *
 * VERSION: draw-app-auth-gas 0.5.4
 */
var AUTH_SHEET_ID = "1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU";
var AUTH_SHEET_TAB = "登入核對";
var TOKEN_TTL_SEC = 600; // 10 min
var VERSION = "draw-app-auth-gas 0.5.4";

function doGet(e) {
  var p = (e && e.parameter) || {};
  var typed = String(p.typedEmail || p.typed || "").trim().toLowerCase();
  var returnOrigin = String(p.returnOrigin || p.origin || "").trim();
  var t = HtmlService.createTemplateFromFile("Index");
  t.typedEmail = typed;
  t.returnOrigin = returnOrigin;
  t.version = VERSION;
  return t
    .evaluate()
    .setTitle("中史無雙 · Google 登入核對")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** HtmlService include helper */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function normalizeEmail_(s) {
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/\u3000/g, " ");
}

function looksLikeEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function getHmacSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("AUTH_HMAC_SECRET");
  if (!s) {
    throw new Error(
      "缺少 Script Property AUTH_HMAC_SECRET。請喺專案設定 → 指令碼屬性加入，並同 CF AUTH_BRIDGE_SECRET 一致。"
    );
  }
  return s;
}

function hmacHex_(secret, message) {
  var raw = Utilities.computeHmacSha256Signature(message, secret);
  var out = "";
  for (var i = 0; i < raw.length; i++) {
    var v = (raw[i] + 256) % 256;
    var h = v.toString(16);
    out += h.length === 1 ? "0" + h : h;
  }
  return out;
}

/**
 * 寫登入核對表。寫表失敗唔阻 match／token（學生 Execute as User 可能無 Sheet 權）。
 */
function appendLog_(typedEmail, googleEmail, match, source) {
  try {
    var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
    var sheet = ss.getSheetByName(AUTH_SHEET_TAB);
    if (!sheet) sheet = ss.getSheets()[0];
    var now = Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([
      now,
      typedEmail || "",
      googleEmail || "",
      match ? "是" : "否",
      source || "gas-bridge",
    ]);
  } catch (err) {
    try {
      console.error("appendLog_ failed: " + (err && err.message ? err.message : err));
    } catch (e2) {}
  }
}

/**
 * 由 Index.html 經 google.script.run 呼叫。
 * @param {string} typedEmail 學生輸入嘅學校 email
 * @returns {{ok:boolean, googleEmail:string, typedEmail:string, match:boolean, token?:string, exp?:number, error?:string, version:string}}
 */
function verifyAndLog(typedEmail) {
  try {
    var typed = normalizeEmail_(typedEmail);
    if (!typed || !looksLikeEmail_(typed)) {
      return {
        ok: false,
        error: "請提供有效學校 email。",
        typedEmail: typed,
        googleEmail: "",
        match: false,
        version: VERSION,
      };
    }

    var googleEmail = "";
    try {
      googleEmail = normalizeEmail_(Session.getActiveUser().getEmail());
    } catch (err) {
      googleEmail = "";
    }
    if (!googleEmail) {
      try {
        googleEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
      } catch (err2) {
        googleEmail = "";
      }
    }

    if (!googleEmail) {
      appendLog_(typed, "", false, "gas-bridge-no-active-user");
      return {
        ok: false,
        error:
          "未能讀取 Chrome／Google 登入帳號。請用學校 Google 帳單獨開啟此核對頁完成授權，並確認 Deploy 為「執行身分：存取網頁應用程式的使用者」。",
        typedEmail: typed,
        googleEmail: "",
        match: false,
        version: VERSION,
      };
    }

    var match = typed === googleEmail;
    appendLog_(typed, googleEmail, match, "gas-bridge");

    if (!match) {
      return {
        ok: false,
        error: "輸入帳號與 Google 帳號不符，無法登入",
        typedEmail: typed,
        googleEmail: googleEmail,
        match: false,
        version: VERSION,
      };
    }

    var exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
    var payload = "v1|" + typed + "|" + googleEmail + "|" + exp;
    var token = hmacHex_(getHmacSecret_(), payload) + "." + exp;

    return {
      ok: true,
      typedEmail: typed,
      googleEmail: googleEmail,
      match: true,
      token: token,
      exp: exp,
      version: VERSION,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e && e.message ? e.message : e),
      typedEmail: normalizeEmail_(typedEmail),
      googleEmail: "",
      match: false,
      version: VERSION,
    };
  }
}
