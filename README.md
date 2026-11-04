# 《中史無雙陀螺》

**Zhongshi Wushuang Tuoluo** — 初中中國歷史陀螺對戰網頁遊戲（Junior-secondary Chinese History spinning-top battle web game）。

對象 Audience：初中 F.1–F.3。

## 線上版本 Live

| App | URL | Worker | VERSION |
| --- | --- | --- | --- |
| 對戰 Battle | https://wushuang.scchan-942.workers.dev | `wushuang` | `0.5.13-card-load` |
| 抽卡 Draw | https://wushuang-tuoluo-draw.scchan-942.workers.dev | `wushuang-tuoluo-draw` | `draw-app 0.5.5-owned-null-guard` |

## 目錄 Layout

```
README.md
DESIGN.md
…其他根目錄文件 root docs（卡表、設計筆記）…
main-app/            對戰 SPA + Cloudflare Worker（wushuang）
draw-app/            抽卡 SPA Worker（wushuang-tuoluo-draw）
draw-app-gas/        抽卡 Google Apps Script
draw-app-auth-gas/   登入核對 GAS（auth bridge）
draw-sheet-gas/      試算表 webhook GAS
```

## 部署 Deploy

用 Wrangler，在對應目錄執行。Deploy with Wrangler from the app directory.

```bash
cd main-app && npx wrangler deploy
cd draw-app && npx wrangler deploy
```

本地開發 Local dev：`main-app` 用 `npm run dev`（Vite）；`draw-app` 用 `npm run dev`（`wrangler dev`）。

## 機密 Secrets

不要把機密提交到這個儲存庫。Do not commit secrets.

- `AUTH_BRIDGE_SECRET`、`SHEET_SECRET`、`GOOGLE_SA_JSON` 只用 `wrangler secret put`（或 GAS Script Properties）存放。
- Sheet ID 與 `AUTH_BRIDGE_URL` 已在 `draw-app/wrangler.toml` 的 `[vars]`，可保留。
- `.dev.vars`、`.env*` 已列入 `.gitignore`。
- 匯入公開庫時已移除 `draw-app-auth-gas/` 內的 live `AUTH_HMAC_SECRET`（`AUTH_HMAC_SECRET.example.txt`、`SECRET_SETUP.txt`、`SetupSecret.js`）。請在本機填回同一組值，分別寫入 GAS Script Property `AUTH_HMAC_SECRET` 與 `wrangler secret put AUTH_BRIDGE_SECRET`，不要再提交該值。

The live `AUTH_HMAC_SECRET` was removed from `draw-app-auth-gas/` before this public import. Set the same value only in the GAS Script Property and as the `AUTH_BRIDGE_SECRET` Wrangler secret.
