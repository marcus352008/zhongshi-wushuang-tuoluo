/**
 * 中史無雙陀螺 — Sheet 接收器（守邊模式）
 * Bound/standalone; Worker POST → doPost
 * VERSION: draw-sheet-gas 0.1.0
 */
var WH_VERSION = 'draw-sheet-gas 0.2.0-pvp';
var SPREADSHEET_ID = '1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc';
var SHEET_STUDY = '學習記錄';
var SHEET_ROSTER = '學生名單';
var SHEET_DRAW_LOG = '抽卡記錄';
var SHEET_OWNED = '擁有卡';
var SHEET_MATCH = '對戰場次';
var SHEET_LEADERBOARD = '對戰排行';
var DAILY_PVP_LIMIT = 3;

function doGet() {
  return json_({ ok: true, service: 'wushuang-draw-sheet', version: WH_VERSION, note: 'POST only' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }
  var action = String(body.action || '').trim();
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SHARED_SECRET');

  if (action === 'bootstrap') {
    if (secret) return json_({ ok: false, error: 'already set' });
    if (typeof body.secret !== 'string' || body.secret.length < 32) return json_({ ok: false, error: 'bad secret' });
    props.setProperty('SHARED_SECRET', body.secret);
    return json_({ ok: true, bootstrapped: true, version: WH_VERSION });
  }

  if (!secret || typeof body.secret !== 'string' || !safeEqual_(body.secret, secret)) {
    return json_({ ok: false, error: 'forbidden' });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
  try {
    if (action === 'ping') return json_({ ok: true, service: 'wushuang-draw-sheet', version: WH_VERSION });
    if (action === 'append_draw') return json_(appendDraw_(body));
    if (action === 'append_owned') return json_(appendOwned_(body));
    if (action === 'study') return json_(study_(body));
    if (action === 'roster') return json_(roster_(body));
    if (action === 'append_study') return json_(appendStudy_(body));
    if (action === 'append_match') return json_(appendMatch_(body));
    if (action === 'get_daily_plays') return json_(getDailyPlays_(body));
    if (action === 'leaderboard_top20') return json_(leaderboardTop20_(body));
    if (action === 'get_form_from_roster') return json_(getFormFromRoster_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function setupSharedSecret(forced) {
  var props = PropertiesService.getScriptProperties();
  var s = (typeof forced === 'string' && forced.length >= 16) ? forced : props.getProperty('SHARED_SECRET');
  if (!s) s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  if (typeof forced === 'string' && forced.length >= 16) s = forced;
  props.setProperty('SHARED_SECRET', s);
  Logger.log('SHARED_SECRET = ' + s);
  return s;
}

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function ensureHeaders_() {
  var ss = ss_();
  var log = ss.getSheetByName(SHEET_DRAW_LOG);
  if (!log) { log = ss.insertSheet(SHEET_DRAW_LOG); }
  if (log.getLastRow() === 0) {
    log.appendRow(['drawId','email','drawnAt','cardId','cardName','slot','cost','isDuplicate','creditedSecBefore','entitledBefore','source']);
  }
  var owned = ss.getSheetByName(SHEET_OWNED);
  if (!owned) { owned = ss.insertSheet(SHEET_OWNED); }
  if (owned.getLastRow() === 0) {
    owned.appendRow(['email','cardId','cardName','slot','cost','count','firstDrawnAt','lastDrawnAt']);
  }
}

function appendDraw_(body) {
  ensureHeaders_();
  var row = body.row || {};
  var drawId = String(row.drawId || '');
  if (!drawId) return { ok: false, error: 'missing drawId' };
  var sh = ss_().getSheetByName(SHEET_DRAW_LOG);
  var headers = ['drawId','email','drawnAt','cardId','cardName','slot','cost','isDuplicate','creditedSecBefore','entitledBefore','source'];
  var last = sh.getLastRow();
  var found = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === drawId) { found = i + 2; break; }
  }
  var values = headers.map(function (h) { return clean_(row[h]); });
  if (found) sh.getRange(found, 1, 1, headers.length).setValues([values]);
  else sh.appendRow(values);
  var ownedResult = null;
  if (body.owned) ownedResult = appendOwned_({ row: body.owned });
  return { ok: true, appended: found ? 0 : 1, updated: found ? 1 : 0, owned: ownedResult };
}

function appendOwned_(body) {
  ensureHeaders_();
  var row = body.row || {};
  var email = String(row.email || '').trim().toLowerCase();
  var cardId = String(row.cardId || '').trim();
  if (!email || !cardId) return { ok: false, error: 'missing email/cardId' };
  var sh = ss_().getSheetByName(SHEET_OWNED);
  var last = sh.getLastRow();
  var header = last >= 1 ? sh.getRange(1, 1, 1, 8).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var iEmail = Math.max(0, header.indexOf('email'));
  var iCard = header.indexOf('cardId') >= 0 ? header.indexOf('cardId') : 1;
  var iCount = header.indexOf('count') >= 0 ? header.indexOf('count') : 5;
  var iFirst = header.indexOf('firstDrawnAt') >= 0 ? header.indexOf('firstDrawnAt') : (header.indexOf('firstAt') >= 0 ? header.indexOf('firstAt') : 6);
  var iLast = header.indexOf('lastDrawnAt') >= 0 ? header.indexOf('lastDrawnAt') : (header.indexOf('lastAt') >= 0 ? header.indexOf('lastAt') : 7);
  var found = 0;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][iEmail]).trim().toLowerCase() === email && String(data[i][iCard]).trim() === cardId) { found = i + 2; break; }
    }
  }
  var now = clean_(row.lastDrawnAt || row.lastAt || row.drawnAt || '');
  if (found) {
    var cur = Number(sh.getRange(found, iCount + 1).getValue() || 0);
    sh.getRange(found, iCount + 1).setValue(cur + 1);
    sh.getRange(found, iLast + 1).setValue(now || sh.getRange(found, iLast + 1).getValue());
    return { ok: true, updated: 1, count: cur + 1 };
  }
  sh.appendRow([email, cardId, clean_(row.cardName), clean_(row.slot), clean_(row.cost), Number(row.count || 1), clean_(row.firstDrawnAt || row.firstAt || now), now]);
  return { ok: true, appended: 1, count: 1 };
}

function study_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  var sh = ss_().getSheetByName(SHEET_STUDY);
  if (!sh) return { ok: false, error: 'no sheet 學習記錄' };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  var values = sh.getRange(1, 1, last, Math.min(12, sh.getLastColumn())).getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  function idx(name) { for (var i = 0; i < header.length; i++) if (header[i] === name) return i; return -1; }
  var iTime = idx('記錄時間'), iInput = idx('輸入的 Email'), iSec = idx('有效秒數'), iGoogle = idx('Google 驗證 Email');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var g = iGoogle >= 0 ? String(row[iGoogle] || '').trim().toLowerCase() : '';
    var inp = iInput >= 0 ? String(row[iInput] || '').trim().toLowerCase() : '';
    if (email && g !== email && inp !== email) continue;
    var sec = Number(row[iSec] || 0);
    if (!sec) continue;
    var when = row[iTime], recordedAt = '';
    if (Object.prototype.toString.call(when) === '[object Date]' && !isNaN(when.getTime())) {
      recordedAt = Utilities.formatDate(when, 'Asia/Hong_Kong', "yyyy-MM-dd'T'HH:mm:ssXXX");
    } else recordedAt = String(when || '');
    rows.push({ recordedAt: recordedAt, validSeconds: sec, inputEmail: inp, googleEmail: g });
  }
  return { ok: true, rows: rows, count: rows.length };
}

function roster_(body) {
  var sh = ss_().getSheetByName(SHEET_ROSTER);
  if (!sh) return { ok: false, error: 'no sheet 學生名單' };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, entries: [] };
  var values = sh.getRange(1, 1, last, Math.min(8, sh.getLastColumn())).getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var iEmail = -1, iName = -1, iClass = -1;
  for (var i = 0; i < header.length; i++) {
    var h = header[i];
    if (h === 'Email' || h.toLowerCase() === 'email') iEmail = i;
    if (h === '姓名') iName = i;
    if (h === '班級') iClass = i;
  }
  if (iEmail < 0) return { ok: false, error: 'no Email column' };
  var entries = [];
  for (var r = 1; r < values.length; r++) {
    var e = String(values[r][iEmail] || '').trim().toLowerCase();
    if (e.indexOf('@') < 0) continue;
    entries.push({ email: e, name: iName >= 0 ? String(values[r][iName] || '').trim() : '', className: iClass >= 0 ? String(values[r][iClass] || '').trim() : '' });
  }
  return { ok: true, entries: entries, count: entries.length };
}

function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v).slice(0, 5000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- PvP batch3 patch (append_study / append_match / daily / leaderboard) ----
/**
 * body: {
 *   email, googleEmail?, name?,
 *   validSeconds: 60,
 *   source: 'wushuang_pvp',
 *   unit?, grade?, sessionId?, cardId?
 * }
 * 寫入「學習記錄」：記錄時間=now(HK), 輸入的 Email, 有效秒數, Google 驗證 Email
 * 其餘欄位若表頭存在則填（學習年級／學習單元／工作階段／卡片ID）
 */
function appendStudy_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) return { ok: false, error: 'missing email' };
  var sec = Number(body.validSeconds);
  if (!isFinite(sec) || sec <= 0) sec = 60;
  if (sec > 3600) sec = 3600;
  var sh = ss_().getSheetByName(SHEET_STUDY);
  if (!sh) return { ok: false, error: 'no sheet 學習記錄' };
  var lastCol = Math.max(10, sh.getLastColumn());
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  function idx(name) {
    for (var i = 0; i < header.length; i++) if (header[i] === name) return i;
    return -1;
  }
  var now = new Date();
  var row = [];
  for (var c = 0; c < header.length; c++) row[c] = '';
  var iTime = idx('記錄時間');
  var iName = idx('使用者姓名');
  var iInput = idx('輸入的 Email');
  var iGrade = idx('學習年級');
  var iUnit = idx('學習單元');
  var iSec = idx('有效秒數');
  var iFmt = idx('格式化時間');
  var iGoogle = idx('Google 驗證 Email');
  var iCard = idx('卡片ID');
  var iSess = idx('工作階段');
  if (iTime >= 0) row[iTime] = now;
  if (iName >= 0) row[iName] = clean_(body.name || '');
  if (iInput >= 0) row[iInput] = email;
  if (iGrade >= 0) row[iGrade] = clean_(body.grade || body.form || '');
  if (iUnit >= 0) row[iUnit] = clean_(body.unit || body.source || 'wushuang_pvp');
  if (iSec >= 0) row[iSec] = sec;
  if (iFmt >= 0) row[iFmt] = Math.floor(sec / 60) + ' 分/min ' + (sec % 60) + ' 秒/sec';
  if (iGoogle >= 0) row[iGoogle] = String(body.googleEmail || email).trim().toLowerCase();
  if (iCard >= 0) row[iCard] = clean_(body.cardId || '');
  if (iSess >= 0) row[iSess] = clean_(body.sessionId || body.roomCode || body.source || 'wushuang_pvp');
  sh.appendRow(row);
  return { ok: true, appended: 1, validSeconds: sec, source: String(body.source || 'wushuang_pvp') };
}


/**
 * body.row: { hkDate, email, roomCode, form, role, startedAt, finishedAt, result, winsDelta, lossesDelta, name?, className? }
 * result: win|loss|forfeit|draw|cancel
 */
function appendMatch_(body) {
  var row = body.row || body;
  var email = String(row.email || '').trim().toLowerCase();
  var roomCode = String(row.roomCode || '').trim().toUpperCase();
  if (!email || !roomCode) return { ok: false, error: 'missing email/roomCode' };
  var sh = ss_().getSheetByName(SHEET_MATCH);
  if (!sh) return { ok: false, error: 'no sheet 對戰場次' };
  if (sh.getLastRow() === 0) {
    sh.appendRow(['hkDate','email','roomCode','form','role','startedAt','finishedAt','result','winsDelta','lossesDelta']);
  }
  var last = sh.getLastRow();
  var found = 0;
  var prevWinsDelta = 0;
  var prevLossesDelta = 0;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1]).trim().toLowerCase() === email && String(data[i][2]).trim().toUpperCase() === roomCode) {
        found = i + 2;
        prevWinsDelta = Number(data[i][8] || 0);
        prevLossesDelta = Number(data[i][9] || 0);
        break;
      }
    }
  }
  var values = [
    clean_(row.hkDate || Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM-dd')),
    email,
    roomCode,
    clean_(row.form || ''),
    clean_(row.role || ''),
    clean_(row.startedAt || ''),
    clean_(row.finishedAt || ''),
    clean_(row.result || ''),
    Number(row.winsDelta || 0),
    Number(row.lossesDelta || 0)
  ];
  if (found) sh.getRange(found, 1, 1, 10).setValues([values]);
  else sh.appendRow(values);

  var netW = Number(row.winsDelta || 0) - prevWinsDelta;
  var netL = Number(row.lossesDelta || 0) - prevLossesDelta;
  if (netW !== 0 || netL !== 0) {
    upsertLeaderboard_(email, clean_(row.name || ''), clean_(row.className || ''), clean_(row.form || ''), netW, netL);
  }
  return { ok: true, appended: found ? 0 : 1, updated: found ? 1 : 0 };
}

function upsertLeaderboard_(email, name, className, form, winsDelta, lossesDelta) {
  var sh = ss_().getSheetByName(SHEET_LEADERBOARD);
  if (!sh) return;
  if (sh.getLastRow() === 0) {
    sh.appendRow(['email','name','className','form','wins','losses','updatedAt']);
  }
  var last = sh.getLastRow();
  var found = 0;
  if (last >= 2) {
    var emails = sh.getRange(2, 1, last, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).trim().toLowerCase() === email) { found = i + 2; break; }
    }
  }
  var now = Utilities.formatDate(new Date(), 'Asia/Hong_Kong', "yyyy-MM-dd'T'HH:mm:ssXXX");
  if (found) {
    var curRow = sh.getRange(found, 2, 1, 6).getValues()[0];
    var wins = Math.max(0, Number(curRow[3] || 0) + Number(winsDelta || 0));
    var losses = Math.max(0, Number(curRow[4] || 0) + Number(lossesDelta || 0));
    sh.getRange(found, 2, 1, 6).setValues([[
      name || curRow[0],
      className || curRow[1],
      form || curRow[2],
      wins,
      losses,
      now
    ]]);
  } else {
    sh.appendRow([email, name, className, form, Math.max(0, Number(winsDelta || 0)), Math.max(0, Number(lossesDelta || 0)), now]);
  }
}


/** body: { email, hkDate? } — hkDate 預設今日 HK */
function getDailyPlays_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'missing email' };
  var hkDate = String(body.hkDate || Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM-dd'));
  var sh = ss_().getSheetByName(SHEET_MATCH);
  var used = 0;
  if (sh && sh.getLastRow() >= 2) {
    var data = sh.getRange(2, 1, sh.getLastRow(), 8).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === hkDate && String(data[i][1]).trim().toLowerCase() === email) {
        var result = String(data[i][7] || '');
        // 已開打（有 result 或至少有 started）都計；cancel 唔計
        if (result === 'cancel') continue;
        used++;
      }
    }
  }
  return { ok: true, email: email, hkDate: hkDate, used: used, remaining: Math.max(0, DAILY_PVP_LIMIT - used), limit: DAILY_PVP_LIMIT };
}


function leaderboardTop20_(body) {
  var formFilter = String((body && body.form) || '').trim().toUpperCase();
  if (formFilter !== 'F1' && formFilter !== 'F2' && formFilter !== 'F3') formFilter = '';

  var sh = ss_().getSheetByName(SHEET_LEADERBOARD);
  if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [], count: 0, formFilter: formFilter || null };
  var last = sh.getLastRow();
  var data = sh.getRange(2, 1, last, 7).getValues();
  var rows = data.map(function (r) {
    return {
      email: String(r[0] || '').trim().toLowerCase(),
      name: String(r[1] || '').trim(),
      className: String(r[2] || '').trim(),
      form: String(r[3] || '').trim().toUpperCase(),
      wins: Number(r[4] || 0),
      losses: Number(r[5] || 0),
      updatedAt: String(r[6] || '').trim()
    };
  }).filter(function (r) {
    if (r.email.indexOf('@') < 0) return false;
    if (formFilter && r.form !== formFilter) return false;
    return true;
  });
  rows.sort(function (a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    var tCmp = String(a.updatedAt).localeCompare(String(b.updatedAt));
    if (tCmp !== 0) return tCmp;
    return String(a.email).localeCompare(String(b.email));
  });
  rows = rows.slice(0, 20).map(function (r, idx) {
    r.rank = idx + 1;
    return r;
  });
  return { ok: true, rows: rows, count: rows.length, formFilter: formFilter || null };
}


/** body: { email } → { ok, email, name, className, form } form = F1|F2|F3|null */
function getFormFromRoster_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'missing email' };
  var roster = roster_({ email: email });
  if (!roster.ok) return roster;
  var hit = null;
  for (var i = 0; i < (roster.entries || []).length; i++) {
    if (roster.entries[i].email === email) { hit = roster.entries[i]; break; }
  }
  if (!hit) {
    // 老師／非學生：預設 F1（初中測試）
    return { ok: true, email: email, name: '', className: '', form: 'F1', teacherDefault: true };
  }
  var form = formFromClassName_(hit.className);
  return { ok: true, email: email, name: hit.name, className: hit.className, form: form };
}

function formFromClassName_(className) {
  var s = String(className || '').trim().toUpperCase();
  if (!s) return null;
  // 初中：1C→F1、2H→F2、3Y→F3；高中 4–6 回 null（擋 PvP）
  if (/F\.?\s*1|FORM\s*1/.test(s) || /^1/.test(s)) return 'F1';
  if (/F\.?\s*2|FORM\s*2/.test(s) || /^2/.test(s)) return 'F2';
  if (/F\.?\s*3|FORM\s*3/.test(s) || /^3/.test(s)) return 'F3';
  return null;
}
