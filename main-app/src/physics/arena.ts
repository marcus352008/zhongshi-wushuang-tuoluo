import { GAP_ANGLES, GAP_HALF_WIDTH, GAP_SPIN_RAD_PER_SEC } from '../config/balance';

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Gap centre angles at simulation time `t` (seconds since round start). */
export function gapAnglesAt(t: number): number[] {
  const spin = GAP_SPIN_RAD_PER_SEC * t;
  return GAP_ANGLES.map((g) => g + spin);
}

/** True when the angle atan2(z, x) lies inside one of the wall's exit gaps. */
export function inGap(angle: number, t = 0): boolean {
  return gapAnglesAt(t).some((g) => Math.abs(angleDiff(angle, g)) < GAP_HALF_WIDTH);
}
