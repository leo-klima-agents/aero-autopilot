// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibVaultStorage} from "../../libraries/LibVaultStorage.sol";
import {IProtocolFacet} from "../../interfaces/IProtocolFacet.sol";

/// @title AeroFacet — Aero (MetaDEX03) v3 integration, DRAFT (§4.1, P8)
/// @notice Status: idea-draft placeholder. The Aero codebase and updated
/// specifications publish in batches starting 2026-08-03; this facet is
/// expected to be written twice — drafted against the specs (M2), rewritten
/// against published code (M5) — behind the frozen IProtocolFacet selector
/// set. Until real addresses are configured and the rewrite lands, every
/// mutating entry point reverts NotLive so a premature cut cannot move funds.
///
/// Spec-diff log (update as the Aug 3+ drops land):
///   [2026-07-17] Drafted from dromos-labs/metadex-specs idea drafts:
///     - per-position rolling cooldown (default 48h) gates reallocation;
///     - revenue streams to allocators pro-rata, per second;
///     - Gauge Caps: emissions ≤ κ × trailing revenue (default κ = 1.2),
///       overage burned;
///     - positions cannot be split post-stake; migration mints new ids.
///   Semantics are exercised today via MockAeroFacet; the real interface
///   bindings land here.
contract AeroFacet is IProtocolFacet {
    error NotLive();

    bytes32 private constant PROTOCOL_ID = "AERO_V3";

    function protocolId() external pure returns (bytes32) {
        return PROTOCOL_ID;
    }

    function createStake(uint256, uint256) external pure returns (uint256) {
        revert NotLive();
    }

    function allocate(uint256, address[] calldata, uint256[] calldata) external pure {
        revert NotLive();
    }

    function resetPosition(uint256) external pure {
        revert NotLive();
    }

    function claimable(uint256, address[] calldata)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        tokens = new address[](1);
        tokens[0] = LibVaultStorage.protocolConfig().aero;
        amounts = new uint256[](1);
    }

    function claimRewards(uint256, bytes calldata) external pure returns (uint256) {
        revert NotLive();
    }

    function claimRebase(uint256) external pure returns (uint256) {
        revert NotLive();
    }

    function swapToAero(bytes calldata, uint256) external pure returns (uint256) {
        revert NotLive();
    }

    function compoundPosition(uint256, uint256) external pure {
        revert NotLive();
    }

    function positionWeight(uint256) external pure returns (uint256) {
        return 0;
    }

    /// @dev Draft default: 48h per-position cooldown, reported as unlocked
    /// until positions exist.
    function cooldownRemaining(uint256) external pure returns (uint256) {
        return 0;
    }

    function currentWindow() external view returns (uint64 start, uint64 end) {
        return (uint64(block.timestamp), uint64(block.timestamp));
    }
}
