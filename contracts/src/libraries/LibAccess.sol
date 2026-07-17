// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibDiamond} from "./LibDiamond.sol";
import {LibVaultStorage} from "./LibVaultStorage.sol";

/// @title LibAccess — roles over namespaced storage
/// @notice OZ AccessControl's logic reimplemented over ERC-7201 storage (P5:
/// stock OZ AccessControl assumes linear layout and is not diamond-safe).
/// OWNER is not a role: it is the diamond owner (the Owner Safe) via IERC173.
/// Damage ceilings (P6): keeper compromise costs liveness only; strategist
/// compromise costs bad-but-bounded allocation until the Owner revokes.
library LibAccess {
    bytes32 internal constant STRATEGIST_ROLE = keccak256("aero.autopilot.role.strategist");
    bytes32 internal constant KEEPER_ROLE = keccak256("aero.autopilot.role.keeper");

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    error MissingRole(bytes32 role, address account);
    error UnknownRole(bytes32 role);

    function hasRole(bytes32 role, address account) internal view returns (bool) {
        return LibVaultStorage.access().roles[role][account];
    }

    function enforceRole(bytes32 role, address account) internal view {
        if (!hasRole(role, account)) revert MissingRole(role, account);
    }

    function enforceOwner() internal view {
        LibDiamond.enforceIsContractOwner();
    }

    function requireKnownRole(bytes32 role) internal pure {
        if (role != STRATEGIST_ROLE && role != KEEPER_ROLE) revert UnknownRole(role);
    }

    function grant(bytes32 role, address account) internal {
        requireKnownRole(role);
        if (!hasRole(role, account)) {
            LibVaultStorage.access().roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revoke(bytes32 role, address account) internal {
        requireKnownRole(role);
        if (hasRole(role, account)) {
            LibVaultStorage.access().roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }
}
