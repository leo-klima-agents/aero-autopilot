/**
 * Strategy 4 (plan §6): WaterFilling — the size-aware marginal-yield
 * equalizer max Σ wᵢRᵢ/(Wᵢ+wᵢ) run standalone on raw trailing revenue.
 * Also the allocator inside PersistenceCarry and ContinuousGreedy.
 */
import type { MarketState, Portfolio, Strategy, StrategyConfig, TargetAllocation } from "../types.js";
import { normalizeToWad, topN, type StrategyDescriptor } from "./base.js";
import { waterfill } from "./waterfill.js";

export interface WaterFillingConfig extends StrategyConfig {
  kind: "water-filling";
  cadenceSec: string;
  topN: number;
  waterfillSteps: number;
}

export class WaterFilling implements Strategy {
  readonly kind = "water-filling";
  constructor(readonly config: WaterFillingConfig) {}

  propose(state: MarketState, portfolio: Portfolio): TargetAllocation {
    const picked = topN(
      state.pools.filter((p) => p.trailingRevenueWad > 0n),
      (p) => p.trailingRevenueWad,
      this.config.topN,
    );
    if (picked.length === 0) return { pools: [], weightsWad: [] };
    const alloc = waterfill({
      revenuesWad: picked.map((p) => p.trailingRevenueWad),
      externalWeightsWad: picked.map((p) => p.externalWeightWad),
      budgetWad: portfolio.totalPowerWad,
      steps: this.config.waterfillSteps,
    });
    return normalizeToWad(
      picked.map((p) => p.pool),
      alloc,
    );
  }
}

export function waterFillingDescriptor(): StrategyDescriptor {
  return {
    kind: "water-filling",
    title: "WaterFilling",
    summary: "Equalize marginal yield across pools: max Σ wᵢRᵢ/(Wᵢ+wᵢ) under the power budget.",
    liveOn: "aero-v3-sim-only",
    schema: [
      { key: "cadenceSec", label: "Decision cadence", kind: "seconds", min: 60 },
      { key: "topN", label: "Top N pools", kind: "int", min: 1, max: 30 },
      { key: "waterfillSteps", label: "Water-filling steps", kind: "int", min: 10, max: 1000 },
    ],
    defaults: {
      kind: "water-filling",
      cadenceSec: String(24 * 3600),
      topN: 10,
      waterfillSteps: 100,
    },
  };
}
