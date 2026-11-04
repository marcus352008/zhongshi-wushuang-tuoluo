export const ARENA_RADIUS = 6;
export const BOWL_K = 0.06;
export const LIP_WIDTH = 1.4;
export const GRAVITY = 16;
export const MAX_SPIN = 100;
export const BEY_RADIUS = 0.55;
export const WINNING_SCORE = 3;

/** Exit pockets in the wall, as angles in the XZ plane (atan2(z, x)). */
export const GAP_ANGLES = [Math.PI / 6, (5 * Math.PI) / 6, (3 * Math.PI) / 2];
export const GAP_HALF_WIDTH = 0.32;

export const PHYS = {
  orbit: 2.6,
  steer: 17,
  friction: 0.5,
  wallRestitution: 0.55,
  restitution: 0.85,
  clash: 2.4,
  rub: 1.6,
  knock: 6,
  damage: 0.2,
  spinDecay: 1.7,
  speedDecay: 0.09,
  dashImpulse: 9,
  dashCost: 6,
  dashCooldown: 1.4,
  ringOutDistance: 0.45,
};

export type BeyKind = 'Attack' | 'Defense' | 'Stamina';

export interface BeyType {
  id: string;
  name: string;
  kind: BeyKind;
  blurb: string;
  color: number;
  accent: number;
  attack: number;
  defense: number;
  /** Spin decay multiplier; lower lasts longer. */
  decay: number;
  speed: number;
  mass: number;
  burstResist: number;
}

export const BEY_TYPES: BeyType[] = [
  {
    id: 'striker',
    name: 'Storm Striker',
    kind: 'Attack',
    blurb: 'Hooked blades and a fast tip. Hits hard and moves quickly, but loses spin fast.',
    color: 0x2f7bff,
    accent: 0x7fe3ff,
    attack: 1.45,
    defense: 0.85,
    decay: 1.25,
    speed: 1.3,
    mass: 1.0,
    burstResist: 0.9,
  },
  {
    id: 'bastion',
    name: 'Iron Bastion',
    kind: 'Defense',
    blurb: 'Heavy and round. Takes hits without losing much spin and is hard to knock out.',
    color: 0x2fbf71,
    accent: 0xd6ff6b,
    attack: 0.9,
    defense: 1.55,
    decay: 1.0,
    speed: 0.85,
    mass: 1.5,
    burstResist: 1.4,
  },
  {
    id: 'lotus',
    name: 'Eternal Lotus',
    kind: 'Stamina',
    blurb: 'Smooth and balanced. Outlasts the opponent and wins on spin.',
    color: 0xa64dff,
    accent: 0xff8be0,
    attack: 0.8,
    defense: 1.05,
    decay: 0.62,
    speed: 1.0,
    mass: 1.1,
    burstResist: 1.0,
  },
];
