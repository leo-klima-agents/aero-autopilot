// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../libraries/LibAccess.sol";
import {LibCooldown} from "../libraries/LibCooldown.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";
import {IProtocolFacet} from "../interfaces/IProtocolFacet.sol";

/// @title ExecutionFacet — rotate / harvest / compound (§4.1)
/// @notice Keeper-gated, mechanical, converges tranches toward the queued
/// target as cooldowns unlock. The keeper never originates a decision (P1):
/// rotate executes exactly the stored target; harvest and compound move
/// rewards along the CLAIM → SWAP → ADD path. Protocol specifics live behind
/// the IProtocolFacet self-call, so a protocol swap never touches this facet.
contract ExecutionFacet {
    event Rotated(uint256 indexed trancheId, bytes32 indexed strategyRef, uint256 positionId);
    event Harvested(uint256 indexed trancheId, uint256 positionId, uint256 aeroFromRewards, uint256 rebase);
    event Compounded(uint256 indexed trancheId, uint256 positionId, uint256 aeroLocked);

    error TrancheNotFound(uint256 trancheId);
    error TrancheInactive(uint256 trancheId);
    error TrancheCoolingDown(uint256 trancheId, uint256 remaining);
    error NoTargetsQueued();
    error Reentrancy();

    modifier nonReentrant() {
        LibVaultStorage.ReentrancyStorage storage r = LibVaultStorage.reentrancy();
        if (r.status == 2) revert Reentrancy();
        r.status = 2;
        _;
        r.status = 1;
    }

    modifier onlyKeeper() {
        LibAccess.enforceRole(LibAccess.KEEPER_ROLE, msg.sender);
        _;
    }

    function _tranche(uint256 trancheId) private view returns (LibVaultStorage.Tranche storage t) {
        t = LibVaultStorage.tranches().tranches[trancheId];
        if (t.positionId == 0) revert TrancheNotFound(trancheId);
        if (!t.active) revert TrancheInactive(trancheId);
    }

    /// @notice Re-allocate the tranche's position toward the stored target.
    /// The per-tranche cooldown guardrail is enforced here regardless of what
    /// the underlying protocol would allow (the vault can be stricter than
    /// the protocol, never looser).
    function rotate(uint256 trancheId) external onlyKeeper nonReentrant {
        LibVaultStorage.Tranche storage t = _tranche(trancheId);
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        if (ts.targetPools.length == 0) revert NoTargetsQueued();

        uint256 remaining = LibCooldown.remaining(t.lastActionAt, ts.cooldownSec, block.timestamp);
        if (remaining != 0) revert TrancheCoolingDown(trancheId, remaining);

        // Allocate replaces the previous allocation wholesale in every
        // protocol facet (v2 re-vote overwrites; an explicit reset first
        // would revert v2's one-action-per-epoch rule).
        IProtocolFacet(address(this)).allocate(t.positionId, ts.targetPools, ts.targetWeightsWad);
        t.lastActionAt = uint64(block.timestamp);
        emit Rotated(trancheId, ts.strategyRef, t.positionId);
    }

    /// @notice Claim fees/bribes/rebase for the tranche into the diamond.
    /// @param claimData protocol-specific claim plumbing, validated by the
    /// protocol facet against the pool allowlist.
    function harvest(uint256 trancheId, bytes calldata claimData) external onlyKeeper nonReentrant {
        LibVaultStorage.Tranche storage t = _tranche(trancheId);
        uint256 aeroOut = IProtocolFacet(address(this)).claimRewards(t.positionId, claimData);
        uint256 rebase = IProtocolFacet(address(this)).claimRebase(t.positionId);
        emit Harvested(trancheId, t.positionId, aeroOut, rebase);
    }

    /// @notice Swap harvested reward tokens to AERO and lock them into the
    /// tranche's position — the batched CLAIM → SWAP → ADD → STAKE flow the
    /// v3 MetaRouter spec anticipates for relay compounding (§4.1).
    /// @param swapData protocol-specific routing (v2: router routes over
    /// allowlisted tokens), validated by the protocol facet.
    function compound(uint256 trancheId, bytes calldata swapData, uint256 minOut)
        external
        onlyKeeper
        nonReentrant
    {
        LibVaultStorage.Tranche storage t = _tranche(trancheId);
        uint256 aeroOut = IProtocolFacet(address(this)).swapToAero(swapData, minOut);
        if (aeroOut > 0) {
            IProtocolFacet(address(this)).compoundPosition(t.positionId, aeroOut);
        }
        emit Compounded(trancheId, t.positionId, aeroOut);
    }
}
