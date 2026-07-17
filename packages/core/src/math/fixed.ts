/**
 * 1e18 fixed-point ("wad") bigint arithmetic whose semantics match Solidity
 * exactly: floor division, revert-on-overflow (uint256 range checks), no
 * floating point anywhere.
 *
 * Every function in this file is fixture-relevant (P2): the Solidity twin
 * lives in contracts/src/libraries/LibFixedPoint.sol and the differential
 * suite asserts exact equality on generated vectors. Floats are allowed in
 * analytics/plotting only — never here.
 */

export const WAD = 10n ** 18n;
export const UINT256_MAX = (1n << 256n) - 1n;

/** Mirrors a Solidity uint256 overflow revert. */
export class Uint256OverflowError extends Error {
  constructor(op: string) {
    super(`uint256 overflow in ${op}`);
  }
}

export class DivByZeroError extends Error {
  constructor() {
    super("division by zero");
  }
}

export function checkUint256(x: bigint, op = "value"): bigint {
  if (x < 0n || x > UINT256_MAX) throw new Uint256OverflowError(op);
  return x;
}

/**
 * floor(a * b / d) with 512-bit intermediate precision — the exact semantics
 * of OpenZeppelin Math.mulDiv. TS bigints are arbitrary precision so the
 * intermediate product is naturally exact; we enforce that the *result* fits
 * uint256, as OZ does.
 */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  checkUint256(a, "mulDiv.a");
  checkUint256(b, "mulDiv.b");
  if (d === 0n) throw new DivByZeroError();
  checkUint256(d, "mulDiv.d");
  return checkUint256((a * b) / d, "mulDiv.result");
}

/** wad * wad → wad, floor. */
export function wadMul(a: bigint, b: bigint): bigint {
  return mulDiv(a, b, WAD);
}

/** wad / wad → wad, floor. */
export function wadDiv(a: bigint, b: bigint): bigint {
  return mulDiv(a, WAD, b);
}

/** a - b, floored at zero — Solidity `a > b ? a - b : 0`. */
export function saturatingSub(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function clamp(x: bigint, lo: bigint, hi: bigint): bigint {
  return min(max(x, lo), hi);
}

/** Integer square root, floor (Newton's method) — matches OZ Math.sqrt. */
export function isqrt(x: bigint): bigint {
  checkUint256(x, "isqrt");
  if (x < 2n) return x;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/** Sum of a bigint array (checked). */
export function sum(xs: readonly bigint[]): bigint {
  let acc = 0n;
  for (const x of xs) acc = checkUint256(acc + x, "sum");
  return acc;
}
