// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {CustodyFacet} from "../../src/facets/CustodyFacet.sol";
import {MockERC20, MockERC721} from "../helpers/MockTokens.sol";

contract CustodyFacetTest is VaultFixture {
    function test_acceptsNFTFromEscrowOnly() public {
        uint256 id = escrow.mint(address(this));
        escrow.safeTransferFrom(address(this), diamond, id); // must not revert
        assertEq(escrow.ownerOf(id), diamond);

        MockERC721 stranger = new MockERC721();
        uint256 strangerId = stranger.mint(address(this));
        vm.expectRevert(abi.encodeWithSelector(CustodyFacet.UnexpectedNFT.selector, address(stranger)));
        stranger.safeTransferFrom(address(this), diamond, strangerId);
    }

    function test_ownerRescuesNFT() public {
        uint256 id = escrow.mint(address(this));
        escrow.safeTransferFrom(address(this), diamond, id);
        address safeExit = makeAddr("migrationDestination");
        CustodyFacet(diamond).rescueERC721(address(escrow), id, safeExit);
        assertEq(escrow.ownerOf(id), safeExit);
    }

    function test_ownerRescuesERC20() public {
        aero.mint(diamond, 100e18);
        CustodyFacet(diamond).rescueERC20(address(aero), 100e18, address(this));
        assertEq(aero.balanceOf(address(this)), 100e18);
    }

    function test_nonOwnerCannotRescue(address caller) public {
        vm.assume(caller != address(this) && caller != diamond);
        aero.mint(diamond, 1e18);
        vm.prank(caller);
        vm.expectRevert();
        CustodyFacet(diamond).rescueERC20(address(aero), 1e18, caller);
    }
}
