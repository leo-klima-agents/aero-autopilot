// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {TargetsFacet} from "../../src/facets/TargetsFacet.sol";
import {IMinFlowOracle} from "../../src/interfaces/IMinFlowOracle.sol";

contract RejectingOracle is IMinFlowOracle {
    function checkTargets(address[] calldata, uint256[] calldata) external pure returns (bool) {
        return false;
    }
}

contract TargetsFacetTest is VaultFixture {
    function test_strategistQueuesValidTargets() public {
        (address[] memory pools, uint256[] memory weights) = targets5050();
        submitTargets(pools, weights, bytes32("cfg-hash"));
        (address[] memory outPools, uint256[] memory outWeights, bytes32 ref, uint64 updatedAt) =
            TargetsFacet(diamond).currentTargets();
        assertEq(outPools.length, 2);
        assertEq(outPools[0], poolA);
        assertEq(outWeights[1], 5e17);
        assertEq(ref, bytes32("cfg-hash"));
        assertEq(updatedAt, uint64(block.timestamp));
    }

    function test_nonStrategistRejected(address caller) public {
        vm.assume(caller != strategist && caller != diamond);
        (address[] memory pools, uint256[] memory weights) = targets5050();
        vm.prank(caller);
        vm.expectRevert();
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_guardrail_poolAllowlist() public {
        address rogue = makeAddr("roguePool");
        address[] memory pools = new address[](1);
        pools[0] = rogue;
        uint256[] memory weights = new uint256[](1);
        weights[0] = WAD;
        vm.prank(strategist);
        vm.expectRevert(abi.encodeWithSelector(TargetsFacet.PoolNotAllowed.selector, rogue));
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_guardrail_maxPoolWeight() public {
        address[] memory pools = new address[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 7e17; // above the 60% cap
        weights[1] = 3e17;
        vm.prank(strategist);
        vm.expectRevert(abi.encodeWithSelector(TargetsFacet.WeightExceedsMax.selector, poolA, 7e17, 6e17));
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_guardrail_weightsMustSumToWad() public {
        address[] memory pools = new address[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5e17;
        weights[1] = 5e17 - 1;
        vm.prank(strategist);
        vm.expectRevert(abi.encodeWithSelector(TargetsFacet.WeightsMustSumToWad.selector, WAD - 1));
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_guardrail_duplicatePool() public {
        address[] memory pools = new address[](2);
        pools[0] = poolA;
        pools[1] = poolA;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5e17;
        weights[1] = 5e17;
        vm.prank(strategist);
        vm.expectRevert(abi.encodeWithSelector(TargetsFacet.DuplicatePool.selector, poolA));
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_guardrail_emptyTargets() public {
        vm.prank(strategist);
        vm.expectRevert(TargetsFacet.EmptyTargets.selector);
        TargetsFacet(diamond).setTargets(new address[](0), new uint256[](0), 0);
    }

    function test_guardrail_maxDelta() public {
        // First target: 50/50 A/B (no delta check on the first submission).
        (address[] memory pools, uint256[] memory weights) = targets5050();
        submitTargets(pools, weights, 0);

        // Full flip to 100% C = delta 1.0 > 0.5 cap.
        address[] memory newPools = new address[](2);
        newPools[0] = poolC;
        newPools[1] = poolB;
        uint256[] memory newWeights = new uint256[](2);
        newWeights[0] = 6e17;
        newWeights[1] = 4e17;
        vm.prank(strategist);
        vm.expectRevert(abi.encodeWithSelector(TargetsFacet.DeltaExceedsMax.selector, 6e17, 5e17));
        TargetsFacet(diamond).setTargets(newPools, newWeights, 0);

        // A bounded shift inside the band passes: move 30% from A to C.
        newPools[0] = poolA;
        newPools[1] = poolC;
        newWeights[0] = 2e17;
        newWeights[1] = 3e17;
        address[] memory pools3 = new address[](3);
        pools3[0] = poolA;
        pools3[1] = poolB;
        pools3[2] = poolC;
        uint256[] memory weights3 = new uint256[](3);
        weights3[0] = 2e17;
        weights3[1] = 5e17;
        weights3[2] = 3e17;
        submitTargets(pools3, weights3, 0);
        (address[] memory outPools,,,) = TargetsFacet(diamond).currentTargets();
        assertEq(outPools.length, 3);
    }

    function test_oracleHookCanVeto() public {
        TargetsFacet(diamond).setMinFlowOracle(address(new RejectingOracle()));
        (address[] memory pools, uint256[] memory weights) = targets5050();
        vm.prank(strategist);
        vm.expectRevert(TargetsFacet.OracleRejectedTargets.selector);
        TargetsFacet(diamond).setTargets(pools, weights, 0);
    }

    function test_ownerSetsGuardrails() public {
        TargetsFacet(diamond).setGuardrails(1e18, 1e18, 7 days);
        (uint256 maxPool, uint256 maxDelta, uint64 cooldown,) = TargetsFacet(diamond).guardrails();
        assertEq(maxPool, 1e18);
        assertEq(maxDelta, 1e18);
        assertEq(cooldown, 7 days);
    }

    function test_nonOwnerCannotConfigure(address caller) public {
        vm.assume(caller != address(this) && caller != diamond);
        vm.startPrank(caller);
        vm.expectRevert();
        TargetsFacet(diamond).setGuardrails(1, 1, 1);
        vm.expectRevert();
        TargetsFacet(diamond).setMinFlowOracle(address(1));
        vm.stopPrank();
    }
}
