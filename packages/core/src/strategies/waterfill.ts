/**
 * Water-filling allocator: size-aware marginal-yield equalizer,
 *   max Σ wᵢ·Rᵢ/(Wᵢ+wᵢ)  s.t.  Σwᵢ = B, wᵢ ≥ 0
 * where Rᵢ is expected pool revenue, Wᵢ the external (non-us) weight, and B
 * our budget of allocation power.
 *
 * Implemented as chunked greedy: the budget is split into `steps` equal
 * chunks and each chunk goes to the pool with the highest exact marginal
 * gain. This is ε-approximate water-filling (exact as steps → ∞) chosen
 * because it is *deterministic and exactly replicable in Solidity*:
 *   gain_i = floor(Rᵢ·s·Wᵢ / ((Wᵢ+wᵢ)·(Wᵢ+wᵢ+s)))
 * compared with strictly-greater, ties broken by lowest index.
 *
 * Domain bounds (enforced): Rᵢ, Wᵢ, B ≤ 1e36 so every intermediate fits the
 * 512-bit mulDiv the Solidity twin (LibWaterFill.sol) uses.
 * Pools with Wᵢ = 0 receive gain = Rᵢ·s/(wᵢ+s) — i.e. we'd capture ~all
 * revenue — handled as the same formula with a virtual 1-wei floor on W.
 */
import { checkUint256 } from "../math/fixed.js";

export const WATERFILL_MAX_INPUT = 10n ** 36n;

export interface WaterfillInput {
  /** Expected revenue per pool, wad. */
  revenuesWad: readonly bigint[];
  /** External weight per pool, wad. */
  externalWeightsWad: readonly bigint[];
  /** Our total budget of allocation power, wad. */
  budgetWad: bigint;
  /** Number of greedy chunks (≥1). More steps = closer to exact water-filling. */
  steps: number;
}

/** Exact marginal gain of adding `s` to pool with revenue R, external weight W, current own weight w. */
function marginalGain(R: bigint, W: bigint, w: bigint, s: bigint): bigint {
  const Weff = W === 0n ? 1n : W;
  const d1 = Weff + w;
  const d2 = Weff + w + s;
  // floor(R·s·W / (d1·d2)) — arbitrary-precision here; 512-bit mulDiv in Solidity.
  return (R * s * Weff) / (d1 * d2);
}

/**
 * Returns per-pool allocations (wad) summing exactly to budgetWad
 * (the final chunk absorbs the division remainder).
 */
export function waterfill(input: WaterfillInput): bigint[] {
  const { revenuesWad, externalWeightsWad, budgetWad, steps } = input;
  const n = revenuesWad.length;
  if (externalWeightsWad.length !== n) throw new Error("length mismatch");
  if (steps < 1 || !Number.isInteger(steps)) throw new Error("steps must be a positive integer");
  for (const x of [...revenuesWad, ...externalWeightsWad, budgetWad]) {
    checkUint256(x, "waterfill.input");
    if (x > WATERFILL_MAX_INPUT) throw new Error("waterfill input exceeds domain bound");
  }
  const alloc: bigint[] = new Array(n).fill(0n);
  if (n === 0 || budgetWad === 0n) return alloc;

  const stepsB = BigInt(steps);
  const chunk = budgetWad / stepsB;
  for (let k = 0n; k < stepsB; k++) {
    // Final chunk absorbs the remainder so Σ alloc == budget exactly.
    const s = k === stepsB - 1n ? budgetWad - chunk * (stepsB - 1n) : chunk;
    if (s === 0n) continue;
    let best = 0;
    let bestGain = -1n;
    for (let i = 0; i < n; i++) {
      const g = marginalGain(revenuesWad[i]!, externalWeightsWad[i]!, alloc[i]!, s);
      if (g > bestGain) {
        bestGain = g;
        best = i;
      }
    }
    alloc[best] = alloc[best]! + s;
  }
  return alloc;
}
