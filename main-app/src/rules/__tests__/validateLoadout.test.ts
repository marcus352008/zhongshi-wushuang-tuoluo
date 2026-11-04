import { describe, expect, it } from 'vitest';
import { MAX_COST } from '../../config/balance';
import { allValidLoadouts, candidateBlockReasons, validateLoadout } from '../validateLoadout';
import { card } from './helpers';

const codes = (r: ReturnType<typeof validateLoadout>) => r.errors.map((e) => e.code).sort();

describe('validateLoadout', () => {
  it('accepts a full, cheap, distinct loadout', () => {
    const r = validateLoadout({ A: card('A', 'A1'), B: card('B', 'B1'), C: card('C', 'C1') });
    expect(r.ok).toBe(true);
    expect(r.totalCost).toBe(6);
  });

  it('requires all three slots', () => {
    const r = validateLoadout({ A: card('A', 'A1') });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['missing', 'missing']);
  });

  it('rejects a card in the wrong slot', () => {
    const r = validateLoadout({ A: card('B', 'B9'), B: card('B', 'B1'), C: card('C', 'C1') });
    expect(codes(r)).toContain('wrongSlot');
  });

  it('rejects duplicate figure by id', () => {
    const r = validateLoadout({ A: card('A', 'X1'), B: card('B', 'X1'), C: card('C', 'C1') });
    expect(codes(r)).toContain('duplicate');
  });

  it('rejects duplicate figure by name', () => {
    const r = validateLoadout({
      A: card('A', 'A1', { name: '劉邦' }),
      B: card('B', 'B1', { name: '劉邦' }),
      C: card('C', 'C1'),
    });
    expect(codes(r)).toEqual(['duplicate']);
  });

  it('allows total cost exactly at the cap and rejects above it', () => {
    expect(MAX_COST).toBe(8);
    const at = validateLoadout({
      A: card('A', 'A1', { cost: 4 }),
      B: card('B', 'B1', { cost: 2 }),
      C: card('C', 'C1', { cost: 2 }),
    });
    expect(at.ok).toBe(true);
    const over = validateLoadout({
      A: card('A', 'A1', { cost: 4 }),
      B: card('B', 'B1', { cost: 3 }),
      C: card('C', 'C1', { cost: 2 }),
    });
    expect(codes(over)).toEqual(['cost']);
  });

  it('explains why a candidate is blocked, ignoring still-empty slots', () => {
    const l = { A: card('A', 'A1', { cost: 4 }), B: card('B', 'B1', { cost: 3 }) };
    expect(candidateBlockReasons(l, 'C', card('C', 'C1', { cost: 1 }))).toEqual([]);
    expect(candidateBlockReasons(l, 'C', card('C', 'C2', { cost: 2 }))).toHaveLength(1);
  });

  it('enumerates only valid loadouts', () => {
    const pool = [
      card('A', 'A1', { cost: 4 }),
      card('A', 'A2', { cost: 1 }),
      card('B', 'B1', { cost: 4 }),
      card('C', 'C1', { cost: 1 }),
    ];
    const all = allValidLoadouts(pool);
    expect(all.map((l) => l.A.id + l.B.id + l.C.id)).toEqual(['A2B1C1']);
  });
});
