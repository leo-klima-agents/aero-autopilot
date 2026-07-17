/**
 * ContinuousModel — parameterized Aero v3 semantics derived from the
 * dromos-labs/metadex-specs idea drafts (P8: everything here is a parameter,
 * not a fact):
 *   - revenue streams to allocators pro-rata by weight, per second;
 *   - per-position cooldown gates reallocation (enforced by the scheduler);
 *   - emissions follow allocation weight, capped at κ × trailing revenue,
 *     overage burned;
 *   - the crowd (external weight) is a model: static, reactive-with-lag, or
 *     adversarial wash-bait (a bait pool advertises revenue that collapses).
 *
 * Rates are regenerated deterministically from the scenario seed, so a URL
 * carrying {scenario, seed} reproduces a run exactly.
 */
import { WAD, mulDiv, sum } from "../math/fixed.js";
import type { MarketState, Portfolio, PoolWindow } from "../types.js";
import { Prng } from "./prng.js";
import type { ContinuousScenarioConfig, ProtocolModel, StepResult } from "./types.js";

export class ContinuousModel implements ProtocolModel {
  readonly kind = "continuous" as const;
  readonly stepSec: bigint;
  readonly numSteps: number;
  readonly config: ContinuousScenarioConfig;

  private readonly pools: string[];
  /** Advertised revenue rate per [step][pool] (what trailing stats show), wad/sec. */
  private readonly advertisedRate: bigint[][];
  /** Realized revenue rate per [step][pool] (what allocators actually earn), wad/sec. */
  private readonly realizedRate: bigint[][];
  /** Crowd weight per pool, mutated as the crowd model reacts. */
  private extWeight: bigint[];
  private readonly window: number;

  constructor(config: ContinuousScenarioConfig) {
    this.config = config;
    this.stepSec = BigInt(config.stepSec);
    this.numSteps = config.numSteps;
    this.pools = config.pools.map((p) => p.id);
    this.extWeight = config.pools.map((p) => BigInt(p.externalWeightWad));
    this.window = config.trailingWindowSteps;

    const prng = new Prng(config.seed);
    this.advertisedRate = [];
    this.realizedRate = [];
    // Per-pool regime state for the 'regime' process.
    const regimeHigh: boolean[] = config.pools.map(() => false);
    for (let k = 0; k < config.numSteps; k++) {
      const adv: bigint[] = [];
      const real: bigint[] = [];
      config.pools.forEach((p, i) => {
        const proc = p.process;
        switch (proc.kind) {
          case "persistent": {
            const r = prng.jitter(BigInt(proc.baseRateWad), proc.volPct);
            adv.push(r);
            real.push(r);
            break;
          }
          case "bursty": {
            const base = BigInt(proc.baseRateWad);
            const r = prng.bernoulliPpm(Math.floor(proc.burstProb * 1_000_000))
              ? base * BigInt(proc.burstMult)
              : base;
            adv.push(r);
            real.push(r);
            break;
          }
          case "regime": {
            if (prng.bernoulliPpm(Math.floor(proc.switchProb * 1_000_000))) {
              regimeHigh[i] = !regimeHigh[i];
            }
            const r = regimeHigh[i] ? BigInt(proc.rateBWad) : BigInt(proc.rateAWad);
            adv.push(r);
            real.push(r);
            break;
          }
          case "washbait": {
            // Wash volume advertises revenue; allocators realize none of it,
            // and the advertisement disappears entirely at collapseStep.
            // Wash prints are spiky by nature: alternate 2×/0 around the same
            // mean, so dispersion-aware strategies can smell it.
            const base = BigInt(proc.advertisedRateWad);
            const advertised = k < proc.collapseStep ? (k % 2 === 0 ? base * 2n : 0n) : 0n;
            adv.push(advertised);
            real.push(0n);
            break;
          }
        }
      });
      this.advertisedRate.push(adv);
      this.realizedRate.push(real);
    }
  }

  timeAt(k: number): bigint {
    return BigInt(k) * this.stepSec;
  }

  poolIds(): readonly string[] {
    return this.pools;
  }

  private trailingAdvertised(k: number, i: number): bigint {
    let acc = 0n;
    for (let e = Math.max(0, k - this.window); e < k; e++) {
      acc += this.advertisedRate[e]![i]! * this.stepSec;
    }
    return acc;
  }

  marketState(k: number): MarketState {
    const windows: PoolWindow[] = this.pools.map((pool, i) => {
      const trailing = this.trailingAdvertised(k, i);
      const steps = Math.min(this.window, Math.max(k, 1));
      const mean = trailing / BigInt(steps);
      // Total dispersion over the window (Σ|r−mean|), same scale as
      // trailingRevenueWad so vol/revenue is a clean [0,2] dispersion ratio.
      let mad = 0n;
      for (let e = Math.max(0, k - this.window); e < k; e++) {
        const r = this.advertisedRate[e]![i]! * this.stepSec;
        mad += r > mean ? r - mean : mean - r;
      }
      return {
        pool,
        trailingRevenueWad: trailing,
        revenueVolWad: mad,
        externalWeightWad: this.extWeight[i]!,
        trailingEmissionsWad: 0n,
      };
    });
    return { now: this.timeAt(k), pools: windows };
  }

  step(k: number, portfolio: Portfolio): StepResult {
    // Our per-pool weight.
    const ours = new Map<string, bigint>();
    for (const t of portfolio.tranches) {
      for (const [pool, frac] of t.weights) {
        ours.set(pool, (ours.get(pool) ?? 0n) + mulDiv(t.powerWad, frac, WAD));
      }
    }

    let revenueWad = 0n;
    let emittedWad = 0n;
    let burnedWad = 0n;
    const kappa = BigInt(this.config.kappaWad);
    const emissionsThisStep = BigInt(this.config.emissionsPerSecWad) * this.stepSec;

    const totalOurs = sum(this.pools.map((p) => ours.get(p) ?? 0n));
    const totalExt = sum(this.extWeight);
    const totalWeight = totalOurs + totalExt;

    for (let i = 0; i < this.pools.length; i++) {
      const w = ours.get(this.pools[i]!) ?? 0n;
      const ext = this.extWeight[i]!;
      const realized = this.realizedRate[k]![i]! * this.stepSec;
      if (w + ext > 0n && w > 0n) {
        revenueWad += mulDiv(realized, w, ext + w);
      }
      // Emissions follow total allocation weight; cap at κ × trailing *realized* revenue.
      if (totalWeight > 0n) {
        const scheduled = mulDiv(emissionsThisStep, w + ext, totalWeight);
        let trailingRealized = 0n;
        for (let e = Math.max(0, k - this.window); e < k; e++) {
          trailingRealized += this.realizedRate[e]![i]! * this.stepSec;
        }
        const cap = mulDiv(trailingRealized, kappa, WAD);
        const emitted = scheduled < cap ? scheduled : cap;
        emittedWad += emitted;
        burnedWad += scheduled - emitted;
      }
    }

    const totalRealized = sum(this.realizedRate[k]!.map((r) => r * this.stepSec));
    const benchmarkRevenueWad =
      totalWeight > 0n ? mulDiv(totalRealized, portfolio.totalPowerWad, totalWeight) : 0n;

    this.stepCrowd(k);
    return { revenueWad, benchmarkRevenueWad, emittedWad, burnedWad };
  }

  /** Crowd reaction after step k. */
  private stepCrowd(k: number): void {
    const crowd = this.config.crowd;
    if (crowd.kind === "static") return;
    const lagK = k - crowd.lagSteps;
    if (lagK < 0) return;
    // Crowd target ∝ advertised revenue rate observed lagSteps ago.
    const lagged = this.advertisedRate[lagK]!;
    const totalLagged = sum(lagged);
    if (totalLagged === 0n) return;
    const totalCrowd = sum(this.extWeight);
    const alpha = BigInt(crowd.alphaWad);
    this.extWeight = this.extWeight.map((w, i) => {
      const target = mulDiv(totalCrowd, lagged[i]!, totalLagged);
      // w + α(target − w), exact in wad.
      const delta = target > w ? mulDiv(target - w, alpha, WAD) : -mulDiv(w - target, alpha, WAD);
      return w + delta;
    });
  }
}
