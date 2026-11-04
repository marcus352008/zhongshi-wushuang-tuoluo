import * as THREE from 'three';
import { ARENA_RADIUS, GRAVITY, PHYS } from './config';
import type { Bey } from './beyblade';
import { bowlHeight, bowlSlope, inGap } from './stadium';

export type PhysEvent =
  | { kind: 'clash'; point: THREE.Vector3; impact: number; a: Bey; b: Bey }
  | { kind: 'wall'; point: THREE.Vector3; impact: number; bey: Bey }
  | { kind: 'ringout'; bey: Bey };

const tmp = new THREE.Vector2();
const n = new THREE.Vector2();
const t = new THREE.Vector2();

let pairCooldown = 0;

export function stepPhysics(beys: Bey[], steer: Map<Bey, THREE.Vector2>, dt: number): PhysEvent[] {
  const events: PhysEvent[] = [];
  pairCooldown = Math.max(0, pairCooldown - dt);

  for (const b of beys) {
    if (!b.active) continue;
    const frac = b.spinFrac;
    const r = b.pos.length();
    const accel = tmp.set(0, 0);

    if (r > 1e-4) {
      const ux = b.pos.x / r;
      const uy = b.pos.y / r;
      const pull = GRAVITY * bowlSlope(r);
      accel.x -= ux * pull;
      accel.y -= uy * pull;
      if (r > 0.4) {
        accel.x += -uy * PHYS.orbit * frac;
        accel.y += ux * PHYS.orbit * frac;
      }
    }

    const s = steer.get(b);
    if (s) accel.addScaledVector(s, PHYS.steer * b.type.speed * (0.35 + 0.65 * frac));

    b.vel.addScaledVector(accel, dt);
    b.vel.multiplyScalar(Math.exp(-(PHYS.friction + (1 - frac) * 0.6) * dt));
    b.pos.addScaledVector(b.vel, dt);
    b.spin -= (PHYS.spinDecay * b.type.decay + b.vel.length() * PHYS.speedDecay) * dt;
    b.dashCooldown = Math.max(0, b.dashCooldown - dt);

    const r2 = b.pos.length();
    if (r2 + b.radius > ARENA_RADIUS) {
      const ang = Math.atan2(b.pos.y, b.pos.x);
      if (inGap(ang)) {
        if (r2 > ARENA_RADIUS + PHYS.ringOutDistance) {
          b.ringOut();
          events.push({ kind: 'ringout', bey: b });
        }
      } else {
        const ux = b.pos.x / r2;
        const uy = b.pos.y / r2;
        const limit = ARENA_RADIUS - b.radius;
        b.pos.set(ux * limit, uy * limit);
        const vr = b.vel.x * ux + b.vel.y * uy;
        if (vr > 0) {
          b.vel.x -= ux * (1 + PHYS.wallRestitution) * vr;
          b.vel.y -= uy * (1 + PHYS.wallRestitution) * vr;
          b.spin -= vr * 0.5;
          if (vr > 2) {
            events.push({
              kind: 'wall',
              point: new THREE.Vector3(ux * ARENA_RADIUS, bowlHeight(ARENA_RADIUS) + 0.3, uy * ARENA_RADIUS),
              impact: vr,
              bey: b,
            });
          }
        }
      }
    }
    if (b.spin <= 0) b.stop();
  }

  for (let i = 0; i < beys.length; i++) {
    for (let j = i + 1; j < beys.length; j++) {
      const a = beys[i];
      const b = beys[j];
      if (a.burst || b.burst || a.ringedOut || b.ringedOut) continue;
      n.subVectors(b.pos, a.pos);
      const dist = n.length();
      const minDist = a.radius + b.radius;
      if (dist >= minDist || dist < 1e-5) continue;
      n.divideScalar(dist);

      const ia = a.stopped ? 0.5 / a.type.mass : 1 / a.type.mass;
      const ib = b.stopped ? 0.5 / b.type.mass : 1 / b.type.mass;
      const overlap = minDist - dist;
      a.pos.addScaledVector(n, (-overlap * ia) / (ia + ib));
      b.pos.addScaledVector(n, (overlap * ib) / (ia + ib));

      const vn = (a.vel.x - b.vel.x) * n.x + (a.vel.y - b.vel.y) * n.y;
      if (vn <= 0 && pairCooldown > 0) continue;

      const fa = a.spinFrac;
      const fb = b.spinFrac;
      const clash = PHYS.clash * (a.type.attack * fa + b.type.attack * fb);
      const impact = Math.max(vn, 0) + clash;
      const jImp = ((1 + PHYS.restitution) * Math.max(vn, 0) + clash) / (ia + ib);
      a.vel.addScaledVector(n, -jImp * ia - (PHYS.knock * b.type.attack * fb) / a.type.mass);
      b.vel.addScaledVector(n, jImp * ib + (PHYS.knock * a.type.attack * fa) / b.type.mass);

      t.set(-n.y, n.x);
      const rub = PHYS.rub * (fa + fb);
      a.vel.addScaledVector(t, rub * ia);
      b.vel.addScaledVector(t, -rub * ib);

      if (!a.stopped) a.spin -= (impact * PHYS.damage * b.type.attack) / a.type.defense;
      if (!b.stopped) b.spin -= (impact * PHYS.damage * a.type.attack) / b.type.defense;
      pairCooldown = 0.25;

      const mx = (a.pos.x + b.pos.x) / 2;
      const mz = (a.pos.y + b.pos.y) / 2;
      events.push({
        kind: 'clash',
        point: new THREE.Vector3(mx, bowlHeight(Math.hypot(mx, mz)) + 0.45, mz),
        impact,
        a,
        b,
      });
    }
  }

  return events;
}

export function dash(b: Bey, dir: THREE.Vector2): boolean {
  if (!b.active || b.dashCooldown > 0 || dir.lengthSq() < 1e-4) return false;
  const d = dir.clone().normalize();
  b.vel.addScaledVector(d, PHYS.dashImpulse * b.type.speed);
  b.spin -= PHYS.dashCost;
  b.dashCooldown = PHYS.dashCooldown;
  return true;
}
