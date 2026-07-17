/**
 * Gauge Cap arithmetic: emissions to a pool are capped at κ × trailing
 * revenue; anything scheduled above the cap is burned.
 * Solidity twin: contracts/src/libraries/LibGaugeCap.sol. Differentially
 * tested (P2).
 */
import { WAD, mulDiv } from "../math/fixed.js";

export interface CapResult {
  emittedWad: bigint;
  burnedWad: bigint;
}

/**
 * @param scheduledWad   emissions scheduled for the window
 * @param trailingRevenueWad  pool revenue over the trailing window
 * @param kappaWad       cap multiple κ (wad, e.g. 1.2e18)
 */
export function applyCap(scheduledWad: bigint, trailingRevenueWad: bigint, kappaWad: bigint): CapResult {
  const cap = mulDiv(trailingRevenueWad, kappaWad, WAD);
  const emitted = scheduledWad < cap ? scheduledWad : cap;
  return { emittedWad: emitted, burnedWad: scheduledWad - emitted };
}
