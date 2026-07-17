/**
 * Strategy 5 (plan §6): ContinuousGreedy — event-driven: reallocate any
 * unlocked tranche whenever the marginal-yield gap between the water-filled
 * ideal and the current book exceeds a threshold plus costs. The cooldown
 * parameter runs down to one block — deliberately, to demonstrate the
 * latency-race limit (P3): at block cadence, reactive returns converge to
 * the system average minus latency costs.
 */
import { WAD } from "../math/fixed.js";
import { allocationDistanceWad } from "../scheduler/scheduler.js";
import { allocationToVector, type MarketState, type Portfolio, type Strategy, type StrategyConfig, type TargetAllocation } from "../types.js";
import { normalizeToWad, topN, type StrategyDescriptor } from "./base.js";
import { waterfill } from "./waterfill.js";

export interface ContinuousGreedyConfig extends StrategyConfig {
  kind: "continuous-greedy";
  /** Decision cadence; 2s ≈ one Base block. */
  cadenceSec: string;
  topN: number;
  /** Move only when distance(current, ideal) > gapThresholdWad + costWad. */
  gapThresholdWad: string;
  /** Modeled per-move cost (gas + slippage drag), wad distance-equivalent. */
  costWad: string;
  waterfillSteps: number;
}

export class ContinuousGreedy implements Strategy {
  readonly kind = "continuous-greedy";
  constructor(readonly config: ContinuousGreedyConfig) {}

  propose(state: MarketState, portfolio: Portfolio): TargetAllocation {
    const picked = topN(
      state.pools.filter((p) => p.trailingRevenueWad > 0n),
      (p) => p.trailingRevenueWad,
      this.config.topN,
    );
    const current = aggregatePortfolio(portfolio);
    if (picked.length === 0) return vectorToTarget(current);

    const alloc = waterfill({
      revenuesWad: picked.map((p) => p.trailingRevenueWad),
      externalWeightsWad: picked.map((p) => p.externalWeightWad),
      budgetWad: portfolio.totalPowerWad,
      steps: this.config.waterfillSteps,
    });
    const ideal = normalizeToWad(
      picked.map((p) => p.pool),
      alloc,
    );

    const gap = allocationDistanceWad(current, allocationToVector(ideal));
    const hurdle = BigInt(this.config.gapThresholdWad) + BigInt(this.config.costWad);
    return gap > hurdle ? ideal : vectorToTarget(current);
  }
}

function aggregatePortfolio(portfolio: Portfolio): Map<string, bigint> {
  const agg = new Map<string, bigint>();
  if (portfolio.totalPowerWad === 0n) return agg;
  for (const t of portfolio.tranches) {
    for (const [pool, frac] of t.weights) {
      agg.set(pool, (agg.get(pool) ?? 0n) + (t.powerWad * frac) / WAD);
    }
  }
  for (const [pool, w] of agg) agg.set(pool, (w * WAD) / portfolio.totalPowerWad);
  return agg;
}

function vectorToTarget(v: Map<string, bigint>): TargetAllocation {
  const pools = [...v.keys()].sort();
  return { pools, weightsWad: pools.map((p) => v.get(p)!) };
}

export function continuousGreedyDescriptor(): StrategyDescriptor {
  return {
    kind: "continuous-greedy",
    title: "ContinuousGreedy",
    summary:
      "Event-driven: rotate any unlocked tranche when the marginal-yield gap beats threshold + costs. Cooldown configurable down to one block — the latency-race limit.",
    liveOn: "aero-v3-sim-only",
    schema: [
      { key: "cadenceSec", label: "Decision cadence", kind: "seconds", min: 2 },
      { key: "topN", label: "Top N pools", kind: "int", min: 1, max: 30 },
      { key: "gapThresholdWad", label: "Gap threshold", kind: "wadPct" },
      { key: "costWad", label: "Per-move cost drag", kind: "wadPct" },
      { key: "waterfillSteps", label: "Water-filling steps", kind: "int", min: 10, max: 1000 },
    ],
    defaults: {
      kind: "continuous-greedy",
      cadenceSec: "2",
      topN: 10,
      gapThresholdWad: (5n * 10n ** 16n).toString(),
      costWad: (10n ** 16n).toString(),
      waterfillSteps: 100,
    },
  };
}
