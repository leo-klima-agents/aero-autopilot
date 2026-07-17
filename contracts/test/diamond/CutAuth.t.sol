// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {IDiamond} from "../../src/interfaces/IDiamond.sol";
import {IDiamondCut} from "../../src/interfaces/IDiamondCut.sol";
import {OwnershipFacet} from "../../src/facets/OwnershipFacet.sol";
import {AeroFacet} from "../../src/facets/protocol/AeroFacet.sol";
import {DiamondBuilder} from "../../script/DiamondBuilder.sol";

/// @notice diamondCut authority is the single most powerful permission in the
/// system and belongs exclusively to the Owner Safe (P4).
contract CutAuthTest is VaultFixture {
    function _someCut() internal returns (IDiamond.FacetCut[] memory) {
        return DiamondBuilder.protocolSwapCuts(address(new AeroFacet()), true, false);
    }

    function test_nonOwnerCannotCut(address caller) public {
        vm.assume(caller != address(this) && caller != diamond);
        IDiamond.FacetCut[] memory cuts = _someCut();
        vm.prank(caller);
        vm.expectRevert();
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
    }

    function test_strategistAndKeeperCannotCut() public {
        IDiamond.FacetCut[] memory cuts = _someCut();
        vm.prank(strategist);
        vm.expectRevert();
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.prank(keeper);
        vm.expectRevert();
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
    }

    function test_ownerCanCut() public {
        IDiamond.FacetCut[] memory cuts = _someCut();
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        (bool ok, bytes memory ret) = diamond.staticcall(abi.encodeWithSignature("protocolId()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (bytes32)), bytes32("AERO_V3"));
    }

    function test_ownershipTransferMovesCutPower() public {
        address newOwner = makeAddr("newOwnerSafe");
        OwnershipFacet(diamond).transferOwnership(newOwner);

        IDiamond.FacetCut[] memory cuts = _someCut();
        vm.expectRevert();
        IDiamondCut(diamond).diamondCut(cuts, address(0), ""); // old owner locked out

        vm.prank(newOwner);
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
    }
}
