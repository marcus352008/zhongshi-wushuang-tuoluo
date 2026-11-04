import type { Card, Loadout } from '../cards/types';
import type { Rng } from '../core/rng';
import { normalize, type Vec2 } from '../core/vec';
import type { Body } from '../physics/world';
import { allValidLoadouts, validateLoadout } from '../rules/validateLoadout';

/** Loadout from explicit ids (e.g. ?cpu=A01,B07,C03), or null if not a valid loadout. */
export function loadoutFromIds(pool: readonly Card[], ids: readonly string[] | null): Loadout | null {
  if (!ids || ids.length !== 3) return null;
  const cards = ids.map((id) => pool.find((c) => c.id === id));
  if (cards.some((c) => !c)) return null;
  const [A, B, C] = cards as Card[];
  const l = { A, B, C };
  return validateLoadout(l).ok ? l : null;
}

/** Random valid loadout from the full pool via the seeded RNG. */
export function pickCpuLoadout(pool: readonly Card[], rng: Rng, overrideIds: readonly string[] | null = null): Loadout {
  const forced = loadoutFromIds(pool, overrideIds);
  if (forced) return forced;
  if (overrideIds) console.warn(`[cpu] ignoring invalid ?cpu=${overrideIds.join(',')}`);
  const all = allValidLoadouts(pool);
  if (!all.length) throw new Error('卡池中沒有任何有效陣容');
  return rng.pick(all);
}

/** CPU steering: unit vector toward the opponent; physics applies STEER_WEIGHT (same cap as the player). */
export function cpuSteer(self: Body, opponent: Body): Vec2 {
  if (self.out || opponent.out) return { x: 0, z: 0 };
  return normalize({ x: opponent.pos.x - self.pos.x, z: opponent.pos.z - self.pos.z });
}
