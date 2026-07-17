/**
 * Aerodrome v2 (Base) address book and minimal ABIs for the indexer and
 * keeper. Addresses were verified on-chain at implementation time
 * (2026-07-17, Base chainId 8453) by cross-checking the wiring:
 *   escrow.token() == AERO, voter.ve() == escrow,
 *   rewardsDistributor.ve() == escrow, router.voter() == voter.
 * The deploy runbook re-verifies against official docs before any funds move.
 */
export const AERODROME = {
  chainId: 8453,
  aero: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  votingEscrow: "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4",
  voter: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
  rewardsDistributor: "0x227f65131A261548b057215bB1D5Ab2997964C7d",
  router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
} as const;

export const EPOCH_SECONDS = 604_800n;

/** Epoch start (Thursday 00:00 UTC) containing `ts`. */
export function epochStart(ts: bigint): bigint {
  return ts - (ts % EPOCH_SECONDS);
}

export const voterAbi = [
  { type: "function", name: "length", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pools", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "weights", stateMutability: "view", inputs: [{ name: "pool", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "gauges", stateMutability: "view", inputs: [{ name: "pool", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "gaugeToFees", stateMutability: "view", inputs: [{ name: "gauge", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "gaugeToBribe", stateMutability: "view", inputs: [{ name: "gauge", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isAlive", stateMutability: "view", inputs: [{ name: "gauge", type: "address" }], outputs: [{ type: "bool" }] },
  {
    type: "event",
    name: "DistributeReward",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "gauge", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const votingRewardAbi = [
  {
    type: "event",
    name: "NotifyReward",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "reward", type: "address", indexed: true },
      { name: "epoch", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
