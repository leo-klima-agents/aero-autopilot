// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {MockAeroFacet} from "../../src/facets/protocol/MockAeroFacet.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";

/// @notice Scenario tests against the simulated v3 semantics (§7.6):
/// early-allocator arc, cooldown shortening mid-run, cap recalibration.
contract MockAeroFacetTest is VaultFixture {
    function _stake(uint256 amount) internal returns (uint256 id) {
        vm.prank(diamond);
        // Direct self-call path is exercised via ExecutionFacet elsewhere;
        // here the Owner (this test) drives the protocol facet directly.
        id = IProtocolFacet(diamond).createStake(amount, 0);
    }

    function _allocate(uint256 id, address pool) internal {
        address[] memory pools = new address[](1);
        pools[0] = pool;
        uint256[] memory weights = new uint256[](1);
        weights[0] = WAD;
        IProtocolFacet(diamond).allocate(id, pools, weights);
    }

    function test_protocolIdentity() public view {
        assertEq(IProtocolFacet(diamond).protocolId(), bytes32("MOCK_AERO_V3"));
        (uint64 start, uint64 end) = IProtocolFacet(diamond).currentWindow();
        assertEq(start, uint64(block.timestamp)); // continuous: window is "now"
        assertEq(end, start);
    }

    function test_earlyAllocatorArc() public {
        // Early allocator takes poolA alone: 100% of its revenue share.
        uint256 early = _stake(100e18);
        _allocate(early, poolA);
        vm.warp(block.timestamp + 1000);
        address[] memory pools = new address[](1);
        pools[0] = poolA;
        (, uint256[] memory earlyEarned) = IProtocolFacet(diamond).claimable(early, pools);
        assertEq(earlyEarned[0], 3000e18); // 3/s × 1000s, sole allocator

        // The crowd arrives with 4× the weight → early's share decays to 1/5.
        uint256 crowd = _stake(400e18);
        _allocate(crowd, poolA);
        vm.warp(block.timestamp + 1000);
        (, uint256[] memory afterCrowd) = IProtocolFacet(diamond).claimable(early, pools);
        assertEq(afterCrowd[0] - earlyEarned[0], 600e18); // 3000 × 1/5
    }

    function test_cooldownBlocksEarlyReallocation() public {
        uint256 id = _stake(10e18);
        _allocate(id, poolA);
        vm.warp(block.timestamp + 1 hours);
        address[] memory pools = new address[](1);
        pools[0] = poolB;
        uint256[] memory weights = new uint256[](1);
        weights[0] = WAD;
        vm.expectRevert(
            abi.encodeWithSelector(MockAeroFacet.CooldownActive.selector, id, uint256(COOLDOWN_48H - 1 hours))
        );
        IProtocolFacet(diamond).allocate(id, pools, weights);
    }

    function test_cooldownShorteningMidRun() public {
        uint256 id = _stake(10e18);
        _allocate(id, poolA);
        vm.warp(block.timestamp + 24 hours);
        assertEq(IProtocolFacet(diamond).cooldownRemaining(id), 24 hours);
        // Protocol governance shortens the cooldown to 12h → instantly unlocked.
        MockAeroFacet(diamond).mock_setCooldown(12 hours);
        assertEq(IProtocolFacet(diamond).cooldownRemaining(id), 0);
        _allocate(id, poolB); // succeeds
    }

    function test_gaugeCapBurnsExcessEmissions() public {
        // poolC: 0.1 AERO/s revenue; schedule 1 AERO/s emissions with κ=1.2:
        // cap = 0.12/s → 0.88/s burned.
        MockAeroFacet(diamond).mock_setEmissionRate(poolC, 1e18);
        vm.warp(block.timestamp + 1000);
        (uint256 emitted, uint256 burned) = MockAeroFacet(diamond).mock_checkpointEmissions(poolC);
        assertEq(emitted, 120e18);
        assertEq(burned, 880e18);
    }

    function test_capRecalibration() public {
        MockAeroFacet(diamond).mock_setEmissionRate(poolC, 1e18);
        vm.warp(block.timestamp + 100);
        MockAeroFacet(diamond).mock_checkpointEmissions(poolC);
        // κ recalibrated 1.2 → 3.0: more of the schedule survives the cap.
        MockAeroFacet(diamond).mock_setKappa(3e18);
        vm.warp(block.timestamp + 100);
        (uint256 emitted, uint256 burned) = MockAeroFacet(diamond).mock_checkpointEmissions(poolC);
        assertEq(emitted, 30e18); // 0.1/s × 3.0 × 100s
        assertEq(burned, 70e18);
    }

    function test_conservation_streamedPlusBurnedEqualsScheduled() public {
        MockAeroFacet(diamond).mock_setEmissionRate(poolA, 5e17);
        vm.warp(block.timestamp + 12345);
        (uint256 emitted, uint256 burned) = MockAeroFacet(diamond).mock_checkpointEmissions(poolA);
        assertEq(emitted + burned, 5e17 * 12345);
    }

    function test_unknownPoolRejected() public {
        uint256 id = _stake(10e18);
        address[] memory pools = new address[](1);
        pools[0] = makeAddr("nowhere");
        uint256[] memory weights = new uint256[](1);
        weights[0] = WAD;
        vm.expectRevert(abi.encodeWithSelector(MockAeroFacet.UnknownPool.selector, pools[0]));
        IProtocolFacet(diamond).allocate(id, pools, weights);
    }
}
