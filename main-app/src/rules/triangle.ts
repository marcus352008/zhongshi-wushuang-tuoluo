import { TRIANGLE_ENABLED, TRIANGLE_KNOCK_MULT } from '../config/balance';
import { SLOT_KEYS, type Loadout, type SlotKey } from '../cards/types';

/** Soft triangle 攻 ＞ 續 ＞ 防 ＞ 攻. Behind TRIANGLE_ENABLED (false in Phase 1). */
export type Style = '攻' | '防' | '續';

const SLOT_STYLE: Record<SlotKey, Style> = { A: '攻', B: '防', C: '續' };
const BEATS: Record<Style, Style> = { 攻: '續', 續: '防', 防: '攻' };

export function styleOfSlot(slot: SlotKey): Style {
  return SLOT_STYLE[slot];
}

/** Majority style of the three cards; tie → 攻. */
export function mainStyle(l: Loadout): Style {
  const counts: Record<Style, number> = { 攻: 0, 防: 0, 續: 0 };
  for (const k of SLOT_KEYS) {
    if (l[k]) counts[styleOfSlot(k)]++;
  }
  const max = Math.max(...Object.values(counts));
  const leaders = (Object.keys(counts) as Style[]).filter((s) => counts[s] === max);
  return leaders.length === 1 ? leaders[0] : '攻';
}

export function beats(attacker: Style, defender: Style): boolean {
  return BEATS[attacker] === defender;
}

/** Knock multiplier for `attacker` hitting `defender`. */
export function triangleKnockMult(attacker: Loadout, defender: Loadout, enabled = TRIANGLE_ENABLED): number {
  if (!enabled) return 1;
  return beats(mainStyle(attacker), mainStyle(defender)) ? TRIANGLE_KNOCK_MULT : 1;
}
