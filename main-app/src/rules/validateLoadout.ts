import { MAX_COST } from '../config/balance';
import { SLOT_KEYS, SLOT_NAMES, type Card, type Loadout, type PartialLoadout, type SlotKey } from '../cards/types';

export type LoadoutErrorCode = 'missing' | 'wrongSlot' | 'duplicate' | 'cost';

export interface LoadoutError {
  code: LoadoutErrorCode;
  slot?: SlotKey;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: LoadoutError[];
  totalCost: number;
}

export function totalCost(l: PartialLoadout): number {
  return SLOT_KEYS.reduce((sum, k) => sum + (l[k]?.cost ?? 0), 0);
}

/** Pure loadout check (spec §4). Accepts partial loadouts so the UI can show live errors. */
export function validateLoadout(l: PartialLoadout): ValidationResult {
  const errors: LoadoutError[] = [];

  for (const k of SLOT_KEYS) {
    const card = l[k];
    if (!card) {
      errors.push({ code: 'missing', slot: k, message: `未選擇「${SLOT_NAMES[k]}」` });
    } else if (card.slot !== SLOT_NAMES[k]) {
      errors.push({
        code: 'wrongSlot',
        slot: k,
        message: `${card.name} 屬於「${card.slot}」，不能放在「${SLOT_NAMES[k]}」`,
      });
    }
  }

  const filled = SLOT_KEYS.filter((k) => l[k]).map((k) => [k, l[k]!] as const);
  for (let i = 0; i < filled.length; i++) {
    for (let j = i + 1; j < filled.length; j++) {
      const [, a] = filled[i];
      const [kb, b] = filled[j];
      if (a.id === b.id || a.name === b.name) {
        errors.push({ code: 'duplicate', slot: kb, message: `同一人物（${b.name}）不能重複使用` });
      }
    }
  }

  const cost = totalCost(l);
  if (cost > MAX_COST) {
    errors.push({ code: 'cost', message: `總費用 ${cost} 超過上限 ${MAX_COST}` });
  }

  return { ok: errors.length === 0, errors, totalCost: cost };
}

export function isCompleteLoadout(l: PartialLoadout): l is Loadout {
  return validateLoadout(l).ok;
}

/** Reasons why putting `card` into `slot` (keeping the other slots) would break a rule. */
export function candidateBlockReasons(l: PartialLoadout, slot: SlotKey, card: Card): string[] {
  const next: PartialLoadout = { ...l, [slot]: card };
  return validateLoadout(next)
    .errors.filter((e) => e.code !== 'missing')
    .map((e) => e.message);
}

/** Every valid loadout from a pool (pool sizes are small: ≤ 20³ combinations). */
export function allValidLoadouts(pool: readonly Card[]): Loadout[] {
  const by = (k: SlotKey) => pool.filter((c) => c.slot === SLOT_NAMES[k]);
  const out: Loadout[] = [];
  for (const A of by('A')) for (const B of by('B')) for (const C of by('C')) {
    if (validateLoadout({ A, B, C }).ok) out.push({ A, B, C });
  }
  return out;
}
