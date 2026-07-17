// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal Aerodrome v2 (Base) interfaces — only what the vault
/// touches (P5). Addresses live in config and were verified on-chain against
/// the wiring (escrow.token() == AERO, voter.ve() == escrow, …); the deploy
/// runbook re-verifies against official docs before funds move.

interface IVotingEscrow {
    function createLock(uint256 value, uint256 lockDuration) external returns (uint256 tokenId);
    function increaseAmount(uint256 tokenId, uint256 value) external;
    function increaseUnlockTime(uint256 tokenId, uint256 lockDuration) external;
    function balanceOfNFT(uint256 tokenId) external view returns (uint256);
    function locked(uint256 tokenId) external view returns (int128 amount, uint256 end, bool isPermanent);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function token() external view returns (address);
}

interface IVoter {
    function vote(uint256 tokenId, address[] calldata poolVote, uint256[] calldata weights) external;
    function reset(uint256 tokenId) external;
    function poke(uint256 tokenId) external;
    function claimBribes(address[] calldata bribes, address[][] calldata tokens, uint256 tokenId) external;
    function claimFees(address[] calldata fees, address[][] calldata tokens, uint256 tokenId) external;
    function gauges(address pool) external view returns (address);
    function gaugeToFees(address gauge) external view returns (address);
    function gaugeToBribe(address gauge) external view returns (address);
    function weights(address pool) external view returns (uint256);
    function lastVoted(uint256 tokenId) external view returns (uint256);
    function ve() external view returns (address);
    function distribute(address[] calldata gauges) external;
    function epochStart(uint256 timestamp) external view returns (uint256);
    function epochNext(uint256 timestamp) external view returns (uint256);
    function epochVoteStart(uint256 timestamp) external view returns (uint256);
    function epochVoteEnd(uint256 timestamp) external view returns (uint256);
}

interface IRewardsDistributor {
    function claim(uint256 tokenId) external returns (uint256);
    function claimable(uint256 tokenId) external view returns (uint256);
}

interface IVotingReward {
    function rewardsListLength() external view returns (uint256);
    function rewards(uint256 index) external view returns (address);
    function earned(address token, uint256 tokenId) external view returns (uint256);
}

interface IRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function defaultFactory() external view returns (address);
}
