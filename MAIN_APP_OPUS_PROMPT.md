# Cursor Opus Prompt — 《中史無雙陀螺》主程式 Phase 1

把下面整段（由「—— PROMPT START ——」到「—— PROMPT END ——」）貼去 Cursor Opus。  
附件：`beyblade-arena-source.zip`、`DESIGN.md`、`cards_60.json`（見文末路徑）。  
**唔好 deploy**；本地 `npm run dev` 可玩即可。做完交檔／zip 畀 Marcus／經理合併，確認前唔上 live。

---

—— PROMPT START ——

You are building **Phase 1** of a Chromebook classroom web game for junior secondary Chinese History students in Hong Kong.

## Product one-liner
Students **assemble a 3-part beyblade** (each part = one historical figure), then fight **1v1 spin battles**. Learning focus is **loadout / history tags**, not esports reaction speed.

Chinese name: **中史無雙陀螺**. Audience: F.1–F.3. UI and card text: **Traditional Chinese (繁體)**. Registry label: **初中**.

## Hard scope (Phase 1)
**In scope:** assemble (3 slots) → launch → one match vs **CPU** → show `winBy` and score.  
**Out of scope (do NOT build as required):** gacha/draw app (already separate), Google OAuth, live deploy, Durable Objects multiplayer, burst mechanic as win condition, dual-player same device (mark stub/TODO only).

Draw/ownership app exists separately; Phase 1 uses **mock owned cards** (local JSON / flag “unlock all for test”). Optional later hook: Flash Card sheet “擁有卡” or draw-app API — mark `TODO`, do not block Phase 1.

## Tech base (follow, do not rewrite from scratch if possible)
- Unzip and study the reference arena: `beyblade-arena-source.zip` (Three.js, spin / knock / ring-out, charge action button, joystick).
- Preferred stack: **Vite + TypeScript + Three.js** (React optional, not required).
- Target: Chromebook; **low graphics default** (shadows/particles off or toggleable); simplified circle/capsule collision.
- Deliverable: `npm install && npm run dev` works; visible `VERSION` string (e.g. `0.1.0-dev`); short README (how to open mode S, how cards load).

## Three parts (slots) — hard rules
| Slot | Chinese | Role | Main axes |
|------|---------|------|-----------|
| A | 戰鋒 | Attack layer | attack / knock |
| B | 國本 | Defense ring | defense / mass / burstResist |
| C | 運命軸 | Driver / stamina | decay / spinDecay / speed |

Rules:
- Every match must fill **A+B+C**.
- Only matching slot type per slot.
- **No same figure across slots** (season 1).
- **Do not** let all three parts stack the same stat axis (one axis per slot).
- Total **Cost ≤ 8**.
- Soft triangle (≤ ±8%): **攻 ＞ 續 ＞ 防 ＞ 攻**. Main style = majority of main labels; tie → 戰鋒.

### Stat fusion weights (DESIGN §3.1) — implement exactly
```
ATK_final = 0.70*A + 0.20*B + 0.10*C
DEF_final = 0.20*A + 0.65*B + 0.15*C
STA_final = 0.15*A + 0.20*B + 0.65*C   // STA uses spinDecay: lower = lasts longer
SPD_final = 0.25*A + 0.15*B + 0.60*C
MAS_final = 0.10*A + 0.70*B + 0.20*C
BR_final  = 0.15*A + 0.70*B + 0.15*C
```
Keep `BR` field but **burst win = optional / Phase 2** (do not require burst KO in Phase 1).

Card pool: ship `cards_60.json` (60 cards, slots 戰鋒／國本／運命軸, cost, rarity, atk/def/sta_decay/spd/mas/br, lore ≤28 chars). Phase 1 may also offer a “12-card demo subset” for faster testing, but prefer loading full JSON.

## Match flow (Phase 1)
1. **Assemble** (30–60s optional timer can be off): pick A/B/C from owned (mock=all); show radar of fused stats; reject Cost>8 or invalid slots.
2. **Launch UI — implement NOW:**
   - **Case C:** aim angle → hold large charge button → release. **Sweet spot** at full charge ±10–15% power (not a single Perfect frame).
   - **Mode S (required):** same fixed mid `launchPowerUsed` for both sides — skip skill; used for balance tests. Toggle clearly in UI (`?mode=s` or button).
   - **Case Q (quiz power):** **DO NOT hard-require.** Mark as working draft / stub behind feature flag OFF. (Marcus discussed Q+C; not locked for Phase 1 code.)
3. **Battle:** bowl arena + ring-out gap; post-launch micro-control weight **low** (parts physics dominate). Classroom dash: **off or very weak** by default.
4. **Scoring (authoritative, big UI text):**
   - `spinOut` (stopped spinning) = **1** point
   - `ringOut` = **2** points
   - `burst` = optional Phase 2 (if coded, behind flag)
   - Classroom: **first to 2** points wins the match
5. **End screen:** win reason + one lore line per used figure + mandatory disclaimer: **「遊戲勝負≠歷史誰對誰錯」** (always show even if lore skip).

## Chromebook UX constraints
- Primary: Chromebook touch + keyboard; phone nice-to-have.
- Touch targets ≥ **44px**.
- Bottom bar: left joystick | right **large charge** | DASH small and away from charge (dash default off/weak).
- Forbid: hover-only, right-click-only, tiny drag as sole launch.
- History text must **not** cover launch / joystick hotspots. In-battle: names/avatars only, no essay popups.

## CPU opponent (Phase 1)
- Simple CPU: pick a legal Cost≤8 loadout (fixed seed or random from pool) + Mode S or mid charge.
- Same rules / scoring as player.

## Debug / QC hooks (ship in Phase 1)
Debug HUD via **`?qc=1`** (and/or in-UI toggle). Must show:
`spin0`, `spinDecay`, `knockPower`, `knockResist`, `ringOutCount`, `spinOutTime`, `launchPowerUsed`, `winBy` (`ring`|`spin`|`burst`), fused ATK/DEF/STA/SPD/MAS/BR, **Cost + part ids** for both loadouts.
- Fixed RNG seed for replay.
- Mode S + mirror swap ready (same loadouts swapped sides).

## Balance gates (write into README; Phase 1 must make them *testable*)
Under Mode S / mid charge, fixed seed, legal Cost≤8 loadouts:
- Any pair ≥30 matches → win rate target **40–60%**; any lineup **>70% = fail / must nerf** before calling balanced.
- Mirror swap (same comps, sides swapped): win-rate gap **<10%**.
- Full charge vs empty charge skill gap: win-rate delta **≤15–20%** (skill helps, must not dominate loadout).
These are **failure conditions** for balance sign-off, not excuses to ship without HUD/S.

## Measurable vs not (QC)
**Measurable (must have steps + expected):** Mode S on/off; sweet-band charge; scoring ring/spin; Cost≤8 reject; disclaimer; HUD fields; Chromebook hotspots; first-to-2 time budget **≤3 min** per match.
**Not required for Phase 1 MVP:** art polish, online multiplayer, live Flash Card ownership data, Case Q quiz launch.
**Hard fail Phase 1:** no Mode S; no charge sweet band; no debug indicators; history text blocks controls; camp/era faction buffs; treating win as historical verdict.

## Acceptance checklist (must pass before calling Phase 1 done)
- [ ] Three slots filled; Cost≤8; no duplicate figure across slots; wrong-slot parts rejected
- [ ] Mode **S** works (equal launch power); Case **C** charge + aim works with sweet band ±10–15%
- [ ] `ringOut` / `spinOut` scoring + first-to-2; UI shows `winBy` large; match (first to 2) **≤3 min** target
- [ ] Chromebook-usable at ~1366×768; low gfx default; ≥44px hotspots; DASH default off/weak
- [ ] 繁中 UI; end disclaimer **「遊戲勝負≠歷史誰對誰錯」** shown
- [ ] `?qc=1` HUD with launchPowerUsed, winBy, spin/decay, knock, ring/spinOut, Cost+part ids
- [ ] `cards_60.json` loads; mock owned = all unlockable via toggle
- [ ] `VERSION` string; README (how to S / qc / load cards); `npm run dev`
- [ ] No production deploy; no Apps Registry write; no faction/camp buffs

## Explicit non-goals / red lines
- Do **not** formally deploy or change live Marcus Apps Registry (label would be **初中** when later live).
- Do **not** mass-rewrite Cost / lore / balance tables without asking.
- Do **not** merge the separate draw-app / Flash Card API into MVP (separate interface later; must not block Phase 1).
- Do **not** treat game outcome as historical judgment (disclaimer required).
- Do **not** add dynasty/camp faction buffs in season 1.
- Launch for Phase 1 code: **Case C + Mode S**. Case **Q+C** = Phase 2 / pending lock (stub only, default OFF).
- Same-device PvP, burst KO, real ownership API: **TODO / pending Marcus+經理 lock**.

## Suggested build order
1. Scaffold Vite+TS+Three from arena zip patterns (spin, knock, ring-out, charge button).
2. Card loader + assemble UI + Cost/slot validation + fusion weights.
3. Case C launch + Mode S.
4. CPU match loop + scoring first-to-2 + end screen + disclaimer.
5. Debug HUD + seed + README + VERSION.
6. Stop. Package source zip for handoff. No deploy.

## Reference files the user will attach / place beside the project
- `beyblade-arena-source.zip` — physics/UX reference
- `DESIGN.md` — full design v0.2.4.2 (follow §3, §4, §5, §7; Phase 1 launch = C+S not Q)
- `cards_60.json` — card pool

If anything in DESIGN conflicts with this prompt, **this prompt wins for Phase 1**; leave DESIGN conflicts as comments in README.

—— PROMPT END ——

---

## 附件路徑（本機／box）
- Arena：`/workspace/cloud-agent-artifacts/bc-824c6ff5-7a3a-4e49-8da1-0abe0d429d83/beyblade-arena-source.zip`
- 設計：`/workspace/beyblade-wu-shuang/DESIGN.md`
- 卡池：`/workspace/beyblade-wu-shuang/cards_60.json`
- 本 prompt：`/workspace/beyblade-wu-shuang/MAIN_APP_OPUS_PROMPT.md`

## 對齊來源
- 高中遊戲 Coder 2026-10-13 主程式 12 點
- DESIGN.md §3／§4／§7 ＋ QC align＋QC 2026-10-13 短點（甜區、S、HUD、平衡失敗條件、Q→Phase2）
- Marcus 慣例：3D／Three.js → Cursor Opus（VPN）；確認前唔 deploy
