# Slither triage — pinned findings (plan §4.3)

Run: `slither .` from `contracts/` (config in `slither.config.json`; CI fails
on HIGH only — everything below is triaged, and any NEW finding must be added
here with a justification or fixed).

Baseline: slither 0.11.5, solc 0.8.26, 2026-07-17 — 0 high, 41 total results.

## Vendored diamond (`Diamond.sol`, `LibDiamond.sol`, cut/loupe facets)

- **assembly / delegatecall-loop / low-level calls** — the EIP-2535 reference
  implementation is vendored unmodified (P5). Delegatecall routing is the
  diamond mechanism itself; contained by the storage rules in
  `LibVaultStorage` (§4.2) and the diamond test suite. Pinned, do not "fix".

## Protocol facets

- **calls-loop** (`AerodromeFacet.claimable/_claimAll/swapToAero`) — claiming
  and swapping iterate keeper-supplied pool lists that the facet validates
  against the Owner allowlist; list length is operator-bounded. By design.
- **reentrancy-events / reentrancy-balance** (`AerodromeFacet`,
  `CustodyFacet.rescueERC721`) — events after external calls, and
  balance-delta accounting in `claimRewards`/`swapToAero`. State-changing
  entry points are keeper-gated behind `nonReentrant` in ExecutionFacet, and
  the protocol facets accept calls only from the diamond itself or the Owner.
  The counterparties are the canonical Aerodrome contracts. Accepted.
- **weak-prng** (`block.timestamp % WEEK`) — epoch arithmetic, not randomness.
  False positive.
- **timestamp** — cooldowns are time-based by definition; sub-second miner
  drift is irrelevant at 1h–7d scales. Accepted.
- **incorrect-equality** (`dt == 0`) — checkpoint no-op guard on elapsed
  time, monotonic by construction. Accepted.
- **unused-return** (`swapExactTokensForTokens`) — output is measured as the
  AERO balance delta (robust against fee-on-transfer paths), then checked
  against `minOut`. Intentional.

## Libraries

- **divide-before-multiply** (`LibWaterFill.fill`) — the final greedy chunk
  is deliberately `budget − chunk·(steps−1)` so allocations sum exactly to
  the budget; the TS twin does the same and the differential suite pins it.
- **uninitialized-local** — accumulators start at Solidity's zero-value;
  idiomatic. Accepted.

## Interfaces

- **shadowing-local** (`IVoter.vote(...weights)`, `distribute(...gauges)`) —
  parameter names mirror Aerodrome's own signatures. Accepted.
