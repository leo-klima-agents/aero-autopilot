import { describe, expect, it } from "vitest";
import { WAD, sum } from "../src/math/fixed.js";
import { normalizeToWad, strategyRef, canonicalJson } from "../src/strategies/base.js";
import { createStrategy, STRATEGY_DESCRIPTORS } from "../src/strategies/index.js";
import type { MarketState, Portfolio, PoolWindow } from "../src/types.js";

const pool = (id: string, rev: bigint, ext: bigint, vol = 0n): PoolWindow => ({
  pool: id,
  trailingRevenueWad: rev,
  revenueVolWad: vol,
  externalWeightWad: ext,
  trailingEmissionsWad: 0n,
});

const portfolio: Portfolio = {
  tranches: [{ id: 0, powerWad: 1000n * WAD, lastActionAt: 0n, weights: new Map() }],
  totalPowerWad: 1000n * WAD,
};

const state: MarketState = {
  now: 0n,
  pools: [
    pool("a", 500n * WAD, 5000n * WAD),
    pool("b", 300n * WAD, 1000n * WAD),
    pool("c", 10n * WAD, 100n * WAD),
    pool("d", 0n, 100n * WAD),
  ],
};

describe("normalizeToWad", () => {
  it("sums to exactly WAD and drops zeros", () => {
    const t = normalizeToWad(["a", "b", "c"], [1n, 1n, 1n]);
    expect(sum([...t.weightsWad])).toBe(WAD);
    const t2 = normalizeToWad(["a", "b"], [3n, 0n]);
    expect(t2.pools).toEqual(["a"]);
    expect(t2.weightsWad).toEqual([WAD]);
  });
});

describe("strategyRef", () => {
  it("is a stable keccak of canonical config JSON", () => {
    const cfg = { kind: "fixed-grid", cadenceSec: "604800", topN: 8 };
    const shuffled = { topN: 8, cadenceSec: "604800", kind: "fixed-grid" };
    expect(canonicalJson(cfg)).toBe(canonicalJson(shuffled));
    expect(strategyRef(cfg)).toBe(strategyRef(shuffled as never));
    expect(strategyRef(cfg)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("strategy suite", () => {
  it("every descriptor constructs and proposes a valid target", () => {
    for (const d of STRATEGY_DESCRIPTORS) {
      const s = createStrategy(d.defaults);
      const t = s.propose(state, portfolio);
      if (t.pools.length > 0) {
        expect(sum([...t.weightsWad])).toBe(WAD);
        expect(new Set(t.pools).size).toBe(t.pools.length);
      }
    }
  });

  it("fixed-grid weights follow trailing revenue and skip zero-revenue pools", () => {
    const s = createStrategy({ kind: "fixed-grid", cadenceSec: "604800", topN: 3 });
    const t = s.propose(state, portfolio);
    expect(t.pools).toContain("a");
    expect(t.pools).not.toContain("d");
    const wa = t.weightsWad[t.pools.indexOf("a")]!;
    const wb = t.weightsWad[t.pools.indexOf("b")]!;
    expect(wa > wb).toBe(true);
  });

  it("water-filling shifts weight toward under-voted revenue", () => {
    const s = createStrategy({ kind: "water-filling", cadenceSec: "86400", topN: 4, waterfillSteps: 200 });
    const t = s.propose(state, portfolio);
    // pool b has 60% of a's revenue but 1/5th the crowd → better marginal yield.
    const wa = t.weightsWad[t.pools.indexOf("a")] ?? 0n;
    const wb = t.weightsWad[t.pools.indexOf("b")]!;
    expect(wb > wa).toBe(true);
  });

  it("persistence-carry haircuts volatile revenue", () => {
    const cfg = {
      kind: "persistence-carry",
      cadenceSec: "172800",
      topN: 4,
      lambdaWad: WAD.toString(),
      moveThresholdWad: "0",
      waterfillSteps: 200,
    };
    const calm = createStrategy(cfg);
    const volatileState: MarketState = {
      now: 0n,
      pools: [
        pool("steady", 300n * WAD, 1000n * WAD, 0n),
        pool("choppy", 300n * WAD, 1000n * WAD, 290n * WAD), // vol ≈ revenue → heavy haircut
      ],
    };
    const t = calm.propose(volatileState, portfolio);
    const ws = t.weightsWad[t.pools.indexOf("steady")]!;
    const wc = t.weightsWad[t.pools.indexOf("choppy")] ?? 0n;
    expect(ws > wc).toBe(true);
  });

  it("persistence-carry (s,S) band holds the previous target for small drifts", () => {
    const s = createStrategy({
      kind: "persistence-carry",
      cadenceSec: "172800",
      topN: 4,
      lambdaWad: "0",
      moveThresholdWad: (2n * 10n ** 17n).toString(), // 20% band
      waterfillSteps: 100,
    });
    const t1 = s.propose(state, portfolio);
    // Small revenue drift → same target object held.
    const drifted: MarketState = {
      now: 1n,
      pools: state.pools.map((p) => ({ ...p, trailingRevenueWad: (p.trailingRevenueWad * 102n) / 100n })),
    };
    const t2 = s.propose(drifted, portfolio);
    expect(t2).toBe(t1);
  });

  it("continuous-greedy holds current book when the gap is under the hurdle", () => {
    const s = createStrategy({
      kind: "continuous-greedy",
      cadenceSec: "2",
      topN: 4,
      gapThresholdWad: WAD.toString(), // impossible hurdle
      costWad: "0",
      waterfillSteps: 50,
    });
    const held: Portfolio = {
      tranches: [{ id: 0, powerWad: 1000n * WAD, lastActionAt: 0n, weights: new Map([["c", WAD]]) }],
      totalPowerWad: 1000n * WAD,
    };
    const t = s.propose(state, held);
    expect(t.pools).toEqual(["c"]);
  });
});
