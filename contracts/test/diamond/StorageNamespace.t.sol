// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LibVaultStorage} from "../../src/libraries/LibVaultStorage.sol";
import {LibDiamond} from "../../src/libraries/LibDiamond.sol";

/// @notice Storage discipline checks (§4.2): every namespace at its exact
/// ERC-7201 slot, all namespaces distinct, none colliding with the vendored
/// diamond's own storage position.
contract StorageNamespaceTest is Test {
    function _erc7201(string memory id) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function test_slotsMatchDeclaredDerivation() public pure {
        assertEq(LibVaultStorage.ACCESS_SLOT, _erc7201("aero.autopilot.access"));
        assertEq(LibVaultStorage.TRANCHES_SLOT, _erc7201("aero.autopilot.tranches"));
        assertEq(LibVaultStorage.TARGETS_SLOT, _erc7201("aero.autopilot.targets"));
        assertEq(LibVaultStorage.PROTOCOL_CONFIG_SLOT, _erc7201("aero.autopilot.protocol.config"));
        assertEq(LibVaultStorage.MOCK_AERO_SLOT, _erc7201("aero.autopilot.mockaero"));
        assertEq(LibVaultStorage.INIT_SLOT, _erc7201("aero.autopilot.init"));
        assertEq(LibVaultStorage.REENTRANCY_SLOT, _erc7201("aero.autopilot.reentrancy"));
    }

    function test_allNamespacesDistinct() public pure {
        bytes32[8] memory slots = [
            LibVaultStorage.ACCESS_SLOT,
            LibVaultStorage.TRANCHES_SLOT,
            LibVaultStorage.TARGETS_SLOT,
            LibVaultStorage.PROTOCOL_CONFIG_SLOT,
            LibVaultStorage.MOCK_AERO_SLOT,
            LibVaultStorage.INIT_SLOT,
            LibVaultStorage.REENTRANCY_SLOT,
            LibDiamond.DIAMOND_STORAGE_POSITION
        ];
        for (uint256 i = 0; i < slots.length; i++) {
            for (uint256 j = i + 1; j < slots.length; j++) {
                assertNotEq(slots[i], slots[j], "namespace slot collision");
            }
        }
    }

    /// @dev ERC-7201 slots are 256-aligned (low byte zeroed), so two distinct
    /// namespaces are at least 256 slots apart — struct growth cannot bleed
    /// into a neighbor until a struct exceeds 256 slots. Assert the gap.
    function test_namespaceSpacing() public pure {
        bytes32[7] memory slots = [
            LibVaultStorage.ACCESS_SLOT,
            LibVaultStorage.TRANCHES_SLOT,
            LibVaultStorage.TARGETS_SLOT,
            LibVaultStorage.PROTOCOL_CONFIG_SLOT,
            LibVaultStorage.MOCK_AERO_SLOT,
            LibVaultStorage.INIT_SLOT,
            LibVaultStorage.REENTRANCY_SLOT
        ];
        for (uint256 i = 0; i < slots.length; i++) {
            assertEq(uint256(slots[i]) & 0xff, 0, "slot not 256-aligned");
            for (uint256 j = i + 1; j < slots.length; j++) {
                uint256 a = uint256(slots[i]);
                uint256 b = uint256(slots[j]);
                uint256 gap = a > b ? a - b : b - a;
                assertGe(gap, 256, "namespaces closer than 256 slots");
            }
        }
    }
}
