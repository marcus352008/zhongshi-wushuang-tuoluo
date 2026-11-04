# REVIEW — 0.5.3-pvp-leaderboard（批次4）

**HKT：** 2026-11-01（Asia/Hong_Kong）  
**Backup：** `main-app-backup-pre-0.5.3-pvp-leaderboard-20261101-155454`  
**Argon：** `_pvp/argon_batch4/argon_reply.md`（session 7709659887274616438）  
**QC：** waived（Marcus）

## 合併決策
| 檔 | 做法 |
|----|------|
| `src/ui/leaderboard.ts` | **新檔**（Argon 完整） |
| `worker/index.ts` | 完整替換（+`GET /api/pvp/leaderboard` 20s cache） |
| `worker/sheetWebhook.ts` | 完整替換（+`fetchLeaderboardTop20`） |
| `worker/BattleRoom.ts` | 完整替換（hello 存 `className`；append_match 帶 name/className） |
| `src/pvp/client.ts` | 完整替換（+`fetchLeaderboard`；hello 帶 className） |
| `src/ui/lobby.ts` | 完整替換（掛風雲榜面板） |
| `src/main.ts` | 完整替換（完場屏掛榜） |
| `wrangler.toml` / `VERSION` | 升 `0.5.3-pvp-leaderboard` |
| `src/config/balance.ts` | **只改 VERSION**（Argon 稿裁走大量物理常數，拒盲貼） |
| `package.json` | **只改 version**（保留 private／type／allowScripts） |
| Live GAS `draw-app-gas/SheetWebhook.gs` | **只補缺**：`leaderboard_top20` + append_match 差額幂等；WH_VERSION → `0.4.10-pvp-leaderboard` |
| `draw-sheet-gas/Code.gs` | 同步 form 過濾／幂等（非 Live） |

## 拒絕
- Argon `balance.ts` 全文（缺 BASE_*／arena／quiz 常數）
- Argon `package.json` 全文（掉 private／type／allowScripts）
- Argon GAS `getRange(..., last-1, ...)`（單列時會炸；已改用 `last`）

## 保留（0.5.2）
分級儲力題 F1–F3、完場 +60s、Host 20Hz snap、fullscreen、每日 3 場、Three.js／物理常數、開局題共用。

## 排序規則
`wins DESC` → `losses ASC` → `updatedAt ASC` → `email ASC`；頭 20。Worker 再二次過濾 `?form=`。
