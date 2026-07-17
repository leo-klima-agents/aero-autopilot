// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {VaultFixture} from "../helpers/VaultFixture.sol";
import {ExecutionFacet} from "../../src/facets/ExecutionFacet.sol";
import {TargetsFacet} from "../../src/facets/TargetsFacet.sol";
import {TrancheFacet} from "../../src/facets/TrancheFacet.sol";
import {MockAeroFacet} from "../../src/facets/protocol/MockAeroFacet.sol";
import {IProtocolFacet} from "../../src/interfaces/IProtocolFacet.sol";
import {IDiamondLoupe} from "../../src/interfaces/IDiamondLoupe.sol";

/// @notice Fuzz/invariant handler: random keeper/strategist/time actions
/// against the full diamond. Ghost variables record what MUST hold; the
/// invariant functions assert it after every run (§7.4).
contract VaultHandler is Test {
    address internal immutable diamond;
    address internal immutable owner;
    address internal immutable strategist;
    address internal immutable keeper;
    address[3] internal pools;
    uint64 internal immutable cooldownSec;

    uint256[] public trancheIds;
    mapping(uint256 => uint256) public lastRotatedAt;
    bool public cooldownViolated;
    uint256 public scheduledGhost; // Σ scheduled emissions across checkpoints
    uint256 public rotations;

    constructor(
        address diamond_,
        address owner_,
        address strategist_,
        address keeper_,
        address[3] memory pools_,
        uint64 cooldownSec_
    ) {
        diamond = diamond_;
        owner = owner_;
        strategist = strategist_;
        keeper = keeper_;
        pools = pools_;
        cooldownSec = cooldownSec_;
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 1, 36 hours);
        vm.warp(block.timestamp + dt);
    }

    function createTranche(uint256 amount) external {
        if (trancheIds.length >= 8) return;
        amount = bound(amount, 1e18, 1_000e18);
        vm.prank(keeper);
        uint256 id = TrancheFacet(diamond).createTranche(amount, 0);
        trancheIds.push(id);
    }

    function submitTargets(uint256 seed) external {
        // Random valid-ish targets; guardrails may still reject (fine).
        uint256 w0 = bound(seed, 0, 6e17);
        uint256 w1 = bound(uint256(keccak256(abi.encode(seed))), 0, 1e18 - w0);
        if (1e18 - w0 - w1 > 6e17) return; // respect per-pool cap on the remainder
        address[] memory p = new address[](3);
        (p[0], p[1], p[2]) = (pools[0], pools[1], pools[2]);
        uint256[] memory w = new uint256[](3);
        w[0] = w0;
        w[1] = w1;
        w[2] = 1e18 - w0 - w1;
        vm.prank(strategist);
        try TargetsFacet(diamond).setTargets(p, w, bytes32(seed)) {} catch {}
    }

    function rotate(uint256 idx) external {
        if (trancheIds.length == 0) return;
        uint256 id = trancheIds[idx % trancheIds.length];
        vm.prank(keeper);
        try ExecutionFacet(diamond).rotate(id) {
            // A successful rotation before the cooldown elapsed is a violation.
            if (lastRotatedAt[id] != 0 && block.timestamp < lastRotatedAt[id] + cooldownSec) {
                cooldownViolated = true;
            }
            lastRotatedAt[id] = block.timestamp;
            rotations++;
        } catch {}
    }

    function harvest(uint256 idx) external {
        if (trancheIds.length == 0) return;
        uint256 id = trancheIds[idx % trancheIds.length];
        address[] memory p = new address[](3);
        (p[0], p[1], p[2]) = (pools[0], pools[1], pools[2]);
        vm.prank(keeper);
        try ExecutionFacet(diamond).harvest(id, abi.encode(p)) {} catch {}
    }

    function checkpointEmissions(uint256 poolIdx) external {
        address pool = pools[poolIdx % 3];
        (uint256 perSec,,, uint64 last) = MockAeroFacet(diamond).mock_poolEmissions(pool);
        uint256 dt = block.timestamp - last;
        vm.prank(owner); // checkpoint hook is Owner-gated
        try MockAeroFacet(diamond).mock_checkpointEmissions(pool) returns (uint256, uint256) {
            scheduledGhost += perSec * dt;
        } catch {}
    }

    function trancheCount() external view returns (uint256) {
        return trancheIds.length;
    }
}

contract VaultInvariantTest is VaultFixture {
    VaultHandler internal handler;
    bytes32 internal routingSnapshot;

    function setUp() public override {
        super.setUp();
        handler =
            new VaultHandler(diamond, address(this), strategist, keeper, [poolA, poolB, poolC], COOLDOWN_48H);
        // Emission schedules so conservation has something to conserve.
        MockAeroFacet(diamond).mock_setEmissionRate(poolA, 1e18);
        MockAeroFacet(diamond).mock_setEmissionRate(poolB, 5e17);
        // The handler pranks keeper/strategist for vault calls and the Owner
        // for the checkpoint hook.
        vm.allowCheatcodes(address(handler));

        routingSnapshot = _routingHash();
        targetContract(address(handler));
    }

    function _routingHash() internal view returns (bytes32) {
        IDiamondLoupe.Facet[] memory fs = IDiamondLoupe(diamond).facets();
        return keccak256(abi.encode(fs));
    }

    /// @dev Cooldowns can never be violated by any call sequence.
    function invariant_cooldownNeverViolated() public view {
        assertFalse(handler.cooldownViolated(), "a rotation beat the cooldown");
    }

    /// @dev Σ per-pool stream weight of a position ≤ its power (weights are
    /// WAD-fractions of power, so the total can never exceed it).
    function invariant_streamWeightsBoundedByPower() public view {
        uint256 n = TrancheFacet(diamond).trancheCount();
        address[3] memory ps = [poolA, poolB, poolC];
        for (uint256 t = 1; t <= n; t++) {
            (uint256 positionId,,) = TrancheFacet(diamond).getTranche(t);
            uint256 power = IProtocolFacet(diamond).positionWeight(positionId);
            uint256 total;
            for (uint256 i = 0; i < 3; i++) {
                (uint256 weight,,) = MockAeroFacet(diamond).mock_positionStream(ps[i], positionId);
                total += weight;
            }
            assertLe(total, power, "allocated stream weight exceeds position power");
        }
    }

    /// @dev Mock conservation: everything scheduled is either emitted or burned.
    function invariant_emissionsConservation() public view {
        uint256 emitted;
        uint256 burned;
        address[3] memory ps = [poolA, poolB, poolC];
        for (uint256 i = 0; i < 3; i++) {
            (, uint256 e, uint256 b,) = MockAeroFacet(diamond).mock_poolEmissions(ps[i]);
            emitted += e;
            burned += b;
        }
        assertEq(emitted + burned, handler.scheduledGhost(), "scheduled != emitted + burned");
    }

    /// @dev No call sequence excluding diamondCut can alter selector routing.
    function invariant_selectorRoutingImmutable() public view {
        assertEq(_routingHash(), routingSnapshot, "selector routing changed without a cut");
    }

    /// @dev Queued targets always satisfy the guardrails, no matter what the
    /// fuzzer submitted.
    function invariant_storedTargetsRespectGuardrails() public view {
        (address[] memory pools_, uint256[] memory weights,,) = TargetsFacet(diamond).currentTargets();
        (uint256 maxPool,,,) = TargetsFacet(diamond).guardrails();
        uint256 total;
        for (uint256 i = 0; i < pools_.length; i++) {
            assertTrue(TargetsFacet(diamond).isPoolAllowed(pools_[i]), "non-allowlisted pool stored");
            assertLe(weights[i], maxPool, "stored weight exceeds per-pool cap");
            total += weights[i];
        }
        if (pools_.length > 0) assertEq(total, WAD, "stored weights do not sum to WAD");
    }
}
