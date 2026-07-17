// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibFixedPoint} from "./LibFixedPoint.sol";

/// @title LibCooldown — cooldown arithmetic
/// @notice TypeScript twin: packages/core/src/scheduler/cooldown.ts (P2).
library LibCooldown {
    /// @return Seconds until the position may act again; 0 when unlocked.
    function remaining(uint256 lastActionAt, uint256 cooldownSec, uint256 nowTs)
        internal
        pure
        returns (uint256)
    {
        return LibFixedPoint.saturatingSub(lastActionAt + cooldownSec, nowTs);
    }

    function canAct(uint256 lastActionAt, uint256 cooldownSec, uint256 nowTs) internal pure returns (bool) {
        return remaining(lastActionAt, cooldownSec, nowTs) == 0;
    }
}
