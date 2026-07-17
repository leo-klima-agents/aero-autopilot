// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../libraries/LibAccess.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";
import {IDiamondCut} from "../interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "../interfaces/IDiamondLoupe.sol";
import {IERC165} from "../interfaces/IERC165.sol";
import {IERC173} from "../interfaces/IERC173.sol";

/// @title DiamondInit — one-time storage initialization per cut (§4.2 rule 4)
/// @notice The ONLY writer during cuts. Every init is guarded by a unique
/// initId so a replayed cut calldata cannot re-execute it.
contract DiamondInit {
    error AlreadyInitialized(bytes32 initId);

    struct Args {
        bytes32 initId;
        // protocol config
        bytes32 protocolId;
        address aero;
        address votingEscrow;
        address voter;
        address rewardsDistributor;
        address router;
        // roles
        address strategist;
        address keeper;
        // guardrails
        uint256 maxPoolWeightWad;
        uint256 maxDeltaWad;
        uint64 cooldownSec;
        // allowlists
        address[] allowedPools;
        address[] allowedRewardTokens;
    }

    function init(Args calldata a) external {
        LibVaultStorage.InitStorage storage initS = LibVaultStorage.init();
        if (initS.executed[a.initId]) revert AlreadyInitialized(a.initId);
        initS.executed[a.initId] = true;

        // ERC-165 introspection for the standard diamond interfaces plus
        // ERC-721 receipt (custody).
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;
        ds.supportedInterfaces[bytes4(0x150b7a02)] = true; // IERC721Receiver

        LibVaultStorage.ProtocolConfigStorage storage cfg = LibVaultStorage.protocolConfig();
        cfg.protocolId = a.protocolId;
        cfg.aero = a.aero;
        cfg.votingEscrow = a.votingEscrow;
        cfg.voter = a.voter;
        cfg.rewardsDistributor = a.rewardsDistributor;
        cfg.router = a.router;

        if (a.strategist != address(0)) LibAccess.grant(LibAccess.STRATEGIST_ROLE, a.strategist);
        if (a.keeper != address(0)) LibAccess.grant(LibAccess.KEEPER_ROLE, a.keeper);

        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        ts.maxPoolWeightWad = a.maxPoolWeightWad;
        ts.maxDeltaWad = a.maxDeltaWad;
        ts.cooldownSec = a.cooldownSec;
        for (uint256 i = 0; i < a.allowedPools.length; i++) {
            if (!ts.allowedPool[a.allowedPools[i]]) {
                ts.allowedPool[a.allowedPools[i]] = true;
                ts.allowedPoolList.push(a.allowedPools[i]);
            }
        }
        for (uint256 i = 0; i < a.allowedRewardTokens.length; i++) {
            ts.allowedRewardToken[a.allowedRewardTokens[i]] = true;
        }
    }
}
