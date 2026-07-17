// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../libraries/LibAccess.sol";
import {LibCooldown} from "../libraries/LibCooldown.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";
import {IProtocolFacet} from "../interfaces/IProtocolFacet.sol";

/// @title TrancheFacet — tranche registry + cooldown accounting (§4.1)
/// @notice Maps trancheId → positionTokenId with per-tranche lastActionAt.
/// Positions are created as separate stakes from the start: v3 positions
/// cannot be split, so the staggered-cooldown structure must exist at stake
/// time — the same discipline applies to v2.
contract TrancheFacet {
    event TrancheCreated(uint256 indexed trancheId, uint256 indexed positionId, uint256 amount);
    event TrancheActiveSet(uint256 indexed trancheId, bool active);

    error TrancheNotFound(uint256 trancheId);
    error Reentrancy();

    modifier nonReentrant() {
        LibVaultStorage.ReentrancyStorage storage r = LibVaultStorage.reentrancy();
        if (r.status == 2) revert Reentrancy();
        r.status = 2;
        _;
        r.status = 1;
    }

    /// @notice Stake `amount` of underlying held by the diamond into a fresh
    /// position and register it as a tranche. Keeper-gated, mechanical.
    function createTranche(uint256 amount, uint256 lockDuration)
        external
        nonReentrant
        returns (uint256 trancheId)
    {
        LibAccess.enforceRole(LibAccess.KEEPER_ROLE, msg.sender);
        // Self-call routes through the diamond so whichever protocol facet is
        // currently cut in provides createStake (§4.1 protocol swap-as-cut).
        uint256 positionId = IProtocolFacet(address(this)).createStake(amount, lockDuration);
        LibVaultStorage.TrancheStorage storage ts = LibVaultStorage.tranches();
        if (ts.nextTrancheId == 0) ts.nextTrancheId = 1;
        trancheId = ts.nextTrancheId++;
        ts.tranches[trancheId] =
            LibVaultStorage.Tranche({positionId: positionId, lastActionAt: 0, active: true});
        emit TrancheCreated(trancheId, positionId, amount);
    }

    /// @notice Owner switch used when retiring tranches (e.g. after migration
    /// rescued the NFT out); inactive tranches refuse execution.
    function setTrancheActive(uint256 trancheId, bool active) external {
        LibAccess.enforceOwner();
        LibVaultStorage.TrancheStorage storage ts = LibVaultStorage.tranches();
        if (ts.tranches[trancheId].positionId == 0) revert TrancheNotFound(trancheId);
        ts.tranches[trancheId].active = active;
        emit TrancheActiveSet(trancheId, active);
    }

    function trancheCount() external view returns (uint256) {
        uint256 next = LibVaultStorage.tranches().nextTrancheId;
        return next == 0 ? 0 : next - 1;
    }

    function getTranche(uint256 trancheId)
        external
        view
        returns (uint256 positionId, uint64 lastActionAt, bool active)
    {
        LibVaultStorage.Tranche storage t = LibVaultStorage.tranches().tranches[trancheId];
        if (t.positionId == 0) revert TrancheNotFound(trancheId);
        return (t.positionId, t.lastActionAt, t.active);
    }

    /// @return Seconds until the tranche may rotate under the Owner-set
    /// cooldown guardrail (the on-chain trace of strategy class, §4.1).
    function trancheCooldownRemaining(uint256 trancheId) external view returns (uint256) {
        LibVaultStorage.Tranche storage t = LibVaultStorage.tranches().tranches[trancheId];
        if (t.positionId == 0) revert TrancheNotFound(trancheId);
        return LibCooldown.remaining(t.lastActionAt, LibVaultStorage.targets().cooldownSec, block.timestamp);
    }
}
