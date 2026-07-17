// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Diamond, DiamondArgs} from "../src/Diamond.sol";
import {IDiamond} from "../src/interfaces/IDiamond.sol";
import {DiamondCutFacet} from "../src/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../src/facets/DiamondLoupeFacet.sol";
import {OwnershipFacet} from "../src/facets/OwnershipFacet.sol";
import {AccessFacet} from "../src/facets/AccessFacet.sol";
import {CustodyFacet} from "../src/facets/CustodyFacet.sol";
import {TrancheFacet} from "../src/facets/TrancheFacet.sol";
import {TargetsFacet} from "../src/facets/TargetsFacet.sol";
import {ExecutionFacet} from "../src/facets/ExecutionFacet.sol";
import {AerodromeFacet} from "../src/facets/protocol/AerodromeFacet.sol";
import {MockAeroFacet} from "../src/facets/protocol/MockAeroFacet.sol";
import {AeroFacet} from "../src/facets/protocol/AeroFacet.sol";
import {DiamondInit} from "../src/init/DiamondInit.sol";
import {IProtocolFacet} from "../src/interfaces/IProtocolFacet.sol";

/// @title DiamondBuilder — the single source of cut composition
/// @notice Used by Deploy.s.sol, Cut.s.sol, AND every test fixture, so the
/// selectors that reach mainnet are the selectors CI exercised. Selector
/// lists are built symbolically (`X.f.selector`) — they cannot drift from
/// the code; facets.json mirrors them and CI diffs the two (§4.1 loupe/manifest).
library DiamondBuilder {
    struct CoreFacets {
        address diamondCut;
        address diamondLoupe;
        address ownership;
        address access;
        address custody;
        address tranche;
        address targets;
        address execution;
    }

    // ── selector sets ───────────────────────────────────────────────────────

    function diamondLoupeSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](5);
        s[0] = DiamondLoupeFacet.facets.selector;
        s[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        s[2] = DiamondLoupeFacet.facetAddresses.selector;
        s[3] = DiamondLoupeFacet.facetAddress.selector;
        s[4] = DiamondLoupeFacet.supportsInterface.selector;
    }

    function ownershipSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](2);
        s[0] = OwnershipFacet.transferOwnership.selector;
        s[1] = OwnershipFacet.owner.selector;
    }

    function accessSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](5);
        s[0] = AccessFacet.grantRole.selector;
        s[1] = AccessFacet.revokeRole.selector;
        s[2] = AccessFacet.hasRole.selector;
        s[3] = AccessFacet.STRATEGIST_ROLE.selector;
        s[4] = AccessFacet.KEEPER_ROLE.selector;
    }

    function custodySelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](3);
        s[0] = CustodyFacet.onERC721Received.selector;
        s[1] = CustodyFacet.rescueERC721.selector;
        s[2] = CustodyFacet.rescueERC20.selector;
    }

    function trancheSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](5);
        s[0] = TrancheFacet.createTranche.selector;
        s[1] = TrancheFacet.setTrancheActive.selector;
        s[2] = TrancheFacet.trancheCount.selector;
        s[3] = TrancheFacet.getTranche.selector;
        s[4] = TrancheFacet.trancheCooldownRemaining.selector;
    }

    function targetsSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](9);
        s[0] = TargetsFacet.setTargets.selector;
        s[1] = TargetsFacet.currentTargets.selector;
        s[2] = TargetsFacet.setGuardrails.selector;
        s[3] = TargetsFacet.setPoolAllowlist.selector;
        s[4] = TargetsFacet.setRewardTokenAllowlist.selector;
        s[5] = TargetsFacet.setMinFlowOracle.selector;
        s[6] = TargetsFacet.guardrails.selector;
        s[7] = TargetsFacet.isPoolAllowed.selector;
        s[8] = TargetsFacet.isRewardTokenAllowed.selector;
    }

    function executionSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](3);
        s[0] = ExecutionFacet.rotate.selector;
        s[1] = ExecutionFacet.harvest.selector;
        s[2] = ExecutionFacet.compound.selector;
    }

    /// @dev The frozen IProtocolFacet selector set (P8) — identical for every
    /// protocol facet; swapping protocols = Replace on exactly these.
    function protocolSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](12);
        s[0] = IProtocolFacet.protocolId.selector;
        s[1] = IProtocolFacet.createStake.selector;
        s[2] = IProtocolFacet.allocate.selector;
        s[3] = IProtocolFacet.resetPosition.selector;
        s[4] = IProtocolFacet.claimable.selector;
        s[5] = IProtocolFacet.claimRewards.selector;
        s[6] = IProtocolFacet.claimRebase.selector;
        s[7] = IProtocolFacet.swapToAero.selector;
        s[8] = IProtocolFacet.compoundPosition.selector;
        s[9] = IProtocolFacet.positionWeight.selector;
        s[10] = IProtocolFacet.cooldownRemaining.selector;
        s[11] = IProtocolFacet.currentWindow.selector;
    }

    /// @dev Extra test hooks that ride along only when MockAeroFacet is cut in.
    function mockExtraSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](9);
        s[0] = MockAeroFacet.mock_setCooldown.selector;
        s[1] = MockAeroFacet.mock_setKappa.selector;
        s[2] = MockAeroFacet.mock_setRevenueRate.selector;
        s[3] = MockAeroFacet.mock_setEmissionRate.selector;
        s[4] = MockAeroFacet.mock_checkpointEmissions.selector;
        s[5] = MockAeroFacet.mock_poolEmissions.selector;
        s[6] = MockAeroFacet.mock_streamInfo.selector;
        s[7] = MockAeroFacet.mock_positionPools.selector;
        s[8] = MockAeroFacet.mock_positionStream.selector;
    }

    // ── deployment ──────────────────────────────────────────────────────────

    function deployCoreFacets() internal returns (CoreFacets memory f) {
        f.diamondCut = address(new DiamondCutFacet());
        f.diamondLoupe = address(new DiamondLoupeFacet());
        f.ownership = address(new OwnershipFacet());
        f.access = address(new AccessFacet());
        f.custody = address(new CustodyFacet());
        f.tranche = address(new TrancheFacet());
        f.targets = address(new TargetsFacet());
        f.execution = address(new ExecutionFacet());
    }

    function diamondCutSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](1);
        s[0] = DiamondCutFacet.diamondCut.selector;
    }

    /// @dev All core cuts including DiamondCutFacet (the vendored Diamond
    /// constructor installs only what it is handed) — minus the protocol
    /// facet, which the caller chooses.
    function coreCuts(CoreFacets memory f) internal pure returns (IDiamond.FacetCut[] memory cuts) {
        cuts = new IDiamond.FacetCut[](8);
        cuts[0] = _add(f.diamondCut, diamondCutSelectors());
        cuts[1] = _add(f.diamondLoupe, diamondLoupeSelectors());
        cuts[2] = _add(f.ownership, ownershipSelectors());
        cuts[3] = _add(f.access, accessSelectors());
        cuts[4] = _add(f.custody, custodySelectors());
        cuts[5] = _add(f.tranche, trancheSelectors());
        cuts[6] = _add(f.targets, targetsSelectors());
        cuts[7] = _add(f.execution, executionSelectors());
    }

    function protocolAddCut(address protocolFacet, bool withMockExtras)
        internal
        pure
        returns (IDiamond.FacetCut[] memory cuts)
    {
        cuts = new IDiamond.FacetCut[](withMockExtras ? 2 : 1);
        cuts[0] = _add(protocolFacet, protocolSelectors());
        if (withMockExtras) cuts[1] = _add(protocolFacet, mockExtraSelectors());
    }

    /// @dev A protocol swap: Replace the frozen selector set, then add/remove
    /// mock extras depending on which side has them.
    function protocolSwapCuts(address newFacet, bool oldHadMockExtras, bool newHasMockExtras)
        internal
        pure
        returns (IDiamond.FacetCut[] memory cuts)
    {
        uint256 n = 1 + (oldHadMockExtras ? 1 : 0) + (newHasMockExtras ? 1 : 0);
        cuts = new IDiamond.FacetCut[](n);
        uint256 k;
        if (oldHadMockExtras) {
            cuts[k++] = IDiamond.FacetCut({
                facetAddress: address(0),
                action: IDiamond.FacetCutAction.Remove,
                functionSelectors: mockExtraSelectors()
            });
        }
        cuts[k++] = IDiamond.FacetCut({
            facetAddress: newFacet,
            action: IDiamond.FacetCutAction.Replace,
            functionSelectors: protocolSelectors()
        });
        if (newHasMockExtras) {
            cuts[k] = _add(newFacet, mockExtraSelectors());
        }
    }

    function _add(address facet, bytes4[] memory selectors) private pure returns (IDiamond.FacetCut memory) {
        return IDiamond.FacetCut({
            facetAddress: facet, action: IDiamond.FacetCutAction.Add, functionSelectors: selectors
        });
    }

    /// @notice Deploy the full diamond: core facets + chosen protocol facet +
    /// genesis init. `owner` receives cut power — on mainnet that is the
    /// Owner Safe and nothing else (P6).
    function deployDiamond(
        address owner,
        address protocolFacet,
        bool withMockExtras,
        DiamondInit.Args memory initArgs
    ) internal returns (address diamond, CoreFacets memory f) {
        f = deployCoreFacets();
        address init = address(new DiamondInit());

        IDiamond.FacetCut[] memory core = coreCuts(f);
        IDiamond.FacetCut[] memory proto = protocolAddCut(protocolFacet, withMockExtras);
        IDiamond.FacetCut[] memory all = new IDiamond.FacetCut[](core.length + proto.length);
        for (uint256 i = 0; i < core.length; i++) {
            all[i] = core[i];
        }
        for (uint256 i = 0; i < proto.length; i++) {
            all[core.length + i] = proto[i];
        }

        diamond = address(
            new Diamond(
                all,
                DiamondArgs({
                    owner: owner, init: init, initCalldata: abi.encodeCall(DiamondInit.init, (initArgs))
                })
            )
        );
    }
}
