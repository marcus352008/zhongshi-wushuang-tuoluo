# 抽卡 App — Sheet 接通（守邊模式，唔使 Service Account）

**VERSION**：`draw-app 0.4.1`  
**Live**：https://wushuang-tuoluo-draw.scchan-942.workers.dev  
**Sheet**：https://docs.google.com/spreadsheets/d/1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc/edit  

模式同《守邊之策》：Cloudflare Worker `POST` → Apps Script `doPost`（Execute as Me／Anyone anonymous）；body 帶 `secret`＝Script Property `SHARED_SECRET`。

## 已完成（Coder）

1. `draw-app-gas` 加 `SheetWebhook.gs`（actions：ping／append_draw／append_owned／study／roster／draw_count／owned_ids）
2. Web App 部署：`ANYONE_ANONYMOUS` + Execute as Me  
   URL：`https://script.google.com/macros/s/AKfycbzYlnhLy3J92rr9yw9uMh-w-hgqss9cTSygulz4txekVhscj04_gl42rGhPeXU7W4wDiA/exec`
3. Worker secrets 已設：`SHEET_WEBHOOK_URL`＋`SHEET_SECRET`
4. Smoke：寫入「抽卡記錄／擁有卡」、讀「學習記錄」、`persistedToSheet:true`、`studySource:sheets`

## Marcus 通常唔使再撳

若 webhook 突然 401／403：打開 script 編輯器 → 執行 `setupSharedSecret` 批准權限 → 確認部署仍係「我／任何人」。

**唔使** GCP Service Account、唔使 share SA email。
