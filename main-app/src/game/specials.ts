/**
 * 儲力特技（0.4.6-specials）：由三張組裝卡中最強武將決定本局特技類型。
 *
 * 三軸分數（每張卡各自計算，已校準跨槽平衡）：
 *   atkScore = card.atk
 *   defScore = Math.max(card.def, card.def * 0.85 + card.mas * 0.15)
 *   staScore = (1.95 - card.sta_decay) + 0.12 * card.br
 * cardPower = max(atkScore, defScore, staScore)
 *
 * 三張卡中 cardPower 最高者為「最強武將」；並列時依 A → B → C 優先。
 * 若卡片有顯式 skill / special 欄位則優先採用；否則由主導軸決定特技：
 *   atkScore 最大 → 強攻 (attack)
 *   defScore 最大 → 鐵壁 (guard)
 *   staScore 最大 → 回血 (heal)
 */
import type { Card, Loadout, SlotKey } from '../cards/types';
import { SLOT_KEYS } from '../cards/types';
import {
  SPECIAL_ATK_DURATION,
  SPECIAL_ATK_KNOCK_MULT,
  SPECIAL_BURST_IMPULSE,
  SPECIAL_CHARGE_MAX,
  SPECIAL_CHARGE_PER_HIT,
  SPECIAL_CHARGE_PER_TAKEN,
  SPECIAL_GUARD_DURATION,
  SPECIAL_GUARD_KNOCK_REDUCTION,
  SPECIAL_GUARD_REDUCE_DURATION,
  SPECIAL_GUARD_RESIST_MULT,
  SPECIAL_HEAL_FRAC,
} from '../config/balance';
import type { Body } from '../physics/world';

export type SkillType = 'attack' | 'guard' | 'heal';

export interface CardPower {
  slot: SlotKey;
  card: Card;
  atkScore: number;
  defScore: number;
  staScore: number;
  cardPower: number;
}

export interface StrongestPick {
  slot: SlotKey;
  card: Card;
  skill: SkillType;
  power: CardPower;
  /** 三張卡的完整分數，方便 UI／測試。 */
  all: CardPower[];
}

/** 檢查卡片是否帶有合法的顯式特技欄位（skill 或 special）。 */
export function explicitSkillOf(card: Card): SkillType | null {
  const raw = card.skill ?? card.special;
  if (raw === 'attack' || raw === 'guard' || raw === 'heal') {
    return raw;
  }
  return null;
}

/** 單張卡三軸分數（0.4.6 重平衡：壓抑 C 軸基礎通膨，平衡戰鋒／國本／運命軸代表性）。 */
export function cardPowerOf(card: Card): Omit<CardPower, 'slot' | 'card'> {
  const atkScore = card.atk;
  const defScore = Math.max(card.def, card.def * 0.85 + card.mas * 0.15);
  const staScore = 1.95 - card.sta_decay + 0.12 * card.br;
  const cardPower = Math.max(atkScore, defScore, staScore);
  return { atkScore, defScore, staScore, cardPower };
}

/** 顯式欄位優先；否則依主導軸 → 特技類型。 */
export function skillTypeOf(card: Card): SkillType {
  const explicit = explicitSkillOf(card);
  if (explicit) return explicit;
  const { atkScore, defScore, staScore } = cardPowerOf(card);
  if (atkScore >= defScore && atkScore >= staScore) return 'attack';
  if (defScore >= staScore) return 'guard';
  return 'heal';
}

/** 從三張卡挑最強武將；並列時 A → B → C。 */
export function pickStrongest(loadout: Loadout): StrongestPick {
  const all: CardPower[] = SLOT_KEYS.map((slot) => {
    const card = loadout[slot];
    return { slot, card, ...cardPowerOf(card) };
  });
  let best = all[0];
  for (const p of all) {
    if (p.cardPower > best.cardPower) best = p;
  }
  return { slot: best.slot, card: best.card, skill: skillTypeOf(best.card), power: best, all };
}

/** 儲力累加（夾在 0..SPECIAL_CHARGE_MAX）。 */
export function addCharge(current: number, delta: number): number {
  return Math.max(0, Math.min(SPECIAL_CHARGE_MAX, current + delta));
}

/** 一次 pair clash 後，某一方的儲力增量。 */
export function chargeGainForSide(receivedSelf: number, receivedOther: number): number {
  const scale = (v: number) => (v > 0 ? 1 : 0);
  return SPECIAL_CHARGE_PER_TAKEN * scale(receivedSelf) + SPECIAL_CHARGE_PER_HIT * scale(receivedOther);
}

/** 回血：spin = min(spin0, spin + spin0 * SPECIAL_HEAL_FRAC)。 */
export function healSpin(spin: number, spin0: number): number {
  return Math.min(spin0, spin + spin0 * SPECIAL_HEAL_FRAC);
}

/** 特技增益狀態（掛在 Body 上，由 World.step 讀取）。 */
export interface SpecialBuff {
  /** knockPower 倍率（強攻）。 */
  atkMult: number;
  /** knockResist 倍率（鐵壁）。 */
  resistMult: number;
  /** 受擊 knock 減免倍率（鐵壁）。 */
  receivedMult: number;
  /** 增益到期時間（World.time 秒）。 */
  buffUntil: number;
  /** 受擊減免到期時間。 */
  guardUntil: number;
}

export function emptyBuff(): SpecialBuff {
  return { atkMult: 1, resistMult: 1, receivedMult: 1, buffUntil: 0, guardUntil: 0 };
}

/** 發動特技：直接改 Body（buff／spin／impulse）。回傳是否成功發動。 */
export function applySpecial(
  body: Body,
  opponent: Body,
  skill: SkillType,
  now: number,
): boolean {
  if (body.out) return false;
  if (!body.buff) body.buff = emptyBuff();
  const buff = body.buff;
  switch (skill) {
    case 'attack': {
      buff.atkMult = SPECIAL_ATK_KNOCK_MULT;
      buff.buffUntil = Math.max(buff.buffUntil, now + SPECIAL_ATK_DURATION);
      const dx = opponent.pos.x - body.pos.x;
      const dz = opponent.pos.z - body.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        body.vel.x += (dx / d) * SPECIAL_BURST_IMPULSE;
        body.vel.z += (dz / d) * SPECIAL_BURST_IMPULSE;
      }
      return true;
    }
    case 'guard': {
      buff.resistMult = SPECIAL_GUARD_RESIST_MULT;
      buff.receivedMult = SPECIAL_GUARD_KNOCK_REDUCTION;
      buff.buffUntil = Math.max(buff.buffUntil, now + SPECIAL_GUARD_DURATION);
      buff.guardUntil = Math.max(buff.guardUntil, now + SPECIAL_GUARD_REDUCE_DURATION);
      return true;
    }
    case 'heal': {
      body.spin = healSpin(body.spin, body.params.spin0);
      return true;
    }
  }
}

/** 每步更新 buff 到期（World.step 呼叫）。 */
export function tickBuff(body: Body, now: number): void {
  const buff = body.buff;
  if (!buff) return;
  if (now >= buff.buffUntil) {
    buff.atkMult = 1;
    buff.resistMult = 1;
  }
  if (now >= buff.guardUntil) {
    buff.receivedMult = 1;
  }
}

/** 目前生效的 knockPower 倍率。 */
export function activeAtkMult(body: Body): number {
  return body.buff ? body.buff.atkMult : 1;
}

/** 目前生效的 knockResist 倍率。 */
export function activeResistMult(body: Body): number {
  return body.buff ? body.buff.resistMult : 1;
}

/** 目前生效的受擊 knock 減免倍率。 */
export function activeReceivedMult(body: Body): number {
  return body.buff ? body.buff.receivedMult : 1;
}
