# 中史無雙 · 登入核對橋（GAS）

VERSION：**draw-app-auth-gas 0.5.1**

主抽卡 App 仍喺 **Cloudflare Workers**。本專案只負責：
用 `Session.getActiveUser().getEmail()` 讀 Chrome／Google 帳，
同輸入 email 對比，寫入新 Sheet，並簽發短命 HMAC proof。

## Sheet

- 標題：中史無雙 登入核對  
- ID：`1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU`  
- URL：https://docs.google.com/spreadsheets/d/1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU/edit  
- 欄：時間｜輸入 Email｜Google Email｜相符｜來源

## Marcus 手動 Deploy（必須）

1. 開 https://script.google.com/ → **新增專案**  
   名稱：`中史無雙-登入核對`
2. 刪預設 `Code.gs` 內容，貼上本目錄 `Code.gs`。  
   新增 HTML 檔 `Index`，貼上 `Index.html`。  
   （可選）專案設定時區 Hong Kong；或用 clasp 推 `appsscript.json`。
3. **專案設定 → 指令碼屬性** 新增：
   - 鍵：`AUTH_HMAC_SECRET`
   - 值：與 CF Worker secret `AUTH_BRIDGE_SECRET` **完全相同**  
     （Coder 部署時會設；見 draw-app `AUTH_BRIDGE_SECRET.txt` 或問 Coder）
4. **部署 → 新增部署作業 → 網頁應用程式**
   - 說明：`draw-app-auth-gas 0.5.1`
   - **執行身分：存取網頁應用程式的使用者**（User accessing）← 關鍵，否則拎唔到 ActiveUser
   - 具有存取權的使用者：**任何人** 或 **任何擁有 Google 帳戶的使用者**（校內政策允許者）
5. 授權（試算表＋用戶 email）→ 複製 **網頁應用程式 URL**（…/exec）
6. 把 URL 貼返畀 Coder／經理 → 寫入 CF `AUTH_BRIDGE_URL` 後 redeploy

### clasp（可選）

```bash
cd draw-app-auth-gas
clasp create --type webapp --title "中史無雙-登入核對"
clasp push
# Deploy 仍建議喺 UI 用 Execute as: USER_ACCESSING
```

## 前端用法

CF 登入頁會 `window.open(AUTH_BRIDGE_URL + '?typedEmail=…&returnOrigin=…')`，  
本頁 `google.script.run.verifyAndLog` 後 `postMessage` proof 返 opener。

## 注意

- 唔好改成 Execute as: Me——會變成永遠係部署者 email。  
- Flash Card 溫習 Sheet（`1vZpNVqC_…`）繼續只畀溫習／抽卡；登入核對用本新表。
