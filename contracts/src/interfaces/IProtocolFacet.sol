// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProtocolFacet — the frozen selector set every protocol facet implements
/// @notice The v3 integration surface is quarantined behind this interface
/// (P8): AerodromeFacet (live v2), MockAeroFacet (simulated v3), AeroFacet
/// (drafted from specs, rewritten against published code). The August and
/// September protocol transitions are a single diamondCut replacing one
/// facet's selectors with another's — this interface is what makes that a
/// cut instead of a migration, so it changes only by explicit Owner decision.
interface IProtocolFacet {
    /// @return Protocol tag: "AERODROME_V2" | "MOCK_AERO_V3" | "AERO_V3".
    function protocolId() external view returns (bytes32);

    /// @notice Lock `amount` of the underlying into a new position NFT owned
    /// by the diamond. Positions are created as separate stakes from the
    /// start: v3 positions cannot be split (§4.1).
    function createStake(uint256 amount, uint256 lockDuration) external returns (uint256 positionId);

    /// @notice Point the position's full power at `pools` with wad fractions
    /// `weightsWad`. Implementations replace any previous allocation wholesale
    /// (v2 re-vote overwrites; v3 reallocate under cooldown).
    function allocate(uint256 positionId, address[] calldata pools, uint256[] calldata weightsWad) external;

    /// @notice Clear the position's allocation entirely (exit/migration path).
    function resetPosition(uint256 positionId) external;

    /// @notice Claimable rewards for the position across `pools`, flattened.
    function claimable(uint256 positionId, address[] calldata pools)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts);

    /// @notice Claim rewards into the diamond. `data` is protocol-specific
    /// claim plumbing (v2: abi-encoded reward contracts + token lists,
    /// validated against the pool allowlist inside the facet).
    /// @return aeroOut AERO received directly by this claim (0 if mixed tokens).
    function claimRewards(uint256 positionId, bytes calldata data) external returns (uint256 aeroOut);

    /// @notice Claim the protocol rebase for the position, if any.
    function claimRebase(uint256 positionId) external returns (uint256 amount);

    /// @notice Swap reward tokens held by the diamond into the underlying.
    /// `data` is protocol-specific routing, validated inside the facet.
    function swapToAero(bytes calldata data, uint256 minOut) external returns (uint256 amountOut);

    /// @notice Lock `amount` of underlying held by the diamond into the position.
    function compoundPosition(uint256 positionId, uint256 amount) external;

    /// @return Current allocation power of the position, wad.
    function positionWeight(uint256 positionId) external view returns (uint256);

    /// @return Seconds until the position may reallocate; 0 when unlocked.
    function cooldownRemaining(uint256 positionId) external view returns (uint256);

    /// @notice The protocol's current decision window (v2: the weekly epoch;
    /// v3 continuous: (now, now)).
    function currentWindow() external view returns (uint64 start, uint64 end);
}
