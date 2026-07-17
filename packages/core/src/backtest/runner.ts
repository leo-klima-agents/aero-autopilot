/**
 * Backtest runner: drives a Strategy against a ProtocolModel through the
 * shared tranche/cooldown scheduler — the same state machine the keeper
 * executes on-chain (P2: one deterministic core).
 *
 * Accounting is exact bigint; the exported series are floats for plotting
 * only (analytics are allowed floats, fixtures are not).
 */
import { WAD } from "../math/fixed.js";
import { planRotations, allocationDistanceWad } from "../scheduler/scheduler.js";
import {
  allocationToVector,
  type Portfolio,
  type Strategy,
  type TargetAllocation,
  type TrancheView,
} from "../types.js";
import type { ProtocolModel } from "../model/types.js";

export interface BacktestParams {
  model: ProtocolModel;
  strategy: Strategy;
  /** Number of staggered tranches (v3 positions can't be split — stake-time structure, §4.1). */
  trancheCount: number;
  totalPowerWad: bigint;
  /** Reallocation cooldown enforced per tranche. */
  cooldownSec: bigint;
  /** Scheduler rotates a tranche only when it's this far off target (wad half-L1). */
  epsilonWad: bigint;
  /** How often the strategy is consulted, in seconds. */
  cadenceSec: bigint;
}

export interface EquityPoint {
  t: number;
  /** Cumulative return on power (revenue ÷ power), float for plotting. */
  ours: number;
  benchmark: number;
}

export interface AllocationSample {
  t: number;
  weights: Record<string, number>;
}

export interface BacktestMetrics {
  /** Cumulative revenue ÷ total power. */
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  /** Max drawdown of (ours − benchmark) cumulative series. */
  maxDrawdownVsBenchmark: number;
  /** Total power-fraction moved across all rotations (sum of half-L1 distances × tranche share). */
  turnover: number;
  /** Fraction of steps where the portfolio was within epsilon of the strategy target. */
  onTargetPct: number;
  /** Continuous model only: emitted ÷ (emitted + burned) — the emissions-accuracy calibration metric. */
  emissionsAccuracy: number | null;
  rotations: number;
}

export interface BacktestResult {
  series: EquityPoint[];
  allocations: AllocationSample[];
  metrics: BacktestMetrics;
  finalTarget: TargetAllocation;
}

const toFloat = (x: bigint): number => Number(x) / 1e18;

export function runBacktest(params: BacktestParams): BacktestResult {
  const { model, strategy, trancheCount, totalPowerWad, cooldownSec, epsilonWad, cadenceSec } = params;
  if (trancheCount < 1) throw new Error("trancheCount must be ≥ 1");

  // Staggered tranches: equal power, cooldown phases spread across the window
  // so some sleeve is always (eventually) unlocked.
  const per = totalPowerWad / BigInt(trancheCount);
  let tranches: TrancheView[] = Array.from({ length: trancheCount }, (_, i) => ({
    id: i,
    powerWad: i === trancheCount - 1 ? totalPowerWad - per * BigInt(trancheCount - 1) : per,
    lastActionAt: model.timeAt(0) - cooldownSec + (cooldownSec * BigInt(i)) / BigInt(trancheCount),
    weights: new Map(),
  }));

  let cumOurs = 0n;
  let cumBench = 0n;
  let emitted = 0n;
  let burned = 0n;
  let turnoverWad = 0n;
  let rotations = 0;
  let onTargetSteps = 0;
  let target: TargetAllocation = { pools: [], weightsWad: [] };
  let lastDecision = -1n;

  const series: EquityPoint[] = [];
  const allocations: AllocationSample[] = [];
  let maxExcess = 0n;
  let maxDrawdown = 0n;

  const sampleEvery = Math.max(1, Math.floor(model.numSteps / 400));

  for (let k = 0; k < model.numSteps; k++) {
    const now = model.timeAt(k);
    const portfolio: Portfolio = { tranches, totalPowerWad };

    // Consult the strategy on its cadence (always at k=0).
    if (lastDecision < 0n || now - lastDecision >= cadenceSec) {
      target = strategy.propose(model.marketState(k), portfolio);
      lastDecision = now;
    }

    // Converge unlocked tranches toward the target.
    if (target.pools.length > 0) {
      const targetVec = allocationToVector(target);
      const plan = planRotations(tranches, now, cooldownSec, target, epsilonWad);
      for (const action of plan.actions) {
        const t = tranches[action.trancheId]!;
        const dist = allocationDistanceWad(t.weights, targetVec);
        turnoverWad += (dist * t.powerWad) / WAD;
        rotations++;
      }
      tranches = plan.next;
    }

    // On-target tracking.
    if (target.pools.length > 0) {
      const agg = new Map<string, bigint>();
      for (const t of tranches) {
        for (const [pool, frac] of t.weights) {
          agg.set(pool, (agg.get(pool) ?? 0n) + (t.powerWad * frac) / WAD);
        }
      }
      const aggFrac = new Map<string, bigint>();
      for (const [pool, w] of agg) aggFrac.set(pool, (w * WAD) / totalPowerWad);
      if (allocationDistanceWad(aggFrac, allocationToVector(target)) <= epsilonWad) onTargetSteps++;
    }

    const res = model.step(k, { tranches, totalPowerWad });
    cumOurs += res.revenueWad;
    cumBench += res.benchmarkRevenueWad;
    emitted += res.emittedWad;
    burned += res.burnedWad;

    const excess = cumOurs - cumBench;
    if (excess > maxExcess) maxExcess = excess;
    if (maxExcess - excess > maxDrawdown) maxDrawdown = maxExcess - excess;

    if (k % sampleEvery === 0 || k === model.numSteps - 1) {
      series.push({
        t: Number(now),
        ours: toFloat((cumOurs * WAD) / totalPowerWad),
        benchmark: toFloat((cumBench * WAD) / totalPowerWad),
      });
      const weights: Record<string, number> = {};
      for (const t of tranches) {
        for (const [pool, frac] of t.weights) {
          weights[pool] = (weights[pool] ?? 0) + toFloat((t.powerWad * frac) / totalPowerWad);
        }
      }
      allocations.push({ t: Number(now), weights });
    }
  }

  const metrics: BacktestMetrics = {
    totalReturn: toFloat((cumOurs * WAD) / totalPowerWad),
    benchmarkReturn: toFloat((cumBench * WAD) / totalPowerWad),
    excessReturn: toFloat(((cumOurs - cumBench) * WAD) / totalPowerWad),
    maxDrawdownVsBenchmark: toFloat((maxDrawdown * WAD) / totalPowerWad),
    turnover: toFloat((turnoverWad * WAD) / totalPowerWad),
    onTargetPct: model.numSteps > 0 ? onTargetSteps / model.numSteps : 0,
    emissionsAccuracy: emitted + burned > 0n ? Number((emitted * 10_000n) / (emitted + burned)) / 10_000 : null,
    rotations,
  };

  return { series, allocations, metrics, finalTarget: target };
}
