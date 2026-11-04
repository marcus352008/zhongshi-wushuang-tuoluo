# draw-app 0.5.2 — AUTH_BRIDGE_URL 已接

**Live**：https://wushuang-tuoluo-draw.scchan-942.workers.dev  
**VERSION**：draw-app 0.5.2  
**時間**：2026-10-17（HKT）

## 變更
- `AUTH_BRIDGE_URL` = Marcus GAS /exec（wahyan.edu.hk macros）
- `ALLOW_MOCK_AUTH=0`（生產核對生效）
- `AUTH_BRIDGE_SECRET` 重設為同 GAS `AUTH_HMAC_SECRET`
- cards 60 檔 16955968 bytes 未變；只 upload index.html + app.js

## 煙測
- `/api/health` → `authBridge: true`，version `draw-app 0.5.2`
- `/api/me?email=…` 無 proof → 401 `auth_bridge_required`
- 前端：`authBridge=true` → 登入開 popup GAS → postMessage proof
