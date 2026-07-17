// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {TrancheFacet} from "../../src/facets/TrancheFacet.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";

contract TrancheFacetTest is VaultFixture {
    function test_createTrancheRegistersPosition() public {
        uint256 t1 = createTrancheAs(100e18);
        uint256 t2 = createTrancheAs(50e18);
        assertEq(t1, 1);
        assertEq(t2, 2);
        assertEq(TrancheFacet(diamond).trancheCount(), 2);

        (uint256 positionId, uint64 lastActionAt, bool active) = TrancheFacet(diamond).getTranche(t1);
        assertGt(positionId, 0);
        assertEq(lastActionAt, 0); // fresh tranche can rotate immediately
        assertTrue(active);
        assertEq(IProtocolFacet(diamond).positionWeight(positionId), 100e18);
    }

    function test_onlyKeeperCreates(address caller) public {
        vm.assume(caller != keeper && caller != diamond);
        vm.prank(caller);
        vm.expectRevert();
        TrancheFacet(diamond).createTranche(1e18, 0);
    }

    function test_cooldownAccountingAfterRotate() public {
        uint256 t = createTrancheAs(100e18);
        (address[] memory pools, uint256[] memory weights) = targets5050();
        submitTargets(pools, weights, bytes32("ref-1"));

        assertEq(TrancheFacet(diamond).trancheCooldownRemaining(t), 0);
        rotateAs(t);
        assertEq(TrancheFacet(diamond).trancheCooldownRemaining(t), COOLDOWN_48H);
        vm.warp(block.timestamp + 20 hours);
        assertEq(TrancheFacet(diamond).trancheCooldownRemaining(t), COOLDOWN_48H - 20 hours);
        vm.warp(block.timestamp + 28 hours);
        assertEq(TrancheFacet(diamond).trancheCooldownRemaining(t), 0);
    }

    function test_ownerCanRetireTranche() public {
        uint256 t = createTrancheAs(10e18);
        TrancheFacet(diamond).setTrancheActive(t, false);
        (,, bool active) = TrancheFacet(diamond).getTranche(t);
        assertFalse(active);
    }

    function test_unknownTrancheReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TrancheFacet.TrancheNotFound.selector, 99));
        TrancheFacet(diamond).getTranche(99);
    }
}
