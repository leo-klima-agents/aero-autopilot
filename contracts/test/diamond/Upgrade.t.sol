// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {VaultFixture} from "../helpers/VaultFixture.sol";
import {DiamondBuilder} from "../../script/DiamondBuilder.sol";
import {IDiamond} from "../../src/interfaces/IDiamond.sol";
import {IDiamondCut} from "../../src/interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "../../src/interfaces/IDiamondLoupe.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";
import {AccessFacet} from "../../src/facets/AccessFacet.sol";
import {TargetsFacet} from "../../src/facets/TargetsFacet.sol";
import {TrancheFacet} from "../../src/facets/TrancheFacet.sol";
import {MockAeroFacet} from "../../src/facets/protocol/MockAeroFacet.sol";
import {AeroFacet} from "../../src/facets/protocol/AeroFacet.sol";
import {ProtocolSwapInit} from "../../src/init/ProtocolSwapInit.sol";
import {LibAccess} from "../../src/libraries/LibAccess.sol";

/// @notice The upgrade suite (§7.2): populate full state, execute a
/// protocol-facet swap, assert every namespace byte-identical and all flows
/// functional post-cut. This test IS the September migration rehearsal in
/// miniature and runs in CI on every change to any facet.
contract UpgradeTest is VaultFixture {
    uint256 internal trancheId;
    uint256 internal positionId;

    function setUp() public override {
        super.setUp();
        // Populate full state: tranche, targets, streamed revenue.
        trancheId = createTrancheAs(100e18);
        (positionId,,) = TrancheFacet(diamond).getTranche(trancheId);
        (address[] memory pools, uint256[] memory weights) = targets5050();
        submitTargets(pools, weights, bytes32("pre-upgrade-cfg"));
        rotateAs(trancheId);
        vm.warp(block.timestamp + 500);
    }

    struct Snapshot {
        // targets namespace
        address[] targetPools;
        uint256[] targetWeights;
        bytes32 strategyRef;
        uint256 maxPool;
        uint256 maxDelta;
        uint64 cooldown;
        // tranches namespace
        uint256 trancheCount;
        uint256 positionId;
        uint64 lastActionAt;
        bool active;
        // access namespace
        bool strategistRole;
        bool keeperRole;
        // protocol state
        uint256 positionWeight;
        uint256 claimableA;
    }

    function _snapshot() internal view returns (Snapshot memory s) {
        (s.targetPools, s.targetWeights, s.strategyRef,) = TargetsFacet(diamond).currentTargets();
        (s.maxPool, s.maxDelta, s.cooldown,) = TargetsFacet(diamond).guardrails();
        s.trancheCount = TrancheFacet(diamond).trancheCount();
        (s.positionId, s.lastActionAt, s.active) = TrancheFacet(diamond).getTranche(1);
        s.strategistRole = AccessFacet(diamond).hasRole(LibAccess.STRATEGIST_ROLE, strategist);
        s.keeperRole = AccessFacet(diamond).hasRole(LibAccess.KEEPER_ROLE, keeper);
        s.positionWeight = IProtocolFacet(diamond).positionWeight(1);
        address[] memory pools = new address[](1);
        pools[0] = poolA;
        (, uint256[] memory amounts) = IProtocolFacet(diamond).claimable(1, pools);
        s.claimableA = amounts[0];
    }

    function _assertSnapshotsEqual(Snapshot memory a, Snapshot memory b) internal pure {
        assertEq(a.targetPools.length, b.targetPools.length);
        for (uint256 i = 0; i < a.targetPools.length; i++) {
            assertEq(a.targetPools[i], b.targetPools[i]);
            assertEq(a.targetWeights[i], b.targetWeights[i]);
        }
        assertEq(a.strategyRef, b.strategyRef);
        assertEq(a.maxPool, b.maxPool);
        assertEq(a.maxDelta, b.maxDelta);
        assertEq(a.cooldown, b.cooldown);
        assertEq(a.trancheCount, b.trancheCount);
        assertEq(a.positionId, b.positionId);
        assertEq(a.lastActionAt, b.lastActionAt);
        assertEq(a.active, b.active);
        assertEq(a.strategistRole, b.strategistRole);
        assertEq(a.keeperRole, b.keeperRole);
    }

    /// @dev Swap MockAero → AeroFacet (draft) → back to MockAero, asserting
    /// vault state is untouched and flows still work — the protocol
    /// transition as a pure selector operation.
    function test_protocolSwapPreservesEveryNamespace() public {
        Snapshot memory before = _snapshot();
        assertGt(before.claimableA, 0); // real state at stake

        // Cut 1: Mock → Aero draft, with swap init updating protocol identity.
        address aeroFacet = address(new AeroFacet());
        ProtocolSwapInit.Args memory swapArgs = ProtocolSwapInit.Args({
            initId: keccak256("swap-to-aero-draft"),
            protocolId: "AERO_V3",
            aero: address(0),
            votingEscrow: address(0),
            voter: address(0),
            rewardsDistributor: address(0),
            router: address(0),
            protocolCooldownSec: 0
        });
        IDiamondCut(diamond)
            .diamondCut(
                DiamondBuilder.protocolSwapCuts(aeroFacet, true, false),
                address(new ProtocolSwapInit()),
                abi.encodeCall(ProtocolSwapInit.init, (swapArgs))
            );

        assertEq(IProtocolFacet(diamond).protocolId(), bytes32("AERO_V3"));
        // Draft facet refuses to move funds (NotLive) — a premature cut is inert.
        vm.prank(keeper);
        vm.expectRevert();
        TrancheFacet(diamond).createTranche(1e18, 0);

        // Cut 2: back to MockAero (the reversibility drill from §9.4 “bad cut”).
        ProtocolSwapInit.Args memory backArgs = ProtocolSwapInit.Args({
            initId: keccak256("swap-back-to-mock"),
            protocolId: "MOCK_AERO_V3",
            aero: address(0),
            votingEscrow: address(0),
            voter: address(0),
            rewardsDistributor: address(0),
            router: address(0),
            protocolCooldownSec: 0
        });
        IDiamondCut(diamond)
            .diamondCut(
                DiamondBuilder.protocolSwapCuts(mockAeroFacet, false, true),
                address(new ProtocolSwapInit()),
                abi.encodeCall(ProtocolSwapInit.init, (backArgs))
            );

        Snapshot memory after_ = _snapshot();
        _assertSnapshotsEqual(before, after_);
        // Streamed revenue survived both cuts byte-for-byte.
        assertEq(after_.claimableA, before.claimableA);
        assertEq(after_.positionWeight, before.positionWeight);

        // All flows functional post-cut: cooldown continues, rotation works.
        vm.warp(block.timestamp + COOLDOWN_48H);
        rotateAs(trancheId);
        uint256 newTranche = createTrancheAs(10e18);
        assertEq(newTranche, 2);
    }

    function test_replayedInitCannotReexecute() public {
        address swapInit = address(new ProtocolSwapInit());
        ProtocolSwapInit.Args memory args = ProtocolSwapInit.Args({
            initId: keccak256("once"),
            protocolId: "AERO_V3",
            aero: address(0),
            votingEscrow: address(0),
            voter: address(0),
            rewardsDistributor: address(0),
            router: address(0),
            protocolCooldownSec: 0
        });
        address aeroFacet = address(new AeroFacet());
        IDiamondCut(diamond)
            .diamondCut(
                DiamondBuilder.protocolSwapCuts(aeroFacet, true, false),
                swapInit,
                abi.encodeCall(ProtocolSwapInit.init, (args))
            );
        // Replaying the same init (idempotency guard, §4.2 rule 4) reverts.
        IDiamond.FacetCut[] memory empty = new IDiamond.FacetCut[](0);
        vm.expectRevert();
        IDiamondCut(diamond).diamondCut(empty, swapInit, abi.encodeCall(ProtocolSwapInit.init, (args)));
    }

    function test_selectorRoutingChangesOnlyForProtocolSet() public {
        address beforeTargets = IDiamondLoupe(diamond).facetAddress(TargetsFacet.setTargets.selector);
        address beforeProtocol = IDiamondLoupe(diamond).facetAddress(IProtocolFacet.allocate.selector);

        address aeroFacet = address(new AeroFacet());
        IDiamondCut(diamond)
            .diamondCut(DiamondBuilder.protocolSwapCuts(aeroFacet, true, false), address(0), "");

        assertEq(
            IDiamondLoupe(diamond).facetAddress(TargetsFacet.setTargets.selector),
            beforeTargets,
            "non-protocol routing must not move"
        );
        assertEq(IDiamondLoupe(diamond).facetAddress(IProtocolFacet.allocate.selector), aeroFacet);
        assertNotEq(beforeProtocol, aeroFacet);
        // Mock extras were removed cleanly.
        assertEq(IDiamondLoupe(diamond).facetAddress(MockAeroFacet.mock_setKappa.selector), address(0));
    }
}
