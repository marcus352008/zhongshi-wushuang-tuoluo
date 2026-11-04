# 《中史無雙陀螺》0.5.12-noS-center — 取消 S 模式＋加強向心

**Live:** https://wushuang.scchan-942.workers.dev  
**Version ID:** `9b6e08a3-0800-461e-ab1f-00079d472c8a`  
**Backup:** `/workspace/beyblade-wu-shuang/main-app-backup-pre-0.5.12-noS-center-20261103-161220`  
**QC:** waived（Marcus hotfix／t152u）  
**Deployed:** 2026-11-03 16:13 HKT

## 要求（t152u）
1. **取消 S 模式**（簡易／Mode S 選項同分支移除；永遠 Case C；唔再因 S 跳過開局題）
2. **雙方陀螺再加速向中心**（調高向心／速度相關常數）

## 改法（一句）
UI／URL／對戰狀態機永遠 Case C＋案Q；`BOWL_SPRING` 0.78→1.00、`BASE_SPEED` 1.4→1.55。

## 常數
| 常數 | 舊 | 新 |
| --- | --- | --- |
| `BOWL_SPRING` | 0.78 | **1.00** |
| `BASE_SPEED` | 1.4 | **1.55** |

## S 模式移除面
- 組裝頁／右上角唔再有「S模式」掣；`?mode=s` 無效（`modeS` 永遠 false）
- `battle.ts`：永遠 `mode='C'`；刪 S 自動發射分支；開局題單機／PvP 一律自動彈
- `MODE_S_*` 常數標 deprecated（headless／舊測試相容）

## 驗證
- vitest 64 passed
- Live `index-BPsOXXUT.js` 含 `0.5.12-noS-center`；無「S模式（等功率）」文案；minify 見 `hu=1,uu=1.55`
- Registry Apps!C21:H21 ＋員工日誌 Done
