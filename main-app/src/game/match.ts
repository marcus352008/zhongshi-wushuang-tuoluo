/** Pure match state machine (no DOM / Three.js) shared by the UI and the headless sim. */
import type { Loadout } from '../cards/types';
import {
  LAUNCH_SPEED,
  MAX_ROUNDS,
  PHYS_DT,
  POINTS_RING_OUT,
  POINTS_SPIN_OUT,
  POINTS_TIMEOUT,
  POINTS_TO_WIN,
  ROUND_TIMEOUT_SEC,
} from '../config/balance';
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import { launchSpot } from '../launch/aim';
import { deriveParams } from '../physics/derive';
import { createBody, World, type StepResult, type TopParams } from '../physics/world';
import { fuse, type FusedStats } from '../rules/fuse';
import { triangleKnockMult } from '../rules/triangle';

export type Mode = 'C' | 'S';
export type Side = 0 | 1;
export type RoundReason = 'ringOut' | 'spinOut' | 'timeout' | 'double';
/** 'burst' is reserved and never awarded in Phase 1. */
export type WinBy = 'ring' | 'spin' | 'burst' | 'none';

export interface LaunchInput {
  /** Aim angle in radians, atan2(z, x). */
  aim: number;
  /** launchPowerUsed in [0, 1.2]（案Q 全中 1.20；其餘模式一般 [0, 1]）。 */
  power: number;
}

export interface RoundResult {
  round: number;
  reason: RoundReason;
  winner: Side | null;
  points: [number, number];
  winBy: WinBy;
  duration: number;
  spinLeft: [number, number];
}

export interface SideInfo {
  loadout: Loadout;
  fused: FusedStats;
  params: TopParams | null;
  launchPowerUsed: number;
  ringOutCount: number;
  /** Round time (s) of this side's most recent spin-out, or null. */
  spinOutTime: number | null;
}

export class Match {
  /** May change between rounds (S-mode toggle on the Launch screen). */
  mode: Mode;
  readonly sides: [SideInfo, SideInfo];
  readonly rng: Rng;
  scores: [number, number] = [0, 0];
  round = 0;
  results: RoundResult[] = [];
  world: World | null = null;
  roundTime = 0;
  totalTime = 0;

  constructor(loadouts: [Loadout, Loadout], mode: Mode, rng: Rng) {
    this.mode = mode;
    this.rng = rng;
    this.sides = loadouts.map((loadout) => ({
      loadout,
      fused: fuse(loadout),
      params: null,
      launchPowerUsed: 0,
      ringOutCount: 0,
      spinOutTime: null,
    })) as [SideInfo, SideInfo];
  }

  get over(): boolean {
    return this.scores[0] >= POINTS_TO_WIN || this.scores[1] >= POINTS_TO_WIN || this.round >= MAX_ROUNDS;
  }

  /** Match winner once over; null = draw (or not over). */
  get winner(): Side | null {
    if (!this.over || this.scores[0] === this.scores[1]) return null;
    return this.scores[0] > this.scores[1] ? 0 : 1;
  }

  /** winBy of the round that decided the match. */
  get winBy(): WinBy {
    if (!this.over) return 'none';
    const w = this.winner;
    if (w === null) return 'none';
    const last = [...this.results].reverse().find((r) => r.winner === w);
    return last?.winBy ?? 'none';
  }

  get roundActive(): boolean {
    return this.world !== null && this.results.length < this.round;
  }

  beginRound(launch: [LaunchInput, LaunchInput]): void {
    if (this.over) throw new Error('match is over');
    this.round++;
    this.roundTime = 0;
    const bodies = ([0, 1] as const).map((s) => {
      const side = this.sides[s];
      side.launchPowerUsed = launch[s].power;
      side.params = deriveParams(side.fused, launch[s].power);
      const pos = launchSpot(s, this.rng);
      const vel = { x: Math.cos(launch[s].aim) * LAUNCH_SPEED, z: Math.sin(launch[s].aim) * LAUNCH_SPEED };
      return createBody(side.params, pos, vel);
    }) as [ReturnType<typeof createBody>, ReturnType<typeof createBody>];
    this.world = new World(bodies, this.rng);
    this.world.knockMult = [
      triangleKnockMult(this.sides[0].loadout, this.sides[1].loadout),
      triangleKnockMult(this.sides[1].loadout, this.sides[0].loadout),
    ];
  }

  /** Advance one fixed physics step. Returns the round result when the round ends on this step. */
  tick(steer: [Vec2, Vec2]): { step: StepResult; result: RoundResult | null } {
    const world = this.world;
    if (!world || !this.roundActive) throw new Error('no active round');
    const step = world.step(PHYS_DT, steer);
    this.roundTime += PHYS_DT;

    for (const i of step.newlyOut) {
      const b = world.bodies[i];
      if (b.out === 'ring') this.sides[i].ringOutCount++;
      if (b.out === 'spin') this.sides[i].spinOutTime = this.roundTime;
    }

    const [a, b] = world.bodies;
    let result: Omit<RoundResult, 'round' | 'duration' | 'spinLeft'> | null = null;
    if (a.out && b.out) {
      result = this.compareSpin('double', POINTS_SPIN_OUT, a.spin, b.spin);
    } else if (a.out || b.out) {
      const loser: Side = a.out ? 0 : 1;
      const kind = world.bodies[loser].out!;
      const pts = kind === 'ring' ? POINTS_RING_OUT : POINTS_SPIN_OUT;
      const points: [number, number] = loser === 0 ? [0, pts] : [pts, 0];
      result = { reason: kind === 'ring' ? 'ringOut' : 'spinOut', winner: loser === 0 ? 1 : 0, points, winBy: kind };
    } else if (this.roundTime >= ROUND_TIMEOUT_SEC - 1e-9) {
      result = this.compareSpin('timeout', POINTS_TIMEOUT, a.spin, b.spin);
    }

    if (!result) return { step, result: null };
    const full: RoundResult = {
      ...result,
      round: this.round,
      duration: this.roundTime,
      spinLeft: [Math.max(0, a.spin), Math.max(0, b.spin)],
    };
    this.results.push(full);
    this.scores = [this.scores[0] + full.points[0], this.scores[1] + full.points[1]];
    this.totalTime += this.roundTime;
    return { step, result: full };
  }

  /** Higher remaining spin wins `pts`; exact tie → 1 point each. */
  private compareSpin(reason: RoundReason, pts: number, sa: number, sb: number) {
    const a = Math.max(0, sa);
    const b = Math.max(0, sb);
    if (a === b) return { reason, winner: null, points: [1, 1] as [number, number], winBy: 'none' as WinBy };
    const winner: Side = a > b ? 0 : 1;
    const points: [number, number] = winner === 0 ? [pts, 0] : [0, pts];
    return { reason, winner, points, winBy: 'spin' as WinBy };
  }
}
