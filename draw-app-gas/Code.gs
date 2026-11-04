/**
 * 中史無雙陀螺 · 抽卡 Web App（Google Apps Script）
 * VERSION: draw-app-gas 0.4.0
 *
 * Deploy → Web app：Execute as Me；Who has access: Anyone（或校內）
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('中史無雙陀螺 · 抽卡')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** HtmlService include helper */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheetHeaders_() {
  var ss = getSpreadsheet_();
  var log = ss.getSheetByName(SHEET_DRAW_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_DRAW_LOG);
    log.appendRow([
      'drawId', 'email', 'drawnAt', 'cardId', 'cardName', 'slot', 'cost',
      'isDuplicate', 'creditedSecBefore', 'entitledBefore', 'source'
    ]);
  } else if (log.getLastRow() === 0) {
    log.appendRow([
      'drawId', 'email', 'drawnAt', 'cardId', 'cardName', 'slot', 'cost',
      'isDuplicate', 'creditedSecBefore', 'entitledBefore', 'source'
    ]);
  }
  var owned = ss.getSheetByName(SHEET_OWNED);
  if (!owned) {
    owned = ss.insertSheet(SHEET_OWNED);
    owned.appendRow([
      'email', 'cardId', 'cardName', 'slot', 'cost', 'count', 'firstAt', 'lastAt'
    ]);
  } else if (owned.getLastRow() === 0) {
    owned.appendRow([
      'email', 'cardId', 'cardName', 'slot', 'cost', 'count', 'firstAt', 'lastAt'
    ]);
  }
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function nowHkIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Hong_Kong', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function newDrawId_() {
  return 'D' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function hkDateKey_(d) {
  return Utilities.formatDate(d, 'Asia/Hong_Kong', 'yyyy-MM-dd');
}

function parseWhen_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v;
  }
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function headerIndex_(header, name) {
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === name) return i;
  }
  return -1;
}

function headerIndexEmail_(header) {
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i]).trim();
    if (h === 'Email' || h.toLowerCase() === 'email') return i;
  }
  return -1;
}

/** —— 學生名單 —— */
function fetchRosterMap_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_ROSTER);
  if (!sh || sh.getLastRow() < 2) return {};
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var iEmail = headerIndexEmail_(header);
  var iName = headerIndex_(header, '姓名');
  var iClass = headerIndex_(header, '班級');
  if (iEmail < 0) return {};
  var map = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var e = normalizeEmail_(row[iEmail]);
    if (e.indexOf('@') < 0) continue;
    map[e] = {
      name: iName >= 0 ? String(row[iName] || '').trim() : '',
      className: iClass >= 0 ? String(row[iClass] || '').trim() : ''
    };
  }
  return map;
}

function assertRoster_(email, providedName) {
  var roster = fetchRosterMap_();
  var keys = Object.keys(roster);
  // 名單空 → 唔擋（方便尚未填名單時試）
  if (keys.length === 0) return null;
  var entry = roster[email];
  if (!entry) {
    return '此學校帳號不在學生名單，未能抽卡。請確認 email 或聯絡老師。';
  }
  if (providedName) {
    var want = String(providedName).trim();
    var have = (entry.name || '').trim();
    if (have && want !== have) {
      return '姓名與學生名單不符。請核對「姓名」欄。';
    }
  }
  return null;
}

/** —— 學習記錄 → 額度 —— */
function fetchStudyRowsForEmail_(email) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_STUDY);
  var rows = [];
  if (sh && sh.getLastRow() >= 2) {
    var values = sh.getDataRange().getValues();
    var header = values[0];
    var iTime = headerIndex_(header, '記錄時間');
    var iInput = headerIndex_(header, '輸入的 Email');
    var iSec = headerIndex_(header, '有效秒數');
    var iGoogle = headerIndex_(header, 'Google 驗證 Email');
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var g = iGoogle >= 0 ? normalizeEmail_(row[iGoogle]) : '';
      var inp = iInput >= 0 ? normalizeEmail_(row[iInput]) : '';
      var match = g || inp;
      if (match !== email) continue;
      rows.push({
        recordedAt: iTime >= 0 ? row[iTime] : '',
        validSeconds: iSec >= 0 ? Number(row[iSec] || 0) : 0,
        googleEmail: g,
        inputEmail: inp
      });
    }
  }
  if (rows.length === 0 && ALLOW_MOCK_STUDY) {
    for (var i = 0; i < MOCK_STUDY_TEMPLATE.length; i++) {
      rows.push({
        recordedAt: MOCK_STUDY_TEMPLATE[i].recordedAt,
        validSeconds: MOCK_STUDY_TEMPLATE[i].validSeconds,
        googleEmail: email,
        inputEmail: email
      });
    }
    return { rows: rows, source: 'mock' };
  }
  return { rows: rows, source: 'sheets' };
}

function computeCreditedSeconds_(rows) {
  var byDay = {};
  for (var i = 0; i < rows.length; i++) {
    var when = parseWhen_(rows[i].recordedAt);
    if (!when) continue;
    var sec = Number(rows[i].validSeconds);
    if (!isFinite(sec) || sec <= 0) continue;
    var day = hkDateKey_(when);
    byDay[day] = (byDay[day] || 0) + sec;
  }
  var total = 0;
  for (var k in byDay) {
    if (!byDay.hasOwnProperty(k)) continue;
    total += Math.min(byDay[k], SECONDS_PER_DAY_CAP);
  }
  return total;
}

function summarizeStudy_(rows, drawLogCount) {
  var creditedSec = computeCreditedSeconds_(rows);
  var entitled = Math.floor(creditedSec / SECONDS_PER_DRAW);
  var used = Math.max(0, Math.floor(drawLogCount));
  return {
    creditedSec: creditedSec,
    creditedMinutes: Math.floor(creditedSec / 60),
    entitledDraws: entitled,
    remainingDraws: Math.max(0, entitled - used),
    drawLogCount: used
  };
}

/** —— 抽卡記錄／擁有卡 —— */
function countDraws_(email) {
  ensureSheetHeaders_();
  var sh = getSpreadsheet_().getSheetByName(SHEET_DRAW_LOG);
  if (!sh || sh.getLastRow() < 2) return 0;
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var iEmail = headerIndex_(header, 'email');
  if (iEmail < 0) iEmail = 1;
  var n = 0;
  for (var r = 1; r < values.length; r++) {
    if (normalizeEmail_(values[r][iEmail]) === email) n++;
  }
  return n;
}

function listDraws_(email, limit) {
  ensureSheetHeaders_();
  var sh = getSpreadsheet_().getSheetByName(SHEET_DRAW_LOG);
  var items = [];
  if (!sh || sh.getLastRow() < 2) return items;
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var iEmail = headerIndex_(header, 'email');
  if (iEmail < 0) iEmail = 1;
  var iAt = headerIndex_(header, 'drawnAt');
  var iId = headerIndex_(header, 'cardId');
  var iName = headerIndex_(header, 'cardName');
  var iDup = headerIndex_(header, 'isDuplicate');
  for (var r = values.length - 1; r >= 1; r--) {
    if (normalizeEmail_(values[r][iEmail]) !== email) continue;
    items.push({
      drawnAt: iAt >= 0 ? String(values[r][iAt]) : '',
      cardId: iId >= 0 ? String(values[r][iId]) : '',
      cardName: iName >= 0 ? String(values[r][iName]) : '',
      isDuplicate: iDup >= 0 ? (values[r][iDup] === true || values[r][iDup] === 'TRUE' || values[r][iDup] === 'true') : false
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** owned map cardId → count；兼更新次數 */
function ownedMap_(email) {
  ensureSheetHeaders_();
  var sh = getSpreadsheet_().getSheetByName(SHEET_OWNED);
  var map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var iEmail = headerIndex_(header, 'email');
  if (iEmail < 0) iEmail = 0;
  var iId = headerIndex_(header, 'cardId');
  if (iId < 0) iId = 1;
  var iCount = headerIndex_(header, 'count');
  for (var r = 1; r < values.length; r++) {
    if (normalizeEmail_(values[r][iEmail]) !== email) continue;
    var id = String(values[r][iId] || '');
    if (!id) continue;
    var c = iCount >= 0 ? Number(values[r][iCount] || 1) : 1;
    if (!isFinite(c) || c < 1) c = 1;
    map[id] = (map[id] || 0) + c;
  }
  return map;
}

function appendDrawLog_(entry) {
  ensureSheetHeaders_();
  var sh = getSpreadsheet_().getSheetByName(SHEET_DRAW_LOG);
  sh.appendRow([
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
    entry.source
  ]);
}

function upsertOwned_(email, card, drawnAt, isDuplicate) {
  ensureSheetHeaders_();
  var sh = getSpreadsheet_().getSheetByName(SHEET_OWNED);
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var iEmail = headerIndex_(header, 'email');
  if (iEmail < 0) iEmail = 0;
  var iId = headerIndex_(header, 'cardId');
  if (iId < 0) iId = 1;
  var iCount = headerIndex_(header, 'count');
  var iLast = headerIndex_(header, 'lastAt');
  for (var r = 1; r < values.length; r++) {
    if (normalizeEmail_(values[r][iEmail]) === email && String(values[r][iId]) === card.id) {
      if (iCount >= 0) {
        var cur = Number(values[r][iCount] || 1) + 1;
        sh.getRange(r + 1, iCount + 1).setValue(cur);
      }
      if (iLast >= 0) sh.getRange(r + 1, iLast + 1).setValue(drawnAt);
      return;
    }
  }
  if (!isDuplicate) {
    sh.appendRow([
      email,
      card.id,
      card.name,
      card.slot,
      Number(card.cost),
      1,
      drawnAt,
      drawnAt
    ]);
  } else {
    // 重複但 sheet 未有列（異常）— 仍補一列
    sh.appendRow([
      email,
      card.id,
      card.name,
      card.slot,
      Number(card.cost),
      1,
      drawnAt,
      drawnAt
    ]);
  }
}

/* ========== Client-callable API ========== */

/**
 * @param {string} email
 * @param {string} name optional
 */
function apiMe(email, name) {
  email = normalizeEmail_(email);
  if (!email || email.indexOf('@') < 0) {
    return { ok: false, error: '請輸入有效學校 email。' };
  }
  var blocked = assertRoster_(email, name || null);
  if (blocked) return { ok: false, error: blocked };
  var study = fetchStudyRowsForEmail_(email);
  var drawLogCount = countDraws_(email);
  var summary = summarizeStudy_(study.rows, drawLogCount);
  return {
    ok: true,
    version: VERSION,
    email: email,
    authMode: 'school-email',
    studySource: study.source,
    creditedSec: summary.creditedSec,
    creditedMinutes: summary.creditedMinutes,
    entitledDraws: summary.entitledDraws,
    remainingDraws: summary.remainingDraws,
    drawLogCount: summary.drawLogCount,
    noStarterCards: true,
    cardsInPool: getCards_().length
  };
}

function apiDraw(email, name) {
  email = normalizeEmail_(email);
  if (!email || email.indexOf('@') < 0) {
    return { ok: false, error: '請輸入有效學校 email。' };
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { ok: false, error: '系統忙碌，請稍後再抽。' };
  }
  try {
    var blocked = assertRoster_(email, name || null);
    if (blocked) return { ok: false, error: blocked };
    var study = fetchStudyRowsForEmail_(email);
    var drawLogCount = countDraws_(email);
    var summary = summarizeStudy_(study.rows, drawLogCount);
    if (summary.remainingDraws < 1) {
      return {
        ok: false,
        error: '未夠抽卡次數。請繼續用 Flash Card 溫習（累積 10 分鐘＝1 抽；每日最多入帳 60 分鐘）。',
        remainingDraws: summary.remainingDraws,
        entitledDraws: summary.entitledDraws,
        creditedSec: summary.creditedSec,
        studySource: study.source
      };
    }
    var owned = ownedMap_(email);
    var card = pickWeightedCard_(owned);
    var isDuplicate = !!owned[card.id];
    var entry = {
      drawId: newDrawId_(),
      email: email,
      drawnAt: nowHkIso_(),
      cardId: card.id,
      cardName: card.name,
      slot: card.slot,
      cost: Number(card.cost),
      isDuplicate: isDuplicate,
      creditedSecBefore: summary.creditedSec,
      entitledBefore: summary.entitledDraws,
      source: 'flashcard_10min'
    };
    appendDrawLog_(entry);
    upsertOwned_(email, card, entry.drawnAt, isDuplicate);
    var after = summarizeStudy_(study.rows, drawLogCount + 1);
    return {
      ok: true,
      card: cardPublicView_(card),
      isDuplicate: isDuplicate,
      draw: entry,
      remainingDraws: after.remainingDraws,
      entitledDraws: after.entitledDraws,
      creditedSec: after.creditedSec,
      studySource: study.source,
      persistedToSheet: true,
      version: VERSION
    };
  } finally {
    lock.releaseLock();
  }
}

function apiCollection(email) {
  email = normalizeEmail_(email);
  if (!email) return { ok: false, error: '未登入', items: [] };
  var owned = ownedMap_(email);
  var items = [];
  for (var id in owned) {
    if (!owned.hasOwnProperty(id)) continue;
    var c = findCard_(id);
    items.push({
      cardId: id,
      count: owned[id],
      card: c ? cardPublicView_(c) : null
    });
  }
  items.sort(function (a, b) {
    var an = (a.card && a.card.name) || a.cardId;
    var bn = (b.card && b.card.name) || b.cardId;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  return {
    ok: true,
    email: email,
    countUnique: items.length,
    items: items,
    message: items.length === 0
      ? '新號無起步卡。請溫習 Flash Card 滿 10 分鐘再抽。'
      : undefined
  };
}

function apiLog(email, limit) {
  email = normalizeEmail_(email);
  limit = Math.min(50, Math.max(1, Number(limit) || 15));
  var items = listDraws_(email, limit);
  return { ok: true, email: email, total: items.length, items: items };
}

function apiHealth() {
  return {
    ok: true,
    version: VERSION,
    sheets: true,
    mockStudy: ALLOW_MOCK_STUDY,
    spreadsheetId: SPREADSHEET_ID,
    cardsInPool: getCards_().length
  };
}

/**
 * Serve portrait as data URL (HtmlService-safe; Drive hotlink often blocked in img).
 * Uses JPEG map in ArtMap.gs (~25KB). Cached in ScriptCache when small enough.
 */
function apiArt(cardId) {
  cardId = String(cardId || '').trim();
  if (!cardId || typeof ART_DRIVE_IDS === 'undefined' || !ART_DRIVE_IDS[cardId]) {
    return { ok: false, error: 'no art', cardId: cardId };
  }
  var cache = CacheService.getScriptCache();
  var key = 'artjpg:' + cardId;
  try {
    var hit = cache.get(key);
    if (hit) return { ok: true, cardId: cardId, dataUrl: hit, cached: true };
  } catch (e) {}
  try {
    var blob = DriveApp.getFileById(ART_DRIVE_IDS[cardId]).getBlob();
    var mime = blob.getContentType() || 'image/jpeg';
    var dataUrl = 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
    try {
      if (dataUrl.length < 90000) cache.put(key, dataUrl, 21600);
    } catch (e2) {}
    return { ok: true, cardId: cardId, dataUrl: dataUrl, cached: false };
  } catch (err) {
    return { ok: false, error: String(err), cardId: cardId };
  }
}
