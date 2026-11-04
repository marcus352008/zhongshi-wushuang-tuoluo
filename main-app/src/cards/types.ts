export const SLOT_NAMES = { A: '戰鋒', B: '國本', C: '運命軸' } as const;
export type SlotKey = keyof typeof SLOT_NAMES;
export type SlotName = (typeof SLOT_NAMES)[SlotKey];
export const SLOT_KEYS: SlotKey[] = ['A', 'B', 'C'];

export type CardSkillType = 'attack' | 'guard' | 'heal';

export interface Card {
  id: string;
  name: string;
  slot: SlotName;
  cost: number;
  atk: number;
  def: number;
  sta_decay: number;
  spd: number;
  mas: number;
  br: number;
  rarity: string;
  era_role: string;
  main_label: string;
  sub_mod: string;
  lore_28: string;
  /** 可選顯式特技欄位（若卡池 JSON 有指定則優先使用）。 */
  skill?: CardSkillType;
  /** 可選顯式特技別名欄位（向後相容）。 */
  special?: CardSkillType;
}

export interface Loadout {
  A: Card;
  B: Card;
  C: Card;
}

export type PartialLoadout = Partial<Record<SlotKey, Card>>;

export function slotKeyOf(slot: SlotName): SlotKey {
  return (Object.keys(SLOT_NAMES) as SlotKey[]).find((k) => SLOT_NAMES[k] === slot)!;
}
