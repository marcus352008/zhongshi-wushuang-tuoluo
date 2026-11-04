import { CHARGE_RAMP_SEC, SWEET_BAND_MIN } from '../config/balance';

/** Raw charge after holding for `heldSec`: ramps 0 → 1 over CHARGE_RAMP_SEC, then holds at 1 (no cycling). */
export function chargeRaw(heldSec: number): number {
  if (!(heldSec > 0)) return 0;
  return Math.min(1, heldSec / CHARGE_RAMP_SEC);
}

export function inSweetBand(raw: number): boolean {
  return raw >= SWEET_BAND_MIN && raw <= 1;
}

/** Case C: releasing inside the sweet band [0.85, 1.0] counts as full power. */
export function launchPowerFromRaw(raw: number): number {
  const r = Math.max(0, Math.min(1, raw));
  return inSweetBand(r) ? 1 : r;
}
