# 中史無雙陀螺 · 抽卡 App（Google Apps Script）

**VERSION**：`draw-app-gas 0.4.0`  
**受眾**：初中  
**肖像主交付已轉 Cloudflare Worker** `draw-app/`（`draw-app 0.3.0`，同源 `/cards/{id}.png`）。本 GAS 作 Sheet 原生備援／legacy（Drive／data-URL 肖像喺手機 iframe 易失敗）。

## 功能

- 學校 email 登入（可選姓名核對學生名單）；**無 Google OAuth**
- 溫習額度：每日入帳 cap 60 分；**10 分鐘＝1 抽**；可跨日累積
- 稀有權重：普通 **4**／優秀 **2**／史詩 **0.7**／傳說 **0.22**；未擁有 ×3
- 翻卡 0.6–0.9s，可跳過；揭曉後**放大詳情**，須按「返回」
- 圖鑑卡可點開同款詳情；**3:4 人物圖位**（「人物圖待上」；之後放圖唔爛版）
- 讀寫同一 Flash Card Spreadsheet：`學習記錄`／`學生名單`／`抽卡記錄`／`擁有卡`

## 檔案

| 檔 | 用途 |
|---|---|
| `appsscript.json` | 時區 Asia/Hong_Kong、Web App 設定 |
| `Config.gs` | Sheet ID、分頁名、權重、VERSION、ALLOW_MOCK_STUDY |
| `Code.gs` | `doGet`、`apiMe`／`apiDraw`／`apiCollection`／`apiLog`／`apiHealth` |
| `Cards.gs` | 加權抽卡 |
| `CardsData.gs` | 60 卡嵌入資料 |
| `Index.html` | HtmlService 頁面 |
| `Stylesheet.html` | CSS |
| `ClientJS.html` | 前端（`google.script.run`） |
| `cards_60.json` | 卡池原始 JSON（改卡後請重產 `CardsData.gs`） |

預設 Sheet ID（`Config.gs`）：  
`1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc`

## 建立專案＋Deploy（Marcus／經理）

1. 開 [script.google.com](https://script.google.com/) → **新增專案**  
   名稱建議：`中史無雙陀螺-抽卡`
2. 刪預設 `Code.gs` 內容後，**逐個新增檔案**並貼上本目錄內容：  
   - 腳本：`Config.gs`、`Code.gs`、`Cards.gs`、`CardsData.gs`  
   - HTML：`Index.html`、`Stylesheet.html`、`ClientJS.html`  
   （檔名須一致，`include('Stylesheet')` 靠檔名）
3. （可選）專案設定 → 將時區設為 **Hong Kong**；或用 clasp 推 `appsscript.json`
4. 確認你登入嘅 Google 帳號對 Flash Card Sheet 有**編輯**權限（Script **Execute as: Me** 用你身份開 Sheet，**唔使** Service Account JSON）
5. **部署 → 新增部署作業 → 類型：網頁應用程式**  
   - 說明：`draw-app-gas 0.4.0`  
   - **執行身分：我（Execute as: Me）**  
   - **具有存取權的使用者：任何人**（或「任何人（Google 帳戶）」／校內政策允許嘅選項）  
6. 授權權限（Spreadsheet）→ 複製 **網頁應用程式 URL** 畀學生／Registry  
7. 之後改碼：**部署 → 管理部署作業 → 編輯 → 新版本**，VERSION 字串一併改 `Config.gs` 嘅 `VERSION`

### clasp（可選）

```bash
cd draw-app-gas
npx @google/clasp create --type webapp --title "中史無雙陀螺-抽卡"
# 或 clasp clone <scriptId>
npx @google/clasp push
npx @google/clasp deploy --description "draw-app-gas 0.4.0"
```

## 設定開關

- `ALLOW_MOCK_STUDY`（`Config.gs`）：該 email 喺「學習記錄」無列時，用 mock 時數方便試抽。正式課室有真資料後改 `false`。
- 學生名單非空時：email 必須喺「學生名單」；有填姓名則對齊「姓名」欄。
- 人物圖：3:4 經 `apiArt`（Drive JPEG → data URL；`ArtMap.gs`）；jpg 資料夾 `1-QGbtih7wRc7tL8fPESf_szyZR21jfzP`。

## 過渡：Cloudflare Worker

仍可用：https://wushuang-tuoluo-draw.scchan-942.workers.dev  
VERSION：`draw-app 0.2.3-preview`（已含 modal／人物位）。**主方案以本 GAS 為準。**

## 重產 CardsData.gs

```bash
node -e '
const cards=require("./cards_60.json");
require("fs").writeFileSync("CardsData.gs",
  "var CARDS_DATA = "+JSON.stringify(cards)+";\n");
'
```
