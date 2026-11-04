# PROGRESS — 中史無雙陀螺 Phase 1

## Reference-file status (applies to all steps)
- `ref/DESIGN.md` and `cards_60.json` were **not present** in the workspace. Built against the prompt spec only.
- `ref/arena-src/` was created from this repo's previous commit (the earlier Three.js beyblade arena) and is never edited.
- Card loading tries `public/cards_60.json` first and falls back to `public/cards_sample.json` (a small, clearly-labelled dev deck), showing a red warning banner. Dropping the real file into `public/` needs no code change.

## Step 1 — Scaffold ✅
- Vite 5 + TypeScript 5 + Three 0.160 + Vitest 1 project in the repo root (`npm run dev|build|preview|test`).
- Ported from `ref/arena-src`: integration loop (bowl pull, orbit drift, steering, friction), circle collision (separation + elastic + knock), and keyboard/joystick/hold-button input → `src/physics/world.ts`, `src/input/input.ts`.
- Spec changes vs ref: fixed 60 Hz, linear bowl spring, no walls (ring-out at rim 5.6), knock = max(floor, knock − resist) × relative speed, no burst.
- `src/config/balance.ts` holds every constant and the four feature flags (all `false`).
- `src/render/arenaView.ts`: bowl + rim + two tops (3 stacked cylinders, one colour per slot), low-gfx default.
- Stubbed: nothing yet. DESIGN conflicts: cannot check (file missing).

## Step 2 — Cards + rules + Assemble ✅
- `src/cards/loader.ts`: string→number coercion (empty string / missing counts as NaN → card skipped with id + field logged), invalid slot rejected, optional text defaults to "", unknown fields dropped, console load report (total, per-slot, skipped + reasons, distinct `sub_mod` list).
- `src/rules/validateLoadout.ts` (3 slots, slot match, no duplicate id/name, cost ≤ 8), `src/rules/fuse.ts` (exact §4 weights), `src/rules/triangle.ts` (flag OFF).
- Vitest: 28 tests (loader, validateLoadout, fuse weights per slot/stat, triangle) — passing.
- Assemble screen: 3 slot pickers, filtered pool, blocked cards greyed with reason toast on tap, cost X / 8, SVG radar (0.5–1.6, dashed 1.0 ring), era_role tag per selected card, main_label + rarity badges, sub_mod in grey as 「特效（未啟用）…」, 「開始」 disabled until valid, toggles 「S模式（等功率）」「全部解鎖（測試）」(default ON)「60秒計時」(default OFF; on expiry auto-fills a valid loadout and starts).
- `src/cards/ownership.ts`: `getOwnedCardIds(): Promise<string[]>` TODO hook, mock = first 4 cards per slot.
- Note: because style is inferred from slot and a loadout always has one card per slot, the triangle's "majority" is always a 1-1-1 tie → 攻. The code path follows the spec exactly; logged as a design question.

## Step 3 — Launch ✅
- Case C (default): aim with ◄ ► buttons, A/D or arrows, joystick X, or drag on the canvas (clamped to ±70° arc shown as a dashed arc + arrow). Hold 「蓄力」 / Space: `chargeRaw` ramps 0→1 over 1.5 s and holds at 1.0; release in [0.85, 1.0] → `launchPowerUsed = 1.0`, otherwise raw. Sweet band drawn on the charge bar (green), bar turns green inside it.
- Mode S: `?mode=s` or 「S模式（等功率）」 toggle (top-right, on Assemble and Launch). Both sides 0.65; tap 「發射」 or auto-fire after 3 s. Toggle applies to the next launch (not mid-round). HUD shows the current mode.
- CPU: random valid loadout from the full pool via seeded RNG (`pickCpuLoadout`), `?cpu=A01,B07,C03` override (invalid override → console warning + random). CPU power 0.65 in both modes; aim random within the same arc.
- `src/launch/quizLaunch.ts`: `// STUB(Phase1)` — throws "Phase 2".
- Tests: charge ramp/hold, sweet band edges, quiz stub.

## Step 4 — Match loop ✅
- `src/game/match.ts` (pure, shared with headless runner): up to 3 rounds, first to 2. ringOut = 2, spinOut = 1, 60 s timeout → higher spin 1 pt (「時間到：轉速較高」, winBy `spin`); both out same frame → higher remaining spin 1 pt, exact tie → 1 pt each. 2–2 = draw. `burst` exists in the WinBy type but is never awarded.
- Round banner: result title 56 px, score 64 px. Battle HUD: side label + three avatar circles (first character, slot colour) + names, score, mode tag.
- End screen: winner, score (72 px), winBy (48 px), per-round list, six lore entries 「name（era_role）」 + lore_28 (skippable), fixed footer 「遊戲勝負≠歷史誰對誰錯」 always visible, buttons 「再戰一次（同陣容）」「重新組裝」「互換陣容再戰」.
- Esc → pause menu (繼續 / 重新組裝).
- Tuning (sample deck, 300 random Mode S matches): rounds ≈ 45 s avg, ~34% ring-out / ~64% spin-out / 0 timeouts, match avg ≈ 70 s, max ≈ 105 s. Constants changed from prompt defaults: BASE_DECAY 12 → 15 (allowed by "tune freely"). Must be re-tuned against the real cards_60.json.
- Tests: ring-out 2 pts + match end, spin-out 1 pt, timeout, same-frame tie, 2–2 draw (36 tests total).
- Manually verified in headless Chrome at 1366×768: Assemble (cost blocking + reason toast), Case C launch with perfect release, battle HUD, round banner, full 2–0 match to End screen with lore and the disclaimer footer. Fixes from that pass: HUD no-wrap, wider status line, smaller attack layer so all three stacked parts are visible from above.
- **Paused here per work order (Steps 5–7 pending "continue").**

## Visual port from ref/arena-src — v0.2.0-dev ✅
Requested by Marcus: bring the old English arena's look/feel into the live 中史無雙陀螺 app; all game systems kept (Assemble, cards, Case C, Mode S, match loop, lore End screen, disclaimer).

**Ported**
- Stadium (`src/render/stadium.ts`, from `ref/arena-src/src/stadium.ts`): canvas floor texture (radial gradient, rings, spokes, red centre), metal wall segments with cyan top strips, red exit-gap pockets on the outer lip, base + table. Radii adapted to Phase 1 (bowl 5.0, wall/rim 5.6).
- Beyblade mesh (`src/render/topModel.ts`, from `beyblade.ts`): metal tip + dark driver (運命軸), metal disk (國本), ExtrudeGeometry blade layer (戰鋒) with Attack/Defense/Stamina shapes, emissive side-colour chip, white stripe, additive glow ring scaling with spin, wobble/precession, bowl-normal tilt, topple on spin-out, fly-out + fall on ring-out. Shape/colour picked from fused stats (`kindFromFused`: the axis furthest above 1.0).
- FX (`src/render/effects.ts`, unchanged copy): sparks on clash, wall hit and launch; camera shake on clash/wall/ring-out/launch. Burst debris code ported but gated by `BURST_FX_ENABLED = false`.
- Audio (`src/audio/sfx.ts`, from `audio.ts`): clash, wall, launch, ring-out, win/lose jingles, spin hum. 「靜音」 toggle top-right.
- Graphics: high quality is the default (antialias, PCF soft shadows 2048, ACES tone mapping, fog, cyan rim point light, pixelRatio ≤ 2, sparks on). 「低畫質」 toggle = previous Chromebook path (no AA / shadows / sparks, pixelRatio ≤ 1.5).
- Physics: wall bounce between three exit gaps (`GAP_ANGLES` 90°/210°/330°, mirror-symmetric for the two launch sides), wall spin loss, wall FX events. Ring-out is still "centre crosses rim 5.6", now only possible through a gap.

**Not ported / changed on purpose**
- Burst KO as a scoring outcome: Phase 1 rules say burst is never awarded, so debris stays behind `BURST_FX_ENABLED = false`.
- Old arena's 120 Hz step, dash and AI: the Phase 1 60 Hz physics, DASH_ENABLED = false and spec CPU are kept.
- Old player marker cone: side-coloured glow rings + chips identify you (yellow) vs CPU (pink).

**Balance (real cards_60.json, 300 random Mode S matches + 200 mirror pairs)**
- Walls cut ring-outs to ~4%, so `IMPULSE_SPEED_SCALE` 0.95 → 1.02: rounds avg 49.5 s, ~24% ring-out / ~75% spin-out / 0 timeouts, match avg 85 s, max 110 s; mirror-swap gap 1.5%.
- The ring-out rate is very sensitive to this constant (1.08 → ~52% ring-out, 1.15 → ~84%).

**Other**
- `public/cards_60.json` added from Marcus's upload (byte-identical). Loads 60/60, 20 per slot, 58 distinct `sub_mod` strings, nothing skipped. Sample deck kept as fallback.
- Tests: match tests now ring out through a gap; added wall-bounce and gap ring-out tests (38 total, passing).
- VERSION 0.2.0-dev (package.json, `balance.ts`, UI corner).

## 0.5.3-pvp-leaderboard (2026-11-01 15:57 HKT)
- Live: https://wushuang.scchan-942.workers.dev
- Version ID: 2817cd81-3eb4-4a6e-8b48-392a04dcf242
- Top20 leaderboard API + lobby/end UI; GAS @25

## 0.5.6-center (2026-11-03)
- BOWL_SPRING 0.42→0.70（多向場心）
- Version ID: 03648357-019f-4dcf-99d0-e72fb9be7184

## 0.5.12-noS-center (2026-11-03 16:13 HKT)
- Live: https://wushuang.scchan-942.workers.dev
- Version ID: 9b6e08a3-0800-461e-ab1f-00079d472c8a
- 取消 S 模式；BOWL_SPRING 0.78→1.00；BASE_SPEED 1.4→1.55
