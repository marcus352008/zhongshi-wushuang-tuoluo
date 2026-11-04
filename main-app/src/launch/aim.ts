import { AIM_ARC, LAUNCH_POS_NOISE, LAUNCH_RADIUS } from '../config/balance';
import type { Rng } from '../core/rng';
import type { Vec2 } from '../core/vec';

/** Side 0 (player / A) launches from the left (−X), side 1 (CPU / B) from the right (+X). */
export function baseLaunchSpot(side: 0 | 1): Vec2 {
  return { x: side === 0 ? -LAUNCH_RADIUS : LAUNCH_RADIUS, z: 0 };
}

/** Default aim (radians, atan2(z, x)) for each side: straight toward the centre. */
export function defaultAim(side: 0 | 1): number {
  return side === 0 ? 0 : Math.PI;
}

export function clampAim(side: 0 | 1, angle: number): number {
  const c = defaultAim(side);
  let d = angle - c;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return c + Math.max(-AIM_ARC, Math.min(AIM_ARC, d));
}

export function launchSpot(side: 0 | 1, rng: Rng): Vec2 {
  const b = baseLaunchSpot(side);
  return { x: b.x + rng.range(-LAUNCH_POS_NOISE, LAUNCH_POS_NOISE), z: b.z + rng.range(-LAUNCH_POS_NOISE, LAUNCH_POS_NOISE) };
}

export function randomAim(side: 0 | 1, rng: Rng): number {
  return defaultAim(side) + rng.range(-AIM_ARC, AIM_ARC);
}
