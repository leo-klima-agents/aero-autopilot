/**
 * Differential fixture generators (P2): TypeScript generates bigint-exact
 * vectors; the Foundry harness (contracts/test/differential) replays them
 * through the Solidity twins and asserts exact equality. TS generates,
 * Solidity verifies.
 *
 * Values are emitted as decimal strings (JSON numbers can't carry uint256).
 * Domains are chosen to exercise rounding pivots and stay inside the bounds
 * the Solidity twins assume (≤1e36 for water-filling inputs).
 */
import { WAD } from "../math/fixed.js";
import { Prng } from "../model/prng.js";
import { cooldownRemaining, canAct } from "../scheduler/cooldown.js";
import { allocationDistanceWad } from "../scheduler/scheduler.js";
import { applyCap } from "../model/gaugecap.js";
import { newProRataState, setRate, setWeight, claim, earned } from "../model/prorata.js";
import { waterfill } from "../strategies/waterfill.js";

const s = (x: bigint): string => x.toString();

/** Random bigint in [0, maxExp10^…], biased toward interesting scales. */
function randWad(prng: Prng, maxPow10: number): bigint {
  const pow = prng.nextBelow(maxPow10 + 1);
  const mantissa = BigInt(prng.nextU32());
  return (mantissa * 10n ** BigInt(pow)) / 4_294_967_296n + BigInt(prng.nextBelow(1000));
}

export function genCooldownFixture() {
  const prng = new Prng(101);
  const lastActionAt: string[] = [];
  const cooldownSec: string[] = [];
  const now: string[] = [];
  const expectedRemaining: string[] = [];
  const expectedCanAct: string[] = [];

  const push = (l: bigint, c: bigint, n: bigint) => {
    lastActionAt.push(s(l));
    cooldownSec.push(s(c));
    now.push(s(n));
    expectedRemaining.push(s(cooldownRemaining(l, c, n)));
    expectedCanAct.push(canAct(l, c, n) ? "1" : "0");
  };

  // Edges: zero cooldown, exact boundary, one-off boundary, far past/future.
  push(0n, 0n, 0n);
  push(1_000n, 100n, 1_100n);
  push(1_000n, 100n, 1_099n);
  push(1_000n, 100n, 1_101n);
  push(1_000n, 0n, 999n);
  push(0n, 604_800n, 302_400n);
  for (let i = 0; i < 200; i++) {
    const l = BigInt(prng.nextU32());
    const c = BigInt(prng.nextBelow(1_000_000));
    const n = l + BigInt(prng.nextBelow(2_000_000));
    push(l, c, n);
  }
  return { count: lastActionAt.length, lastActionAt, cooldownSec, now, expectedRemaining, expectedCanAct };
}

export function genCapsFixture() {
  const prng = new Prng(202);
  const scheduled: string[] = [];
  const trailingRevenue: string[] = [];
  const kappa: string[] = [];
  const expectedEmitted: string[] = [];
  const expectedBurned: string[] = [];

  const push = (sch: bigint, rev: bigint, k: bigint) => {
    const r = applyCap(sch, rev, k);
    scheduled.push(s(sch));
    trailingRevenue.push(s(rev));
    kappa.push(s(k));
    expectedEmitted.push(s(r.emittedWad));
    expectedBurned.push(s(r.burnedWad));
  };

  push(0n, 0n, WAD);
  push(WAD, 0n, WAD); // zero revenue → everything burned
  push(WAD, WAD, 12n * 10n ** 17n); // scheduled below cap
  push(2n * WAD, WAD, 12n * 10n ** 17n); // cap binds at 1.2
  push(12n * 10n ** 17n, WAD, 12n * 10n ** 17n); // exactly at cap
  push(12n * 10n ** 17n + 1n, WAD, 12n * 10n ** 17n); // one wei over
  for (let i = 0; i < 200; i++) {
    push(randWad(prng, 27), randWad(prng, 27), randWad(prng, 19));
  }
  return { count: scheduled.length, scheduled, trailingRevenue, kappa, expectedEmitted, expectedBurned };
}

export function genDistanceFixture() {
  const prng = new Prng(303);
  const cases: { weightsA: string[]; weightsB: string[]; expectedDistance: string }[] = [];

  const push = (a: bigint[], b: bigint[]) => {
    const va = new Map(a.map((x, i) => [`p${i}`, x]));
    const vb = new Map(b.map((x, i) => [`p${i}`, x]));
    cases.push({
      weightsA: a.map(s),
      weightsB: b.map(s),
      expectedDistance: s(allocationDistanceWad(va, vb)),
    });
  };

  push([], []);
  push([WAD], [WAD]);
  push([WAD], [0n]);
  push([WAD / 2n, WAD / 2n], [WAD / 2n, WAD / 2n]);
  push([WAD / 2n, WAD / 2n], [0n, WAD]);
  push([WAD / 3n, WAD / 3n, WAD - 2n * (WAD / 3n)], [WAD, 0n, 0n]);
  for (let i = 0; i < 100; i++) {
    const n = 1 + prng.nextBelow(8);
    const mk = () => {
      const raw = Array.from({ length: n }, () => BigInt(prng.nextU32()) + 1n);
      const tot = raw.reduce((x, y) => x + y, 0n);
      const w = raw.map((x) => (x * WAD) / tot);
      w[0] = w[0]! + (WAD - w.reduce((x, y) => x + y, 0n));
      return w;
    };
    push(mk(), mk());
  }
  return { count: cases.length, cases };
}

export function genWaterfillFixture() {
  const prng = new Prng(404);
  const cases: {
    revenuesWad: string[];
    externalWeightsWad: string[];
    budgetWad: string;
    steps: string;
    expectedAlloc: string[];
  }[] = [];

  const push = (rev: bigint[], ext: bigint[], budget: bigint, steps: number) => {
    const alloc = waterfill({ revenuesWad: rev, externalWeightsWad: ext, budgetWad: budget, steps });
    cases.push({
      revenuesWad: rev.map(s),
      externalWeightsWad: ext.map(s),
      budgetWad: s(budget),
      steps: String(steps),
      expectedAlloc: alloc.map(s),
    });
  };

  // Edges: single pool, zero budget, zero external weight, dominant pool, remainder chunk.
  push([WAD], [WAD], 100n * WAD, 10);
  push([WAD, WAD], [WAD, WAD], 0n, 10);
  push([WAD, WAD], [0n, WAD], 10n * WAD, 7);
  push([1000n * WAD, WAD], [WAD, WAD], 10n * WAD, 13);
  push([WAD, WAD, WAD], [WAD, 2n * WAD, 3n * WAD], 100n * WAD + 3n, 9); // non-divisible budget
  for (let i = 0; i < 60; i++) {
    const n = 1 + prng.nextBelow(6);
    const rev = Array.from({ length: n }, () => randWad(prng, 24) + 1n);
    const ext = Array.from({ length: n }, () => randWad(prng, 24));
    const budget = randWad(prng, 24) + 1n;
    push(rev, ext, budget, 5 + prng.nextBelow(45));
  }
  return { count: cases.length, cases };
}

/** Pro-rata op kinds (must match ProRataDiff.t.sol): 0 setRate, 1 setWeight, 2 claim. */
export function genProRataFixture() {
  const prng = new Prng(505);
  const cases: {
    opKind: string[];
    opNow: string[];
    opA: string[]; // setRate: rate | setWeight: positionId | claim: positionId
    opB: string[]; // setWeight: weight | otherwise 0
    opExpect: string[]; // claim: expected claimed amount | otherwise 0
    finalNow: string;
    expectedAccPerWeight: string;
    expectedTotalWeight: string;
    expectedUnallocated: string;
    expectedEarnedFinal: string[]; // positions 0,1,2 at finalNow
  }[] = [];

  const build = (script: (push: (kind: number, now: bigint, a: bigint, b: bigint) => void) => bigint) => {
    const st = newProRataState(0n);
    const opKind: string[] = [];
    const opNow: string[] = [];
    const opA: string[] = [];
    const opB: string[] = [];
    const opExpect: string[] = [];
    const push = (kind: number, now: bigint, a: bigint, b: bigint) => {
      let expect = 0n;
      if (kind === 0) setRate(st, now, a);
      else if (kind === 1) setWeight(st, now, a.toString(), b);
      else expect = claim(st, now, a.toString());
      opKind.push(String(kind));
      opNow.push(s(now));
      opA.push(s(a));
      opB.push(s(b));
      opExpect.push(s(expect));
    };
    const finalNow = script(push);
    cases.push({
      opKind,
      opNow,
      opA,
      opB,
      opExpect,
      finalNow: s(finalNow),
      expectedAccPerWeight: s(st.accPerWeightWad),
      expectedTotalWeight: s(st.totalWeightWad),
      expectedUnallocated: s(st.unallocatedWad),
      expectedEarnedFinal: [0, 1, 2].map((id) => s(earned(st, finalNow, String(id)))),
    });
  };

  // Case: simple stream to a single position.
  build((push) => {
    push(0, 0n, WAD, 0n); // 1 wad/s
    push(1, 0n, 0n, 10n * WAD);
    return 100n;
  });
  // Case: revenue while nobody is allocated goes to unallocated.
  build((push) => {
    push(0, 0n, 5n * WAD, 0n);
    push(1, 50n, 0n, WAD);
    return 100n;
  });
  // Case: two positions joining at different times, one claims mid-stream.
  build((push) => {
    push(0, 0n, 3n * WAD, 0n);
    push(1, 0n, 0n, WAD);
    push(1, 100n, 1n, 3n * WAD);
    push(2, 200n, 0n, 0n); // claim position 0
    push(1, 250n, 0n, 0n); // position 0 exits
    return 400n;
  });
  // Randomized scripts.
  for (let i = 0; i < 40; i++) {
    build((push) => {
      let now = 0n;
      const nOps = 4 + prng.nextBelow(12);
      for (let k = 0; k < nOps; k++) {
        now += BigInt(prng.nextBelow(1000));
        const kind = prng.nextBelow(3);
        if (kind === 0) push(0, now, randWad(prng, 18), 0n);
        else if (kind === 1) push(1, now, BigInt(prng.nextBelow(3)), randWad(prng, 21));
        else push(2, now, BigInt(prng.nextBelow(3)), 0n);
      }
      return now + BigInt(prng.nextBelow(1000));
    });
  }
  return { count: cases.length, cases };
}
