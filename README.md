# Aero Autopilot PoC

A proof-of-concept autopilot (relay) for vote-escrow allocation on Base: an EIP-2535 **diamond
custody vault** plus an **off-chain TypeScript strategy engine** that manages veAERO
voting/allocation positions. It runs live against **Aerodrome v2** today and is architected to
absorb **Aero (MetaDEX03) v3** — code drops from August 3, 2026, launch expected September — as a
single `diamondCut`, not a custody migration: the diamond owns the position NFTs, and swapping the
protocol integration is a facet replace around them. The custody address is forever; logic is
facets.

Strategy decisions are computed off-chain and executed on-chain through a guardrailed,
strategy-blind target interface. The accounting-critical core (cooldown scheduling, pro-rata
revenue, water-filling, cap/burn math) exists twice — TypeScript and Solidity — and a differential
test suite proves the two agree bit-for-bit on 626 generated vectors.

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — what is built and why.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — governors & maintainers guide (runbooks, cut
  ceremony, migration, verification).
- **[docs/PLAN.md](docs/PLAN.md)** — the founding implementation plan (kept for provenance).

## Status (2026-07-17)

Against the [PLAN.md](docs/PLAN.md) §12 milestones:

| Milestone | Status |
|---|---|
| **M0 Scaffold** — monorepo, MIT license, diamond scaffold + manifest CI, indexer | ✅ complete |
| **M1 Core & sim** — both models, strategy suite, backtester, fixtures, vitest + property tests | ✅ complete (47 vitest tests) |
| **M2 Contracts** — all facets + protocol facets, unit/diamond/invariant/differential green, fork suite green | ✅ complete (65 non-fork forge tests; fork suite **7/7 green** at pinned block 48,750,000, incl. the full money path and a mid-lifecycle facet swap) |
| **M3 Web** — interactive simulator on GitHub Pages | ⏳ in progress |
| **M4 Ops & v3 readiness** — Sepolia dry run, canary, `AeroFacet` vs published code | ◻ pending |
| **M5 Launch week** — final `AeroFacet`, live migration, repo public | ◻ pending |

## Quickstart

Prerequisites: Node 22+, pnpm 10, Foundry (CI pins v1.7.1).

```bash
git clone <this repo> && cd aero-autopilot
git submodule update --init --recursive     # forge-std + openzeppelin-contracts
pnpm install

# TypeScript side: core + keeper tests
pnpm test
pnpm typecheck

# Contracts: everything except the fork suite
cd contracts
forge build --skip 'test/**' --skip 'script/**' --deny warnings   # strict gate, prod sources
forge test --no-match-path 'test/fork/*'

# Fork suite (needs a Base RPC; pinned block 48,750,000)
BASE_RPC_URL=<private endpoint> forge test --match-path 'test/fork/*' -vv
cd ..

# Differential fixtures: TS generates, Solidity verifies (CI fails on drift)
pnpm fixtures            # regenerates contracts/test/differential/fixtures/
pnpm manifest:check      # facets.json ↔ code (regenerate with: pnpm manifest:build)
```

### Keeper

Dry-run by default; `--execute` sends. Env (see `.env.example`): `BASE_RPC_URL`,
`BASE_RPC_URL_FALLBACK`, `KEEPER_PRIVATE_KEY`, `DIAMOND_ADDRESS`.

```bash
pnpm --filter @aero-poc/keeper keeper -- status --config strategy.json   # + strategyRef check
pnpm --filter @aero-poc/keeper keeper -- rotate                          # dry run
pnpm --filter @aero-poc/keeper keeper -- rotate --execute
pnpm --filter @aero-poc/keeper keeper -- harvest --execute
pnpm --filter @aero-poc/keeper keeper -- compute-targets --config strategy.json
pnpm --filter @aero-poc/keeper keeper -- watch --interval 600 --execute
```

The keeper is a hot key with mechanical, guardrail-bounded execution and no discretion: it
deliberately **cannot** submit targets. `compute-targets` prints the `strategyRef` and payload for
the Strategist Safe, which submits `setTargets(pools, weightsWad, strategyRef)` itself.

### Web (M3, in progress)

```bash
pnpm --filter @aero-poc/web dev      # Vite dev server; static site, no backend, no secrets (P7)
```

### Data

```bash
pnpm --filter @aero-poc/core index-data -- --pools 30 --epochs 52   # needs BASE_RPC_URL
pnpm --filter @aero-poc/core calibrate                              # raw → EpochDataset
```

A committed sample dataset lives at `data/aerodrome-sample.json`.

## Repository layout

```
aero-autopilot/
├── contracts/                    # Foundry project (solc 0.8.26, optimizer 200, cancun — frozen)
│   ├── src/
│   │   ├── Diamond.sol               # vendored EIP-2535 proxy, unmodified
│   │   ├── libraries/                # LibDiamond (vendored), LibVaultStorage (ERC-7201),
│   │   │                             # LibAccess, LibCooldown, LibProRata, LibGaugeCap,
│   │   │                             # LibWaterFill, LibAllocation, LibFixedPoint
│   │   ├── facets/                   # DiamondCut/Loupe (vendored), Ownership, Access, Custody,
│   │   │   └── protocol/             # Tranche, Targets, Execution + AerodromeFacet (live v2),
│   │   │                             # MockAeroFacet (sim v3), AeroFacet (v3 draft)
│   │   ├── interfaces/               # IProtocolFacet (the frozen selector set), IMinFlowOracle,
│   │   │   └── external/             # minimal Aerodrome v2 interfaces
│   │   └── init/                     # DiamondInit (genesis), ProtocolSwapInit (facet swaps)
│   ├── script/                   # Deploy.s.sol, Cut.s.sol (preview() for Safe ceremonies),
│   │                             # DiamondBuilder.sol (single source of cut composition)
│   ├── facets.json               # off-chain mirror of the loupe (pnpm manifest:build / :check)
│   └── test/                     # unit/ diamond/ invariant/ differential/ fork/ helpers/
├── packages/core/                # the TypeScript twin: math, scheduler, model (Epoch/Continuous
│                                 # + scenarios), strategies, backtest, fixtures, data indexer
├── apps/keeper/                  # thin CLI: status | rotate | harvest | compute-targets | watch
├── apps/web/                     # Vite + React static simulator (M3, in progress)
├── data/                         # versioned JSON datasets built by CI (never secrets)
├── scripts/                      # build-facet-manifest.mjs, scan-bundle-for-secrets.mjs
├── docs/                         # ARCHITECTURE.md, OPERATIONS.md, PLAN.md
└── .github/workflows/            # ci.yml (tests + manifest + fixture drift), fork-tests.yml
                                  # (nightly + `fork-tests` label), data.yml (weekly indexer),
                                  # pages.yml (build + secret-scan + Pages deploy)
```

## Security model in eight lines

- **P1** — strategies compute off-chain; the chain validates, bounds, and executes. Contracts are
  strategy-blind and never originate a decision.
- **P2** — one deterministic core, two implementations; differential fixtures prove exact equality
  (TS generates, Solidity verifies).
- **P3** — sub-weekly cadence is simulation-only until Aero ships; only the weekly strategy runs
  live on Aerodrome v2.
- **P4** — diamond custody: the address is forever, protocol swaps are a `diamondCut`; cut
  authority belongs exclusively to the Owner Safe.
- **P5** — few, standard imports: OZ 5.x utilities, forge-std, vendored diamond reference; no
  linear-storage OZ contracts, no assembly outside the vendored internals.
- **P6** — single-owner custody, no share token; Owner Safe (cold, cut power) / Strategist Safe
  (targets, guardrail-bounded) / keeper (hot, liveness-only damage ceiling).
- **P7** — secrets never reach the browser: the site is static, datasets are CI-built JSON, and CI
  secret-scans every bundle.
- **P8** — the v3 integration surface is quarantined in one facet behind the frozen
  `IProtocolFacet` selector set; expect to write `AeroFacet` twice and budget for it.

Because Basescan cannot resolve EIP-2535 routing, inspect the deployed diamond with **louper.dev**
(`https://louper.dev/diamond/<diamond address>?network=base`) or load the merged ABI — assembled
from the facet set recorded in `contracts/facets.json` — into Basescan's *Custom ABI*; both
workflows are in [OPERATIONS.md §6](docs/OPERATIONS.md#6-contract-verification-on-basescan).

## License & visibility

MIT ([LICENSE](LICENSE)), committed from day one. The repository stays **private through
audit-contest season** (~mid-September 2026) and then flips public — publication is a visibility
flip, not a re-licensing. Note the GitHub Pages site is public even while the repo is private, and
shipped strategy configs are readable in the bundle: each deploy is checked to contain no private
alpha.
