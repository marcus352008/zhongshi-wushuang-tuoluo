/**
 * Every tunable gameplay constant lives here. Fused stats are multipliers around 1.0;
 * the BASE_* values turn them into physics quantities (see README "Stat → physics").
 */

export const VERSION = '0.5.13-card-load';

/** Live draw-app base (collection / health / auth bridge). */
export const DRAW_BASE = 'https://wushuang-tuoluo-draw.scchan-942.workers.dev';


// ---- Feature flags ----
export const SUB_MOD_ENABLED = false;
export const TRIANGLE_ENABLED = false;
/** 案Q：發射前五題中史選擇題，答對數決定發射功率。預設開啟。 */
export const QUIZ_LAUNCH_ENABLED = true;
export const DASH_ENABLED = false;
/** 儲力特技（強攻／鐵壁／回血）總開關。 */
export const SPECIALS_ENABLED = true;

// ---- Loadout ----
export const MAX_COST = 8;

// ---- Stat fusion weights [A, B, C] ----
export const FUSION_WEIGHTS = {
  atk: [0.7, 0.2, 0.1],
  def: [0.2, 0.65, 0.15],
  sta_decay: [0.15, 0.2, 0.65],
  spd: [0.25, 0.15, 0.6],
  mas: [0.1, 0.7, 0.2],
  br: [0.15, 0.7, 0.15],
} as const;

// ---- Soft triangle (攻 > 續 > 防 > 攻) ----
export const TRIANGLE_KNOCK_MULT = 1.08;

// ---- Stat → physics ----
export const BASE_SPIN0 = 1000;
export const BASE_DECAY = 15;
export const BASE_KNOCK = 10;
export const BASE_RESIST = 10;
export const BASE_MASS = 1.0;
export const BASE_SPEED = 1.55;
export const IMPULSE_FLOOR = 1.0;
export const COLLISION_SPIN_LOSS = 0.5;
/** Fraction of current spin each top loses on every collision. */
export const COLLISION_SPIN_PCT = 0.03;
/** Launch power scaling: value = base * (LAUNCH_POWER_MIN + LAUNCH_POWER_RANGE * power). */
export const LAUNCH_POWER_MIN = 0.6;
export const LAUNCH_POWER_RANGE = 0.4;

// ---- Simulation ----
export const PHYS_HZ = 60;
export const PHYS_DT = 1 / PHYS_HZ;

// ---- Arena (metres) ----
export const BOWL_RADIUS = 5.0;
export const RIM_RADIUS = 5.6;
export const TOP_RADIUS = 0.55;
/** Radial acceleration toward centre per metre of distance (bowl slope).
 * 0.5.5: 0.55→0.42；0.5.6-center: 0.42→0.70；0.5.9: 0.70→0.78；0.5.12-noS-center: 0.78→1.00. */
export const BOWL_SPRING = 1.00;
/** Linear velocity damping per second. */
export const FRICTION = 0.36;
/** Tangential self-propulsion: accel = DRIFT_ACCEL * moveSpeed * spinFraction.
 * 0.4.5-3d: 0.35→0.62；0.5.5-drift-hit: 0.62→0.90（加大走位／撞到機會；配合 BOWL_SPRING／FRICTION／TOP_RADIUS）。 */
export const DRIFT_ACCEL = 0.90;
/** Visual-only bowl depth: y = BOWL_VISUAL_K * r^2.
 * 0.5.9-gap-spin: 0.045→0.068（中心凹陷更深，擂台更似碗）. */
export const BOWL_VISUAL_K = 0.068;
/** Exit gaps in the wall at RIM_RADIUS, as angles atan2(z, x). Ring-out is only possible through a gap. */
export const GAP_ANGLES = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6];
/** Half-width of each exit gap (radians). 0.5.9: 0.3→0.22（缺口縮細一啲）. */
export const GAP_HALF_WIDTH = 0.22;
/** Gap ring spin rate (rad/s). ~1 rev / 30s — 可玩、唔太快. */
export const GAP_SPIN_RAD_PER_SEC = (Math.PI * 2) / 30;
export const WALL_RESTITUTION = 0.55;
/** Spin lost per m/s of radial speed into the wall. */
export const WALL_SPIN_LOSS = 0.5;
/** Wall hits below this radial speed produce no FX event. */
export const WALL_EVENT_MIN_SPEED = 1.0;
/** Outer lip beyond the wall (visual only). */
export const LIP_WIDTH = 1.2;

// ---- Burst (reserved; never scored in Phase 1) ----
/** Visual-only burst debris on finish. Off: burst is not a Phase 1 win condition. */
export const BURST_FX_ENABLED = false;

// ---- Steering ----
/** Joystick / CPU steering weight relative to moveSpeed. */
export const STEER_WEIGHT = 0.40;
/** Converts (STEER_WEIGHT * moveSpeed) into an acceleration (m/s^2). */
export const STEER_GAIN = 3.0;

// ---- Collision ----
export const RESTITUTION = 0.6;
/** Knock impulse = max(IMPULSE_FLOOR, knock - resist) * relSpeed * IMPULSE_SPEED_SCALE. */
export const IMPULSE_SPEED_SCALE = 1.02;
/** Relative speeds below this are clamped up so resting contact still knocks a little. */
export const REL_SPEED_MIN = 0.4;
export const PAIR_HIT_COOLDOWN = 0.18;
/** Max random rotation (radians) of the contact normal. */
export const COLLISION_JITTER = 0.06;

// ---- Launch ----
export const CHARGE_RAMP_SEC = 1.5;
export const SWEET_BAND_MIN = 0.85;
/** @deprecated S模式已取消（0.5.12）；保留畀 headless／舊測試相容。 */
export const MODE_S_POWER = 0.65;
export const CPU_CASE_C_POWER = 0.65;
/** @deprecated S模式已取消（0.5.12）。 */
export const MODE_S_AUTOFIRE_SEC = 3;
export const LAUNCH_RADIUS = 3.6;
export const LAUNCH_POS_NOISE = 0.25;
export const LAUNCH_SPEED = 2.8;
/** Aim is limited to ± this many radians around the default launch direction. */
export const AIM_ARC = (70 * Math.PI) / 180;
export const AIM_TURN_RATE = 1.6;

// ---- 案Q（答題定力）----
/** 每題限時（秒）。Chromebook 友善：8–12 秒。 */
export const QUIZ_SEC_PER_Q = 10;
/** 每局抽題數。 */
export const QUIZ_QUESTIONS_PER_MATCH = 5;
/** 答對數 → 發射功率。全中 1.20（Marcus 覆蓋 DESIGN 的 100%，用 120%）。 */
export const QUIZ_POWER_BY_CORRECT: readonly number[] = [0.25, 0.40, 0.55, 0.70, 0.95, 1.20];
/** 案Q 允許的發射功率上限（>1 合法）。 */
export const LAUNCH_POWER_MAX = 1.2;

// ---- Dash (DASH_ENABLED = false) ----
export const DASH_COOLDOWN = 5;
export const DASH_SPIN_COST_PCT = 0.05;
export const DASH_IMPULSE = 2.5;

// ---- 儲力特技（0.3.1-specials）----
/** 每次碰撞「打到對方」時，己方儲力增加量（0.5.5: ~5–8%/撞；雙向時 HIT+TAKEN≈0.07）。 */
export const SPECIAL_CHARGE_PER_HIT = 0.055;
/** 每次碰撞「被對方打到」時，己方儲力增加量。 */
export const SPECIAL_CHARGE_PER_TAKEN = 0.015;
/** 儲力上限（滿表＝可發動）。 */
export const SPECIAL_CHARGE_MAX = 1.0;
/** 強攻：增益持續秒數。 */
export const SPECIAL_ATK_DURATION = 3.0;
/** 強攻：knockPower 倍率。 */
export const SPECIAL_ATK_KNOCK_MULT = 1.35;
/** 強攻：發動瞬間朝對手方向的額外衝量。 */
export const SPECIAL_BURST_IMPULSE = 2.2;
/** 鐵壁：增益持續秒數。 */
export const SPECIAL_GUARD_DURATION = 3.0;
/** 鐵壁：knockResist 倍率。 */
export const SPECIAL_GUARD_RESIST_MULT = 1.45;
/** 鐵壁：受擊 knock 減免倍率（received 乘此值）。 */
export const SPECIAL_GUARD_KNOCK_REDUCTION = 0.55;
/** 鐵壁：受擊減免持續秒數。 */
export const SPECIAL_GUARD_REDUCE_DURATION = 2.5;
/** 回血：回復初始轉速的比例。 */
export const SPECIAL_HEAL_FRAC = 0.28;
/** CPU 儲滿後自動發動的延遲秒數。 */
export const SPECIAL_CPU_DELAY_SEC = 0.8;

// ---- Fight MC charge (P0-4 / 0.5.10-quiz5-wy／0.5.11-launch-quiz：連續不停出題 + 每次答對 +5%) ----
/** Seconds before the FIRST fight MC after round launch (0.4.8: 4→1.2 + 短局保底；保留 DRIFT 0.62). */
export const FIGHT_QUIZ_FIRST_SEC = 1.2;
/** Seconds between subsequent fight MC prompts (0 = 答完／逾時關閉後立即出下一題，不設冷卻間隔). */
export const FIGHT_QUIZ_INTERVAL_SEC = 0;
/** Overlay countdown / auto-dismiss seconds. */
export const FIGHT_QUIZ_TIMEOUT_SEC = 9;
/** Charge granted on correct answer (0.05 = +5% 特技儲力). */
export const FIGHT_QUIZ_CHARGE = 0.05;
/** Master switch for fight-phase MC charge. */
export const FIGHT_QUIZ_ENABLED = true;

// ---- Match ----
export const ROUND_TIMEOUT_SEC = 60;
export const POINTS_TO_WIN = 2;
export const MAX_ROUNDS = 3;
export const POINTS_RING_OUT = 2;
export const POINTS_SPIN_OUT = 1;
export const POINTS_TIMEOUT = 1;

// ---- Assemble ----
export const ASSEMBLE_TIMER_SEC = 60;

// ---- Graphics ----
export const LOW_GFX_MAX_PIXEL_RATIO = 1.5;
export const HIGH_GFX_MAX_PIXEL_RATIO = 2;
export const SHADOW_MAP_SIZE = 2048;

