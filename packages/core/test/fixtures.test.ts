import { describe, expect, it } from "vitest";
import {
  genCapsFixture,
  genCooldownFixture,
  genDistanceFixture,
  genProRataFixture,
  genWaterfillFixture,
} from "../src/fixtures/generators.js";

describe("differential fixture generators", () => {
  it("are deterministic (two runs → identical vectors)", () => {
    expect(genCooldownFixture()).toEqual(genCooldownFixture());
    expect(genCapsFixture()).toEqual(genCapsFixture());
    expect(genDistanceFixture()).toEqual(genDistanceFixture());
    expect(genWaterfillFixture()).toEqual(genWaterfillFixture());
    expect(genProRataFixture()).toEqual(genProRataFixture());
  });

  it("emit non-trivial case counts", () => {
    expect(genCooldownFixture().count).toBeGreaterThan(100);
    expect(genCapsFixture().count).toBeGreaterThan(100);
    expect(genDistanceFixture().count).toBeGreaterThan(50);
    expect(genWaterfillFixture().count).toBeGreaterThan(30);
    expect(genProRataFixture().count).toBeGreaterThan(20);
  });

  it("waterfill vectors conserve the budget", () => {
    for (const c of genWaterfillFixture().cases) {
      const total = c.expectedAlloc.reduce((acc, x) => acc + BigInt(x), 0n);
      expect(total).toBe(BigInt(c.budgetWad));
    }
  });

  it("caps vectors conserve scheduled emissions", () => {
    const f = genCapsFixture();
    for (let i = 0; i < f.count; i++) {
      expect(BigInt(f.expectedEmitted[i]!) + BigInt(f.expectedBurned[i]!)).toBe(BigInt(f.scheduled[i]!));
    }
  });
});
