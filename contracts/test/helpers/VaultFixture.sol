// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DiamondBuilder} from "../../script/DiamondBuilder.sol";
import {DiamondInit} from "../../src/init/DiamondInit.sol";
import {MockAeroFacet} from "../../src/facets/protocol/MockAeroFacet.sol";
import {AccessFacet} from "../../src/facets/AccessFacet.sol";
import {TargetsFacet} from "../../src/facets/TargetsFacet.sol";
import {TrancheFacet} from "../../src/facets/TrancheFacet.sol";
import {ExecutionFacet} from "../../src/facets/ExecutionFacet.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";
import {LibAccess} from "../../src/libraries/LibAccess.sol";
import {MockERC20, MockERC721} from "./MockTokens.sol";

/// @notice Shared fixture: a full diamond with MockAeroFacet cut in, roles
/// granted, pools registered and streaming. The test contract is the Owner.
contract VaultFixture is Test {
    uint256 internal constant WAD = 1e18;
    uint64 internal constant COOLDOWN_48H = 48 hours;

    address internal diamond;
    DiamondBuilder.CoreFacets internal coreFacets;
    address internal mockAeroFacet;

    MockERC20 internal aero;
    MockERC721 internal escrow;

    address internal strategist = makeAddr("strategist");
    address internal keeper = makeAddr("keeper");

    address internal poolA = makeAddr("poolA");
    address internal poolB = makeAddr("poolB");
    address internal poolC = makeAddr("poolC");

    function setUp() public virtual {
        // Deterministic, comfortably-post-genesis clock for cooldown math.
        vm.warp(1_760_000_000);

        aero = new MockERC20("Aerodrome", "AERO");
        escrow = new MockERC721();
        mockAeroFacet = address(new MockAeroFacet());

        (diamond, coreFacets) =
            DiamondBuilder.deployDiamond(address(this), mockAeroFacet, true, defaultInitArgs());

        // Register pools + revenue streams on the mock protocol.
        MockAeroFacet(diamond).mock_setCooldown(COOLDOWN_48H);
        MockAeroFacet(diamond).mock_setKappa(1.2e18);
        MockAeroFacet(diamond).mock_setRevenueRate(poolA, 3e18); // 3 AERO/s
        MockAeroFacet(diamond).mock_setRevenueRate(poolB, 1e18);
        MockAeroFacet(diamond).mock_setRevenueRate(poolC, 1e17);
    }

    function defaultInitArgs() internal view returns (DiamondInit.Args memory) {
        address[] memory pools = new address[](3);
        pools[0] = poolA;
        pools[1] = poolB;
        pools[2] = poolC;
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(aero);
        return DiamondInit.Args({
            initId: keccak256("genesis"),
            protocolId: "MOCK_AERO_V3",
            aero: address(aero),
            votingEscrow: address(escrow),
            voter: address(0),
            rewardsDistributor: address(0),
            router: address(0),
            strategist: strategist,
            keeper: keeper,
            maxPoolWeightWad: 6e17, // 60% per pool
            maxDeltaWad: 5e17, // 50% max move per setTargets
            cooldownSec: COOLDOWN_48H,
            allowedPools: pools,
            allowedRewardTokens: rewardTokens
        });
    }

    // ── convenience wrappers ────────────────────────────────────────────────

    function submitTargets(address[] memory pools, uint256[] memory weights, bytes32 ref) internal {
        vm.prank(strategist);
        TargetsFacet(diamond).setTargets(pools, weights, ref);
    }

    function targets5050() internal view returns (address[] memory pools, uint256[] memory weights) {
        pools = new address[](2);
        pools[0] = poolA;
        pools[1] = poolB;
        weights = new uint256[](2);
        weights[0] = 5e17;
        weights[1] = 5e17;
    }

    function createTrancheAs(uint256 amount) internal returns (uint256 trancheId) {
        vm.prank(keeper);
        trancheId = TrancheFacet(diamond).createTranche(amount, 0);
    }

    function rotateAs(uint256 trancheId) internal {
        vm.prank(keeper);
        ExecutionFacet(diamond).rotate(trancheId);
    }
}
