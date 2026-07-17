// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {AccessFacet} from "../../src/facets/AccessFacet.sol";
import {LibAccess} from "../../src/libraries/LibAccess.sol";
import {OwnershipFacet} from "../../src/facets/OwnershipFacet.sol";

contract AccessFacetTest is VaultFixture {
    function test_initGrantsConfiguredRoles() public view {
        assertTrue(AccessFacet(diamond).hasRole(LibAccess.STRATEGIST_ROLE, strategist));
        assertTrue(AccessFacet(diamond).hasRole(LibAccess.KEEPER_ROLE, keeper));
        assertEq(OwnershipFacet(diamond).owner(), address(this));
    }

    function test_ownerCanGrantAndRevoke() public {
        address newKeeper = makeAddr("newKeeper");
        AccessFacet(diamond).grantRole(LibAccess.KEEPER_ROLE, newKeeper);
        assertTrue(AccessFacet(diamond).hasRole(LibAccess.KEEPER_ROLE, newKeeper));
        AccessFacet(diamond).revokeRole(LibAccess.KEEPER_ROLE, newKeeper);
        assertFalse(AccessFacet(diamond).hasRole(LibAccess.KEEPER_ROLE, newKeeper));
    }

    function test_nonOwnerCannotGrant(address caller) public {
        vm.assume(caller != address(this) && caller != diamond);
        vm.prank(caller);
        vm.expectRevert();
        AccessFacet(diamond).grantRole(LibAccess.KEEPER_ROLE, caller);
    }

    function test_unknownRoleRejected() public {
        vm.expectRevert(abi.encodeWithSelector(LibAccess.UnknownRole.selector, keccak256("bogus")));
        AccessFacet(diamond).grantRole(keccak256("bogus"), address(1));
    }

    function test_roleConstantsExposed() public view {
        assertEq(AccessFacet(diamond).STRATEGIST_ROLE(), LibAccess.STRATEGIST_ROLE);
        assertEq(AccessFacet(diamond).KEEPER_ROLE(), LibAccess.KEEPER_ROLE);
    }
}
