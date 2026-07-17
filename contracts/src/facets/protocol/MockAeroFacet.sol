// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../../libraries/LibAccess.sol";
import {LibCooldown} from "../../libraries/LibCooldown.sol";
import {LibFixedPoint} from "../../libraries/LibFixedPoint.sol";
import {LibGaugeCap} from "../../libraries/LibGaugeCap.sol";
import {LibProRata} from "../../libraries/LibProRata.sol";
import {LibVaultStorage} from "../../libraries/LibVaultStorage.sol";
import {IProtocolFacet} from "../../interfaces/IProtocolFacet.sol";

/// @title MockAeroFacet — simulated Aero v3 semantics for tests (§4.1)
/// @notice Parameterized model of the spec drafts (P8): per-position rolling
/// cooldown, per-second streaming revenue pro-rata by weight, gauge caps with
/// overage burn — every parameter test-settable via mock_* hooks. Balances
/// are bookkeeping (no token transfers): the mock exists so vault flows and
/// invariants can be exercised against v3 semantics before v3 exists.
contract MockAeroFacet is IProtocolFacet {
    event MockStakeCreated(uint256 indexed positionId, uint256 powerWad);
    event MockAllocated(uint256 indexed positionId, address[] pools, uint256[] weightsWad);
    event MockEmissionsCheckpoint(address indexed pool, uint256 emittedWad, uint256 burnedWad);

    error NotAuthorized(address caller);
    error PositionNotFound(uint256 positionId);
    error CooldownActive(uint256 positionId, uint256 remaining);
    error LengthMismatch();
    error WeightsMustSumToWad(uint256 total);
    error UnknownPool(address pool);

    bytes32 private constant PROTOCOL_ID = "MOCK_AERO_V3";

    /// @dev Mutating protocol calls arrive via the diamond's own execution
    /// facets (self-call) or from the Owner (migration runbook).
    modifier onlyAuthorized() {
        if (msg.sender != address(this)) {
            LibAccess.enforceOwner();
        }
        _;
    }

    modifier onlyOwner() {
        LibAccess.enforceOwner();
        _;
    }

    function _position(uint256 positionId) private view returns (LibVaultStorage.MockPosition storage p) {
        p = LibVaultStorage.mockAero().positions[positionId];
        if (!p.exists) revert PositionNotFound(positionId);
    }

    // ── IProtocolFacet ──────────────────────────────────────────────────────

    function protocolId() external pure returns (bytes32) {
        return PROTOCOL_ID;
    }

    function createStake(uint256 amount, uint256) external onlyAuthorized returns (uint256 positionId) {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        if (s.nextPositionId == 0) s.nextPositionId = 1;
        positionId = s.nextPositionId++;
        LibVaultStorage.MockPosition storage p = s.positions[positionId];
        p.powerWad = amount;
        p.exists = true;
        emit MockStakeCreated(positionId, amount);
    }

    /// @notice v3 semantics: reallocation is gated by a per-position rolling
    /// cooldown at the protocol level (the vault's own guardrail sits above).
    function allocate(uint256 positionId, address[] calldata pools, uint256[] calldata weightsWad)
        external
        onlyAuthorized
    {
        if (pools.length != weightsWad.length) revert LengthMismatch();
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        LibVaultStorage.MockPosition storage p = _position(positionId);

        uint256 remaining = LibCooldown.remaining(p.lastActionAt, s.cooldownSec, block.timestamp);
        if (remaining != 0) revert CooldownActive(positionId, remaining);

        uint256 total;
        for (uint256 i = 0; i < weightsWad.length; i++) {
            total += weightsWad[i];
        }
        if (pools.length > 0 && total != LibFixedPoint.WAD) revert WeightsMustSumToWad(total);

        _clearAllocation(s, p, positionId);
        for (uint256 i = 0; i < pools.length; i++) {
            if (!s.poolKnown[pools[i]]) revert UnknownPool(pools[i]);
            uint256 weight = LibFixedPoint.wadMul(p.powerWad, weightsWad[i]);
            LibProRata.setWeight(s.streams[pools[i]], uint64(block.timestamp), positionId, weight);
            p.pools.push(pools[i]);
        }
        p.lastActionAt = uint64(block.timestamp);
        emit MockAllocated(positionId, pools, weightsWad);
    }

    function resetPosition(uint256 positionId) external onlyAuthorized {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        LibVaultStorage.MockPosition storage p = _position(positionId);
        uint256 remaining = LibCooldown.remaining(p.lastActionAt, s.cooldownSec, block.timestamp);
        if (remaining != 0) revert CooldownActive(positionId, remaining);
        _clearAllocation(s, p, positionId);
        p.lastActionAt = uint64(block.timestamp);
    }

    function _clearAllocation(
        LibVaultStorage.MockAeroStorage storage s,
        LibVaultStorage.MockPosition storage p,
        uint256 positionId
    ) private {
        for (uint256 i = 0; i < p.pools.length; i++) {
            LibProRata.setWeight(s.streams[p.pools[i]], uint64(block.timestamp), positionId, 0);
        }
        delete p.pools;
    }

    function claimable(uint256 positionId, address[] calldata pools)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        uint256 total;
        for (uint256 i = 0; i < pools.length; i++) {
            total += LibProRata.earned(s.streams[pools[i]], uint64(block.timestamp), positionId);
        }
        tokens = new address[](1);
        tokens[0] = LibVaultStorage.protocolConfig().aero;
        amounts = new uint256[](1);
        amounts[0] = total;
    }

    /// @param data optional abi.encode(address[] pools); empty = the
    /// position's current allocation.
    function claimRewards(uint256 positionId, bytes calldata data)
        external
        onlyAuthorized
        returns (uint256 aeroOut)
    {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        LibVaultStorage.MockPosition storage p = _position(positionId);
        address[] memory pools = data.length > 0 ? abi.decode(data, (address[])) : p.pools;
        for (uint256 i = 0; i < pools.length; i++) {
            aeroOut += LibProRata.claim(s.streams[pools[i]], uint64(block.timestamp), positionId);
        }
    }

    /// @dev v3 has no ve-rebase in the spec drafts; parameterized as zero.
    function claimRebase(uint256) external onlyAuthorized returns (uint256) {
        return 0;
    }

    /// @dev Mock revenue is already AERO-denominated bookkeeping: identity.
    function swapToAero(bytes calldata data, uint256 minOut)
        external
        view
        onlyAuthorized
        returns (uint256 amountOut)
    {
        amountOut = data.length > 0 ? abi.decode(data, (uint256)) : 0;
        require(amountOut >= minOut, "MockAero: insufficient output");
    }

    function compoundPosition(uint256 positionId, uint256 amount) external onlyAuthorized {
        LibVaultStorage.MockPosition storage p = _position(positionId);
        // Power grows immediately; stream weights update on the next allocate
        // (documented approximation — the cooldown makes this the common case).
        p.powerWad += amount;
    }

    function positionWeight(uint256 positionId) external view returns (uint256) {
        return _position(positionId).powerWad;
    }

    function cooldownRemaining(uint256 positionId) external view returns (uint256) {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        LibVaultStorage.MockPosition storage p = _position(positionId);
        return LibCooldown.remaining(p.lastActionAt, s.cooldownSec, block.timestamp);
    }

    /// @dev Continuous: no epochs, the window is always "now".
    function currentWindow() external view returns (uint64 start, uint64 end) {
        return (uint64(block.timestamp), uint64(block.timestamp));
    }

    // ── mock_* test hooks (Owner-gated; test-only facet) ────────────────────

    function mock_setCooldown(uint64 cooldownSec) external onlyOwner {
        LibVaultStorage.mockAero().cooldownSec = cooldownSec;
    }

    function mock_setKappa(uint256 kappaWad) external onlyOwner {
        LibVaultStorage.mockAero().kappaWad = kappaWad;
    }

    /// @notice Registers the pool on first call and (re)sets its revenue rate.
    function mock_setRevenueRate(address pool, uint256 rateWad) external onlyOwner {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        if (!s.poolKnown[pool]) {
            s.poolKnown[pool] = true;
            s.poolList.push(pool);
            s.streams[pool].lastUpdate = uint64(block.timestamp);
            s.emissions[pool].lastCheckpoint = uint64(block.timestamp);
        }
        LibProRata.setRate(s.streams[pool], uint64(block.timestamp), rateWad);
    }

    function mock_setEmissionRate(address pool, uint256 scheduledPerSecWad) external onlyOwner {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        if (!s.poolKnown[pool]) revert UnknownPool(pool);
        _checkpointEmissions(pool);
        s.emissions[pool].scheduledPerSecWad = scheduledPerSecWad;
    }

    /// @notice Apply the gauge cap to emissions scheduled since the last
    /// checkpoint: emitted ≤ κ × revenue over the same window, overage burned.
    function mock_checkpointEmissions(address pool)
        external
        onlyOwner
        returns (uint256 emittedWad, uint256 burnedWad)
    {
        if (!LibVaultStorage.mockAero().poolKnown[pool]) revert UnknownPool(pool);
        return _checkpointEmissions(pool);
    }

    function _checkpointEmissions(address pool) private returns (uint256 emittedWad, uint256 burnedWad) {
        LibVaultStorage.MockAeroStorage storage s = LibVaultStorage.mockAero();
        LibVaultStorage.MockPoolEmissions storage e = s.emissions[pool];
        uint256 dt = block.timestamp - e.lastCheckpoint;
        if (dt == 0) return (0, 0);
        uint256 scheduled = e.scheduledPerSecWad * dt;
        uint256 revenue = s.streams[pool].rateWad * dt;
        (emittedWad, burnedWad) = LibGaugeCap.apply_(scheduled, revenue, s.kappaWad);
        e.emittedWad += emittedWad;
        e.burnedWad += burnedWad;
        e.revenueSinceCheckpointWad = revenue;
        e.lastCheckpoint = uint64(block.timestamp);
        emit MockEmissionsCheckpoint(pool, emittedWad, burnedWad);
    }

    function mock_poolEmissions(address pool)
        external
        view
        returns (uint256 scheduledPerSecWad, uint256 emittedWad, uint256 burnedWad, uint64 lastCheckpoint)
    {
        LibVaultStorage.MockPoolEmissions storage e = LibVaultStorage.mockAero().emissions[pool];
        return (e.scheduledPerSecWad, e.emittedWad, e.burnedWad, e.lastCheckpoint);
    }

    function mock_streamInfo(address pool)
        external
        view
        returns (uint256 totalWeightWad, uint256 accPerWeightWad, uint256 rateWad, uint256 unallocatedWad)
    {
        LibVaultStorage.Stream storage st = LibVaultStorage.mockAero().streams[pool];
        return (st.totalWeightWad, st.accPerWeightWad, st.rateWad, st.unallocatedWad);
    }

    function mock_positionPools(uint256 positionId) external view returns (address[] memory) {
        return _position(positionId).pools;
    }

    function mock_positionStream(address pool, uint256 positionId)
        external
        view
        returns (uint256 weightWad, uint256 accPaidWad, uint256 earnedWad)
    {
        LibVaultStorage.StreamPosition storage sp =
            LibVaultStorage.mockAero().streams[pool].positions[positionId];
        return (sp.weightWad, sp.accPaidWad, sp.earnedWad);
    }
}
