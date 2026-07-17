import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WAD } from "../src/math/fixed.js";
import { EpochModel } from "../src/model/epoch.js";
import { ContinuousModel } from "../src/model/continuous.js";
import { SCENARIOS } from "../src/model/scenarios.js";
import { generateSyntheticEpochDataset } from "../src/data/synthetic.js";
import { createStrategy } from "../src/strategies/index.js";
import { runBacktest, type BacktestMetrics } from "../src/backtest/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "golden");

/**
 * Golden snapshots (plan §6): every strategy ships a golden backtest asserted
 * in CI so refactors that change results fail loudly.
 * Regenerate deliberately with UPDATE_GOLDEN=1 pnpm test.
 */
function assertGolden(name: string, metrics: BacktestMetrics): void {
  mkdirSync(goldenDir, { recursive: true });
  const path = join(goldenDir, `${name}.json`);
  const serialized = JSON.stringify(metrics, null, 1);
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(path)) {
    writeFileSync(path, serialized + "\n");
    return;
  }
  expect(JSON.parse(serialized)).toEqual(JSON.parse(readFileSync(path, "utf8")));
}

const WEEK = 604_800n;

describe("backtest runner", () => {
  it("weekly grid on synthetic epochs beats holding nothing and respects the one-vote-per-epoch grid", () => {
    const dataset = generateSyntheticEpochDataset({ pools: 20, epochs: 26, seed: 42 });
    const model = new EpochModel(dataset);
    const res = runBacktest({
      model,
      strategy: createStrategy({ kind: "fixed-grid", cadenceSec: WEEK.toString(), topN: 8 }),
      trancheCount: 4,
      totalPowerWad: 1_000_000n * WAD,
      cooldownSec: WEEK,
      epsilonWad: 10n ** 16n,
      cadenceSec: WEEK,
    });
    expect(res.metrics.totalReturn).toBeGreaterThan(0);
    expect(res.metrics.rotations).toBeLessThanOrEqual(26 * 4);
    expect(res.series.length).toBeGreaterThan(0);
    assertGolden("fixed-grid-weekly-synthetic", res.metrics);
  });

  it("latency race: block-cadence chasing converges toward the average (P3)", () => {
    const scenario = SCENARIOS["latency-race"]();
    const power = 500_000n * WAD;
    const run = (cooldownSec: bigint, cadenceSec: bigint, kind: string) =>
      runBacktest({
        model: new ContinuousModel(scenario),
        strategy: createStrategy(
          kind === "greedy"
            ? { kind: "continuous-greedy", cadenceSec: cadenceSec.toString(), topN: 5, gapThresholdWad: "0", costWad: "0", waterfillSteps: 60 }
            : { kind: "fixed-grid", cadenceSec: cadenceSec.toString(), topN: 5 },
        ),
        trancheCount: 4,
        totalPowerWad: power,
        cooldownSec,
        epsilonWad: 10n ** 16n,
        cadenceSec,
      });

    const blockCadence = run(600n, 600n, "greedy"); // every sim step ≈ "one block"
    // The reactive block-cadence chaser should sit near the passive benchmark:
    // excess magnitude within 25% of benchmark return.
    const rel = Math.abs(blockCadence.metrics.excessReturn) / blockCadence.metrics.benchmarkReturn;
    expect(rel).toBeLessThan(0.25);
    assertGolden("continuous-greedy-block-latency-race", blockCadence.metrics);
  });

  it("persistence-carry avoids the wash-bait trap better than the naive chaser", () => {
    const scenario = SCENARIOS["wash-bait"]();
    const power = 500_000n * WAD;
    const mk = (strategy: Parameters<typeof createStrategy>[0]) =>
      runBacktest({
        model: new ContinuousModel(scenario),
        strategy: createStrategy(strategy),
        trancheCount: 4,
        totalPowerWad: power,
        cooldownSec: 48n * 3600n,
        epsilonWad: 10n ** 16n,
        cadenceSec: 3600n,
      });
    const naive = mk({ kind: "fixed-grid", cadenceSec: "3600", topN: 3 });
    const carry = mk({
      kind: "persistence-carry",
      cadenceSec: "3600",
      topN: 3,
      lambdaWad: (2n * WAD).toString(),
      moveThresholdWad: (10n ** 17n).toString(),
      waterfillSteps: 100,
    });
    expect(carry.metrics.totalReturn).toBeGreaterThan(naive.metrics.totalReturn);
    assertGolden("wash-bait-naive", naive.metrics);
    assertGolden("wash-bait-persistence-carry", carry.metrics);
  });

  it("reports the emissions-accuracy calibration metric on the continuous model", () => {
    const res = runBacktest({
      model: new ContinuousModel(SCENARIOS["early-allocator"]()),
      strategy: createStrategy({ kind: "water-filling", cadenceSec: "86400", topN: 4, waterfillSteps: 60 }),
      trancheCount: 4,
      totalPowerWad: 200_000n * WAD,
      cooldownSec: 48n * 3600n,
      epsilonWad: 10n ** 16n,
      cadenceSec: 86_400n,
    });
    expect(res.metrics.emissionsAccuracy).not.toBeNull();
    expect(res.metrics.emissionsAccuracy!).toBeGreaterThan(0);
    expect(res.metrics.emissionsAccuracy!).toBeLessThanOrEqual(1);
    assertGolden("water-filling-early-allocator", res.metrics);
  });

  it("turnover and on-target metrics are sane", () => {
    const res = runBacktest({
      model: new ContinuousModel(SCENARIOS["mixed-market"]()),
      strategy: createStrategy({ kind: "fixed-grid", cadenceSec: "86400", topN: 5 }),
      trancheCount: 6,
      totalPowerWad: 100_000n * WAD,
      cooldownSec: 24n * 3600n,
      epsilonWad: 5n * 10n ** 16n,
      cadenceSec: 86_400n,
    });
    expect(res.metrics.onTargetPct).toBeGreaterThan(0);
    expect(res.metrics.onTargetPct).toBeLessThanOrEqual(1);
    expect(res.metrics.turnover).toBeGreaterThan(0);
    assertGolden("fixed-grid-daily-mixed-market", res.metrics);
  });
});
