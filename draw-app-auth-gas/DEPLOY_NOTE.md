# draw-app-auth-gas 0.5.3 — Marcus 部署步驟

CF draw-app **0.5.3** 已上線；GAS 橋要你喺 Apps Script **重新貼碼＋新版本 Deploy** 先生效。

## (a) 更新 GAS 並發新版本

1. 開 [script.google.com](https://script.google.com/) → 專案「中史無雙-登入核對」
2. 用箱內最新檔覆蓋：
   - `Code.gs` ← `/workspace/beyblade-wu-shuang/draw-app-auth-gas/Code.gs`
   - `Index`（HTML）← `/workspace/beyblade-wu-shuang/draw-app-auth-gas/Index.html`
3. 確認指令碼屬性仍有：`AUTH_HMAC_SECRET` =（同 CF `AUTH_BRIDGE_SECRET`）
4. **部署 → 管理部署 → 編輯（鉛筆）→ 版本：新增版本 → 部署**
   - 執行身分：**存取網頁應用程式的使用者**
   - 具有存取權的使用者：Google 帳戶／校內允許
5. **/exec URL 唔使改**（同一部署 ID 即可）；若換咗新 URL 再貼返畀工程師

## (b) 單獨開 /exec 完成授權一次

用**學校 Google 帳**（例如 scchan@wahyan.edu.hk）開：

https://script.google.com/a/macros/wahyan.edu.hk/s/AKfycbxqCw6Blyzux8_v0ilobLRf7eYhkFQnPW6AysAnZEqhZnUwiQc3IHI74G97SeyR8e6d/exec?typedEmail=scchan@wahyan.edu.hk

見到「允許／授權」就批；頁面應顯示「核對中…」或成功／失敗訊息（**唔應長期空白**）。完成後返抽卡 App 硬重新整理再登入。

## (c) Sheet 共用畀校網域「編輯者」

表：https://docs.google.com/spreadsheets/d/1ZIB-whclOkMFWCNf9007v3fXs0T0PwHsVO1pRwge9LU/edit

1. 共用 → 新增「Wah Yan College, Hong Kong」／網域 `wahyan.edu.hk`
2. 角色：**編輯者**（學生 Execute as User 先寫得入「登入核對」）
3. 0.5.3 起：寫表失敗**唔再擋** match／token，但無共用就無登入紀錄

## CF Live

https://wushuang-tuoluo-draw.scchan-942.workers.dev  
VERSION：draw-app 0.5.3（逾時 45s；彈窗關閉即解除「核對中…」）

## 改動摘要

| 檔 | 改乜 |
|---|---|
| Code.gs | `appendLog_` try/catch；寫表失敗唔阻 token |
| Index.html | 一入頁即顯示繁中提示＋空白授權說明；失敗顯示 error |
| public/app.js | 逾時 45s；關窗 reject；錯誤叫用戶先單獨開 GAS 授權 |
