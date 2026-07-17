// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LibAccess} from "../../libraries/LibAccess.sol";
import {LibFixedPoint} from "../../libraries/LibFixedPoint.sol";
import {LibVaultStorage} from "../../libraries/LibVaultStorage.sol";
import {IProtocolFacet} from "../../interfaces/IProtocolFacet.sol";
import {
    IRewardsDistributor,
    IRouter,
    IVoter,
    IVotingEscrow,
    IVotingReward
} from "../../interfaces/external/IAerodrome.sol";

/// @title AerodromeFacet — live Aerodrome v2 integration on Base (§4.1)
/// @notice The only facet that talks to real protocol contracts today.
/// v2 mechanics honored here:
///   - vote() overwrites the previous vote; one vote action per epoch per
///     tokenId (so allocate() never calls reset() first — that would burn
///     the epoch's action);
///   - votes persist across epochs but decay with ve balance (keeper "poke"
///     policy lives in OPERATIONS.md);
///   - rebase claims compound into the lock via the RewardsDistributor.
contract AerodromeFacet is IProtocolFacet {
    using SafeERC20 for IERC20;

    event StakeCreated(uint256 indexed positionId, uint256 amount, uint256 lockDuration);
    event Allocated(uint256 indexed positionId, address[] pools, uint256[] weightsWad);
    event RewardsClaimed(uint256 indexed positionId, uint256 aeroOut);
    event RebaseClaimed(uint256 indexed positionId, uint256 amount);
    event SwappedToAero(uint256 amountOut);

    error NotAuthorized(address caller);
    error PoolNotAllowed(address pool);
    error TokenNotAllowed(address token);
    error RouteMustEndInAero(address token);
    error EmptyRoute();

    bytes32 private constant PROTOCOL_ID = "AERODROME_V2";
    uint256 private constant WEEK = 7 days;

    /// @dev Mutating protocol calls arrive via the diamond's own execution
    /// facets (self-call) or from the Owner (migration runbook).
    modifier onlyAuthorized() {
        if (msg.sender != address(this)) {
            LibAccess.enforceOwner();
        }
        _;
    }

    function protocolId() external pure returns (bytes32) {
        return PROTOCOL_ID;
    }

    function createStake(uint256 amount, uint256 lockDuration)
        external
        onlyAuthorized
        returns (uint256 positionId)
    {
        LibVaultStorage.ProtocolConfigStorage storage cfg = LibVaultStorage.protocolConfig();
        IERC20(cfg.aero).forceApprove(cfg.votingEscrow, amount);
        positionId = IVotingEscrow(cfg.votingEscrow).createLock(amount, lockDuration);
        emit StakeCreated(positionId, amount, lockDuration);
    }

    /// @notice v2 vote weights are relative, so wad fractions pass through
    /// unchanged. Overwrites any previous vote (no reset needed or allowed).
    function allocate(uint256 positionId, address[] calldata pools, uint256[] calldata weightsWad)
        external
        onlyAuthorized
    {
        IVoter(LibVaultStorage.protocolConfig().voter).vote(positionId, pools, weightsWad);
        emit Allocated(positionId, pools, weightsWad);
    }

    function resetPosition(uint256 positionId) external onlyAuthorized {
        IVoter(LibVaultStorage.protocolConfig().voter).reset(positionId);
    }

    function claimable(uint256 positionId, address[] calldata pools)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        IVoter voter = IVoter(LibVaultStorage.protocolConfig().voter);
        // First pass: size the flattened arrays.
        uint256 total;
        for (uint256 i = 0; i < pools.length; i++) {
            (address fees, address bribe) = _rewardContracts(voter, pools[i]);
            total += IVotingReward(fees).rewardsListLength() + IVotingReward(bribe).rewardsListLength();
        }
        tokens = new address[](total);
        amounts = new uint256[](total);
        uint256 k;
        for (uint256 i = 0; i < pools.length; i++) {
            (address fees, address bribe) = _rewardContracts(voter, pools[i]);
            k = _collect(fees, positionId, tokens, amounts, k);
            k = _collect(bribe, positionId, tokens, amounts, k);
        }
    }

    function _collect(
        address rewardContract,
        uint256 positionId,
        address[] memory tokens,
        uint256[] memory amounts,
        uint256 k
    ) private view returns (uint256) {
        uint256 len = IVotingReward(rewardContract).rewardsListLength();
        for (uint256 j = 0; j < len; j++) {
            address token = IVotingReward(rewardContract).rewards(j);
            tokens[k] = token;
            amounts[k] = IVotingReward(rewardContract).earned(token, positionId);
            k++;
        }
        return k;
    }

    function _rewardContracts(IVoter voter, address pool) private view returns (address fees, address bribe) {
        address gauge = voter.gauges(pool);
        fees = voter.gaugeToFees(gauge);
        bribe = voter.gaugeToBribe(gauge);
    }

    /// @param data abi.encode(address[] pools, address[][] feeTokens, address[][] bribeTokens).
    /// Pools must be allowlisted — the facet derives the reward contracts
    /// itself, so a hostile keeper cannot point the Voter at arbitrary code.
    function claimRewards(uint256 positionId, bytes calldata data)
        external
        onlyAuthorized
        returns (uint256 aeroOut)
    {
        address aero = LibVaultStorage.protocolConfig().aero;
        uint256 aeroBefore = IERC20(aero).balanceOf(address(this));
        _claimAll(positionId, data);
        aeroOut = IERC20(aero).balanceOf(address(this)) - aeroBefore;
        emit RewardsClaimed(positionId, aeroOut);
    }

    function _claimAll(uint256 positionId, bytes calldata data) private {
        (address[] memory pools, address[][] memory feeTokens, address[][] memory bribeTokens) =
            abi.decode(data, (address[], address[][], address[][]));
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();
        IVoter voter = IVoter(LibVaultStorage.protocolConfig().voter);

        address[] memory fees = new address[](pools.length);
        address[] memory bribes = new address[](pools.length);
        for (uint256 i = 0; i < pools.length; i++) {
            if (!ts.allowedPool[pools[i]]) revert PoolNotAllowed(pools[i]);
            (fees[i], bribes[i]) = _rewardContracts(voter, pools[i]);
        }
        voter.claimFees(fees, feeTokens, positionId);
        voter.claimBribes(bribes, bribeTokens, positionId);
    }

    /// @notice Rebase claims deposit straight back into the lock (v2
    /// RewardsDistributor semantics) — unclaimed rebase is compounding drag.
    function claimRebase(uint256 positionId) external onlyAuthorized returns (uint256 amount) {
        amount = IRewardsDistributor(LibVaultStorage.protocolConfig().rewardsDistributor).claim(positionId);
        emit RebaseClaimed(positionId, amount);
    }

    /// @param data abi.encode(IRouter.Route[][] routesList, uint256[] amountsIn).
    /// Every hop must stay inside the Owner-set reward-token allowlist and
    /// every route must terminate in AERO — a compromised keeper can waste
    /// gas, not exfiltrate value (P6 damage ceilings).
    /// @dev Triaged HIGH (SLITHER-TRIAGE.md): the balance-delta accounting is
    /// deliberate. Entry is keeper-gated behind ExecutionFacet's nonReentrant
    /// or the Owner; the router is the canonical Aerodrome router.
    // slither-disable-start reentrancy-balance
    function swapToAero(bytes calldata data, uint256 minOut)
        external
        onlyAuthorized
        returns (uint256 amountOut)
    {
        (IRouter.Route[][] memory routesList, uint256[] memory amountsIn) =
            abi.decode(data, (IRouter.Route[][], uint256[]));
        if (routesList.length != amountsIn.length) revert EmptyRoute();
        LibVaultStorage.ProtocolConfigStorage storage cfg = LibVaultStorage.protocolConfig();
        LibVaultStorage.TargetsStorage storage ts = LibVaultStorage.targets();

        uint256 aeroBefore = IERC20(cfg.aero).balanceOf(address(this));
        for (uint256 i = 0; i < routesList.length; i++) {
            IRouter.Route[] memory routes = routesList[i];
            if (routes.length == 0) revert EmptyRoute();
            address tokenIn = routes[0].from;
            if (tokenIn != cfg.aero && !ts.allowedRewardToken[tokenIn]) revert TokenNotAllowed(tokenIn);
            for (uint256 j = 0; j < routes.length; j++) {
                address hop = routes[j].to;
                if (hop != cfg.aero && !ts.allowedRewardToken[hop]) revert TokenNotAllowed(hop);
            }
            if (routes[routes.length - 1].to != cfg.aero) {
                revert RouteMustEndInAero(routes[routes.length - 1].to);
            }
            IERC20(tokenIn).forceApprove(cfg.router, amountsIn[i]);
            IRouter(cfg.router)
                .swapExactTokensForTokens(
                    amountsIn[i],
                    0, // aggregate slippage enforced below across all routes
                    routes,
                    address(this),
                    block.timestamp
                );
        }
        amountOut = IERC20(cfg.aero).balanceOf(address(this)) - aeroBefore;
        require(amountOut >= minOut, "Aerodrome: insufficient output");
        emit SwappedToAero(amountOut);
    }
    // slither-disable-end reentrancy-balance

    function compoundPosition(uint256 positionId, uint256 amount) external onlyAuthorized {
        LibVaultStorage.ProtocolConfigStorage storage cfg = LibVaultStorage.protocolConfig();
        IERC20(cfg.aero).forceApprove(cfg.votingEscrow, amount);
        IVotingEscrow(cfg.votingEscrow).increaseAmount(positionId, amount);
    }

    function positionWeight(uint256 positionId) external view returns (uint256) {
        return IVotingEscrow(LibVaultStorage.protocolConfig().votingEscrow).balanceOfNFT(positionId);
    }

    /// @notice v2 grid: one vote action per epoch, inside the vote window
    /// (epoch start + 1h … epoch end − 1h). Epoch math is computed locally
    /// (fixed in v2) and verified empirically by the fork suite.
    function cooldownRemaining(uint256 positionId) external view returns (uint256) {
        IVoter voter = IVoter(LibVaultStorage.protocolConfig().voter);
        // Triaged (SLITHER-TRIAGE.md): modulo on timestamp is epoch
        // arithmetic, not randomness.
        // slither-disable-next-line weak-prng
        uint256 epochStart = block.timestamp - (block.timestamp % WEEK);
        uint256 lastVoted = voter.lastVoted(positionId);
        uint256 nextAllowed;
        if (lastVoted >= epochStart) {
            // Already acted this epoch: next window opens 1h after the flip.
            nextAllowed = epochStart + WEEK + 1 hours;
        } else {
            // Not yet acted: wait for this epoch's window to open (first hour
            // is the distribute window).
            nextAllowed = epochStart + 1 hours;
        }
        return LibFixedPoint.saturatingSub(nextAllowed, block.timestamp);
    }

    function currentWindow() external view returns (uint64 start, uint64 end) {
        // Triaged (SLITHER-TRIAGE.md): epoch arithmetic, not randomness.
        // slither-disable-next-line weak-prng
        uint256 epochStart = block.timestamp - (block.timestamp % WEEK);
        // casting to 'uint64' is safe: unix timestamps fit uint64 for ~584B years
        // forge-lint: disable-next-line(unsafe-typecast)
        return (uint64(epochStart), uint64(epochStart + WEEK));
    }
}
