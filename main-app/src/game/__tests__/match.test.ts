import { describe, expect, it } from 'vitest';
import { GAP_ANGLES, RIM_RADIUS, ROUND_TIMEOUT_SEC } from '../../config/balance';
import { Rng } from '../../core/rng';
import { card } from '../../rules/__tests__/helpers';
import { Match } from '../match';

const l = () => ({ A: card('A', 'A1'), B: card('B', 'B1'), C: card('C', 'C1') });
const still = [{ x: 0, z: 0 }, { x: 0, z: 0 }] as [{ x: number; z: number }, { x: number; z: number }];

/** A point just past the rim inside exit gap `g`. */
const outside = (g: number, extra = 0.5) => ({
  x: Math.cos(GAP_ANGLES[g]) * (RIM_RADIUS + extra),
  z: Math.sin(GAP_ANGLES[g]) * (RIM_RADIUS + extra),
});

function freshRound(m: Match) {
  m.beginRound([{ aim: Math.PI / 2, power: 0.65 }, { aim: -Math.PI / 2, power: 0.65 }]);
  return m.world!;
}

describe('Match scoring', () => {
  it('ring-out awards 2 points and ends the match (first to 2)', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    w.bodies[1].pos = outside(0);
    const { result } = m.tick(still);
    expect(result).toMatchObject({ reason: 'ringOut', winner: 0, points: [2, 0], winBy: 'ring' });
    expect(m.over).toBe(true);
    expect(m.winner).toBe(0);
    expect(m.winBy).toBe('ring');
    expect(m.sides[1].ringOutCount).toBe(1);
  });

  it('spin-out awards 1 point', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    w.bodies[0].spin = 0.001;
    const { result } = m.tick(still);
    expect(result).toMatchObject({ reason: 'spinOut', winner: 1, points: [0, 1], winBy: 'spin' });
    expect(m.over).toBe(false);
    expect(m.sides[0].spinOutTime).not.toBeNull();
  });

  it('timeout gives 1 point to the higher remaining spin', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    w.bodies[0].pos = { x: -3, z: 0 };
    w.bodies[1].pos = { x: 3, z: 0 };
    let result = null;
    while (!result) {
      w.bodies[0].spin = 900;
      w.bodies[1].spin = 800;
      w.bodies[0].pos = { x: -3, z: 0 };
      w.bodies[1].pos = { x: 3, z: 0 };
      result = m.tick(still).result;
    }
    expect(result.reason).toBe('timeout');
    expect(result.duration).toBeCloseTo(ROUND_TIMEOUT_SEC, 1);
    expect(result).toMatchObject({ winner: 0, points: [1, 0], winBy: 'spin' });
  });

  it('both out on the same frame with equal spin → 1 point each', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    w.bodies[0].pos = outside(1, 1);
    w.bodies[1].pos = outside(2, 1);
    w.bodies[0].spin = w.bodies[1].spin = 500;
    const { result } = m.tick(still);
    expect(result).toMatchObject({ reason: 'double', winner: null, points: [1, 1], winBy: 'none' });
  });

  it('a 2-2 finish after three rounds is a draw', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    for (let i = 0; i < 2; i++) {
      const w = freshRound(m);
      w.bodies[0].pos = outside(1, 1);
      w.bodies[1].pos = outside(2, 1);
      w.bodies[0].spin = w.bodies[1].spin = 500;
      m.tick(still);
    }
    expect(m.scores).toEqual([2, 2]);
    expect(m.over).toBe(true);
    expect(m.winner).toBeNull();
  });

  it('the wall bounces a top back between gaps (no ring-out there)', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    w.bodies[0].pos = { x: -3, z: 0 };
    w.bodies[1].pos = { x: RIM_RADIUS - 0.5, z: 0 };
    w.bodies[1].vel = { x: 6, z: 0 };
    const { step, result } = m.tick(still);
    expect(result).toBeNull();
    expect(w.bodies[1].out).toBeNull();
    expect(w.bodies[1].vel.x).toBeLessThan(0);
    expect(step.walls).toHaveLength(1);
  });

  it('a top moving fast through a gap rings out', () => {
    const m = new Match([l(), l()], 'S', new Rng(1));
    const w = freshRound(m);
    const g = GAP_ANGLES[0];
    w.bodies[0].pos = { x: -3, z: -2 };
    w.bodies[1].pos = { x: Math.cos(g) * (RIM_RADIUS - 0.1), z: Math.sin(g) * (RIM_RADIUS - 0.1) };
    w.bodies[1].vel = { x: Math.cos(g) * 12, z: Math.sin(g) * 12 };
    const { result } = m.tick(still);
    expect(result).toMatchObject({ reason: 'ringOut', winner: 0, points: [2, 0] });
  });
});
