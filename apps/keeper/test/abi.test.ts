import { describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, toFunctionSelector } from "viem";
import { diamondAbi } from "../src/abi.js";

describe("keeper abi", () => {
  it("carries the diamond functions and events it depends on", () => {
    expect(diamondAbi.some((e) => e.type === "function" && e.name === "rotate")).toBe(true);
    expect(diamondAbi.some((e) => e.type === "function" && e.name === "claimable")).toBe(true);
    expect(diamondAbi.some((e) => e.type === "event" && e.name === "DiamondCut")).toBe(true);
    // Selector spot-check against facets.json (kept literal so drift is loud).
    expect(toFunctionSelector("rotate(uint256)")).toBe("0x3852f4b0");
  });

  it("claim data encodes to the shape AerodromeFacet.claimRewards decodes", () => {
    const pools = ["0x1111111111111111111111111111111111111111"] as const;
    const feeTokens = [["0x2222222222222222222222222222222222222222"]] as const;
    const bribeTokens = [[]] as const;
    const encoded = encodeAbiParameters(
      [{ type: "address[]" }, { type: "address[][]" }, { type: "address[][]" }],
      [pools as never, feeTokens as never, bribeTokens as never],
    );
    const [p, f, b] = decodeAbiParameters(
      [{ type: "address[]" }, { type: "address[][]" }, { type: "address[][]" }],
      encoded,
    );
    expect(p).toEqual([pools[0]]);
    expect(f[0]).toEqual([feeTokens[0]![0]]);
    expect(b[0]).toEqual([]);
  });
});
