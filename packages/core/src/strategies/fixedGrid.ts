/**
 * Strategies 1–2 (plan §6): FixedGridWeekly / FixedGrid{48h,24h,1h}.
 * One reallocation per grid tick on a trailing-revenue signal: weights
 * proportional to trailing revenue over the top-N pools. Weekly is the only
 * live-runnable strategy on Aerodrome today (P3); the shorter grids isolate
 * the value of cadence in the Aero simulation.
 */
import type { MarketState, Portfolio, Strategy, StrategyConfig, TargetAllocation } from "../types.js";
import { normalizeToWad, topN, type StrategyDescriptor } from "./base.js";

export interface FixedGridConfig extends StrategyConfig {
  kind: "fixed-grid";
  cadenceSec: string;
  topN: number;
}

export class FixedGrid implements Strategy {
  readonly kind = "fixed-grid";
  constructor(readonly config: FixedGridConfig) {}

  propose(state: MarketState, _portfolio: Portfolio): TargetAllocation {
    const candidates = topN(
      state.pools.filter((p) => p.trailingRevenueWad > 0n),
      (p) => p.trailingRevenueWad,
      this.config.topN,
    );
    return normalizeToWad(
      candidates.map((c) => c.pool),
      candidates.map((c) => c.trailingRevenueWad),
    );
  }
}

const WEEK = 7 * 86_400;

export function fixedGridDescriptor(cadenceSec: number): StrategyDescriptor {
  const label =
    cadenceSec === WEEK ? "weekly" : cadenceSec >= 3600 ? `${cadenceSec / 3600}h` : `${cadenceSec}s`;
  return {
    kind: "fixed-grid",
    title: `FixedGrid (${label})`,
    summary:
      "Reallocate on a fixed grid toward trailing revenue, proportional weights over the top-N pools.",
    liveOn: cadenceSec >= WEEK ? "aerodrome-v2" : "aero-v3-sim-only",
    schema: [
      { key: "cadenceSec", label: "Grid cadence", kind: "seconds", min: 2 },
      { key: "topN", label: "Top N pools", kind: "int", min: 1, max: 30 },
    ],
    defaults: { kind: "fixed-grid", cadenceSec: String(cadenceSec), topN: 8 },
  };
}
