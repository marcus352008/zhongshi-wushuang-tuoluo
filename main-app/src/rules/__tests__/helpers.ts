import { SLOT_NAMES, type Card, type SlotKey } from '../../cards/types';

export function card(slot: SlotKey, id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    name: `人物${id}`,
    slot: SLOT_NAMES[slot],
    cost: 2,
    atk: 1,
    def: 1,
    sta_decay: 1,
    spd: 1,
    mas: 1,
    br: 1,
    rarity: '',
    era_role: '',
    main_label: '',
    sub_mod: '',
    lore_28: '',
    ...over,
  };
}
