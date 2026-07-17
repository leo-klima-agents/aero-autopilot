// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibFixedPoint} from "./LibFixedPoint.sol";

/// @title LibGaugeCap — Gauge Cap arithmetic
/// @notice Emissions above κ × trailing revenue are burned. TypeScript twin:
/// packages/core/src/model/gaugecap.ts (P2).
library LibGaugeCap {
    function apply_(uint256 scheduledWad, uint256 trailingRevenueWad, uint256 kappaWad)
        internal
        pure
        returns (uint256 emittedWad, uint256 burnedWad)
    {
        uint256 cap = LibFixedPoint.mulDiv(trailingRevenueWad, kappaWad, LibFixedPoint.WAD);
        emittedWad = scheduledWad < cap ? scheduledWad : cap;
        burnedWad = scheduledWad - emittedWad;
    }
}
