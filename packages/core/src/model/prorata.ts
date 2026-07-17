/**
 * Pro-rata streaming revenue accumulator — the Synthetix-style
 * reward-per-weight pattern the v3 model streams revenue with.
 * Solidity twin: contracts/src/libraries/LibProRata.sol. Differentially
 * tested (P2): exact bigint equality, including every floor-rounding site.
 *
 * accPerWeight accumulates revenueRate·dt·WAD / totalWeight; a position's
 * earned revenue is weight·(accPerWeight − accPaid) / WAD, settled on every
 * weight change.
 */
import { WAD, checkUint256, mulDiv } from "../math/fixed.js";

export interface ProRataPosition {
  weightWad: bigint;
  /** accPerWeight snapshot at last settlement. */
  accPaidWad: bigint;
  /** Settled but unclaimed revenue, wad. */
  earnedWad: bigint;
}

export interface ProRataState {
  totalWeightWad: bigint;
  accPerWeightWad: bigint;
  /** Revenue per second, wad. */
  rateWad: bigint;
  lastUpdate: bigint;
  /** Revenue that accrued while totalWeight == 0 (undistributable), wad. */
  unallocatedWad: bigint;
  positions: Map<string, ProRataPosition>;
}

export function newProRataState(t0: bigint): ProRataState {
  return {
    totalWeightWad: 0n,
    accPerWeightWad: 0n,
    rateWad: 0n,
    lastUpdate: t0,
    unallocatedWad: 0n,
    positions: new Map(),
  };
}

function positionOf(s: ProRataState, id: string): ProRataPosition {
  let p = s.positions.get(id);
  if (!p) {
    p = { weightWad: 0n, accPaidWad: 0n, earnedWad: 0n };
    s.positions.set(id, p);
  }
  return p;
}

/** Advance the global accumulator to `now`. */
export function accrue(s: ProRataState, now: bigint): void {
  if (now < s.lastUpdate) throw new Error("time went backwards");
  const dt = now - s.lastUpdate;
  if (dt === 0n) return;
  const revenue = checkUint256(s.rateWad * dt, "accrue.revenue");
  if (s.totalWeightWad === 0n) {
    s.unallocatedWad += revenue;
  } else {
    s.accPerWeightWad += mulDiv(revenue, WAD, s.totalWeightWad);
  }
  s.lastUpdate = now;
}

/** Settle a position against the accumulator (no time advance). */
export function settle(s: ProRataState, id: string): void {
  const p = positionOf(s, id);
  p.earnedWad += mulDiv(p.weightWad, s.accPerWeightWad - p.accPaidWad, WAD);
  p.accPaidWad = s.accPerWeightWad;
}

export function setRate(s: ProRataState, now: bigint, rateWad: bigint): void {
  accrue(s, now);
  s.rateWad = checkUint256(rateWad, "setRate");
}

export function setWeight(s: ProRataState, now: bigint, id: string, weightWad: bigint): void {
  accrue(s, now);
  settle(s, id);
  const p = positionOf(s, id);
  s.totalWeightWad = s.totalWeightWad - p.weightWad + checkUint256(weightWad, "setWeight");
  p.weightWad = weightWad;
}

/** Earned revenue if settled at `now` (view). */
export function earned(s: ProRataState, now: bigint, id: string): bigint {
  const p = s.positions.get(id) ?? { weightWad: 0n, accPaidWad: 0n, earnedWad: 0n };
  let acc = s.accPerWeightWad;
  const dt = now - s.lastUpdate;
  if (dt > 0n && s.totalWeightWad > 0n) {
    acc += mulDiv(s.rateWad * dt, WAD, s.totalWeightWad);
  }
  return p.earnedWad + mulDiv(p.weightWad, acc - p.accPaidWad, WAD);
}

/** Claim settled revenue; returns the claimed amount. */
export function claim(s: ProRataState, now: bigint, id: string): bigint {
  accrue(s, now);
  settle(s, id);
  const p = positionOf(s, id);
  const out = p.earnedWad;
  p.earnedWad = 0n;
  return out;
}
