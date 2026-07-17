/**
 * The merged diamond ABI the keeper drives — the subset of facets.json it
 * touches (one address, many facets; the loupe routes selectors). Kept as
 * human-readable signatures so drift against the manifest is greppable.
 */
import { parseAbi } from "viem";

export const diamondAbi = parseAbi([
  // TrancheFacet
  "function trancheCount() view returns (uint256)",
  "function getTranche(uint256 trancheId) view returns (uint256 positionId, uint64 lastActionAt, bool active)",
  "function trancheCooldownRemaining(uint256 trancheId) view returns (uint256)",
  "function createTranche(uint256 amount, uint256 lockDuration) returns (uint256)",
  // TargetsFacet
  "function currentTargets() view returns (address[] pools, uint256[] weightsWad, bytes32 strategyRef, uint64 updatedAt)",
  "function guardrails() view returns (uint256 maxPoolWeightWad, uint256 maxDeltaWad, uint64 cooldownSec, address minFlowOracle)",
  // ExecutionFacet
  "function rotate(uint256 trancheId)",
  "function harvest(uint256 trancheId, bytes claimData)",
  "function compound(uint256 trancheId, bytes swapData, uint256 minOut)",
  // ProtocolFacet (frozen selector set)
  "function protocolId() view returns (bytes32)",
  "function claimable(uint256 positionId, address[] pools) view returns (address[] tokens, uint256[] amounts)",
  "function positionWeight(uint256 positionId) view returns (uint256)",
  "function cooldownRemaining(uint256 positionId) view returns (uint256)",
  "function currentWindow() view returns (uint64 start, uint64 end)",
  // events the keeper watches
  "event TargetsQueued(bytes32 indexed strategyRef, address[] pools, uint256[] weightsWad, uint256 deltaWad)",
  "event Rotated(uint256 indexed trancheId, bytes32 indexed strategyRef, uint256 positionId)",
  "event DiamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)",
]);

export const voterAbi = parseAbi([
  "function gauges(address pool) view returns (address)",
  "function gaugeToFees(address gauge) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
]);

export const votingRewardAbi = parseAbi([
  "function rewardsListLength() view returns (uint256)",
  "function rewards(uint256 index) view returns (address)",
  "function earned(address token, uint256 tokenId) view returns (uint256)",
]);
