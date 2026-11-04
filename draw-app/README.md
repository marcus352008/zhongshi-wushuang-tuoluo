# 中史無雙陀螺 — 抽卡 Web App

> **主交付（肖像同源）**：本 Cloudflare Worker。GAS（`../draw-app-gas/`）作 Sheet 原生備援／legacy。
>
> **肖像**：`public/cards/{A01–C20}.png`（3:4，同源 `/cards/C01.png`），唔經 Drive。
> **Sheet**：守邊模式：`SHEET_WEBHOOK_URL`＋`SHEET_SECRET` → GAS doPost（見 SETUP_FOR_MARCUS.md）；未設則 mock／memory。

**VERSION**：`draw-app 0.4.1`  
**受眾**：初中（F.1–F.3）｜**Registry 請標：初中**  
**重大 deploy 前必須知會經理**

Flash Card 溫習累積時數 → 抽人物卡（60 張；同源 3:4 肖像 /cards/{id}.png）。新號**唔送起步卡**。

## 功能

| API | 說明 |
|-----|------|
| `GET /api/health` | 版本／mock／sheets 狀態 |
| `GET /api/me` | 入帳分鐘、可抽／已抽／剩餘 |
| `POST /api/draw` | 抽 1 張（未擁有權重 ×3） |
| `GET /api/collection` | 圖鑑（擁有卡） |
| `GET /api/log` | 抽卡記錄 |
| `GET /api/roster-check?email=` | 單筆名單核對（唔洩漏完整名單） |

規則（已鎖）：

- 按香港日加總「有效秒數」，**每日最多入帳 3600 秒（60 分）**，可跨日累積  
- `entitledDraws = floor(creditedSec / 600)`（10 分＝1 抽）  
- `remaining = entitled - 抽卡記錄筆數`

## 資料（同一 Google Sheet）

Spreadsheet id：`1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc`（中史初中 FLASH CARD 題庫）

| 分頁 | 用途 |
|------|------|
| `學習記錄` | 讀溫習秒數 |
| `抽卡記錄` | 寫每次抽卡 |
| `擁有卡` | 寫首次擁有（新卡） |
| `學生名單` | Email 白名單（＋姓名核對） |

**唔再用**獨立簿 `1E1dVuL__…`（已棄用）。

## 本機執行（Mock，唔使 GAS webhook（守邊））

```bash
cd /workspace/beyblade-wu-shuang/draw-app
npm install
npm run test          # 時數計算單測
npm run typecheck
npm run dev           # wrangler dev → http://127.0.0.1:8787
```

瀏覽器開首頁 → 輸入**學校 email**（姓名選填）→「進入」。  
登入＝`x-user-email`（唔使 OAuth／GIS）。未設 SA 時跳過學生名單，用 mock 溫習時數。

預設 mock 溫習：day1 5000s（入帳 3600）+ day2 1000s → **credited 4600 → 可抽 3 次**。

自訂 mock 秒數：

```bash
npx wrangler dev --var MOCK_STUDY_SEC:7200
```

API 帶 header `x-user-email`（可選 `x-user-name`）或 query `?email=`。

未有 SA 時：DrawLog 存在 **Worker 記憶體**（或可綁 KV `DRAW_KV`）；重整／換 isolate 可能清空。

## 接真 Google（未完成前唔正式上線）

需要 Marcus／經理（見 `SETUP_FOR_MARCUS.md`）：

1. **GAS webhook（守邊）** JSON → `wrangler secret put GOOGLE_SA_JSON`  
2. 將 Flash Card Sheet **分享編輯**俾 SA `client_email`（讀 `學習記錄`／`學生名單`＋寫 `抽卡記錄`／`擁有卡`）  
3. **唔使** OAuth Client ID — 學生只輸入學校 email

正式網域意向（待拍板）：例如 `wushuang-draw.scchan-942.workers.dev`。

## 目錄

```
draw-app/
  assets/cards_30.json
  public/                 # 繁中 UI
  src/
    index.ts              # Worker 路由
    study.ts              # 時數純函式
    cards.ts              # 加權抽卡
    store.ts              # memory／KV
    sheets.ts             # Sheets API（要 SA；同一簿）
    auth.ts
  scripts/test-study.ts
  wrangler.toml
```

## 部署注意

- **確認前／重大更新前知會經理**  
- Registry：category **初中**、status、live URL、Drive／source  
- 生產建議 `ALLOW_MOCK_AUTH=0`，並設好 Client ID＋SA  

## 卡住（要外部配合）

| 項目 | 狀態 |
|------|------|
| GIS OAuth Client ID | 未設 → 只能 Mock 登入 |
| GAS webhook（守邊） + Sheet 分享 | 未設 → 溫習／log 用 mock／memory |
| 只准學生名單 email？ | 待 Marcus 拍板 |
