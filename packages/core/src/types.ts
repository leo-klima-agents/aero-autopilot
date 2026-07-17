/**
 * Shared domain types for the strategy engine, simulator, keeper, and web UI.
 * All monetary quantities are 1e18-scaled bigints ("wad"); all times are unix
 * seconds as bigints.
 */

/** A pool is identified by its address (live) or a stable synthetic id (sim). */
export type PoolId = string;

/** Per-pool trailing statistics visible to strategies at decision time. */
export interface PoolWindow {
  pool: PoolId;
  /** Revenue (fees + incentives to allocators) over the trailing lookback, wad. */
  trailingRevenueWad: bigint;
  /** Dispersion of per-step revenue over the lookback (mean absolute deviation), wad. */
  revenueVolWad: bigint;
  /** Allocation weight held by everyone who is not us, wad units of voting power. */
  externalWeightWad: bigint;
  /** Scheduled emissions over the trailing lookback, wad (0 when unknown). */
  trailingEmissionsWad: bigint;
}

/** What a strategy sees when asked to propose. */
export interface MarketState {
  now: bigint;
  pools: readonly PoolWindow[];
}

/** Allocation vector: pool → fraction of a position's power, wad. Fractions sum to WAD (or 0 if empty). */
export type AllocationVector = ReadonlyMap<PoolId, bigint>;

export interface TrancheView {
  id: number;
  /** Voting/allocation power of this tranche, wad. */
  powerWad: bigint;
  /** Unix seconds of the last cooldown-starting action. */
  lastActionAt: bigint;
  /** Current allocation of this tranche. */
  weights: AllocationVector;
}

export interface Portfolio {
  tranches: readonly TrancheView[];
  totalPowerWad: bigint;
}

/** A strategy's output: a vault-level target allocation plus attribution tag. */
export interface TargetAllocation {
  pools: readonly PoolId[];
  /** Wad fractions aligned with `pools`; must sum to WAD (or be empty). */
  weightsWad: readonly bigint[];
}

/** The strategy contract every implementation satisfies (plan §6). */
export interface Strategy {
  readonly kind: string;
  readonly config: StrategyConfig;
  propose(state: MarketState, portfolio: Portfolio): TargetAllocation;
}

/** Serializable config; hashed (keccak) into the on-chain strategyRef. */
export interface StrategyConfig {
  kind: string;
  /** Reallocation cadence in seconds (7d grid, 48h, 24h, 1h, or 2s ≈ one Base block). */
  cadenceSec: string;
  [key: string]: unknown;
}

export function allocationToVector(t: TargetAllocation): AllocationVector {
  const m = new Map<PoolId, bigint>();
  t.pools.forEach((p, i) => m.set(p, t.weightsWad[i] ?? 0n));
  return m;
}
