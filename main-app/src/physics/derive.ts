import {
  BASE_DECAY,
  BASE_KNOCK,
  BASE_MASS,
  BASE_RESIST,
  BASE_SPEED,
  BASE_SPIN0,
  LAUNCH_POWER_MIN,
  LAUNCH_POWER_RANGE,
} from '../config/balance';
import type { FusedStats } from '../rules/fuse';
import type { TopParams } from './world';

/**
 * Maps fused multipliers + launch power to physics parameters (spec §5).
 * launchPowerUsed 允許 [0, 1.2]（案Q 全中 1.20），不 clamp 到 1。
 */
export function deriveParams(f: FusedStats, launchPowerUsed: number): TopParams {
  const p = Number.isFinite(launchPowerUsed) ? Math.max(0, launchPowerUsed) : 0;
  const power = LAUNCH_POWER_MIN + LAUNCH_POWER_RANGE * p;
  return {
    spin0: BASE_SPIN0 * power,
    spinDecay: BASE_DECAY * f.STA_DECAY,
    knockPower: BASE_KNOCK * f.ATK * power,
    knockResist: BASE_RESIST * (0.5 * f.DEF + 0.5 * f.MAS),
    mass: BASE_MASS * f.MAS,
    moveSpeed: BASE_SPEED * f.SPD,
  };
}
