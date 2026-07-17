// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {stdJson} from "forge-std/StdJson.sol";
import {VaultFixture} from "../helpers/VaultFixture.sol";
import {IDiamondLoupe} from "../../src/interfaces/IDiamondLoupe.sol";

/// @notice The loupe is the on-chain source of truth for what code is live;
/// facets.json is its off-chain mirror (§4.1). These tests pin the two
/// together: every manifest selector routes to the expected facet, and the
/// diamond exposes no selector the manifest doesn't know about.
contract LoupeManifestTest is VaultFixture {
    using stdJson for string;

    string internal manifest;

    function loadManifest() internal {
        manifest = vm.readFile("facets.json");
    }

    function _facetNameToAddress(string memory name) internal view returns (address) {
        bytes32 h = keccak256(bytes(name));
        if (h == keccak256("DiamondCutFacet")) return coreFacets.diamondCut;
        if (h == keccak256("DiamondLoupeFacet")) return coreFacets.diamondLoupe;
        if (h == keccak256("OwnershipFacet")) return coreFacets.ownership;
        if (h == keccak256("AccessFacet")) return coreFacets.access;
        if (h == keccak256("CustodyFacet")) return coreFacets.custody;
        if (h == keccak256("TrancheFacet")) return coreFacets.tranche;
        if (h == keccak256("TargetsFacet")) return coreFacets.targets;
        if (h == keccak256("ExecutionFacet")) return coreFacets.execution;
        if (h == keccak256("MockAeroFacet")) return mockAeroFacet;
        revert("unknown facet name");
    }

    /// @dev The facets cut into the fixture diamond (AerodromeFacet/AeroFacet
    /// are manifest-listed but not cut in — they replace MockAeroFacet later).
    function _liveFacetNames() internal pure returns (string[9] memory) {
        return [
            "DiamondCutFacet",
            "DiamondLoupeFacet",
            "OwnershipFacet",
            "AccessFacet",
            "CustodyFacet",
            "TrancheFacet",
            "TargetsFacet",
            "ExecutionFacet",
            "MockAeroFacet"
        ];
    }

    function test_everyManifestSelectorRoutesToItsFacet() public {
        loadManifest();
        string[9] memory names = _liveFacetNames();
        for (uint256 i = 0; i < names.length; i++) {
            address expected = _facetNameToAddress(names[i]);
            bytes32[] memory sels =
                manifest.readBytes32Array(string.concat(".facets.", names[i], ".selectorList"));
            for (uint256 j = 0; j < sels.length; j++) {
                bytes4 sel = bytes4(sels[j]);
                assertEq(
                    IDiamondLoupe(diamond).facetAddress(sel),
                    expected,
                    string.concat("selector of ", names[i], " misrouted")
                );
            }
        }
    }

    function test_noOrphanSelectors() public {
        loadManifest();
        // Union of manifest selectors across live facets…
        string[9] memory names = _liveFacetNames();
        uint256 manifestCount;
        for (uint256 i = 0; i < names.length; i++) {
            manifestCount += manifest.readBytes32Array(string.concat(".facets.", names[i], ".selectorList"))
            .length;
        }
        // …must exactly cover what the loupe reports.
        IDiamondLoupe.Facet[] memory live = IDiamondLoupe(diamond).facets();
        uint256 liveCount;
        for (uint256 i = 0; i < live.length; i++) {
            liveCount += live[i].functionSelectors.length;
        }
        assertEq(liveCount, manifestCount, "diamond exposes selectors the manifest does not know");
    }

    function test_loupeFacetAddressesMatchFixture() public view {
        address[] memory addrs = IDiamondLoupe(diamond).facetAddresses();
        assertEq(addrs.length, 9); // 8 core + protocol
    }

    function test_supportsInterface() public view {
        // ERC-165, cut, loupe, ownership, 721-receiver.
        (bool ok, bytes memory ret) =
            diamond.staticcall(abi.encodeWithSignature("supportsInterface(bytes4)", bytes4(0x01ffc9a7)));
        assertTrue(ok && abi.decode(ret, (bool)));
        (, ret) = diamond.staticcall(abi.encodeWithSignature("supportsInterface(bytes4)", bytes4(0x150b7a02)));
        assertTrue(abi.decode(ret, (bool)));
        (, ret) = diamond.staticcall(abi.encodeWithSignature("supportsInterface(bytes4)", bytes4(0x48e2b093)));
        assertTrue(abi.decode(ret, (bool))); // IDiamondLoupe
    }
}
