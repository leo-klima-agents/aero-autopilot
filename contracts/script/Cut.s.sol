// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DiamondBuilder} from "./DiamondBuilder.sol";
import {IDiamond} from "../src/interfaces/IDiamond.sol";
import {IDiamondCut} from "../src/interfaces/IDiamondCut.sol";
import {AerodromeFacet} from "../src/facets/protocol/AerodromeFacet.sol";
import {MockAeroFacet} from "../src/facets/protocol/MockAeroFacet.sol";
import {AeroFacet} from "../src/facets/protocol/AeroFacet.sol";
import {ProtocolSwapInit} from "../src/init/ProtocolSwapInit.sol";

/// @title Cut — parameterized protocol-facet swap (§4.1, §9.5 cut runbook)
/// @notice The August/September transitions run through here. Every cut
/// follows the ceremony: PR + manifest diff → CI upgrade tests → Sepolia
/// rehearsal → Owner Safe signatures over the EXACT calldata printed by
/// --sig "preview()" → execution → post-cut loupe diff → archive.
///
/// Environment:
///   DIAMOND            — diamond address (REQUIRED)
///   NEW_PROTOCOL       — "aerodrome" | "mock" | "aero" (REQUIRED)
///   OLD_HAS_MOCK       — "true" if the outgoing facet carried mock_* hooks
///   INIT_ID            — unique id for the swap init (e.g. "swap-2026-09-xx")
///   AERO, VOTING_ESCROW, VOTER, REWARDS_DISTRIBUTOR, ROUTER — new protocol
///     addresses (zero = keep current)
///   PROTOCOL_COOLDOWN_SEC — incoming protocol cooldown (0 = keep)
/// With a Safe as owner, run `preview()` to print calldata for signature
/// collection instead of broadcasting.
contract Cut is Script {
    function _build()
        internal
        returns (IDiamond.FacetCut[] memory cuts, address init, bytes memory initCalldata)
    {
        string memory proto = vm.envString("NEW_PROTOCOL");
        bool oldHasMock = vm.envOr("OLD_HAS_MOCK", false);

        address newFacet;
        bool newHasMock;
        bytes32 protocolId;
        if (keccak256(bytes(proto)) == keccak256("aerodrome")) {
            newFacet = address(new AerodromeFacet());
            protocolId = "AERODROME_V2";
        } else if (keccak256(bytes(proto)) == keccak256("mock")) {
            newFacet = address(new MockAeroFacet());
            newHasMock = true;
            protocolId = "MOCK_AERO_V3";
        } else {
            newFacet = address(new AeroFacet());
            protocolId = "AERO_V3";
        }

        cuts = DiamondBuilder.protocolSwapCuts(newFacet, oldHasMock, newHasMock);
        init = address(new ProtocolSwapInit());
        initCalldata = abi.encodeCall(
            ProtocolSwapInit.init,
            (ProtocolSwapInit.Args({
                    initId: keccak256(bytes(vm.envString("INIT_ID"))),
                    protocolId: protocolId,
                    aero: vm.envOr("AERO", address(0)),
                    votingEscrow: vm.envOr("VOTING_ESCROW", address(0)),
                    voter: vm.envOr("VOTER", address(0)),
                    rewardsDistributor: vm.envOr("REWARDS_DISTRIBUTOR", address(0)),
                    router: vm.envOr("ROUTER", address(0)),
                    protocolCooldownSec: uint64(vm.envOr("PROTOCOL_COOLDOWN_SEC", uint256(0)))
                }))
        );
        console.log("new protocol facet:", newFacet);
    }

    /// @notice Deploy the new facet + init, print the diamondCut calldata for
    /// Owner Safe signature collection (signers cross-check this hash, §9.5).
    function preview() external {
        vm.startBroadcast();
        (IDiamond.FacetCut[] memory cuts, address init, bytes memory initCalldata) = _build();
        vm.stopBroadcast();
        bytes memory cutCalldata = abi.encodeCall(IDiamondCut.diamondCut, (cuts, init, initCalldata));
        console.log("diamondCut target: ", vm.envAddress("DIAMOND"));
        console.log("diamondCut calldata:");
        console.logBytes(cutCalldata);
        console.log("calldata keccak256:");
        console.logBytes32(keccak256(cutCalldata));
    }

    /// @notice Direct execution path (EOA owner: Sepolia rehearsals, forks).
    function run() external {
        address diamond = vm.envAddress("DIAMOND");
        vm.startBroadcast();
        (IDiamond.FacetCut[] memory cuts, address init, bytes memory initCalldata) = _build();
        IDiamondCut(diamond).diamondCut(cuts, init, initCalldata);
        vm.stopBroadcast();
        console.log("cut executed on", diamond);
    }
}
