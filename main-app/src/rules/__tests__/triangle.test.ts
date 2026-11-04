import { describe, expect, it } from 'vitest';
import { TRIANGLE_ENABLED, TRIANGLE_KNOCK_MULT } from '../../config/balance';
import { beats, mainStyle, styleOfSlot, triangleKnockMult } from '../triangle';
import { card } from './helpers';

const l = { A: card('A', 'A1'), B: card('B', 'B1'), C: card('C', 'C1') };

describe('soft triangle', () => {
  it('is disabled by default', () => {
    expect(TRIANGLE_ENABLED).toBe(false);
    expect(triangleKnockMult(l, l)).toBe(1);
  });

  it('infers style from slot', () => {
    expect([styleOfSlot('A'), styleOfSlot('B'), styleOfSlot('C')]).toEqual(['攻', '防', '續']);
  });

  it('攻 > 續 > 防 > 攻', () => {
    expect(beats('攻', '續')).toBe(true);
    expect(beats('續', '防')).toBe(true);
    expect(beats('防', '攻')).toBe(true);
    expect(beats('續', '攻')).toBe(false);
    expect(beats('攻', '攻')).toBe(false);
  });

  it('a full loadout is a 1-1-1 tie, so main style is 攻', () => {
    expect(mainStyle(l)).toBe('攻');
    expect(triangleKnockMult(l, l, true)).toBe(1);
  });

  it('applies the knock multiplier only when the flag is passed on and the style wins', () => {
    expect(TRIANGLE_KNOCK_MULT).toBe(1.08);
  });
});
