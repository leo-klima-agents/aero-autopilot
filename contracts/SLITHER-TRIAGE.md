# Slither triage — pinned findings (plan §4.3)

Run: `slither .` from `contracts/` (config in `slither.config.json`,
`fail_on: high`). CI fails on HIGH-impact findings; anything HIGH that is a
contextual false positive is suppressed **inline** with a
`slither-disable` comment pointing back here, so every suppression is visible
in review. Any NEW finding must be fixed or triaged here with justification.

Baseline: slither 0.11.5, solc 0.8.26, 2026-07-17 — 41 raw results:
3 High (all triaged inline, below), 14 Medium, 24 Low.

## HIGH — triaged inline

- **weak-prng ×2** (`AerodromeFacet.cooldownRemaining`, `currentWindow`) —
  `block.timestamp % WEEK` is Aerodrome epoch arithmetic, not randomness.
  False positive; suppressed with `slither-disable-next-line weak-prng`.
- **reentrancy-balance ×1** (`AerodromeFacet.swapToAero`) — output is
  measured as the AERO balance delta around the router calls, then checked
  against `minOut`. Slither flags that reentrancy during the router call
  could inflate the delta. Entry is keeper-gated behind ExecutionFacet's
  `nonReentrant` (or the Owner), hop tokens are Owner-allowlisted, and the
  counterparty is the canonical Aerodrome router; a poisoned delta requires a
  malicious allowlisted token — an Owner-level failure, not a keeper-level
  one (P6). Suppressed with `slither-disable-start/end reentrancy-balance`.

## MEDIUM / LOW — accepted, not suppressed

### Vendored diamond (`Diamond.sol`, `LibDiamond.sol`, cut/loupe facets)

- **assembly / delegatecall / low-level calls** — the EIP-2535 reference
  implementation is vendored unmodified (P5). Delegatecall routing is the
  diamond mechanism itself; contained by the storage rules in
  `LibVaultStorage` (§4.2) and the diamond test suite. Pinned, do not "fix".

### Protocol facets

- **calls-loop** (`AerodromeFacet.claimable/_claimAll/swapToAero`) — claiming
  and swapping iterate keeper-supplied pool lists that the facet validates
  against the Owner allowlist; list length is operator-bounded. By design.
- **reentrancy-events** — events after external calls to canonical Aerodrome
  contracts; state-changing entry points are keeper-gated behind
  `nonReentrant` in ExecutionFacet. Accepted.
- **timestamp** — cooldowns are time-based by definition; sub-second miner
  drift is irrelevant at 1h–7d scales. Accepted.
- **incorrect-equality** (`dt == 0`) — checkpoint no-op guard on elapsed
  time, monotonic by construction. Accepted.
- **unused-return** (`swapExactTokensForTokens`) — output is measured as the
  AERO balance delta (robust against fee-on-transfer paths), then checked
  against `minOut`. Intentional.

### Libraries

- **divide-before-multiply** (`LibWaterFill.fill`) — the final greedy chunk
  is deliberately `budget − chunk·(steps−1)` so allocations sum exactly to
  the budget; the TS twin does the same and the differential suite pins it.
- **uninitialized-local** — accumulators start at Solidity's zero-value;
  idiomatic. Accepted.

### Interfaces

- **shadowing-local** (`IVoter.vote(...weights)`, `distribute(...gauges)`) —
  parameter names mirror Aerodrome's own signatures. Accepted.

## Process note (2026-07-17)

The first version of this file claimed "0 high" — wrong: the local exit-code
check measured the tail of a pipeline instead of slither itself. The CI
failure on PR #1 was the gate working as configured. Impact levels are now
taken from `slither . --json` rather than eyeballed.
