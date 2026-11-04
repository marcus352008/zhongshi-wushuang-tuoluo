/**
 * Hand-rolled 2D top physics on the XZ plane, fixed step. Ported from ref/arena-src/src/physics.ts
 * (bowl pull + orbit drift + steering + friction integration, circle-vs-circle collision with
 * separation, elastic response and a stat-driven knock) and adapted to the Phase 1 spec:
 * linear bowl spring, no walls (ring-out when the centre crosses RIM_RADIUS), knock = max(floor,
 * knockPower - knockResist) scaled by relative speed, no burst.
 *
 * 0.3.1-specials：Body 加 optional buff 欄位；碰撞時讀取 atkMult／resistMult／receivedMult。
 */
import {
  BOWL_SPRING,
  COLLISION_JITTER,
  COLLISION_SPIN_LOSS,
  COLLISION_SPIN_PCT,
  DASH_COOLDOWN,
  DASH_ENABLED,
  DASH_IMPULSE,
  DASH_SPIN_COST_PCT,
  DRIFT_ACCEL,
  FRICTION,
  IMPULSE_FLOOR,
  IMPULSE_SPEED_SCALE,
  PAIR_HIT_COOLDOWN,
  REL_SPEED_MIN,
  RESTITUTION,
  RIM_RADIUS,
  STEER_GAIN,
  STEER_WEIGHT,
  TOP_RADIUS,
  WALL_EVENT_MIN_SPEED,
  WALL_RESTITUTION,
  WALL_SPIN_LOSS,
} from '../config/balance';
import { inGap } from './arena';
import type { Rng } from '../core/rng';
import { clampLen, dot, len, normalize, rotate, type Vec2 } from '../core/vec';
import {
  activeAtkMult,
  activeReceivedMult,
  activeResistMult,
  emptyBuff,
  tickBuff,
  type SpecialBuff,
} from '../game/specials';

/** Physics parameters derived from fused stats + launch power (see physics/derive.ts). */
export interface TopParams {
  spin0: number;
  spinDecay: number;
  knockPower: number;
  knockResist: number;
  mass: number;
  moveSpeed: number;
}

export type OutKind = 'ring' | 'spin';

export interface Body {
  params: TopParams;
  pos: Vec2;
  vel: Vec2;
  spin: number;
  radius: number;
  out: OutKind | null;
  dashCooldown: number;
  /** 0.3.1-specials：特技增益狀態（可選）。 */
  buff?: SpecialBuff;
}

export interface CollisionEvent {
  point: Vec2;
  /** Knock impulse received by body 0 and body 1. */
  received: [number, number];
  relSpeed: number;
}

export interface WallEvent {
  index: number;
  point: Vec2;
  /** Radial speed into the wall (m/s). */
  impact: number;
}

export interface StepResult {
  collisions: CollisionEvent[];
  walls: WallEvent[];
  /** Indices of bodies that went out during this step. */
  newlyOut: number[];
}

export function createBody(params: TopParams, pos: Vec2, vel: Vec2): Body {
  return {
    params,
    pos: { ...pos },
    vel: { ...vel },
    spin: params.spin0,
    radius: TOP_RADIUS,
    out: null,
    dashCooldown: 0,
    buff: emptyBuff(),
  };
}

export class World {
  readonly bodies: [Body, Body];
  time = 0;
  private pairCooldown = 0;
  private rng: Rng;
  /** Optional knock multiplier per body (soft triangle); 1 when disabled. */
  knockMult: [number, number] = [1, 1];

  constructor(bodies: [Body, Body], rng: Rng) {
    this.bodies = bodies;
    this.rng = rng;
  }

  /** steer: desired direction per body, length ≤ 1. */
  step(dt: number, steer: [Vec2, Vec2]): StepResult {
    this.time += dt;
    this.pairCooldown = Math.max(0, this.pairCooldown - dt);
    const newlyOut: number[] = [];
    const walls: WallEvent[] = [];

    this.bodies.forEach((b, i) => {
      if (b.out) return;
      tickBuff(b, this.time);
      const p = b.params;
      const spinFrac = Math.max(0, b.spin) / p.spin0;
      const r = len(b.pos);

      let ax = -BOWL_SPRING * b.pos.x;
      let az = -BOWL_SPRING * b.pos.z;
      if (r > 1e-4) {
        // Counter-clockwise (seen from above) self-propelled drift along the bowl.
        const drift = DRIFT_ACCEL * p.moveSpeed * spinFrac;
        ax += (-b.pos.z / r) * drift;
        az += (b.pos.x / r) * drift;
      }
      const s = clampLen(steer[i], 1);
      const steerAccel = STEER_WEIGHT * p.moveSpeed * STEER_GAIN;
      ax += s.x * steerAccel;
      az += s.z * steerAccel;

      b.vel.x += ax * dt;
      b.vel.z += az * dt;
      const damp = Math.exp(-FRICTION * dt);
      b.vel.x *= damp;
      b.vel.z *= damp;
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;

      b.spin -= p.spinDecay * dt;
      b.dashCooldown = Math.max(0, b.dashCooldown - dt);

      const r2 = len(b.pos);
      if (r2 + b.radius > RIM_RADIUS && !inGap(Math.atan2(b.pos.z, b.pos.x), this.time)) {
        const ux = b.pos.x / r2;
        const uz = b.pos.z / r2;
        const limit = RIM_RADIUS - b.radius;
        b.pos.x = ux * limit;
        b.pos.z = uz * limit;
        const vr = b.vel.x * ux + b.vel.z * uz;
        if (vr > 0) {
          b.vel.x -= ux * (1 + WALL_RESTITUTION) * vr;
          b.vel.z -= uz * (1 + WALL_RESTITUTION) * vr;
          b.spin -= vr * WALL_SPIN_LOSS;
          if (vr >= WALL_EVENT_MIN_SPEED) walls.push({ index: i, point: { x: ux * RIM_RADIUS, z: uz * RIM_RADIUS }, impact: vr });
        }
      }
    });

    const collisions: CollisionEvent[] = [];
    const [a, b] = this.bodies;
    if (!a.out && !b.out) {
      const c = this.collide(a, b);
      if (c) collisions.push(c);
    }

    this.bodies.forEach((body, i) => {
      if (body.out) return;
      if (len(body.pos) > RIM_RADIUS) {
        body.out = 'ring';
        newlyOut.push(i);
      } else if (body.spin <= 0) {
        body.spin = 0;
        body.out = 'spin';
        newlyOut.push(i);
      }
    });

    return { collisions, walls, newlyOut };
  }

  private collide(a: Body, b: Body): CollisionEvent | null {
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    const minDist = a.radius + b.radius;
    if (dist >= minDist || dist < 1e-6) return null;

    let n = { x: dx / dist, z: dz / dist };
    const ia = 1 / a.params.mass;
    const ib = 1 / b.params.mass;
    const overlap = minDist - dist;
    a.pos.x -= n.x * overlap * (ia / (ia + ib));
    a.pos.z -= n.z * overlap * (ia / (ia + ib));
    b.pos.x += n.x * overlap * (ib / (ia + ib));
    b.pos.z += n.z * overlap * (ib / (ia + ib));

    const vn = (a.vel.x - b.vel.x) * n.x + (a.vel.z - b.vel.z) * n.z;
    if (vn <= 0 || this.pairCooldown > 0) return null;
    this.pairCooldown = PAIR_HIT_COOLDOWN;

    n = rotate(n, this.rng.range(-COLLISION_JITTER, COLLISION_JITTER));

    const j = ((1 + RESTITUTION) * vn) / (ia + ib);
    const relSpeed = Math.max(vn, REL_SPEED_MIN);
    const knockAtoB =
      Math.max(
        IMPULSE_FLOOR,
        a.params.knockPower * this.knockMult[0] * activeAtkMult(a) - b.params.knockResist * activeResistMult(b),
      ) *
      relSpeed *
      IMPULSE_SPEED_SCALE;
    const knockBtoA =
      Math.max(
        IMPULSE_FLOOR,
        b.params.knockPower * this.knockMult[1] * activeAtkMult(b) - a.params.knockResist * activeResistMult(a),
      ) *
      relSpeed *
      IMPULSE_SPEED_SCALE;

    const receivedA = knockBtoA * activeReceivedMult(a);
    const receivedB = knockAtoB * activeReceivedMult(b);

    a.vel.x -= n.x * (j + receivedA) * ia;
    a.vel.z -= n.z * (j + receivedA) * ia;
    b.vel.x += n.x * (j + receivedB) * ib;
    b.vel.z += n.z * (j + receivedB) * ib;

    a.spin -= a.spin * COLLISION_SPIN_PCT + COLLISION_SPIN_LOSS * receivedA;
    b.spin -= b.spin * COLLISION_SPIN_PCT + COLLISION_SPIN_LOSS * receivedB;

    return {
      point: { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 },
      received: [receivedA, receivedB],
      relSpeed: vn,
    };
  }

  /** Dash is behind DASH_ENABLED (false in Phase 1). */
  dash(index: number, dir: Vec2): boolean {
    const b = this.bodies[index];
    if (!DASH_ENABLED || b.out || b.dashCooldown > 0) return false;
    const d = normalize(dir);
    if (dot(d, d) < 1e-6) return false;
    b.vel.x += d.x * DASH_IMPULSE;
    b.vel.z += d.z * DASH_IMPULSE;
    b.spin -= b.spin * DASH_SPIN_COST_PCT;
    b.dashCooldown = DASH_COOLDOWN;
    return true;
  }
}

