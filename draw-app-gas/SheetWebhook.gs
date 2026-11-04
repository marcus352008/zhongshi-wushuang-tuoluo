/**
 * 守邊模式 Sheet 接收器 — CF Worker POST → 本 doPost
 * VERSION: draw-app-gas 0.4.8-webhook
 *
 * body.secret 必須 = Script Property SHARED_SECRET（= Worker SHEET_SECRET）
 * actions:
 *   ping | setup（唔經呢度；用 setupSharedSecret）
 *   append_draw  — 寫「抽卡記錄」一列（可選同時寫「擁有卡」）
 *   append_owned — 只寫／更新「擁有卡」
 *   study        — 讀「學習記錄」（可選 email 過濾）
 *   roster       — 讀「學生名單」
 *   draw_count / owned_ids
 *   draw_prep    — 一次回 count + study rows + ownedIds（抽卡前讀取）
 *   append_study — 寫「學習記錄」+秒數（PvP 完場 +60s）
 *   append_match — 寫「對戰場次」並更新「對戰排行」
 *   leaderboard_top20 — 讀「對戰排行」頭 20（可選 form=F1|F2|F3）
 */
var WH_VERSION = 'draw-app-gas 0.4.10-pvp-leaderboard';

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return whJson_({ ok: false, error: 'bad json' });
  }
  var action = String(body.action || '').trim();
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SHARED_SECRET');



  // One-time bootstrap (only if unset) — same pattern as first-time 守邊 setup
  if (action === 'bootstrap') {
    if (secret) return whJson_({ ok: false, error: 'already set' });
    if (typeof body.secret !== 'string' || body.secret.length < 32) {
      return whJson_({ ok: false, error: 'bad secret' });
    }
    props.setProperty('SHARED_SECRET', body.secret);
    return whJson_({ ok: true, bootstrapped: true, version: WH_VERSION });
  }

  if (!secret || typeof body.secret !== 'string' || !whSafeEqual_(body.secret, secret)) {
    return whJson_({ ok: false, error: 'forbidden' });
  }
  // Reads (ping/study/roster/draw_count/owned_ids/draw_prep) skip ScriptLock so /api/me
  // concurrent refresh does not serialize behind writes or each other.
  var needsLock = action === 'append_draw' || action === 'append_owned' || action === 'append_study' || action === 'append_match';
  var lock = null;
  if (needsLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return whJson_({ ok: false, error: 'busy' });
  }
  try {
    if (action === 'ping') {
      return whJson_({ ok: true, service: 'wushuang-draw-sheet', version: WH_VERSION });
    }
    if (action === 'append_draw') {
      return whJson_(whAppendDraw_(body));
    }
    if (action === 'append_owned') {
      return whJson_(whAppendOwned_(body));
    }
    if (action === 'study') {
      return whJson_(whStudy_(body));
    }
    if (action === 'roster') {
      return whJson_(whRoster_(body));
    }
    if (action === 'draw_count') {
      return whJson_(whDrawCount_(body));
    }
    if (action === 'owned_ids') {
      return whJson_(whOwnedIds_(body));
    }
    if (action === 'draw_prep') {
      return whJson_(whDrawPrep_(body));
    }
    if (action === 'append_study') {
      return whJson_(whAppendStudy_(body));
    }
    if (action === 'append_match') {
      return whJson_(whAppendMatch_(body));
    }
    if (action === 'leaderboard_top20') {
      return whJson_(whLeaderboardTop20_(body));
    }
    return whJson_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return whJson_({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** 執行一次：產生／覆寫 SHARED_SECRET；clasp run 可傳 forced 字串 */
function setupSharedSecret(forced) {
  var props = PropertiesService.getScriptProperties();
  var s = typeof forced === 'string' && forced.length >= 16 ? forced : props.getProperty('SHARED_SECRET');
  if (!s) {
    s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }
  if (typeof forced === 'string' && forced.length >= 16) s = forced;
  props.setProperty('SHARED_SECRET', s);
  Logger.log('SHARED_SECRET = ' + s + '\n用 wrangler secret put SHEET_SECRET 貼同一個值。');
  return s;
}

function whAppendDraw_(body) {
  ensureSheetHeaders_();
  var row = body.row || {};
  var drawId = String(row.drawId || '');
  if (!drawId) return { ok: false, error: 'missing drawId' };
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_DRAW_LOG);
  if (!sh) return { ok: false, error: 'no sheet 抽卡記錄' };
  var headers = [
    'drawId', 'email', 'drawnAt', 'cardId', 'cardName', 'slot', 'cost',
    'isDuplicate', 'creditedSecBefore', 'entitledBefore', 'source'
  ];
  // upsert by drawId (col A)
  var last = sh.getLastRow();
  var found = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === drawId) {
        found = i + 2;
        break;
      }
    }
  }
  var values = headers.map(function (h) { return whClean_(row[h]); });
  if (found) {
    sh.getRange(found, 1, 1, headers.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }
  var ownedResult = null;
  if (body.owned) {
    ownedResult = whAppendOwned_({ row: body.owned });
  }
  return {
    ok: true,
    appended: found ? 0 : 1,
    updated: found ? 1 : 0,
    owned: ownedResult
  };
}

function whAppendOwned_(body) {
  ensureSheetHeaders_();
  var row = body.row || {};
  var email = String(row.email || '').trim().toLowerCase();
  var cardId = String(row.cardId || '').trim();
  if (!email || !cardId) return { ok: false, error: 'missing email/cardId' };
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_OWNED);
  if (!sh) return { ok: false, error: 'no sheet 擁有卡' };
  // headers: email,cardId,cardName,slot,cost,count,firstDrawnAt,lastDrawnAt
  // (GAS ensureSheetHeaders_ may use firstAt/lastAt — align to existing header row)
  var last = sh.getLastRow();
  var header = last >= 1 ? sh.getRange(1, 1, 1, 8).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var iEmail = header.indexOf('email');
  var iCard = header.indexOf('cardId');
  var iCount = header.indexOf('count');
  var iFirst = header.indexOf('firstDrawnAt') >= 0 ? header.indexOf('firstDrawnAt') : header.indexOf('firstAt');
  var iLast = header.indexOf('lastDrawnAt') >= 0 ? header.indexOf('lastDrawnAt') : header.indexOf('lastAt');
  if (iEmail < 0) iEmail = 0;
  if (iCard < 0) iCard = 1;
  if (iCount < 0) iCount = 5;
  if (iFirst < 0) iFirst = 6;
  if (iLast < 0) iLast = 7;

  var found = 0;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][iEmail]).trim().toLowerCase() === email && String(data[i][iCard]).trim() === cardId) {
        found = i + 2;
        break;
      }
    }
  }
  var now = whClean_(row.lastDrawnAt || row.lastAt || row.drawnAt || '');
  if (found) {
    var cur = Number(sh.getRange(found, iCount + 1).getValue() || 0);
    sh.getRange(found, iCount + 1).setValue(cur + 1);
    sh.getRange(found, iLast + 1).setValue(now || sh.getRange(found, iLast + 1).getValue());
    return { ok: true, updated: 1, count: cur + 1 };
  }
  var values = [
    email,
    cardId,
    whClean_(row.cardName),
    whClean_(row.slot),
    whClean_(row.cost),
    Number(row.count || 1),
    whClean_(row.firstDrawnAt || row.firstAt || now),
    now
  ];
  sh.appendRow(values);
  return { ok: true, appended: 1, count: 1 };
}

function whStudy_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_STUDY);
  if (!sh) return { ok: false, error: 'no sheet 學習記錄' };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  var values = sh.getRange(1, 1, last, Math.min(12, sh.getLastColumn())).getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  function idx(name) {
    for (var i = 0; i < header.length; i++) if (header[i] === name) return i;
    return -1;
  }
  var iTime = idx('記錄時間');
  var iInput = idx('輸入的 Email');
  var iSec = idx('有效秒數');
  var iGoogle = idx('Google 驗證 Email');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var g = iGoogle >= 0 ? String(row[iGoogle] || '').trim().toLowerCase() : '';
    var inp = iInput >= 0 ? String(row[iInput] || '').trim().toLowerCase() : '';
    if (email && g !== email && inp !== email) continue;
    var sec = Number(row[iSec] || 0);
    if (!sec) continue;
    var when = row[iTime];
    var recordedAt = '';
    if (Object.prototype.toString.call(when) === '[object Date]' && !isNaN(when.getTime())) {
      recordedAt = Utilities.formatDate(when, 'Asia/Hong_Kong', "yyyy-MM-dd'T'HH:mm:ssXXX");
    } else {
      recordedAt = String(when || '');
    }
    rows.push({
      recordedAt: recordedAt,
      validSeconds: sec,
      inputEmail: inp,
      googleEmail: g
    });
  }
  return { ok: true, rows: rows, count: rows.length };
}

function whRoster_(body) {
  // CacheService: avoid re-reading 學生名單 on every /api/me (10 min)
  var cache = CacheService.getScriptCache();
  var cacheKey = 'roster_v1';
  if (!body || !body.nocache) {
    var hit = cache.get(cacheKey);
    if (hit) {
      try {
        var parsed = JSON.parse(hit);
        if (parsed && parsed.ok && parsed.entries) return parsed;
      } catch (ignore) {}
    }
  }
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(SHEET_ROSTER);
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
    entries.push({
      email: e,
      name: iName >= 0 ? String(values[r][iName] || '').trim() : '',
      className: iClass >= 0 ? String(values[r][iClass] || '').trim() : ''
    });
  }
  var out = { ok: true, entries: entries, count: entries.length };
  try {
    // CacheService value limit ~100KB; roster is small
    cache.put(cacheKey, JSON.stringify(out), 600);
  } catch (ignore2) {}
  return out;
}

function whClean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v).slice(0, 5000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function whSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}


function whDrawCount_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'missing email' };
  var sh = getSpreadsheet_().getSheetByName(SHEET_DRAW_LOG);
  if (!sh) return { ok: true, count: 0 };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, count: 0, draws: [] };
  var values = sh.getRange(2, 1, last, 11).getValues();
  var count = 0;
  var draws = [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1] || '').trim().toLowerCase() !== email) continue;
    count++;
    draws.push({
      drawId: String(values[i][0] || ''),
      email: email,
      drawnAt: String(values[i][2] || ''),
      cardId: String(values[i][3] || ''),
      cardName: String(values[i][4] || ''),
      slot: String(values[i][5] || ''),
      cost: values[i][6],
      isDuplicate: values[i][7] === true || String(values[i][7]).toUpperCase() === 'TRUE'
    });
  }
  var out = { ok: true, count: count };
  if (body.includeDraws) out.draws = draws;
  return out;
}

function whOwnedIds_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'missing email' };
  var sh = getSpreadsheet_().getSheetByName(SHEET_OWNED);
  if (!sh) return { ok: true, ids: [] };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, ids: [] };
  var header = sh.getRange(1, 1, 1, 8).getValues()[0].map(function (h) { return String(h).trim(); });
  var iEmail = Math.max(0, header.indexOf('email'));
  var iCard = header.indexOf('cardId') >= 0 ? header.indexOf('cardId') : 1;
  var iCount = header.indexOf('count') >= 0 ? header.indexOf('count') : 5;
  var data = sh.getRange(2, 1, last, 8).getValues();
  var ids = [];
  var items = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][iEmail] || '').trim().toLowerCase() !== email) continue;
    var id = String(data[i][iCard] || '').trim();
    if (!id) continue;
    ids.push(id);
    items.push({ cardId: id, count: Number(data[i][iCount] || 1) });
  }
  return { ok: true, ids: ids, items: items };
}


/**
 * One-shot pre-draw context: draw_count + study + owned_ids in a single doPost.
 * No ScriptLock (read-only). Keeps appends on append_draw only.
 */
function whDrawPrep_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'missing email' };
  var countRes = whDrawCount_({ email: email });
  if (!countRes || countRes.ok === false) {
    return { ok: false, error: (countRes && countRes.error) || 'draw_count failed' };
  }
  var studyRes = whStudy_({ email: email });
  if (!studyRes || studyRes.ok === false) {
    return { ok: false, error: (studyRes && studyRes.error) || 'study failed' };
  }
  var ownedRes = whOwnedIds_({ email: email });
  if (!ownedRes || ownedRes.ok === false) {
    return { ok: false, error: (ownedRes && ownedRes.error) || 'owned_ids failed' };
  }
  return {
    ok: true,
    count: Number(countRes.count || 0),
    rows: studyRes.rows || [],
    ownedIds: ownedRes.ids || [],
    ids: ownedRes.ids || [],
    items: ownedRes.items || []
  };
}

function whJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** PvP 完場：寫「學習記錄」validSeconds（預設 60） */
function whAppendStudy_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) return { ok: false, error: 'missing email' };
  var sec = Number(body.validSeconds);
  if (!isFinite(sec) || sec <= 0) sec = 60;
  if (sec > 3600) sec = 3600;
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_STUDY);
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
  function clean_(v) { return String(v == null ? '' : v).trim(); }
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
  return { ok: true, appended: 1, validSeconds: sec, source: String(body.source || 'wushuang_pvp'), version: WH_VERSION };
}

/** PvP 完場：寫「對戰場次」並更新「對戰排行」；重試只加差額 */
function whAppendMatch_(body) {
  var row = body.row || body;
  var email = String(row.email || '').trim().toLowerCase();
  var roomCode = String(row.roomCode || '').trim().toUpperCase();
  if (!email || !roomCode) return { ok: false, error: 'missing email/roomCode' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('對戰場次');
  if (!sh) return { ok: false, error: 'no sheet 對戰場次' };
  if (sh.getLastRow() === 0) {
    sh.appendRow(['hkDate','email','roomCode','form','role','startedAt','finishedAt','result','winsDelta','lossesDelta']);
  }
  function clean_(v) { return String(v == null ? '' : v).trim(); }
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
    whUpsertLeaderboard_(email, clean_(row.name || ''), clean_(row.className || ''), clean_(row.form || ''), netW, netL);
  }
  return { ok: true, appended: found ? 0 : 1, updated: found ? 1 : 0, version: WH_VERSION };
}

function whUpsertLeaderboard_(email, name, className, form, winsDelta, lossesDelta) {
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('對戰排行');
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

/**
 * body: { form?: 'F1'|'F2'|'F3' }
 * 排序：wins DESC → losses ASC → updatedAt ASC → email ASC；取頭 20。
 */
function whLeaderboardTop20_(body) {
  var formFilter = String((body && body.form) || '').trim().toUpperCase();
  if (formFilter !== 'F1' && formFilter !== 'F2' && formFilter !== 'F3') formFilter = '';

  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('對戰排行');
  if (!sh || sh.getLastRow() < 2) {
    return { ok: true, rows: [], count: 0, formFilter: formFilter || null, version: WH_VERSION };
  }

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
  return { ok: true, rows: rows, count: rows.length, formFilter: formFilter || null, version: WH_VERSION };
}
