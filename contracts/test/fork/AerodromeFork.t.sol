// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DiamondBuilder} from "../../script/DiamondBuilder.sol";
import {DiamondInit} from "../../src/init/DiamondInit.sol";
import {ProtocolSwapInit} from "../../src/init/ProtocolSwapInit.sol";
import {AerodromeFacet} from "../../src/facets/protocol/AerodromeFacet.sol";
import {MockAeroFacet} from "../../src/facets/protocol/MockAeroFacet.sol";
import {AccessFacet} from "../../src/facets/AccessFacet.sol";
import {TargetsFacet} from "../../src/facets/TargetsFacet.sol";
import {TrancheFacet} from "../../src/facets/TrancheFacet.sol";
import {ExecutionFacet} from "../../src/facets/ExecutionFacet.sol";
import {CustodyFacet} from "../../src/facets/CustodyFacet.sol";
import {IDiamondCut} from "../../src/interfaces/IDiamondCut.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";
import {IRouter, IVoter, IVotingEscrow} from "../../src/interfaces/external/IAerodrome.sol";

/// @notice Fork suite (§7.3): the money path end-to-end against REAL
/// Aerodrome on Base through the diamond, at a pinned block.
/// Runs only with BASE_RPC_URL set — CI executes it from fork-tests.yml
/// (nightly + PRs labeled `fork-tests`); the default suite excludes test/fork.
///
///   forge test --match-path 'test/fork/*' -vv
contract AerodromeForkTest is Test {
    // Aerodrome v2 on Base — cross-verified on-chain (escrow.token() == AERO,
    // voter.ve() == escrow, …) at implementation time; the deploy runbook
    // re-verifies against official docs.
    address constant AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant VOTING_ESCROW = 0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4;
    address constant VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;
    address constant REWARDS_DISTRIBUTOR = 0x227f65131A261548b057215bB1D5Ab2997964C7d;
    address constant ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    uint256 constant PINNED_BLOCK = 48_750_000;
    uint256 constant WEEK = 7 days;
    uint256 constant STAKE = 1_000e18;
    uint256 constant MAX_LOCK = 4 * 365 days;

    address diamond;
    address strategist = makeAddr("strategist");
    address keeper = makeAddr("keeper");
    address mockFacet;
    address aerodromeFacet;

    address[] livePools; // two live, heavily-voted pools discovered on-fork

    bool forkReady;

    modifier onlyFork() {
        if (!forkReady) {
            console.log("SKIP: BASE_RPC_URL not set");
            return;
        }
        _;
    }

    function setUp() public {
        string memory url = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url, vm.envOr("FORK_BLOCK", PINNED_BLOCK));
        forkReady = true;

        // Land mid-epoch, safely inside the vote window (start+1h … end−1h).
        uint256 epochStart = block.timestamp - (block.timestamp % WEEK);
        if (block.timestamp < epochStart + 2 hours || block.timestamp > epochStart + WEEK - 2 hours) {
            vm.warp(epochStart + 3 days);
        }

        // Discover two live, heavily-voted pools instead of hardcoding them.
        IVoter voter = IVoter(VOTER);
        uint256 found;
        for (uint256 i = 0; i < 40 && found < 2; i++) {
            (bool ok, bytes memory ret) = VOTER.staticcall(abi.encodeWithSignature("pools(uint256)", i));
            if (!ok) break;
            address pool = abi.decode(ret, (address));
            address gauge = voter.gauges(pool);
            if (gauge != address(0) && voter.weights(pool) > 1_000_000e18) {
                livePools.push(pool);
                found++;
            }
        }
        require(livePools.length == 2, "fork: could not discover two live pools");

        aerodromeFacet = address(new AerodromeFacet());
        mockFacet = address(new MockAeroFacet());

        address[] memory rewardTokens = new address[](2);
        rewardTokens[0] = WETH;
        rewardTokens[1] = AERO;
        (diamond,) = DiamondBuilder.deployDiamond(
            address(this),
            aerodromeFacet,
            false,
            DiamondInit.Args({
                initId: keccak256("fork-genesis"),
                protocolId: "AERODROME_V2",
                aero: AERO,
                votingEscrow: VOTING_ESCROW,
                voter: VOTER,
                rewardsDistributor: REWARDS_DISTRIBUTOR,
                router: ROUTER,
                strategist: strategist,
                keeper: keeper,
                maxPoolWeightWad: 1e18,
                maxDeltaWad: 1e18,
                cooldownSec: uint64(WEEK),
                allowedPools: livePools,
                allowedRewardTokens: rewardTokens
            })
        );

        deal(AERO, diamond, STAKE * 4);
    }

    function _voteTargets() internal {
        address[] memory pools = new address[](2);
        pools[0] = livePools[0];
        pools[1] = livePools[1];
        uint256[] memory weights = new uint256[](2);
        weights[0] = 6e17;
        weights[1] = 4e17;
        vm.prank(strategist);
        TargetsFacet(diamond).setTargets(pools, weights, bytes32("fork-cfg"));
    }

    function _createAndVote() internal returns (uint256 trancheId, uint256 positionId) {
        vm.prank(keeper);
        trancheId = TrancheFacet(diamond).createTranche(STAKE, MAX_LOCK);
        (positionId,,) = TrancheFacet(diamond).getTranche(trancheId);
        _voteTargets();
        vm.prank(keeper);
        ExecutionFacet(diamond).rotate(trancheId);
    }

    /// @dev The full money path: create lock → vote → warp across the epoch
    /// flip → claim fees/bribes → rebase → compound → re-vote.
    function test_fork_moneyPathEndToEnd() public onlyFork {
        (uint256 trancheId, uint256 positionId) = _createAndVote();

        // Lock exists, owned by the diamond, with real voting power.
        assertEq(IVotingEscrow(VOTING_ESCROW).ownerOf(positionId), diamond);
        uint256 power = IProtocolFacet(diamond).positionWeight(positionId);
        assertGt(power, STAKE * 90 / 100); // ~max lock ≈ full power

        // Same-epoch re-vote is blocked by the vault cooldown…
        vm.prank(keeper);
        vm.expectRevert();
        ExecutionFacet(diamond).rotate(trancheId);

        // …warp across the flip into the next window.
        uint256 nextEpoch = block.timestamp - (block.timestamp % WEEK) + WEEK;
        vm.warp(nextEpoch + 2 hours);

        // Trigger the epoch distribution so emissions/rebase move (on a live
        // chain anyone pokes this; on the fork we do it ourselves).
        address[] memory gauges = new address[](2);
        gauges[0] = IVoter(VOTER).gauges(livePools[0]);
        gauges[1] = IVoter(VOTER).gauges(livePools[1]);
        try IVoter(VOTER).distribute(gauges) {} catch {}

        // Claim real fees + bribes accrued for our vote through the flip.
        (address[] memory tokens, uint256[] memory amounts) =
            IProtocolFacet(diamond).claimable(positionId, livePools);
        uint256 nonZero;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] > 0) nonZero++;
        }
        console.log("claimable reward entries:", tokens.length, "nonzero:", nonZero);
        assertGt(nonZero, 0, "top pools should have accrued voter rewards over a full epoch");

        // Build claim data BEFORE pranking (its staticcalls would consume the prank).
        bytes memory claimData = _claimDataFor(positionId);
        vm.prank(keeper);
        ExecutionFacet(diamond).harvest(trancheId, claimData);

        // Rebase claim must not revert (may legitimately be zero for a young lock).
        // Compound: lock freshly-dealt AERO into the position via the real escrow.
        uint256 before = IProtocolFacet(diamond).positionWeight(positionId);
        IProtocolFacet(diamond).compoundPosition(positionId, 100e18);
        assertGt(IProtocolFacet(diamond).positionWeight(positionId), before);

        // Re-vote once the weekly vault cooldown elapses (vote was cast 3d
        // into the old epoch → unlock lands 3d into this one, mid-window).
        (, uint64 lastActionAt,) = TrancheFacet(diamond).getTranche(trancheId);
        vm.warp(uint256(lastActionAt) + WEEK);
        vm.prank(keeper);
        ExecutionFacet(diamond).rotate(trancheId);
    }

    function _claimDataFor(uint256) internal view returns (bytes memory) {
        // Build token lists for fees + bribes from the on-chain reward lists.
        IVoter voter = IVoter(VOTER);
        address[] memory pools = livePools;
        address[][] memory feeTokens = new address[][](2);
        address[][] memory bribeTokens = new address[][](2);
        for (uint256 i = 0; i < 2; i++) {
            address gauge = voter.gauges(pools[i]);
            feeTokens[i] = _rewardList(voter.gaugeToFees(gauge));
            bribeTokens[i] = _rewardList(voter.gaugeToBribe(gauge));
        }
        return abi.encode(pools, feeTokens, bribeTokens);
    }

    function _rewardList(address rewardContract) internal view returns (address[] memory tokens) {
        (, bytes memory lenRet) = rewardContract.staticcall(abi.encodeWithSignature("rewardsListLength()"));
        uint256 len = abi.decode(lenRet, (uint256));
        tokens = new address[](len);
        for (uint256 j = 0; j < len; j++) {
            (, bytes memory ret) = rewardContract.staticcall(abi.encodeWithSignature("rewards(uint256)", j));
            tokens[j] = abi.decode(ret, (address));
        }
    }

    /// @dev Same-epoch double vote reverts at the PROTOCOL level too, not just
    /// our cooldown (verified empirically, §7.3).
    function test_fork_sameEpochRevoteRevertsAtProtocol() public onlyFork {
        (, uint256 positionId) = _createAndVote();
        address[] memory pools = new address[](1);
        pools[0] = livePools[0];
        uint256[] memory weights = new uint256[](1);
        weights[0] = 1e18;
        // Direct protocol-facet call as Owner bypasses the vault cooldown —
        // Aerodrome itself must reject the second vote this epoch.
        vm.expectRevert();
        IProtocolFacet(diamond).allocate(positionId, pools, weights);
    }

    /// @dev Vote inside the final hour of the epoch is rejected by Aerodrome
    /// (the vote-window restriction, verified empirically).
    function test_fork_voteWindowBoundary() public onlyFork {
        vm.prank(keeper);
        uint256 trancheId = TrancheFacet(diamond).createTranche(STAKE, MAX_LOCK);
        _voteTargets();

        uint256 epochEnd = block.timestamp - (block.timestamp % WEEK) + WEEK;
        vm.warp(epochEnd - 30 minutes);
        vm.prank(keeper);
        vm.expectRevert();
        ExecutionFacet(diamond).rotate(trancheId);

        // The first hour of the next epoch is the distribute window — also closed.
        vm.warp(epochEnd + 10 minutes);
        vm.prank(keeper);
        vm.expectRevert();
        ExecutionFacet(diamond).rotate(trancheId);

        // Window reopens an hour in.
        vm.warp(epochEnd + 61 minutes);
        vm.prank(keeper);
        ExecutionFacet(diamond).rotate(trancheId);
    }

    /// @dev Zero-reward claim: harvesting immediately after voting (no epoch
    /// has completed for us) must not revert.
    function test_fork_zeroRewardClaimIsSafe() public onlyFork {
        (uint256 trancheId, uint256 positionId) = _createAndVote();
        bytes memory claimData = _claimDataFor(positionId);
        vm.prank(keeper);
        ExecutionFacet(diamond).harvest(trancheId, claimData);
    }

    /// @dev Real swap through the Aerodrome router: WETH (allowlisted reward
    /// token) → AERO, with route validation and minOut enforced.
    function test_fork_swapToAeroThroughRouter() public onlyFork {
        deal(WETH, diamond, 1e18);
        IRouter.Route[][] memory routes = new IRouter.Route[][](1);
        routes[0] = new IRouter.Route[](1);
        routes[0][0] =
            IRouter.Route({from: WETH, to: AERO, stable: false, factory: IRouter(ROUTER).defaultFactory()});
        uint256[] memory amountsIn = new uint256[](1);
        amountsIn[0] = 1e18;

        uint256 out = IProtocolFacet(diamond).swapToAero(abi.encode(routes, amountsIn), 1);
        assertGt(out, 0);
        assertGe(IERC20(AERO).balanceOf(diamond), out);

        // A route ending anywhere but AERO is rejected.
        routes[0][0].to = WETH;
        routes[0][0].from = AERO;
        vm.expectRevert();
        IProtocolFacet(diamond).swapToAero(abi.encode(routes, amountsIn), 1);
    }

    /// @dev NFT transfer out (rescue) and back in — the migration exit path.
    function test_fork_custodyTransferInOut() public onlyFork {
        (, uint256 positionId) = _createAndVote();
        address vaultOps = makeAddr("vaultOps");
        CustodyFacet(diamond).rescueERC721(VOTING_ESCROW, positionId, vaultOps);
        assertEq(IVotingEscrow(VOTING_ESCROW).ownerOf(positionId), vaultOps);
        vm.prank(vaultOps);
        IVotingEscrow(VOTING_ESCROW).safeTransferFrom(vaultOps, diamond, positionId);
        assertEq(IVotingEscrow(VOTING_ESCROW).ownerOf(positionId), diamond);
    }

    /// @dev Fork-level facet swap mid-lifecycle (Aerodrome→Mock→Aerodrome):
    /// custody and tranche state survive a live protocol transition (§7.3).
    function test_fork_facetSwapMidLifecycle() public onlyFork {
        (uint256 trancheId, uint256 positionId) = _createAndVote();
        (uint256 posBefore, uint64 lastBefore,) = TrancheFacet(diamond).getTranche(trancheId);

        // Swap to mock (as the September runbook will swap to AeroFacet).
        IDiamondCut(diamond)
            .diamondCut(
                DiamondBuilder.protocolSwapCuts(mockFacet, false, true),
                address(new ProtocolSwapInit()),
                abi.encodeCall(
                    ProtocolSwapInit.init,
                    (ProtocolSwapInit.Args({
                        initId: keccak256("fork-swap-1"),
                        protocolId: "MOCK_AERO_V3",
                        aero: address(0),
                        votingEscrow: address(0),
                        voter: address(0),
                        rewardsDistributor: address(0),
                        router: address(0),
                        protocolCooldownSec: 48 hours
                    }))
                )
            );
        assertEq(IProtocolFacet(diamond).protocolId(), bytes32("MOCK_AERO_V3"));

        // Custody: the real veNFT never moved.
        assertEq(IVotingEscrow(VOTING_ESCROW).ownerOf(positionId), diamond);
        (uint256 posMid, uint64 lastMid,) = TrancheFacet(diamond).getTranche(trancheId);
        assertEq(posMid, posBefore);
        assertEq(lastMid, lastBefore);

        // Swap back and prove the live integration still works end-to-end.
        IDiamondCut(diamond)
            .diamondCut(
                DiamondBuilder.protocolSwapCuts(aerodromeFacet, true, false),
                address(new ProtocolSwapInit()),
                abi.encodeCall(
                    ProtocolSwapInit.init,
                    (ProtocolSwapInit.Args({
                        initId: keccak256("fork-swap-2"),
                        protocolId: "AERODROME_V2",
                        aero: address(0),
                        votingEscrow: address(0),
                        voter: address(0),
                        rewardsDistributor: address(0),
                        router: address(0),
                        protocolCooldownSec: 0
                    }))
                )
            );
        assertEq(
            IProtocolFacet(diamond).positionWeight(positionId),
            IVotingEscrow(VOTING_ESCROW).balanceOfNFT(positionId)
        );

        // Unlock lands one full cooldown after the original vote — 3d into
        // the next epoch, safely mid-window.
        vm.warp(uint256(lastBefore) + WEEK);
        vm.prank(keeper);
        ExecutionFacet(diamond).rotate(trancheId); // re-vote works after the round trip
    }
}
