// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibFixedPoint} from "./LibFixedPoint.sol";
import {LibVaultStorage} from "./LibVaultStorage.sol";

/// @title LibProRata — per-second streaming revenue, pro-rata by weight
/// @notice The Synthetix-style reward-per-weight accumulator the v3 model
/// streams revenue with. TypeScript twin: packages/core/src/model/prorata.ts
/// (P2: every floor-rounding site matches exactly).
library LibProRata {
    error TimeWentBackwards();

    /// @dev Advance the global accumulator to `nowTs`.
    function accrue(LibVaultStorage.Stream storage s, uint64 nowTs) internal {
        if (nowTs < s.lastUpdate) revert TimeWentBackwards();
        uint256 dt = nowTs - s.lastUpdate;
        if (dt == 0) return;
        uint256 revenue = s.rateWad * dt;
        if (s.totalWeightWad == 0) {
            s.unallocatedWad += revenue;
        } else {
            s.accPerWeightWad += LibFixedPoint.mulDiv(revenue, LibFixedPoint.WAD, s.totalWeightWad);
        }
        s.lastUpdate = nowTs;
    }

    /// @dev Settle a position against the accumulator (no time advance).
    function settle(LibVaultStorage.Stream storage s, uint256 positionId) internal {
        LibVaultStorage.StreamPosition storage p = s.positions[positionId];
        p.earnedWad += LibFixedPoint.mulDiv(p.weightWad, s.accPerWeightWad - p.accPaidWad, LibFixedPoint.WAD);
        p.accPaidWad = s.accPerWeightWad;
    }

    function setRate(LibVaultStorage.Stream storage s, uint64 nowTs, uint256 rateWad) internal {
        accrue(s, nowTs);
        s.rateWad = rateWad;
    }

    function setWeight(LibVaultStorage.Stream storage s, uint64 nowTs, uint256 positionId, uint256 weightWad)
        internal
    {
        accrue(s, nowTs);
        settle(s, positionId);
        LibVaultStorage.StreamPosition storage p = s.positions[positionId];
        s.totalWeightWad = s.totalWeightWad - p.weightWad + weightWad;
        p.weightWad = weightWad;
    }

    /// @dev Earned revenue if settled at `nowTs` (view).
    function earned(LibVaultStorage.Stream storage s, uint64 nowTs, uint256 positionId)
        internal
        view
        returns (uint256)
    {
        LibVaultStorage.StreamPosition storage p = s.positions[positionId];
        uint256 acc = s.accPerWeightWad;
        uint256 dt = nowTs >= s.lastUpdate ? nowTs - s.lastUpdate : 0;
        if (dt > 0 && s.totalWeightWad > 0) {
            acc += LibFixedPoint.mulDiv(s.rateWad * dt, LibFixedPoint.WAD, s.totalWeightWad);
        }
        return p.earnedWad + LibFixedPoint.mulDiv(p.weightWad, acc - p.accPaidWad, LibFixedPoint.WAD);
    }

    /// @dev Claim settled revenue; returns the claimed amount.
    function claim(LibVaultStorage.Stream storage s, uint64 nowTs, uint256 positionId)
        internal
        returns (uint256 out)
    {
        accrue(s, nowTs);
        settle(s, positionId);
        LibVaultStorage.StreamPosition storage p = s.positions[positionId];
        out = p.earnedWad;
        p.earnedWad = 0;
    }
}
