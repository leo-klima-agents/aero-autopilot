// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title LibVaultStorage — every byte of vault state, ERC-7201 namespaced
/// @notice One namespace per domain, each at a keccak-derived slot (§4.2).
/// Storage discipline, CI-enforced where possible:
///   1. Structs are APPEND-ONLY: never reorder, retype, or delete fields —
///      deprecate by renaming to __deprecated_*.
///   2. No facet declares contract-level state variables.
///   3. Every namespace string is registered HERE and only here; the CI
///      layout check (scripts/check-storage-layout.mjs) fails on duplicates
///      or on struct layouts that changed without an append.
///   4. DiamondInit is the only writer during cuts.
///
/// @dev Slot derivation is ERC-7201:
///   keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))
/// The one-line `s.slot := slot` bindings below are the only assembly outside
/// the vendored diamond internals (P5) — Solidity offers no other way to bind
/// a struct to a namespaced slot; the same idiom OpenZeppelin 5.x uses.
library LibVaultStorage {
    // ─────────────────────────────── access ────────────────────────────────
    bytes32 internal constant ACCESS_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.access")) - 1)) & ~bytes32(uint256(0xff));

    struct AccessStorage {
        mapping(bytes32 role => mapping(address account => bool)) roles;
    }

    function access() internal pure returns (AccessStorage storage s) {
        bytes32 slot = ACCESS_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ─────────────────────────────── tranches ──────────────────────────────
    bytes32 internal constant TRANCHES_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.tranches")) - 1)) & ~bytes32(uint256(0xff));

    struct Tranche {
        uint256 positionId;
        uint64 lastActionAt;
        bool active;
    }

    struct TrancheStorage {
        /// @dev tranche ids are 1-based; 0 is "no tranche".
        uint256 nextTrancheId;
        mapping(uint256 trancheId => Tranche) tranches;
    }

    function tranches() internal pure returns (TrancheStorage storage s) {
        bytes32 slot = TRANCHES_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ─────────────────────────────── targets ───────────────────────────────
    bytes32 internal constant TARGETS_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.targets")) - 1)) & ~bytes32(uint256(0xff));

    struct TargetsStorage {
        // The queued intent (P1): validated, bounded, strategy-blind.
        address[] targetPools;
        uint256[] targetWeightsWad;
        bytes32 strategyRef;
        uint64 targetsUpdatedAt;
        // Guardrails (Owner-set).
        uint256 maxPoolWeightWad;
        uint256 maxDeltaWad;
        uint64 cooldownSec;
        address minFlowOracle;
        // Pool allowlist (Owner-set).
        mapping(address pool => bool) allowedPool;
        address[] allowedPoolList;
        // Reward tokens compound routes may traverse (Owner-set).
        mapping(address token => bool) allowedRewardToken;
    }

    function targets() internal pure returns (TargetsStorage storage s) {
        bytes32 slot = TARGETS_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ──────────────────────────── protocol.config ──────────────────────────
    bytes32 internal constant PROTOCOL_CONFIG_SLOT = keccak256(
        abi.encode(uint256(keccak256("aero.autopilot.protocol.config")) - 1)
    ) & ~bytes32(uint256(0xff));

    struct ProtocolConfigStorage {
        bytes32 protocolId; // "AERODROME_V2" | "MOCK_AERO_V3" | "AERO_V3"
        address aero;
        address votingEscrow;
        address voter;
        address rewardsDistributor;
        address router;
    }

    function protocolConfig() internal pure returns (ProtocolConfigStorage storage s) {
        bytes32 slot = PROTOCOL_CONFIG_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ─────────────────────────────── mockaero ──────────────────────────────
    bytes32 internal constant MOCK_AERO_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.mockaero")) - 1)) & ~bytes32(uint256(0xff));

    struct StreamPosition {
        uint256 weightWad;
        uint256 accPaidWad;
        uint256 earnedWad;
    }

    /// @dev One pro-rata revenue stream per pool (LibProRata operates on this).
    struct Stream {
        uint256 totalWeightWad;
        uint256 accPerWeightWad;
        uint256 rateWad; // revenue per second
        uint64 lastUpdate;
        uint256 unallocatedWad;
        mapping(uint256 positionId => StreamPosition) positions;
    }

    struct MockPosition {
        uint256 powerWad;
        uint64 lastActionAt;
        bool exists;
        address[] pools; // pools this position currently allocates to
    }

    struct MockPoolEmissions {
        uint256 scheduledPerSecWad;
        uint64 lastCheckpoint;
        uint256 emittedWad;
        uint256 burnedWad;
        uint256 revenueSinceCheckpointWad; // trailing realized revenue for the cap
    }

    struct MockAeroStorage {
        uint64 cooldownSec;
        uint256 kappaWad;
        uint256 nextPositionId;
        mapping(uint256 positionId => MockPosition) positions;
        mapping(address pool => Stream) streams;
        mapping(address pool => MockPoolEmissions) emissions;
        address[] poolList;
        mapping(address pool => bool) poolKnown;
    }

    function mockAero() internal pure returns (MockAeroStorage storage s) {
        bytes32 slot = MOCK_AERO_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ──────────────────────────────── init ─────────────────────────────────
    bytes32 internal constant INIT_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.init")) - 1)) & ~bytes32(uint256(0xff));

    struct InitStorage {
        mapping(bytes32 initId => bool) executed;
    }

    function init() internal pure returns (InitStorage storage s) {
        bytes32 slot = INIT_SLOT;
        assembly {
            s.slot := slot
        }
    }

    // ────────────────────────────── reentrancy ─────────────────────────────
    bytes32 internal constant REENTRANCY_SLOT =
        keccak256(abi.encode(uint256(keccak256("aero.autopilot.reentrancy")) - 1)) & ~bytes32(uint256(0xff));

    struct ReentrancyStorage {
        uint256 status; // 0/1 = not entered, 2 = entered
    }

    function reentrancy() internal pure returns (ReentrancyStorage storage s) {
        bytes32 slot = REENTRANCY_SLOT;
        assembly {
            s.slot := slot
        }
    }
}
