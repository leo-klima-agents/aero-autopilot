import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  WAD,
  UINT256_MAX,
  mulDiv,
  wadMul,
  wadDiv,
  saturatingSub,
  isqrt,
  Uint256OverflowError,
  DivByZeroError,
} from "../src/math/fixed.js";

const uint = fc.bigInt({ min: 0n, max: UINT256_MAX });
const smallUint = fc.bigInt({ min: 0n, max: 10n ** 30n });

describe("fixed-point math (Solidity-exact)", () => {
  it("mulDiv floors like the EVM", () => {
    expect(mulDiv(7n, 3n, 2n)).toBe(10n); // 21/2 = 10.5 → 10
    expect(mulDiv(1n, 1n, 3n)).toBe(0n);
    expect(wadMul(WAD / 2n, WAD / 2n)).toBe(WAD / 4n);
    expect(wadDiv(1n, 3n)).toBe(333333333333333333n);
  });

  it("mulDiv uses full intermediate precision (no phantom overflow)", () => {
    const big = 10n ** 38n;
    expect(mulDiv(big, big, big)).toBe(big);
  });

  it("rejects division by zero and uint256 overflow of the result", () => {
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(DivByZeroError);
    expect(() => mulDiv(UINT256_MAX, 2n, 1n)).toThrow(Uint256OverflowError);
    expect(() => mulDiv(-1n, 1n, 1n)).toThrow(Uint256OverflowError);
  });

  it("saturatingSub never goes negative", () => {
    fc.assert(
      fc.property(uint, uint, (a, b) => {
        const r = saturatingSub(a, b);
        expect(r).toBe(a > b ? a - b : 0n);
        expect(r >= 0n).toBe(true);
      }),
    );
  });

  it("isqrt: floor sqrt invariant", () => {
    fc.assert(
      fc.property(smallUint, (x) => {
        const r = isqrt(x);
        expect(r * r <= x).toBe(true);
        expect((r + 1n) * (r + 1n) > x).toBe(true);
      }),
    );
  });

  it("mulDiv(a,b,d)·d + rem == a·b (division identity)", () => {
    fc.assert(
      fc.property(smallUint, smallUint, fc.bigInt({ min: 1n, max: 10n ** 30n }), (a, b, d) => {
        const q = mulDiv(a, b, d);
        const rem = a * b - q * d;
        expect(rem >= 0n && rem < d).toBe(true);
      }),
    );
  });
});
