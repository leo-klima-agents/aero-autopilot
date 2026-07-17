import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { WAD } from "../src/math/fixed.js";
import { waterfill } from "../src/strategies/waterfill.js";
import { applyCap } from "../src/model/gaugecap.js";

describe("waterfill", () => {
  it("allocates the whole budget to a single pool", () => {
    expect(waterfill({ revenuesWad: [WAD], externalWeightsWad: [WAD], budgetWad: 42n * WAD, steps: 10 })).toEqual([
      42n * WAD,
    ]);
  });

  it("splits symmetric pools evenly (up to chunking)", () => {
    const [a, b] = waterfill({
      revenuesWad: [WAD, WAD],
      externalWeightsWad: [10n * WAD, 10n * WAD],
      budgetWad: 100n * WAD,
      steps: 100,
    });
    const diff = a! > b! ? a! - b! : b! - a!;
    expect(diff <= (100n * WAD) / 100n).toBe(true); // within one chunk
  });

  it("prefers high-revenue pools", () => {
    const [hot, cold] = waterfill({
      revenuesWad: [100n * WAD, WAD],
      externalWeightsWad: [10n * WAD, 10n * WAD],
      budgetWad: 10n * WAD,
      steps: 50,
    });
    expect(hot! > cold!).toBe(true);
  });

  it("property: allocations are non-negative and sum exactly to the budget", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            rev: fc.bigInt({ min: 1n, max: 10n ** 27n }),
            ext: fc.bigInt({ min: 0n, max: 10n ** 27n }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.bigInt({ min: 0n, max: 10n ** 27n }),
        fc.integer({ min: 1, max: 60 }),
        (pools, budget, steps) => {
          const alloc = waterfill({
            revenuesWad: pools.map((p) => p.rev),
            externalWeightsWad: pools.map((p) => p.ext),
            budgetWad: budget,
            steps,
          });
          let total = 0n;
          for (const a of alloc) {
            expect(a >= 0n).toBe(true);
            total += a;
          }
          expect(total).toBe(budget);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("rejects out-of-domain inputs", () => {
    expect(() =>
      waterfill({ revenuesWad: [10n ** 37n], externalWeightsWad: [WAD], budgetWad: WAD, steps: 5 }),
    ).toThrow(/domain/);
  });
});

describe("gauge caps", () => {
  it("burns everything above κ × trailing revenue", () => {
    const kappa = 12n * 10n ** 17n; // 1.2
    expect(applyCap(2n * WAD, WAD, kappa)).toEqual({
      emittedWad: 12n * 10n ** 17n,
      burnedWad: 8n * 10n ** 17n,
    });
    expect(applyCap(WAD, WAD, kappa)).toEqual({ emittedWad: WAD, burnedWad: 0n });
    expect(applyCap(WAD, 0n, kappa)).toEqual({ emittedWad: 0n, burnedWad: WAD });
  });

  it("property: emitted + burned == scheduled, emitted ≤ cap", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 27n }),
        fc.bigInt({ min: 0n, max: 10n ** 27n }),
        fc.bigInt({ min: 0n, max: 10n ** 19n }),
        (scheduled, rev, kappa) => {
          const { emittedWad, burnedWad } = applyCap(scheduled, rev, kappa);
          expect(emittedWad + burnedWad).toBe(scheduled);
          expect(emittedWad <= (rev * kappa) / WAD).toBe(true);
        },
      ),
    );
  });
});
