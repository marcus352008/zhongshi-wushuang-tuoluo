# draw-app 0.5.1 — GAS ActiveUser 登入核對橋

**Live CF**：https://wushuang-tuoluo-draw.scchan-942.workers.dev  
**VERSION**：draw-app 0.5.1  
**時間**：2026-10-17 ~18:45 HKT

## 做咗咩

1. **新 Sheet**「中史無雙 登入核對」  
   - ID：`1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU`  
   - URL：https://docs.google.com/spreadsheets/d/1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU/edit  
   - 欄：時間｜輸入 Email｜Google Email｜相符｜來源

2. **輕量 GAS**（主 App 仍 CF）：`/workspace/beyblade-wu-shuang/draw-app-auth-gas/`  
   - `Session.getActiveUser().getEmail()`（同 Flash Card）  
   - 寫入新 Sheet；相符簽發 HMAC proof  
   - **clasp create 失敗**（API socket hang up）→ 要 Marcus 手動 Deploy

3. **CF Worker**  
   - `src/authBridge.ts`：驗 `x-auth-proof: typed|google|token`  
   - `/api/me`、`/api/draw` 主擋改為 bridge  
   - 0.5.0 學習記錄弱核對改次要（唔再硬擋）  
   - `AUTH_BRIDGE_SECRET` 已設 wrangler secret  
   - `AUTH_BRIDGE_URL=""` stub；`ALLOW_MOCK_AUTH=1` → 橋未上線時仍可 preview 登入

4. **前端**：進入時若 `authBridge=true` → popup GAS → postMessage proof → 不符拒登入

5. **資產**：cards 60 檔 16955968 bytes 未變；只 upload index.html + app.js

6. **Registry**：兩列《中史無雙》已標 0.5.1／bridge pending

## Blocked（Marcus）

1. script.google.com → 新增專案「中史無雙-登入核對」  
2. 貼 `Code.gs` + HTML `Index`（內容見 `draw-app-auth-gas/`）  
3. Script Property：`AUTH_HMAC_SECRET` = 同 CF 嘅值（見 `draw-app-auth-gas/SECRET_SETUP.txt`）  
4. Deploy 網頁應用程式：  
   - **執行身分：存取網頁應用程式的使用者**  
   - 存取權：任何人／任何 Google 帳戶  
5. 把 **/exec URL** 貼返 → Coder 填 `AUTH_BRIDGE_URL` 並 redeploy；建議之後 `ALLOW_MOCK_AUTH=0`

## 煙測（而家）

- `/api/health` → `draw-app 0.5.1`，`authBridge: false`  
- `/api/me`（無 proof）→ 200（preview stub）  
- 全量核對未生效直至 GAS URL 上線
