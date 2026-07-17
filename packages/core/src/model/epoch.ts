/**
 * EpochModel — Aerodrome v2 semantics: weekly flips, one vote change per
 * epoch, persistent votes, pro-rata lump-sum voter rewards at epoch end.
 *
 * Strategies see trailing statistics through the END of the previous epoch —
 * which is exactly what a late-in-epoch vote submission acts on.
 */
import { WAD, mulDiv, sum } from "../math/fixed.js";
import type { MarketState, Portfolio, PoolWindow } from "../types.js";
import type { EpochDataset, ProtocolModel, StepResult } from "./types.js";

export class EpochModel implements ProtocolModel {
  readonly kind = "epoch" as const;
  readonly stepSec: bigint;
  readonly numSteps: number;
  private readonly pools: string[];
  private readonly revenue: bigint[][]; // [epoch][pool]
  private readonly extVotes: bigint[][];
  private readonly emissions: bigint[][];
  private readonly starts: bigint[];
  private readonly lookback: number;

  constructor(dataset: EpochDataset, lookbackEpochs = 2) {
    this.stepSec = BigInt(dataset.epochSec);
    this.pools = dataset.pools;
    this.revenue = dataset.epochs.map((e) => e.revenueWad.map(BigInt));
    this.extVotes = dataset.epochs.map((e) => e.externalVotesWad.map(BigInt));
    this.emissions = dataset.epochs.map((e) => e.emissionsWad.map(BigInt));
    this.starts = dataset.epochs.map((e) => BigInt(e.start));
    this.numSteps = dataset.epochs.length;
    this.lookback = lookbackEpochs;
  }

  timeAt(k: number): bigint {
    return this.starts[k] ?? this.starts[this.starts.length - 1]! + this.stepSec;
  }

  marketState(k: number): MarketState {
    const windows: PoolWindow[] = this.pools.map((pool, i) => {
      // Trailing stats over epochs [k-lookback, k) — never the current epoch.
      let rev = 0n;
      let count = 0n;
      const perEpoch: bigint[] = [];
      for (let e = Math.max(0, k - this.lookback); e < k; e++) {
        const r = this.revenue[e]![i]!;
        rev += r;
        perEpoch.push(r);
        count++;
      }
      const mean = count > 0n ? rev / count : 0n;
      // Total dispersion over the window (Σ|r−mean|), same scale as
      // trailingRevenueWad so vol/revenue is a clean [0,2] dispersion ratio.
      let mad = 0n;
      for (const r of perEpoch) mad += r > mean ? r - mean : mean - r;
      return {
        pool,
        trailingRevenueWad: rev,
        revenueVolWad: mad,
        externalWeightWad: k > 0 ? this.extVotes[k - 1]![i]! : this.extVotes[0]![i]!,
        trailingEmissionsWad: k > 0 ? this.emissions[k - 1]![i]! : 0n,
      };
    });
    return { now: this.timeAt(k), pools: windows };
  }

  step(k: number, portfolio: Portfolio): StepResult {
    // Aggregate our per-pool weight (power × fraction).
    const ours = new Map<string, bigint>();
    for (const t of portfolio.tranches) {
      for (const [pool, frac] of t.weights) {
        ours.set(pool, (ours.get(pool) ?? 0n) + mulDiv(t.powerWad, frac, WAD));
      }
    }
    let revenueWad = 0n;
    for (let i = 0; i < this.pools.length; i++) {
      const w = ours.get(this.pools[i]!) ?? 0n;
      if (w === 0n) continue;
      const rev = this.revenue[k]![i]!;
      const ext = this.extVotes[k]![i]!;
      revenueWad += mulDiv(rev, w, ext + w);
    }
    const totalRev = sum(this.revenue[k]!);
    const totalExt = sum(this.extVotes[k]!);
    const power = portfolio.totalPowerWad;
    const benchmarkRevenueWad = totalExt + power > 0n ? mulDiv(totalRev, power, totalExt + power) : 0n;
    return { revenueWad, benchmarkRevenueWad, emittedWad: 0n, burnedWad: 0n };
  }
}
