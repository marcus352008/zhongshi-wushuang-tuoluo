/**
 * 卡池載入＋加權抽卡（稀有權重 × 未擁有權重）
 * Marcus／經理 2026-10-14 拍板：普通4／優秀2／史詩0.7／傳說0.22；未擁有×3；唔加軟 pity
 */

export type Card = {
  id: string;
  name: string;
  era_role: string;
  slot: string;
  cost: string | number;
  rarity?: string;
  atk: string | number;
  def: string | number;
  sta_decay: string | number;
  spd: string | number;
  mas: string | number;
  br: string | number;
  main_label: string;
  sub_mod: string;
  lore_28: string;
};

/** 稀有基礎權重（Marcus／經理 2026-10-14 拍板） */
export const RARITY_WEIGHT: Record<string, number> = {
  普通: 4,
  優秀: 2,
  史詩: 0.7,
  傳說: 0.22,
};

export const UNOWNED_MULT = 3;
export const OWNED_MULT = 1;

export function loadCards(json: unknown): Card[] {
  if (!Array.isArray(json)) throw new Error("cards json must be an array");
  const cards = json as Card[];
  if (cards.length < 30) {
    console.warn(`[cards] expected >=30 cards, got ${cards.length}`);
  }
  return cards;
}

function rarityWeight(c: Card): number {
  const r = (c.rarity || "優秀").trim();
  return RARITY_WEIGHT[r] ?? 2;
}

/**
 * 加權：rarityWeight × (未擁有 ? 3 : 1)
 */
export function pickWeightedCard(
  pool: Card[],
  ownedIds: Set<string>,
  rng: () => number = Math.random
): Card {
  if (pool.length === 0) throw new Error("empty card pool");
  const weights = pool.map(
    (c) => rarityWeight(c) * (ownedIds.has(c.id) ? OWNED_MULT : UNOWNED_MULT)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function cardPublicView(c: Card) {
  return {
    id: c.id,
    name: c.name,
    era_role: c.era_role,
    slot: c.slot,
    cost: Number(c.cost),
    rarity: c.rarity || "",
    atk: Number(c.atk),
    def: Number(c.def),
    sta_decay: Number(c.sta_decay),
    spd: Number(c.spd),
    mas: Number(c.mas),
    br: Number(c.br),
    main_label: c.main_label,
    sub_mod: c.sub_mod,
    lore_28: c.lore_28,
  };
}
