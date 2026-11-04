/** Headless (no rendering) full-match runner at the fixed 60 Hz step. */
import type { Loadout } from '../cards/types';
import { CPU_CASE_C_POWER, MODE_S_POWER } from '../config/balance';
import { Rng } from '../core/rng';
import { randomAim } from '../launch/aim';
import { cpuSteer } from './cpu';
import { Match, type Mode, type RoundResult, type Side } from './match';

export interface HeadlessOptions {
  a: Loadout;
  b: Loadout;
  seed: number;
  mode?: Mode;
  /** Case C forced launchPowerUsed per side (skill-gap test). */
  charge?: [number, number];
}

export interface MatchSummary {
  winner: Side | null;
  scores: [number, number];
  duration: number;
  rounds: RoundResult[];
}

export function runHeadlessMatch(opts: HeadlessOptions): MatchSummary {
  const mode = opts.mode ?? 'C';
  const rng = new Rng(opts.seed);
  const match = new Match([opts.a, opts.b], mode, rng);
  const powers: [number, number] =
    mode === 'S' ? [MODE_S_POWER, MODE_S_POWER] : (opts.charge ?? [CPU_CASE_C_POWER, CPU_CASE_C_POWER]);

  while (!match.over) {
    match.beginRound([
      { aim: randomAim(0, rng), power: powers[0] },
      { aim: randomAim(1, rng), power: powers[1] },
    ]);
    for (;;) {
      const [p, q] = match.world!.bodies;
      const { result } = match.tick([cpuSteer(p, q), cpuSteer(q, p)]);
      if (result) break;
    }
  }
  return { winner: match.winner, scores: match.scores, duration: match.totalTime, rounds: match.results };
}
