import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { WAD } from "../src/math/fixed.js";
import { claim, earned, newProRataState, setRate, setWeight } from "../src/model/prorata.js";

describe("pro-rata streaming accumulator", () => {
  it("streams to a single position exactly", () => {
    const s = newProRataState(0n);
    setRate(s, 0n, WAD); // 1/s
    setWeight(s, 0n, "a", 10n * WAD);
    expect(earned(s, 100n, "a")).toBe(100n * WAD);
    expect(claim(s, 100n, "a")).toBe(100n * WAD);
    expect(earned(s, 100n, "a")).toBe(0n);
  });

  it("splits pro-rata by weight", () => {
    const s = newProRataState(0n);
    setRate(s, 0n, 3n * WAD);
    setWeight(s, 0n, "a", WAD);
    setWeight(s, 0n, "b", 2n * WAD);
    expect(earned(s, 100n, "a")).toBe(100n * WAD);
    expect(earned(s, 100n, "b")).toBe(200n * WAD);
  });

  it("routes revenue to unallocated when nobody holds weight", () => {
    const s = newProRataState(0n);
    setRate(s, 0n, 5n * WAD);
    setWeight(s, 50n, "a", WAD);
    expect(s.unallocatedWad).toBe(250n * WAD);
    expect(earned(s, 100n, "a")).toBe(250n * WAD);
  });

  it("rejects time going backwards", () => {
    const s = newProRataState(100n);
    expect(() => setRate(s, 50n, WAD)).toThrow();
  });

  it("property: conservation — streamed = claimed + pending + unallocated (± rounding dust)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dt: fc.bigInt({ min: 0n, max: 10_000n }),
            op: fc.constantFrom("rate", "weight", "claim") as fc.Arbitrary<"rate" | "weight" | "claim">,
            id: fc.constantFrom("a", "b", "c"),
            value: fc.bigInt({ min: 0n, max: 10n ** 24n }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (ops) => {
          const s = newProRataState(0n);
          let now = 0n;
          let streamed = 0n;
          let claimed = 0n;
          let opCount = 0n;
          for (const o of ops) {
            // Only time with weight outstanding distributes to positions.
            if (s.totalWeightWad > 0n) streamed += s.rateWad * o.dt;
            now += o.dt;
            if (o.op === "rate") setRate(s, now, o.value);
            else if (o.op === "weight") setWeight(s, now, o.id, o.value);
            else claimed += claim(s, now, o.id);
            opCount++;
          }
          let pending = 0n;
          for (const id of ["a", "b", "c"]) pending += earned(s, now, id);
          // Every accrual step floors once against totalWeight; dust per step < totalWeight/WAD wads.
          const diff = streamed - (claimed + pending);
          expect(diff >= 0n).toBe(true);
          // Bound dust: ops × max weight rounding (1 wei per settle × weight/WAD scale).
          expect(diff <= opCount * 10n ** 7n).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
