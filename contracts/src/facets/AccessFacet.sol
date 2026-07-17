// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibAccess} from "../libraries/LibAccess.sol";

/// @title AccessFacet — role admin, Owner-gated (§4.1)
/// @notice Grants/revokes STRATEGIST (Strategist Safe) and KEEPER (hot key).
/// The Owner is the diamond owner (Owner Safe) and is managed via IERC173
/// (OwnershipFacet), not here.
contract AccessFacet {
    function grantRole(bytes32 role, address account) external {
        LibAccess.enforceOwner();
        LibAccess.grant(role, account);
    }

    function revokeRole(bytes32 role, address account) external {
        LibAccess.enforceOwner();
        LibAccess.revoke(role, account);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return LibAccess.hasRole(role, account);
    }

    function STRATEGIST_ROLE() external pure returns (bytes32) {
        return LibAccess.STRATEGIST_ROLE;
    }

    function KEEPER_ROLE() external pure returns (bytes32) {
        return LibAccess.KEEPER_ROLE;
    }
}
