/**
 * 卡池加權抽卡
 * VERSION: draw-app-gas 0.4.0
 */

function getCards_() {
  if (typeof CARDS_DATA === 'undefined' || !CARDS_DATA || !CARDS_DATA.length) {
    throw new Error('CARDS_DATA missing — 請一併貼上 CardsData.gs');
  }
  return CARDS_DATA;
}

function cardPublicView_(c) {
  return {
    id: c.id,
    name: c.name,
    era_role: c.era_role,
    slot: c.slot,
    cost: Number(c.cost),
    rarity: c.rarity || '',
    atk: Number(c.atk),
    def: Number(c.def),
    sta_decay: Number(c.sta_decay),
    spd: Number(c.spd),
    mas: Number(c.mas),
    br: Number(c.br),
    main_label: c.main_label,
    sub_mod: c.sub_mod,
    lore_28: c.lore_28
  };
}

function rarityWeight_(c) {
  var r = (c.rarity || '優秀').toString().trim();
  return RARITY_WEIGHT[r] != null ? RARITY_WEIGHT[r] : 2;
}

/** 加權：稀有 ×（未擁有 ? 3 : 1） */
function pickWeightedCard_(ownedIds) {
  var pool = getCards_();
  var weights = [];
  var total = 0;
  var i;
  for (i = 0; i < pool.length; i++) {
    var w = rarityWeight_(pool[i]) * (ownedIds[pool[i].id] ? 1 : UNOWNED_MULT);
    weights.push(w);
    total += w;
  }
  var r = Math.random() * total;
  for (i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function findCard_(id) {
  var pool = getCards_();
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].id === id) return pool[i];
  }
  return null;
}
