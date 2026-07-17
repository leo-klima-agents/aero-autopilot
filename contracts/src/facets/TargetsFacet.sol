// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../libraries/LibAccess.sol";
import {LibAllocation} from "../libraries/LibAllocation.sol";
import {LibFixedPoint} from "../libraries/LibFixedPoint.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";
import {IMinFlowOracle} from "../interfaces/IMinFlowOracle.sol";

/// @title TargetsFacet — setTargets + guardrails + strategyRef (§4.1)
/// @notice Stores the strategist's allocation as a QUEUED INTENT after
/// guardrail validation. The contracts are strategy-blind (P1): exactly two
/// traces of strategy identity touch the chain — the Owner-set cooldown
/// guardrail, and the opaque strategyRef emitted (never validated) here.
/// One strategist signature drives many keeper executions, so multisig
/// latency costs signal freshness, never liveness.
contract TargetsFacet {
    event TargetsQueued(bytes32 indexed strategyRef, address[] pools, uint256[] weightsWad, uint256 deltaWad);
    event GuardrailsSet(uint256 maxPoolWeightWad, uint256 maxDeltaWad, uint64 cooldownSec);
    event PoolAllowlistSet(address indexed pool, bool allowed);
    event RewardTokenAllowlistSet(address indexed token, bool allowed);
    event MinFlowOracleSet(address indexed oracle);

    error LengthMismatch();
    error EmptyTargets();
    error DuplicatePool(address pool);
    error PoolNotAllowed(address pool);
    error WeightExceedsMax(address pool, uint256 weightWad, uint256 maxPoolWeightWad);
    error WeightsMustSumToWad(uint256 total);
    error DeltaExceedsMax(uint256 deltaWad, uint256 maxDeltaWad);
    error OracleRejectedTargets();

    /// @notice Strategist entry point: validate and queue a target allocation.
    /// @param strategyRef keccak of the off-chain strategy config — an
    /// attribution tag linking every target to the config that produced it.
    function setTargets(address[] calldata pools, uint256[] calldata weightsWad, bytes32 strategyRef)
        external
    {
        LibAccess.enforceRole(LibAccess.STRATEGIST_ROLE, msg.sender);
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();

        if (pools.length != weightsWad.length) revert LengthMismatch();
        if (pools.length == 0) revert EmptyTargets();

        uint256 total;
        for (uint256 i = 0; i < pools.length; i++) {
            if (!ts.allowedPool[pools[i]]) revert PoolNotAllowed(pools[i]);
            if (weightsWad[i] > ts.maxPoolWeightWad) {
                revert WeightExceedsMax(pools[i], weightsWad[i], ts.maxPoolWeightWad);
            }
            for (uint256 j = 0; j < i; j++) {
                if (pools[j] == pools[i]) revert DuplicatePool(pools[i]);
            }
            total += weightsWad[i];
        }
        if (total != LibFixedPoint.WAD) revert WeightsMustSumToWad(total);

        // Max-reallocation-delta guardrail: half-L1 distance between the old
        // and new targets over the union of pools.
        uint256 deltaWad = _deltaFromCurrent(ts, pools, weightsWad);
        if (ts.targetPools.length > 0 && deltaWad > ts.maxDeltaWad) {
            revert DeltaExceedsMax(deltaWad, ts.maxDeltaWad);
        }

        if (ts.minFlowOracle != address(0)) {
            if (!IMinFlowOracle(ts.minFlowOracle).checkTargets(pools, weightsWad)) {
                revert OracleRejectedTargets();
            }
        }

        ts.targetPools = pools;
        ts.targetWeightsWad = weightsWad;
        ts.strategyRef = strategyRef;
        ts.targetsUpdatedAt = uint64(block.timestamp);
        emit TargetsQueued(strategyRef, pools, weightsWad, deltaWad);
    }

    /// @dev Align old and new targets over the union of their pools, then
    /// half-L1 via LibAllocation (differentially tested, P2).
    function _deltaFromCurrent(
        LibVaultStorage.TargetsStorage storage ts,
        address[] calldata pools,
        uint256[] calldata weightsWad
    ) private view returns (uint256) {
        address[] memory oldPools = ts.targetPools;
        uint256[] memory oldWeights = ts.targetWeightsWad;

        // Union: all old pools plus any new pools not in old.
        uint256 unionLen = oldPools.length;
        for (uint256 i = 0; i < pools.length; i++) {
            bool found;
            for (uint256 j = 0; j < oldPools.length; j++) {
                if (oldPools[j] == pools[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) unionLen++;
        }

        address[] memory union_ = new address[](unionLen);
        uint256 n = oldPools.length;
        for (uint256 i = 0; i < oldPools.length; i++) {
            union_[i] = oldPools[i];
        }
        for (uint256 i = 0; i < pools.length; i++) {
            bool found;
            for (uint256 j = 0; j < oldPools.length; j++) {
                if (oldPools[j] == pools[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) union_[n++] = pools[i];
        }

        uint256[] memory a = new uint256[](unionLen);
        uint256[] memory b = new uint256[](unionLen);
        for (uint256 i = 0; i < unionLen; i++) {
            for (uint256 j = 0; j < oldPools.length; j++) {
                if (oldPools[j] == union_[i]) {
                    a[i] = oldWeights[j];
                    break;
                }
            }
            for (uint256 j = 0; j < pools.length; j++) {
                if (pools[j] == union_[i]) {
                    b[i] = weightsWad[j];
                    break;
                }
            }
        }
        return LibAllocation.distanceWad(a, b);
    }

    function currentTargets()
        external
        view
        returns (address[] memory pools, uint256[] memory weightsWad, bytes32 strategyRef, uint64 updatedAt)
    {
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        return (ts.targetPools, ts.targetWeightsWad, ts.strategyRef, ts.targetsUpdatedAt);
    }

    // ── Owner configuration ─────────────────────────────────────────────────

    /// @notice Operationally, changing cooldownSec is what "switching strategy
    /// class" means on-chain (§4.1): 7d for the v2 grid; 48h/24h/1h for v3.
    function setGuardrails(uint256 maxPoolWeightWad, uint256 maxDeltaWad, uint64 cooldownSec) external {
        LibAccess.enforceOwner();
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        ts.maxPoolWeightWad = maxPoolWeightWad;
        ts.maxDeltaWad = maxDeltaWad;
        ts.cooldownSec = cooldownSec;
        emit GuardrailsSet(maxPoolWeightWad, maxDeltaWad, cooldownSec);
    }

    function setPoolAllowlist(address[] calldata pools, bool allowed) external {
        LibAccess.enforceOwner();
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        for (uint256 i = 0; i < pools.length; i++) {
            if (allowed && !ts.allowedPool[pools[i]]) {
                ts.allowedPoolList.push(pools[i]);
            }
            ts.allowedPool[pools[i]] = allowed;
            emit PoolAllowlistSet(pools[i], allowed);
        }
    }

    function setRewardTokenAllowlist(address[] calldata tokens, bool allowed) external {
        LibAccess.enforceOwner();
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        for (uint256 i = 0; i < tokens.length; i++) {
            ts.allowedRewardToken[tokens[i]] = allowed;
            emit RewardTokenAllowlistSet(tokens[i], allowed);
        }
    }

    function setMinFlowOracle(address oracle) external {
        LibAccess.enforceOwner();
        LibVaultStorage.targets().minFlowOracle = oracle;
        emit MinFlowOracleSet(oracle);
    }

    function guardrails()
        external
        view
        returns (uint256 maxPoolWeightWad, uint256 maxDeltaWad, uint64 cooldownSec, address minFlowOracle)
    {
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        return (ts.maxPoolWeightWad, ts.maxDeltaWad, ts.cooldownSec, ts.minFlowOracle);
    }

    function isPoolAllowed(address pool) external view returns (bool) {
        return LibVaultStorage.targets().allowedPool[pool];
    }

    function isRewardTokenAllowed(address token) external view returns (bool) {
        return LibVaultStorage.targets().allowedRewardToken[token];
    }
}
