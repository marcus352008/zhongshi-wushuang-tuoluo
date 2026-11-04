import { describe, expect, it } from 'vitest';
import type { Card, SlotKey } from '../../cards/types';
import { fuse } from '../fuse';
import { card } from './helpers';

const base = () => ({ A: card('A', 'A1'), B: card('B', 'B1'), C: card('C', 'C1') });

/** Put 2.0 in one stat of one slot; fused = 1 + weight. */
function bump(slot: SlotKey, stat: keyof Card) {
  const l = base();
  l[slot] = { ...l[slot], [stat]: 2.0 };
  return fuse(l);
}

describe('fuse', () => {
  it('three identical 1.0 cards fuse to exactly 1.0', () => {
    const f = fuse(base());
    for (const v of Object.values(f)) expect(v).toBeCloseTo(1.0, 10);
  });

  it('A.atk = 2.0, rest 1.0 → ATK = 1.7', () => {
    expect(bump('A', 'atk').ATK).toBeCloseTo(1.7, 10);
  });

  const cases: [keyof ReturnType<typeof fuse>, keyof Card, [number, number, number]][] = [
    ['ATK', 'atk', [0.7, 0.2, 0.1]],
    ['DEF', 'def', [0.2, 0.65, 0.15]],
    ['STA_DECAY', 'sta_decay', [0.15, 0.2, 0.65]],
    ['SPD', 'spd', [0.25, 0.15, 0.6]],
    ['MAS', 'mas', [0.1, 0.7, 0.2]],
    ['BR', 'br', [0.15, 0.7, 0.15]],
  ];

  for (const [out, stat, [wa, wb, wc]] of cases) {
    it(`${out} weights are A ${wa} / B ${wb} / C ${wc}`, () => {
      expect(bump('A', stat)[out]).toBeCloseTo(1 + wa, 10);
      expect(bump('B', stat)[out]).toBeCloseTo(1 + wb, 10);
      expect(bump('C', stat)[out]).toBeCloseTo(1 + wc, 10);
    });
  }

  it('matches a hand-computed real-looking loadout', () => {
    const f = fuse({
      A: card('A', 'A01', { atk: 1.5, def: 0.75, sta_decay: 1.3, spd: 1.15, mas: 1.0, br: 0.85 }),
      B: card('B', 'B01', { atk: 1.05, def: 1.4, sta_decay: 1.05, spd: 0.85, mas: 1.4, br: 1.3 }),
      C: card('C', 'C01', { atk: 0.95, def: 0.95, sta_decay: 0.75, spd: 1.25, mas: 0.95, br: 1.0 }),
    });
    expect(f.ATK).toBeCloseTo(0.7 * 1.5 + 0.2 * 1.05 + 0.1 * 0.95, 10);
    expect(f.STA_DECAY).toBeCloseTo(0.15 * 1.3 + 0.2 * 1.05 + 0.65 * 0.75, 10);
  });
});
