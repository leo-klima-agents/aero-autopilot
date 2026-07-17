// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DiamondBuilder} from "./DiamondBuilder.sol";
import {DiamondInit} from "../src/init/DiamondInit.sol";
import {AerodromeFacet} from "../src/facets/protocol/AerodromeFacet.sol";
import {MockAeroFacet} from "../src/facets/protocol/MockAeroFacet.sol";

/// @title Deploy — full diamond deployment (OPERATIONS.md §2 runbook)
/// @notice Environment:
///   OWNER_SAFE        — receives cut power (2/3+ Safe on mainnet; REQUIRED)
///   STRATEGIST_SAFE   — strategist role (REQUIRED)
///   KEEPER_ADDRESS    — keeper hot key (REQUIRED)
///   PROTOCOL          — "aerodrome" (mainnet) | "mock" (Sepolia dry run)
///   AERO, VOTING_ESCROW, VOTER, REWARDS_DISTRIBUTOR, ROUTER — protocol
///     addresses; re-verify against official docs before running (§9.2).
///   MAX_POOL_WEIGHT_WAD, MAX_DELTA_WAD, COOLDOWN_SEC — guardrails.
/// After deploy: record every address in facets.json + the address book,
/// verify on Basescan + Sourcify, diff the loupe against the manifest.
contract Deploy is Script {
    function run() external {
        address ownerSafe = vm.envAddress("OWNER_SAFE");
        address strategistSafe = vm.envAddress("STRATEGIST_SAFE");
        address keeperAddr = vm.envAddress("KEEPER_ADDRESS");
        bool useMock = keccak256(bytes(vm.envOr("PROTOCOL", string("aerodrome")))) == keccak256("mock");

        DiamondInit.Args memory args = DiamondInit.Args({
            initId: keccak256(abi.encodePacked("genesis", block.chainid)),
            protocolId: useMock ? bytes32("MOCK_AERO_V3") : bytes32("AERODROME_V2"),
            aero: vm.envOr("AERO", address(0)),
            votingEscrow: vm.envOr("VOTING_ESCROW", address(0)),
            voter: vm.envOr("VOTER", address(0)),
            rewardsDistributor: vm.envOr("REWARDS_DISTRIBUTOR", address(0)),
            router: vm.envOr("ROUTER", address(0)),
            strategist: strategistSafe,
            keeper: keeperAddr,
            maxPoolWeightWad: vm.envOr("MAX_POOL_WEIGHT_WAD", uint256(6e17)),
            maxDeltaWad: vm.envOr("MAX_DELTA_WAD", uint256(5e17)),
            cooldownSec: uint64(vm.envOr("COOLDOWN_SEC", uint256(7 days))),
            allowedPools: new address[](0), // allowlist is a post-deploy Owner action
            allowedRewardTokens: new address[](0)
        });

        vm.startBroadcast();
        address protocolFacet = useMock ? address(new MockAeroFacet()) : address(new AerodromeFacet());
        (address diamond, DiamondBuilder.CoreFacets memory f) =
            DiamondBuilder.deployDiamond(ownerSafe, protocolFacet, useMock, args);
        vm.stopBroadcast();

        console.log("diamond:            ", diamond);
        console.log("DiamondCutFacet:    ", f.diamondCut);
        console.log("DiamondLoupeFacet:  ", f.diamondLoupe);
        console.log("OwnershipFacet:     ", f.ownership);
        console.log("AccessFacet:        ", f.access);
        console.log("CustodyFacet:       ", f.custody);
        console.log("TrancheFacet:       ", f.tranche);
        console.log("TargetsFacet:       ", f.targets);
        console.log("ExecutionFacet:     ", f.execution);
        console.log(useMock ? "MockAeroFacet:      " : "AerodromeFacet:     ", protocolFacet);
        console.log("owner (cut power):  ", ownerSafe);
    }
}
