import { describe, expect, it } from 'vitest';
import { parseCards } from '../loader';

const good = {
  id: 'A01',
  name: '項羽',
  era_role: '秦末／西楚霸王',
  slot: '戰鋒',
  cost: '4',
  rarity: '傳說',
  atk: '1.50',
  def: '0.75',
  sta_decay: '1.30',
  spd: '1.15',
  mas: '1.00',
  br: '0.85',
  main_label: '極高攻、低續航',
  sub_mod: '第一擊 knock +0.10',
  lore_28: '巨鹿之戰大破秦軍，破釜沉舟。',
};

describe('parseCards', () => {
  it('coerces string numerics to numbers and keeps text verbatim', () => {
    const { cards } = parseCards([good]);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.cost).toBe(4);
    expect(c.atk).toBe(1.5);
    expect(c.sta_decay).toBe(1.3);
    expect(c.lore_28).toBe(good.lore_28);
    expect(c.sub_mod).toBe(good.sub_mod);
  });

  it('skips cards with NaN numerics (including empty strings) without throwing', () => {
    const { cards, report } = parseCards([
      { ...good, id: 'X1', atk: 'abc' },
      { ...good, id: 'X2', def: '' },
      { ...good, id: 'X3', br: undefined },
      good,
    ]);
    expect(cards.map((c) => c.id)).toEqual(['A01']);
    expect(report.skipped.map((s) => s.id)).toEqual(['X1', 'X2', 'X3']);
    expect(report.skipped[0].reason).toContain('atk');
  });

  it('rejects unknown slots', () => {
    const { cards, report } = parseCards([{ ...good, id: 'Z1', slot: '輔助' }]);
    expect(cards).toHaveLength(0);
    expect(report.skipped[0].reason).toContain('slot');
  });

  it('defaults missing optional fields to "" and ignores unknown fields', () => {
    const { rarity: _r, era_role: _e, main_label: _m, sub_mod: _s, lore_28: _l, ...bare } = good;
    const { cards } = parseCards([{ ...bare, extra_field: 123 }]);
    expect(cards[0]).toMatchObject({ rarity: '', era_role: '', main_label: '', sub_mod: '', lore_28: '' });
    expect('extra_field' in cards[0]).toBe(false);
  });

  it('reports totals, per-slot counts and distinct sub_mods', () => {
    const { report } = parseCards([
      good,
      { ...good, id: 'A02', name: '韓信' },
      { ...good, id: 'B01', name: '秦始皇', slot: '國本', sub_mod: '' },
      { ...good, id: 'C01', name: '張騫', slot: '運命軸', sub_mod: '回合末轉速 +2%' },
      'garbage',
    ]);
    expect(report.total).toBe(5);
    expect(report.loaded).toBe(4);
    expect(report.perSlot).toEqual({ A: 2, B: 1, C: 1 });
    expect(report.distinctSubMods).toEqual(['第一擊 knock +0.10', '回合末轉速 +2%']);
  });

  it('tolerates non-array input', () => {
    expect(parseCards({}).cards).toEqual([]);
  });
});
