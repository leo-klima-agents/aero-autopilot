// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IMinFlowOracle — optional organic-flow guardrail hook (stub, §4.1)
/// @notice When configured on the TargetsFacet, submitted targets must pass
/// this check; the PoC ships no implementation (wash-bait rejection is
/// exercised in the simulator instead).
interface IMinFlowOracle {
    function checkTargets(address[] calldata pools, uint256[] calldata weightsWad)
        external
        view
        returns (bool);
}
