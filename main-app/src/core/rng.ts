/** Seeded PRNG (mulberry32). All gameplay randomness must go through an Rng instance. */
export class Rng {
  private state: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Derive an independent child stream (e.g. one per match) deterministically. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
}

/** Create a seeded Rng (shared match seed for PvP host/guest). */
export function createRng(seed: number): Rng {
  return new Rng(seed);
}
