import { describe, expect, it } from 'vitest';
import type { Card, Loadout } from '../../cards/types';
import {
  addCharge,
  cardPowerOf,
  chargeGainForSide,
  healSpin,
  pickStrongest,
  skillTypeOf,
} from '../specials';
import {
  SPECIAL_CHARGE_MAX,
  SPECIAL_CHARGE_PER_HIT,
  SPECIAL_CHARGE_PER_TAKEN,
  SPECIAL_HEAL_FRAC,
} from '../../config/balance';

function card(partial: Partial<Card> & { id: string; name: string }): Card {
  return {
    slot: '戰鋒',
    cost: 2,
    atk: 1,
    def: 1,
    sta_decay: 1,
    spd: 1,
    mas: 1,
    br: 1,
    rarity: 'N',
    era_role: '',
    main_label: '',
    sub_mod: '',
    lore_28: '',
    ...partial,
  };
}

function loadout(a: Card, b: Card, c: Card): Loadout {
  return { A: a, B: b, C: c };
}

describe('specials：最強武將挑選與實戰陣容驗證', () => {
  it('取三張卡中 cardPower 最高者', () => {
    const a = card({ id: 'a', name: '甲', atk: 1.1, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const b = card({ id: 'b', name: '乙', atk: 1.6, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const c = card({ id: 'c', name: '丙', atk: 1.0, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const pick = pickStrongest(loadout(a, b, c));
    expect(pick.slot).toBe('B');
    expect(pick.card.id).toBe('b');
  });

  it('並列時依 A → B → C 優先', () => {
    const a = card({ id: 'a', name: '甲', atk: 1.2, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const b = card({ id: 'b', name: '乙', atk: 1.2, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const c = card({ id: 'c', name: '丙', atk: 1.2, def: 1.0, sta_decay: 1.0, br: 1.0 });
    const pick = pickStrongest(loadout(a, b, c));
    expect(pick.slot).toBe('A');
  });

  it('實戰組合 1：項羽(A) + 秦始皇(B) + 林則徐(C 弱續航) → 項羽（強攻）', () => {
    const xiangYu = card({
      id: 'A01',
      name: '項羽',
      slot: '戰鋒',
      atk: 1.5,
      def: 0.75,
      sta_decay: 1.3,
      mas: 1.0,
      br: 0.85,
    });
    const qinShiHuang = card({
      id: 'B05',
      name: '秦始皇',
      slot: '國本',
      atk: 0.95,
      def: 1.48,
      sta_decay: 1.05,
      mas: 1.55,
      br: 1.3,
    });
    const linZeXu = card({
      id: 'C10',
      name: '林則徐',
      slot: '運命軸',
      atk: 0.85,
      def: 1.1,
      sta_decay: 0.9,
      mas: 1.1,
      br: 1.05,
    });
    const pick = pickStrongest(loadout(xiangYu, qinShiHuang, linZeXu));
    expect(pick.slot).toBe('A');
    expect(pick.card.name).toBe('項羽');
    expect(pick.skill).toBe('attack');
  });

  it('實戰組合 2：霍去病(A) + 秦始皇(B) + 林則徐(C) → 秦始皇（鐵壁）', () => {
    const huoQuBing = card({
      id: 'A02',
      name: '霍去病',
      slot: '戰鋒',
      atk: 1.35,
      def: 0.85,
      sta_decay: 1.15,
      mas: 0.95,
      br: 0.9,
    });
    const qinShiHuang = card({
      id: 'B05',
      name: '秦始皇',
      slot: '國本',
      atk: 0.95,
      def: 1.48,
      sta_decay: 1.05,
      mas: 1.55,
      br: 1.3,
    });
    const linZeXu = card({
      id: 'C10',
      name: '林則徐',
      slot: '運命軸',
      atk: 0.85,
      def: 1.1,
      sta_decay: 0.9,
      mas: 1.1,
      br: 1.05,
    });
    const pick = pickStrongest(loadout(huoQuBing, qinShiHuang, linZeXu));
    expect(pick.slot).toBe('B');
    expect(pick.card.name).toBe('秦始皇');
    expect(pick.skill).toBe('guard');
  });

  it('實戰組合 3：項羽(A) + 秦始皇(B) + 諸葛亮(C 極高續航) → 諸葛亮（回血）', () => {
    const xiangYu = card({
      id: 'A01',
      name: '項羽',
      slot: '戰鋒',
      atk: 1.5,
      def: 0.75,
      sta_decay: 1.3,
      mas: 1.0,
      br: 0.85,
    });
    const qinShiHuang = card({
      id: 'B05',
      name: '秦始皇',
      slot: '國本',
      atk: 0.95,
      def: 1.48,
      sta_decay: 1.05,
      mas: 1.55,
      br: 1.3,
    });
    const zhuGeLiang = card({
      id: 'C01',
      name: '諸葛亮',
      slot: '運命軸',
      atk: 0.8,
      def: 1.05,
      sta_decay: 0.55,
      mas: 1.1,
      br: 1.05,
    });
    const pick = pickStrongest(loadout(xiangYu, qinShiHuang, zhuGeLiang));
    expect(pick.slot).toBe('C');
    expect(pick.card.name).toBe('諸葛亮');
    expect(pick.skill).toBe('heal');
  });
});

describe('specials：特技類型映射', () => {
  it('atkScore 最大 → 強攻', () => {
    const c = card({ id: 'x', name: '攻', atk: 1.8, def: 1.0, mas: 1.0, sta_decay: 1.0, br: 1.0 });
    expect(skillTypeOf(c)).toBe('attack');
  });

  it('defScore 最大 → 鐵壁', () => {
    const c = card({ id: 'x', name: '防', atk: 1.0, def: 1.9, mas: 1.0, sta_decay: 1.0, br: 1.0 });
    expect(skillTypeOf(c)).toBe('guard');
  });

  it('staScore 最大 → 回血', () => {
    const c = card({ id: 'x', name: '續', atk: 1.0, def: 1.0, mas: 1.0, sta_decay: 0.5, br: 1.0 });
    expect(skillTypeOf(c)).toBe('heal');
  });

  it('顯式指定 card.skill 時優先採用顯式特技', () => {
    const c = card({
      id: 'x',
      name: '特例將領',
      atk: 1.0,
      def: 1.0,
      sta_decay: 0.5,
      br: 1.2,
      skill: 'attack',
    });
    expect(skillTypeOf(c)).toBe('attack');
  });

  it('cardPowerOf 三軸分數公式正確', () => {
    const c = card({ id: 'x', name: '測', atk: 1.3, def: 0.8, mas: 1.1, sta_decay: 0.9, br: 1.2 });
    const p = cardPowerOf(c);
    const expectedDef = Math.max(0.8, 0.8 * 0.85 + 1.1 * 0.15);
    const expectedSta = 1.95 - 0.9 + 0.12 * 1.2;
    expect(p.atkScore).toBeCloseTo(1.3);
    expect(p.defScore).toBeCloseTo(expectedDef);
    expect(p.staScore).toBeCloseTo(expectedSta);
    expect(p.cardPower).toBeCloseTo(Math.max(1.3, expectedDef, expectedSta));
  });
});

describe('specials：儲力與回血', () => {
  it('addCharge 夾在 0..MAX', () => {
    expect(addCharge(0, 0.5)).toBeCloseTo(0.5);
    expect(addCharge(0.9, 0.5)).toBeCloseTo(SPECIAL_CHARGE_MAX);
    expect(addCharge(0.1, -1)).toBe(0);
  });

  it('chargeGainForSide 依 received 有無累加', () => {
    expect(chargeGainForSide(1, 1)).toBeCloseTo(SPECIAL_CHARGE_PER_TAKEN + SPECIAL_CHARGE_PER_HIT);
    expect(chargeGainForSide(0, 1)).toBeCloseTo(SPECIAL_CHARGE_PER_HIT);
    expect(chargeGainForSide(1, 0)).toBeCloseTo(SPECIAL_CHARGE_PER_TAKEN);
    expect(chargeGainForSide(0, 0)).toBe(0);
  });

  it('healSpin 回復比例並夾在 spin0', () => {
    expect(healSpin(500, 1000)).toBeCloseTo(500 + 1000 * SPECIAL_HEAL_FRAC);
    expect(healSpin(950, 1000)).toBeCloseTo(1000);
  });
});
