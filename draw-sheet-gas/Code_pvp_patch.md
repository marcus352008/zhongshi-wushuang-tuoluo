# draw-sheet-gas PvP 擴充草稿（尚未貼上 Live GAS）

**現況**：`Code.gs` actions = `ping`｜`append_draw`｜`append_owned`｜`study`（**只讀**學習記錄）｜`roster`。  
**Sheet**：`1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc`  
**本檔用途**：畀 Marcus／Coder 手動合併進 Apps Script；**唔好**當已部署。部署途徑：開啟 GAS 專案（見 `draw-sheet-gas/.clasp.json`）→ 貼函式 → 儲存 → 若用 clasp：`clasp push`（需已 login）。

---

## 1. 新增常數（放檔案頂）

```javascript
var SHEET_MATCH = '對戰場次';
var SHEET_LEADERBOARD = '對戰排行';
var DAILY_PVP_LIMIT = 3;
```

---

## 2. 在 `doPost` switch 加支線

於 `action === 'roster'` 之後、`unknown action` 之前插入：

```javascript
    if (action === 'append_study') return json_(appendStudy_(body));
    if (action === 'append_match') return json_(appendMatch_(body));
    if (action === 'get_daily_plays') return json_(getDailyPlays_(body));
    if (action === 'leaderboard_top20') return json_(leaderboardTop20_(body));
    if (action === 'get_form_from_roster') return json_(getFormFromRoster_(body));
```

**注意**：現有 `study` **唔改名、唔改行為**（繼續只讀）。新寫入用 `append_study`。

---

## 3. `append_study` — 寫學習記錄 +60 秒

```javascript
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
```

---

## 4. `append_match` — 對戰場次＋更新排行

```javascript
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
  // 幂等：同一 email+roomCode 已有 started 列則 update
  var last = sh.getLastRow();
  var found = 0;
  if (last >= 2) {
    var data = sh.getRange(2, 1, last, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1]).trim().toLowerCase() === email && String(data[i][2]).trim().toUpperCase() === roomCode) {
        found = i + 2; break;
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

  var w = Number(row.winsDelta || 0);
  var l = Number(row.lossesDelta || 0);
  if (w || l) upsertLeaderboard_(email, clean_(row.name || ''), clean_(row.className || ''), clean_(row.form || ''), w, l);
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
    var wins = Number(sh.getRange(found, 5).getValue() || 0) + Number(winsDelta || 0);
    var losses = Number(sh.getRange(found, 6).getValue() || 0) + Number(lossesDelta || 0);
    sh.getRange(found, 2, 1, 6).setValues([[name || sh.getRange(found, 2).getValue(), className || sh.getRange(found, 3).getValue(), form || sh.getRange(found, 4).getValue(), wins, losses, now]]);
  } else {
    sh.appendRow([email, name, className, form, Number(winsDelta || 0), Number(lossesDelta || 0), now]);
  }
}
```

---

## 5. `get_daily_plays`

```javascript
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
```

---

## 6. `leaderboard_top20`

```javascript
function leaderboardTop20_(body) {
  var sh = ss_().getSheetByName(SHEET_LEADERBOARD);
  if (!sh || sh.getLastRow() < 2) return { ok: true, rows: [], count: 0 };
  var data = sh.getRange(2, 1, sh.getLastRow(), 7).getValues();
  var rows = data.map(function (r) {
    return {
      email: String(r[0] || '').trim().toLowerCase(),
      name: String(r[1] || ''),
      className: String(r[2] || ''),
      form: String(r[3] || ''),
      wins: Number(r[4] || 0),
      losses: Number(r[5] || 0),
      updatedAt: String(r[6] || '')
    };
  }).filter(function (r) { return r.email.indexOf('@') >= 0; });
  rows.sort(function (a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return String(a.updatedAt).localeCompare(String(b.updatedAt));
  });
  rows = rows.slice(0, 20);
  return { ok: true, rows: rows, count: rows.length };
}
```

---

## 7. 可選 `get_form_from_roster`

```javascript
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
```

---

## 8. 貼上檢查清單

1. 確認 Sheet 已有分頁「對戰場次」「對戰排行」（Coder 已建）。
2. 合併上述函式；`WH_VERSION` bump 例如 `draw-sheet-gas 0.2.0-pvp`。
3. `clasp push` 或編輯器儲存；用 `action:ping` 測。
4. 用 `SHARED_SECRET` 先測 `get_daily_plays` → `append_match` → `leaderboard_top20` → `append_study`。
5. **唔好**改 Live Worker 直到 batch2 接線。

