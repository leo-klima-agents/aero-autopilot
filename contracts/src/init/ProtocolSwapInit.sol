// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";

/// @title ProtocolSwapInit — init for protocol-facet swap cuts (§4.1)
/// @notice The August/September transitions are a single diamondCut replacing
/// the protocol facet's selectors; this init updates the protocol identity
/// and (optionally) external addresses in the same atomic cut. Custody,
/// tranches, targets, and roles are untouched — the CI upgrade test asserts
/// exactly that, byte for byte.
contract ProtocolSwapInit {
    error AlreadyInitialized(bytes32 initId);

    struct Args {
        bytes32 initId;
        bytes32 protocolId;
        // zero address = keep existing value
        address aero;
        address votingEscrow;
        address voter;
        address rewardsDistributor;
        address router;
        // per-position protocol cooldown for the incoming protocol (0 = keep)
        uint64 protocolCooldownSec;
    }

    function init(Args calldata a) external {
        LibVaultStorage.InitStorage storage initS = LibVaultStorage.init();
        if (initS.executed[a.initId]) revert AlreadyInitialized(a.initId);
        initS.executed[a.initId] = true;

        LibVaultStorage.ProtocolConfigStorage storage cfg = LibVaultStorage.protocolConfig();
        cfg.protocolId = a.protocolId;
        if (a.aero != address(0)) cfg.aero = a.aero;
        if (a.votingEscrow != address(0)) cfg.votingEscrow = a.votingEscrow;
        if (a.voter != address(0)) cfg.voter = a.voter;
        if (a.rewardsDistributor != address(0)) cfg.rewardsDistributor = a.rewardsDistributor;
        if (a.router != address(0)) cfg.router = a.router;

        if (a.protocolCooldownSec != 0) {
            LibVaultStorage.mockAero().cooldownSec = a.protocolCooldownSec;
        }
    }
}
