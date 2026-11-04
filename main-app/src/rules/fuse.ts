import { FUSION_WEIGHTS } from '../config/balance';
import type { Card, Loadout } from '../cards/types';

export interface FusedStats {
  ATK: number;
  DEF: number;
  STA_DECAY: number;
  SPD: number;
  MAS: number;
  BR: number;
}

type StatKey = keyof typeof FUSION_WEIGHTS;

function blend(key: StatKey, a: Card, b: Card, c: Card): number {
  const [wa, wb, wc] = FUSION_WEIGHTS[key];
  return wa * a[key] + wb * b[key] + wc * c[key];
}

/** Stat fusion, spec §4. All inputs and outputs are multipliers around 1.0. */
export function fuse(l: Loadout): FusedStats {
  const { A, B, C } = l;
  return {
    ATK: blend('atk', A, B, C),
    DEF: blend('def', A, B, C),
    STA_DECAY: blend('sta_decay', A, B, C),
    SPD: blend('spd', A, B, C),
    MAS: blend('mas', A, B, C),
    BR: blend('br', A, B, C),
  };
}
