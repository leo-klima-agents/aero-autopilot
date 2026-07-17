/**
 * Deterministic integer PRNG (mulberry32). Operates entirely on 32-bit
 * integer ops, so streams are identical across JS engines — shared seeds in
 * URLs reproduce runs exactly (plan §8).
 */
export class Prng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next uint32. */
  nextU32(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, bound). */
  nextBelow(bound: number): number {
    return this.nextU32() % bound;
  }

  /** Bernoulli(pPpm) — probability given in parts-per-million to stay integer-only. */
  bernoulliPpm(pPpm: number): boolean {
    return this.nextBelow(1_000_000) < pPpm;
  }

  /**
   * Multiplies x (bigint) by a random factor in [1 - volPct/100, 1 + volPct/100]
   * with 1e6 resolution, floor.
   */
  jitter(x: bigint, volPct: number): bigint {
    const span = Math.floor(volPct * 10_000) * 2; // 1e6-scale width
    const f = 1_000_000 - Math.floor(volPct * 10_000) + this.nextBelow(span + 1);
    return (x * BigInt(f)) / 1_000_000n;
  }
}
