// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibFixedPoint} from "./LibFixedPoint.sol";

/// @title LibWaterFill — chunked-greedy water-filling allocator
/// @notice ε-approximate solution of max Σ wᵢRᵢ/(Wᵢ+wᵢ) s.t. Σwᵢ = B chosen
/// for exact cross-implementation determinism. TypeScript twin:
/// packages/core/src/strategies/waterfill.ts (P2). On-chain this exists as a
/// verification primitive (a future guardrail hook can score a submitted
/// target against the water-filled ideal); the keeper computes with the TS
/// twin (P1: decisions off-chain).
library LibWaterFill {
    error LengthMismatch();
    error InputOutOfDomain();
    error ZeroSteps();

    uint256 internal constant MAX_INPUT = 1e36;

    /// @dev Exact marginal gain of adding `s` to a pool: floor(R·s·W / ((W+w)(W+w+s))).
    /// W floored at 1 wei so zero-crowd pools stay comparable.
    function marginalGain(uint256 R, uint256 W, uint256 w, uint256 s) internal pure returns (uint256) {
        uint256 weff = W == 0 ? 1 : W;
        // Inputs are bounded to 1e36, so R·s ≤ 1e72 and the denominator
        // product ≤ 6e72 both fit uint256 (≈1.16e77); mulDiv carries the
        // ·W term through a 512-bit intermediate.
        return LibFixedPoint.mulDiv(R * s, weff, (weff + w) * (weff + w + s));
    }

    function fill(
        uint256[] memory revenuesWad,
        uint256[] memory extWeightsWad,
        uint256 budgetWad,
        uint256 steps
    ) internal pure returns (uint256[] memory alloc) {
        uint256 n = revenuesWad.length;
        if (extWeightsWad.length != n) revert LengthMismatch();
        if (steps == 0) revert ZeroSteps();
        for (uint256 i = 0; i < n; i++) {
            if (revenuesWad[i] > MAX_INPUT || extWeightsWad[i] > MAX_INPUT) revert InputOutOfDomain();
        }
        if (budgetWad > MAX_INPUT) revert InputOutOfDomain();

        alloc = new uint256[](n);
        if (n == 0 || budgetWad == 0) return alloc;

        uint256 chunk = budgetWad / steps;
        for (uint256 k = 0; k < steps; k++) {
            // Final chunk absorbs the remainder so Σ alloc == budget exactly.
            uint256 s = k == steps - 1 ? budgetWad - chunk * (steps - 1) : chunk;
            if (s == 0) continue;
            uint256 best;
            uint256 bestGain;
            bool haveBest;
            for (uint256 i = 0; i < n; i++) {
                uint256 g = marginalGain(revenuesWad[i], extWeightsWad[i], alloc[i], s);
                if (!haveBest || g > bestGain) {
                    haveBest = true;
                    bestGain = g;
                    best = i;
                }
            }
            alloc[best] += s;
        }
    }
}
