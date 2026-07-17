// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {LibCooldown} from "../../src/libraries/LibCooldown.sol";
import {LibGaugeCap} from "../../src/libraries/LibGaugeCap.sol";
import {LibAllocation} from "../../src/libraries/LibAllocation.sol";
import {LibWaterFill} from "../../src/libraries/LibWaterFill.sol";
import {LibProRata} from "../../src/libraries/LibProRata.sol";
import {LibVaultStorage} from "../../src/libraries/LibVaultStorage.sol";

/// @notice The P2 differential suite: TypeScript generates bigint-exact
/// fixture vectors (packages/core/src/fixtures); this harness replays every
/// vector through the Solidity twins and asserts EXACT equality. TS
/// generates, Solidity verifies. Regenerate with `pnpm fixtures`; CI fails
/// on drift.
contract DifferentialTest is Test {
    using stdJson for string;

    string constant FIXTURES = "test/differential/fixtures/";

    function _load(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(FIXTURES, name));
    }

    // ── cooldown.json ───────────────────────────────────────────────────────

    function test_diff_cooldown() public view {
        string memory j = _load("cooldown.json");
        uint256[] memory lastActionAt = j.readUintArray(".lastActionAt");
        uint256[] memory cooldownSec = j.readUintArray(".cooldownSec");
        uint256[] memory nowTs = j.readUintArray(".now");
        uint256[] memory expRemaining = j.readUintArray(".expectedRemaining");
        uint256[] memory expCanAct = j.readUintArray(".expectedCanAct");

        for (uint256 i = 0; i < lastActionAt.length; i++) {
            assertEq(
                LibCooldown.remaining(lastActionAt[i], cooldownSec[i], nowTs[i]),
                expRemaining[i],
                string.concat("cooldown remaining case ", vm.toString(i))
            );
            assertEq(
                LibCooldown.canAct(lastActionAt[i], cooldownSec[i], nowTs[i]),
                expCanAct[i] == 1,
                string.concat("cooldown canAct case ", vm.toString(i))
            );
        }
    }

    // ── caps.json ───────────────────────────────────────────────────────────

    function test_diff_gaugeCaps() public view {
        string memory j = _load("caps.json");
        uint256[] memory scheduled = j.readUintArray(".scheduled");
        uint256[] memory trailingRevenue = j.readUintArray(".trailingRevenue");
        uint256[] memory kappa = j.readUintArray(".kappa");
        uint256[] memory expEmitted = j.readUintArray(".expectedEmitted");
        uint256[] memory expBurned = j.readUintArray(".expectedBurned");

        for (uint256 i = 0; i < scheduled.length; i++) {
            (uint256 emitted, uint256 burned) = LibGaugeCap.apply_(scheduled[i], trailingRevenue[i], kappa[i]);
            assertEq(emitted, expEmitted[i], string.concat("caps emitted case ", vm.toString(i)));
            assertEq(burned, expBurned[i], string.concat("caps burned case ", vm.toString(i)));
        }
    }

    // ── distance.json ───────────────────────────────────────────────────────

    function test_diff_allocationDistance() public view {
        string memory j = _load("distance.json");
        uint256 count = j.readUint(".count");
        for (uint256 i = 0; i < count; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            uint256[] memory a = j.readUintArray(string.concat(base, ".weightsA"));
            uint256[] memory b = j.readUintArray(string.concat(base, ".weightsB"));
            uint256 expected = j.readUint(string.concat(base, ".expectedDistance"));
            assertEq(
                LibAllocation.distanceWad(a, b), expected, string.concat("distance case ", vm.toString(i))
            );
        }
    }

    // ── waterfill.json ──────────────────────────────────────────────────────

    function test_diff_waterfill() public view {
        string memory j = _load("waterfill.json");
        uint256 count = j.readUint(".count");
        for (uint256 i = 0; i < count; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            uint256[] memory revenues = j.readUintArray(string.concat(base, ".revenuesWad"));
            uint256[] memory ext = j.readUintArray(string.concat(base, ".externalWeightsWad"));
            uint256 budget = j.readUint(string.concat(base, ".budgetWad"));
            uint256 steps = j.readUint(string.concat(base, ".steps"));
            uint256[] memory expected = j.readUintArray(string.concat(base, ".expectedAlloc"));

            uint256[] memory alloc = LibWaterFill.fill(revenues, ext, budget, steps);
            assertEq(alloc.length, expected.length);
            for (uint256 k = 0; k < alloc.length; k++) {
                assertEq(
                    alloc[k],
                    expected[k],
                    string.concat("waterfill case ", vm.toString(i), " pool ", vm.toString(k))
                );
            }
        }
    }
}

/// @notice Pro-rata streams live in storage, so the replay needs a stateful
/// harness: one Stream, ops applied in sequence, exact-state assertions at
/// the end. Op kinds match the TS generator: 0 setRate, 1 setWeight, 2 claim.
contract ProRataDifferentialTest is Test {
    using stdJson for string;

    LibVaultStorage.Stream internal stream;

    function _resetStream() internal {
        stream.totalWeightWad = 0;
        stream.accPerWeightWad = 0;
        stream.rateWad = 0;
        stream.lastUpdate = 0;
        stream.unallocatedWad = 0;
        for (uint256 id = 0; id < 3; id++) {
            delete stream.positions[id];
        }
    }

    function test_diff_proRata() public {
        string memory j = vm.readFile("test/differential/fixtures/prorata.json");
        uint256 count = j.readUint(".count");
        for (uint256 c = 0; c < count; c++) {
            _resetStream();
            string memory base = string.concat(".cases[", vm.toString(c), "]");
            uint256[] memory opKind = j.readUintArray(string.concat(base, ".opKind"));
            uint256[] memory opNow = j.readUintArray(string.concat(base, ".opNow"));
            uint256[] memory opA = j.readUintArray(string.concat(base, ".opA"));
            uint256[] memory opB = j.readUintArray(string.concat(base, ".opB"));
            uint256[] memory opExpect = j.readUintArray(string.concat(base, ".opExpect"));

            for (uint256 i = 0; i < opKind.length; i++) {
                uint64 nowTs = uint64(opNow[i]);
                if (opKind[i] == 0) {
                    LibProRata.setRate(stream, nowTs, opA[i]);
                } else if (opKind[i] == 1) {
                    LibProRata.setWeight(stream, nowTs, opA[i], opB[i]);
                } else {
                    uint256 claimed = LibProRata.claim(stream, nowTs, opA[i]);
                    assertEq(
                        claimed,
                        opExpect[i],
                        string.concat("claim case ", vm.toString(c), " op ", vm.toString(i))
                    );
                }
            }

            uint64 finalNow = uint64(j.readUint(string.concat(base, ".finalNow")));
            assertEq(
                stream.accPerWeightWad,
                j.readUint(string.concat(base, ".expectedAccPerWeight")),
                string.concat("accPerWeight case ", vm.toString(c))
            );
            assertEq(
                stream.totalWeightWad,
                j.readUint(string.concat(base, ".expectedTotalWeight")),
                string.concat("totalWeight case ", vm.toString(c))
            );
            assertEq(
                stream.unallocatedWad,
                j.readUint(string.concat(base, ".expectedUnallocated")),
                string.concat("unallocated case ", vm.toString(c))
            );
            uint256[] memory expectedEarned = j.readUintArray(string.concat(base, ".expectedEarnedFinal"));
            for (uint256 id = 0; id < 3; id++) {
                assertEq(
                    LibProRata.earned(stream, finalNow, id),
                    expectedEarned[id],
                    string.concat("earnedFinal case ", vm.toString(c), " id ", vm.toString(id))
                );
            }
        }
    }
}
