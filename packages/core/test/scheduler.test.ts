import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { WAD } from "../src/math/fixed.js";
import { canAct, cooldownRemaining } from "../src/scheduler/cooldown.js";
import { allocationDistanceWad, planRotations } from "../src/scheduler/scheduler.js";
import type { TrancheView } from "../src/types.js";

const t = (id: number, lastActionAt: bigint, weights: [string, bigint][] = []): TrancheView => ({
  id,
  powerWad: 100n * WAD,
  lastActionAt,
  weights: new Map(weights),
});

describe("cooldown", () => {
  it("boundary semantics: unlocked exactly at lastActionAt + cooldown", () => {
    expect(canAct(100n, 50n, 149n)).toBe(false);
    expect(canAct(100n, 50n, 150n)).toBe(true);
    expect(cooldownRemaining(100n, 50n, 120n)).toBe(30n);
    expect(cooldownRemaining(100n, 50n, 999n)).toBe(0n);
  });

  it("property: remaining is 0 iff canAct", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 8n }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        (last, cd, now) => {
          expect(canAct(last, cd, now)).toBe(cooldownRemaining(last, cd, now) === 0n);
        },
      ),
    );
  });
});

describe("allocation distance", () => {
  it("half-L1 on known vectors", () => {
    const a = new Map([
      ["x", WAD / 2n],
      ["y", WAD / 2n],
    ]);
    const b = new Map([["y", WAD]]);
    expect(allocationDistanceWad(a, b)).toBe(WAD / 2n);
    expect(allocationDistanceWad(a, a)).toBe(0n);
    expect(allocationDistanceWad(new Map(), new Map([["x", WAD]]))).toBe(WAD / 2n);
  });
});

describe("planRotations", () => {
  const target = { pools: ["x"], weightsWad: [WAD] };

  it("rotates only unlocked, off-target tranches and stamps lastActionAt", () => {
    const tranches = [
      t(0, 0n, [["y", WAD]]), // unlocked, off target → rotate
      t(1, 90n, [["y", WAD]]), // still cooling → skip
      t(2, 0n, [["x", WAD]]), // on target → skip
    ];
    const plan = planRotations(tranches, 100n, 50n, target, 0n);
    expect(plan.actions).toEqual([{ kind: "rotate", trancheId: 0 }]);
    expect(plan.next[0]!.lastActionAt).toBe(100n);
    expect(plan.next[0]!.weights.get("x")).toBe(WAD);
    expect(plan.next[1]!.weights.get("y")).toBe(WAD);
  });

  it("epsilon band suppresses small moves", () => {
    const nearly = t(0, 0n, [
      ["x", WAD - 10n ** 16n],
      ["y", 10n ** 16n],
    ]);
    expect(planRotations([nearly], 100n, 10n, target, 10n ** 17n).actions).toHaveLength(0);
    expect(planRotations([nearly], 100n, 10n, target, 10n ** 15n).actions).toHaveLength(1);
  });

  it("property: no plan ever rotates a cooling tranche", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ last: fc.bigInt({ min: 0n, max: 1000n }), onTarget: fc.boolean() }), { maxLength: 20 }),
        fc.bigInt({ min: 0n, max: 2000n }),
        fc.bigInt({ min: 1n, max: 500n }),
        (specs, now, cd) => {
          const tranches = specs.map((sp, i) => t(i, sp.last, sp.onTarget ? [["x", WAD]] : [["y", WAD]]));
          const plan = planRotations(tranches, now, cd, target, 0n);
          for (const a of plan.actions) {
            expect(canAct(tranches[a.trancheId]!.lastActionAt, cd, now)).toBe(true);
          }
        },
      ),
    );
  });
});
