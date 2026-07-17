/**
 * Strategy 3 (plan §6): PersistenceCarry — persistence-weighted trailing
 * revenue (haircut proportional to revenue volatility), (s,S)-threshold
 * reallocation, lock-timing aware: the optimal reactive family under a 48h
 * cooldown. Volatile ("bursty" or baited) revenue is discounted, and the
 * portfolio only moves when the proposed target is far enough from the
 * current one to pay for the cooldown it burns.
 */
import { WAD, mulDiv, saturatingSub, wadDiv } from "../math/fixed.js";
import { allocationDistanceWad } from "../scheduler/scheduler.js";
import { allocationToVector, type MarketState, type Portfolio, type Strategy, type StrategyConfig, type TargetAllocation } from "../types.js";
import { normalizeToWad, topN, type StrategyDescriptor } from "./base.js";
import { waterfill } from "./waterfill.js";

export interface PersistenceCarryConfig extends StrategyConfig {
  kind: "persistence-carry";
  cadenceSec: string;
  topN: number;
  /** Haircut multiplier λ, wad: score = R × max(0, 1 − λ·vol/R̄). */
  lambdaWad: string;
  /** (s,S) band: only move when distance(current, proposed) > sWad. */
  moveThresholdWad: string;
  /** Water-filling steps for the sizing pass. */
  waterfillSteps: number;
}

export class PersistenceCarry implements Strategy {
  readonly kind = "persistence-carry";
  private lastTarget: TargetAllocation | null = null;

  constructor(readonly config: PersistenceCarryConfig) {}

  propose(state: MarketState, portfolio: Portfolio): TargetAllocation {
    const lambda = BigInt(this.config.lambdaWad);
    const scored = state.pools
      .map((p) => {
        if (p.trailingRevenueWad === 0n) return { pool: p.pool, score: 0n, ext: p.externalWeightWad };
        // haircut = min(WAD, λ·vol/R); score = R·(WAD − haircut)/WAD
        const volRatio = wadDiv(p.revenueVolWad, p.trailingRevenueWad);
        const haircut = mulDiv(volRatio, lambda, WAD);
        const keep = saturatingSub(WAD, haircut);
        return { pool: p.pool, score: mulDiv(p.trailingRevenueWad, keep, WAD), ext: p.externalWeightWad };
      })
      .filter((s) => s.score > 0n);

    const picked = topN(scored, (s) => s.score, this.config.topN);
    if (picked.length === 0) return this.lastTarget ?? { pools: [], weightsWad: [] };

    // Size with water-filling on the persistence-adjusted revenue.
    const alloc = waterfill({
      revenuesWad: picked.map((p) => p.score),
      externalWeightsWad: picked.map((p) => p.ext),
      budgetWad: portfolio.totalPowerWad,
      steps: this.config.waterfillSteps,
    });
    const proposed = normalizeToWad(
      picked.map((p) => p.pool),
      alloc,
    );

    // (s,S) band: hold the current target unless the move is worth a cooldown.
    if (this.lastTarget) {
      const dist = allocationDistanceWad(allocationToVector(this.lastTarget), allocationToVector(proposed));
      if (dist <= BigInt(this.config.moveThresholdWad)) return this.lastTarget;
    }
    this.lastTarget = proposed;
    return proposed;
  }
}

export function persistenceCarryDescriptor(): StrategyDescriptor {
  return {
    kind: "persistence-carry",
    title: "PersistenceCarry",
    summary:
      "Persistence-weighted trailing revenue with a volatility haircut, water-filled sizing, and an (s,S) move band — built for cooldown-gated reallocation.",
    liveOn: "aero-v3-sim-only",
    schema: [
      { key: "cadenceSec", label: "Decision cadence", kind: "seconds", min: 60 },
      { key: "topN", label: "Top N pools", kind: "int", min: 1, max: 30 },
      { key: "lambdaWad", label: "Volatility haircut λ", kind: "wadPct", help: "score = R·(1 − λ·vol/R)" },
      { key: "moveThresholdWad", label: "(s,S) move threshold", kind: "wadPct" },
      { key: "waterfillSteps", label: "Water-filling steps", kind: "int", min: 10, max: 1000 },
    ],
    defaults: {
      kind: "persistence-carry",
      cadenceSec: String(48 * 3600),
      topN: 8,
      lambdaWad: (5n * 10n ** 17n).toString(),
      moveThresholdWad: (10n ** 17n).toString(),
      waterfillSteps: 100,
    },
  };
}
