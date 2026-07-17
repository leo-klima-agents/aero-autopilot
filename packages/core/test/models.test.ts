import { describe, expect, it } from "vitest";
import { WAD } from "../src/math/fixed.js";
import { EpochModel } from "../src/model/epoch.js";
import { ContinuousModel } from "../src/model/continuous.js";
import { washBaitScenario, mixedMarketScenario } from "../src/model/scenarios.js";
import { generateSyntheticEpochDataset } from "../src/data/synthetic.js";
import type { Portfolio } from "../src/types.js";

const mkPortfolio = (weights: [string, bigint][], power = 1000n * WAD): Portfolio => ({
  tranches: [{ id: 0, powerWad: power, lastActionAt: 0n, weights: new Map(weights) }],
  totalPowerWad: power,
});

describe("EpochModel", () => {
  const dataset = {
    schemaVersion: 1 as const,
    source: "synthetic:test",
    chainId: 0,
    epochSec: "604800",
    pools: ["p0", "p1"],
    epochs: [
      { start: "0", revenueWad: [(100n * WAD).toString(), (50n * WAD).toString()], externalVotesWad: [(900n * WAD).toString(), (100n * WAD).toString()], emissionsWad: ["0", "0"] },
      { start: "604800", revenueWad: [(100n * WAD).toString(), (50n * WAD).toString()], externalVotesWad: [(900n * WAD).toString(), (100n * WAD).toString()], emissionsWad: ["0", "0"] },
    ],
  };

  it("pays pro-rata against external votes", () => {
    const m = new EpochModel(dataset);
    // All our 1000 power on p1: share = 1000/(100+1000) of 50.
    const r = m.step(0, mkPortfolio([["p1", WAD]]));
    expect(r.revenueWad).toBe((50n * WAD * 1000n) / 1100n);
    // Benchmark: 150 × 1000/(1000+1000)
    expect(r.benchmarkRevenueWad).toBe((150n * WAD * 1000n) / 2000n);
  });

  it("shows only trailing data to strategies", () => {
    const m = new EpochModel(dataset);
    expect(m.marketState(0).pools[0]!.trailingRevenueWad).toBe(0n); // no history yet
    expect(m.marketState(1).pools[0]!.trailingRevenueWad).toBe(100n * WAD);
  });
});

describe("ContinuousModel", () => {
  it("wash-bait pool advertises revenue but never pays", () => {
    const m = new ContinuousModel(washBaitScenario());
    const baitIdx = m.poolIds().indexOf("pool-bait");
    expect(baitIdx).toBeGreaterThanOrEqual(0);
    // Advertised trailing revenue is visible before collapse…
    const advertised = m.marketState(24).pools[baitIdx]!.trailingRevenueWad;
    expect(advertised > 0n).toBe(true);
    // …but allocating 100% to the bait realizes nothing.
    const r = m.step(24, mkPortfolio([["pool-bait", WAD]]));
    expect(r.revenueWad).toBe(0n);
  });

  it("conserves revenue: our share never exceeds realized total", () => {
    const scenario = mixedMarketScenario();
    const m = new ContinuousModel(scenario);
    const pools = m.poolIds();
    const even = pools.map((p) => [p, WAD / BigInt(pools.length)] as [string, bigint]);
    for (let k = 0; k < 50; k++) {
      const r = m.step(k, mkPortfolio(even));
      expect(r.revenueWad <= r.benchmarkRevenueWad * BigInt(pools.length)).toBe(true);
      expect(r.emittedWad >= 0n && r.burnedWad >= 0n).toBe(true);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = new ContinuousModel(mixedMarketScenario(99));
    const b = new ContinuousModel(mixedMarketScenario(99));
    const p = mkPortfolio([["pool-blue-A", WAD]]);
    for (let k = 0; k < 20; k++) {
      const ra = a.step(k, p);
      const rb = b.step(k, p);
      expect(ra.revenueWad).toBe(rb.revenueWad);
      expect(ra.emittedWad).toBe(rb.emittedWad);
    }
  });
});

describe("synthetic epoch dataset", () => {
  it("generates schema-valid, deterministic data", () => {
    const d1 = generateSyntheticEpochDataset({ pools: 10, epochs: 12, seed: 7 });
    const d2 = generateSyntheticEpochDataset({ pools: 10, epochs: 12, seed: 7 });
    expect(d1).toEqual(d2);
    expect(d1.epochs).toHaveLength(12);
    expect(d1.pools).toHaveLength(10);
    for (const e of d1.epochs) {
      expect(e.revenueWad).toHaveLength(10);
      expect(BigInt(e.start) % 604_800n).toBe(0n);
    }
  });
});
