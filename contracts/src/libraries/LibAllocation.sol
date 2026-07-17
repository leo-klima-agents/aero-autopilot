// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title LibAllocation — allocation-vector arithmetic
/// @notice Half-L1 distance between aligned weight vectors; used by the
/// TargetsFacet max-reallocation-delta guardrail. TypeScript twin:
/// packages/core/src/scheduler/scheduler.ts allocationDistanceWad (P2).
library LibAllocation {
    error LengthMismatch();

    /// @dev Vectors are aligned by index (same pool ordering). 0 = identical,
    /// WAD = fully disjoint for WAD-normalized vectors.
    function distanceWad(uint256[] memory a, uint256[] memory b) internal pure returns (uint256) {
        if (a.length != b.length) revert LengthMismatch();
        uint256 l1;
        for (uint256 i = 0; i < a.length; i++) {
            l1 += a[i] > b[i] ? a[i] - b[i] : b[i] - a[i];
        }
        return l1 / 2;
    }
}
