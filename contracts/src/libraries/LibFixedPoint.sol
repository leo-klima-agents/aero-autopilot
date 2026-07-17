// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LibFixedPoint — 1e18 fixed-point ("wad") helpers
/// @notice TypeScript twin: packages/core/src/math/fixed.ts. The differential
/// suite (P2) asserts exact equality on generated vectors, so every rounding
/// site here must floor exactly like the TS side.
library LibFixedPoint {
    uint256 internal constant WAD = 1e18;

    /// @dev floor(a·b/d) with 512-bit intermediate precision (OZ Math.mulDiv).
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return Math.mulDiv(a, b, d);
    }

    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.mulDiv(a, b, WAD);
    }

    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.mulDiv(a, WAD, b);
    }

    /// @dev a - b floored at zero.
    function saturatingSub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }
}
