/**
 * Cooldown arithmetic — Solidity twin: contracts/src/libraries/LibCooldown.sol.
 * Differentially tested (P2): exact bigint equality on generated vectors.
 */
import { saturatingSub } from "../math/fixed.js";

/** Seconds until the position may act again; 0 when unlocked. */
export function cooldownRemaining(lastActionAt: bigint, cooldownSec: bigint, now: bigint): bigint {
  return saturatingSub(lastActionAt + cooldownSec, now);
}

export function canAct(lastActionAt: bigint, cooldownSec: bigint, now: bigint): boolean {
  return cooldownRemaining(lastActionAt, cooldownSec, now) === 0n;
}
