# 中史無雙陀螺 — 抽卡 Web App 短方案 v1

**日期**：2026-10-13（HKT）  
**狀態**：讀完 Sheet 後方案；確認前／權限未通前可先做 UI＋假登入；**重大 deploy 前知會經理**  
**受眾**：初中｜Registry 標初中｜卡只要數值唔要圖

---

## 1. 資料源（已讀）

Spreadsheet：`中史初中FLASH CARD題庫`  
id：`1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc`

### 主用：`學習記錄`

| 欄 | 用途 |
|----|------|
| 記錄時間 | 日切（Asia/Hong_Kong）計每日 cap |
| 輸入的 Email | 後備對帳 |
| **有效秒數** | 溫習秒數（加總用） |
| **Google 驗證 Email** | **主對帳**（同學生輸入嘅學校 email） |
| 使用者姓名／年級／單元 | 顯示用 |

### 輔助：`學生名單`

`班級, 姓名, Email` — 可顯示班別；**白名單已鎖**：有 SA 時只准「學生名單」Email 抽卡（`REQUIRE_ROSTER=0` 可關）。

### 唔用嚟做即時扣抽

`每週總記錄`／`每月總記錄` 已係匯總分鐘，**難做每日 60 分 cap** → 抽卡結算以 **`學習記錄.有效秒數`** 為準。

### 卡池

卡池：`cards_60`（60 卡＋稀有度）已入 Worker；舊 30 卡簿可作備份。

---

## 2. 時數 → 抽數（已鎖規則）

> **Marcus 2026-10-14**：由 20 分鐘＝1 抽改為 **10 分鐘＝1 抽**（`SECONDS_PER_DRAW=600`，source=`flashcard_10min`）。
>
> **Marcus／經理 2026-10-14 拍板**：稀有權重 普通4／優秀2／史詩0.7／傳說0.22；未擁有×3；翻卡 0.6–0.9s 可跳過；震動預設關；短揭曉音可靜音；唔加軟 pity。

1. 只計 `Google 驗證 Email`（空則 fallback `輸入的 Email`）＝學生輸入嘅學校 email（小寫 trim）。  
2. 按 **香港日期** 把當日有效秒加總，**每日最多入帳 3600 秒（60 分）**。  
3. 所有日期入帳秒 **可跨日累積** → `creditedSec`。  
4. `entitledDraws = floor(creditedSec / 600)`（10 分鐘＝1 抽）。  
5. `remainingDraws = entitledDraws - count(DrawLog where user email)`。  
6. 每次抽 1 張；`remainingDraws >= 1` 先准抽。  
7. **新號唔送卡**；擁有卡＝DrawLog 去重（duplicate 先只標記，碎片未定）。

---

## 3. Auth

**學校 email 輸入**（Marcus 簡化，2026-10-13）：學生打學校帳號 email（可選姓名核對）→ header `x-user-email`（＋可選 `x-user-name`）→ Worker 當用戶鍵。

- **唔用** Google OAuth／GIS／密碼。  
- 有 SA 時：白名單＝`學生名單` Email；若有傳姓名則 trim 對齊名單「姓名」。  
- 無 SA（preview）：跳過名單，mock 溫習時數。  
- 後端讀寫 Sheet 仍用 **Service Account**（只 Coder／伺服器；學生唔見）。

---

## 4. 存邊（抽卡／擁有／log）

**Marcus 定（2026-10-13）**：用 **Flash Card 同一個 Sheet**（`1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc`）加新分頁，**唔另開簿**。

（先前誤建獨立簿 `1E1dVuL__…` 可棄用／封存。）

| Tab（同一簿） | 欄位 |
|-----|------|
| **抽卡記錄** | drawId, email, drawnAt(ISO+08), cardId, cardName, slot, cost, isDuplicate, creditedSecBefore, entitledBefore, source=`flashcard_10min` |
| **擁有卡**（可物化或由抽卡記錄聚合） | email, cardId, cardName, slot, cost, count, firstDrawnAt, lastDrawnAt |
| **Meta**（可選） | email, lastSyncAt, cachedCreditedSec |

卡池只讀 `cards_30`；溫習讀 `學習記錄`；抽卡寫 `抽卡記錄`／`擁有卡`——**全部同一 spreadsheet**。

執行期後端需要 **有權讀寫此 Flash Card Sheet** 嘅 Service Account（見 §6）。

---

## 5. 技術选型（推介）

| 層 | 選擇 | 原因 |
|----|------|------|
| 宿主 | **Cloudflare Worker**（Pages／Workers 靜態＋API） | 同校其他遊戲一致；Chromebook 友善 |
| 前端 | 單頁：登入／時數／抽 1 次／圖鑑列表（數值卡） | 初中簡單 |
| 卡池 | 建置時打包 `cards_30.json` 或啟動拉 Sheet | Cost 暫沿用 |
| 溫習＋Log | Google Sheets API | Marcus 已用 Sheet 做 Flash Card |

畫面流程：輸入學校 email（可選姓名）→ 顯示已入帳分鐘／可抽次數 →「抽 1 張」→ 結果＋寫 DrawLog → 圖鑑列表。

---

## 6. 權限／卡住點（要 Marcus／經理配合）

學生個 Google 帳號**唔會**有題庫 Sheet 讀權 → 唔可以純前端直連 Sheet。

需要其一：

1. **Service Account**（推介）：同一個 Flash Card Sheet（讀寫）分享俾 `…@….iam.gserviceaccount.com`；Worker 用 JSON key（Secrets）。  
2. 或 **Apps Script Web App** 綁題庫、以擁有者身份執行（改技術栈）。

未有 SA／分享前：先做 **mock 時數** 開發 UI／抽卡／本機 log；唔正式 deploy。

---

## 7. 實作步驟

1. ✅ 讀 Sheet 結構（本文件）  
2. 建 `cards_30.json`＋同一簿分頁骨架（抽卡記錄／擁有卡）  
3. Worker 專案骨架：`/auth` 驗證、`/me` 時數＋剩餘抽、`/draw`、`/collection`  
4. UI：登入、狀態、抽卡、圖鑑  
5. 接真 Sheet（等 SA）  
6. 知會經理 → deploy → Registry 標**初中**＋VERSION  

---

## 8. 請 Marcus／經理拍板（短）

1. 只准 `學生名單` 內 email 抽卡？  
2. ~~抽卡資料用獨立 Sheet？~~ → **Marcus 已定：同一簿新分頁**  
3. 可否開 **Google Cloud Service Account** 並分享兩個 Sheet？  
4. 正式網域意向（例 `wushuang-draw.scchan-942.workers.dev`）？



---

## Marcus 手開權限步驟

見 [`draw-app/SETUP_FOR_MARCUS.md`](draw-app/SETUP_FOR_MARCUS.md)（只要 Service Account 共用編輯者；**唔使 OAuth**）。交經理轉 Marcus；JSON key 用安全渠道交 Coder，唔好貼公開 chat。
