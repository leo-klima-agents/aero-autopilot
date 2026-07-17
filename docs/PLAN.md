# Aero Autopilot PoC — Implementation Plan

**Date:** 2026-07-17 · **Scope:** Base / Aerodrome only

> This is the founding implementation plan the repository was built against.
> ARCHITECTURE.md describes what was actually built; OPERATIONS.md is the
> governors & maintainers guide. Where they disagree, the code and those two
> documents win — this file is kept as the original spec for provenance.

## 1. Context and timing

Aero (MetaDEX03) replaces the weekly-epoch vote-escrow model with continuous, cooldown-gated Predictive Allocation: sAERO holders allocate toward pools ahead of expected volume, revenue streams to allocators pro-rata and in real time, and Gauge Caps burn emissions that exceed a multiple of pool revenue. The protocol is in audit; the codebase and updated specifications publish in batches starting **August 3, 2026**, final audits run through August 21, a public audit contest runs August 24 – September 11, and launch is expected in **September**.

This project builds a proof-of-concept autopilot (relay): a custody vault plus an off-chain strategy engine that manages voting/allocation positions. It runs live against Aerodrome v2 on Base today and is architected to absorb Aero's real interfaces as they publish, with the September migration treated as a first-class operational event.

The plan phases work around August 3: before it, everything targets live Aerodrome plus a parameterized simulation of the Aero model derived from the `dromos-labs/metadex-specs` idea drafts; after it, a protocol facet swap absorbs the published code.

## 2. Design principles

**P1 — Strategy decisions are computed off-chain; they are validated, bounded, and executed on-chain.** Strategies need historical data, forecasting, optimization, and fast iteration — all hostile to the EVM, and every on-chain line is audit surface. The contracts therefore expose a guardrailed target-allocation interface and are strategy-blind: they cannot tell one strategy from another and never originate a decision. This mirrors the protocol's own architecture (the Minter's emission rate is computed off-chain by an operator and set on-chain within bounded limits).

**P2 — One deterministic core, two implementations, differential testing.** The accounting-critical logic (cooldown scheduling, pro-rata revenue math, allocation optimization, cap/burn arithmetic) exists in TypeScript and Solidity. The TypeScript side generates bigint-exact fixture vectors; a Foundry harness replays them through the Solidity implementation and asserts exact equality. TS generates, Solidity verifies.

**P3 — Sub-weekly cadence is simulation-only until Aero ships.** Aerodrome v2 permits one vote change per epoch, so only the weekly strategy runs live today. The 48h/24h/1h/1-block regimes run in the simulator against a parameterized Aero model. The 1-block case exists to demonstrate its own futility: reactive returns at that cadence converge to the system average minus latency costs.

**P4 — Diamond architecture (EIP-2535); custody address is forever, logic is facets.** The vault is a single diamond proxy whose functions are provided by small, replaceable facets. The motivating property: the diamond *owns the position NFTs*, and swapping logic — above all, swapping the protocol integration when Aero's real interfaces publish in August and again at September launch — is a `diamondCut`, not a custody migration. Positions, approvals, allowlists, and monitoring integrations keep one address for the life of the project. The cost is well-known diamond complexity (delegatecall, shared storage, selector routing); it is contained by strict rules in §4.4. `diamondCut` authority is the single most powerful permission in the system and belongs exclusively to the Owner Safe.

**P5 — Few, standard, audited imports.** OpenZeppelin 5.x utility libraries (SafeERC20 and friends), forge-std, and a vendored copy of the EIP-2535 reference implementation (Nick Mudge's `LibDiamond`, `DiamondCutFacet`, `DiamondLoupeFacet`) — nothing else. OZ contracts that assume linear storage layout (e.g., stock `AccessControl`, `ReentrancyGuard`) are not used as-is; their logic is reimplemented over namespaced storage (§4.4). No assembly outside the vendored diamond internals, no gas golf; the codebase optimizes for auditability.

**P6 — Single-owner custody; no depositor share token.** Multi-depositor shares over locked-NFT custody would triple the contract surface for zero PoC value. Two Safes on Base: an **Owner Safe** (2/3 minimum, cold-ish signers: `diamondCut`, parameters, rescues, migration) and a **Strategist Safe** (lower threshold, e.g. 1/2 or 2/4 with responsive signers: submits target allocations). The **keeper** is a hot key with mechanical, guardrail-bounded execution and no discretion. Damage ceilings by construction: keeper compromise costs liveness only; Strategist Safe compromise costs bad-but-bounded allocation until the Owner revokes the role; Owner Safe compromise costs everything — it holds cut power — hence its higher threshold and coldest signers.

**P7 — Secrets never reach the browser.** The site is fully static. Historical datasets are built in CI using repository secrets and published as versioned JSON; the site fetches plain files. RPC and Alchemy keys exist only in Actions secrets, fork-test config, and the keeper's environment.

**P8 — The v3 integration surface is quarantined in one facet.** Everything spec-derived (cooldown semantics, gauge caps, weight decay) sits behind the `IProtocolFacet` selector set and configuration. The specs are idea drafts; expect to write the Aero protocol facet twice (draft against specs, rewrite against published code), and budget for it. Everything else is a parameter.

**Stack:** pnpm monorepo · Foundry · Node 22, TypeScript 5.x, viem · Vite + React 18 + recharts · vitest + fast-check. **Repo:** private through audit-contest season (~mid-September), then public; MIT `LICENSE` committed from day one so publication is a visibility flip. GitHub premium is available, so GitHub Pages deploys from the private repo from day one — noting the site is public even while the repo is private, and shipped strategy configs are readable in the bundle; a PR-checklist item confirms each deploy contains no private alpha.

## 3. Repository layout

```
aero-autopilot/
├── contracts/                  # Foundry project
│   ├── src/
│   │   ├── Diamond.sol             # thin EIP-2535 proxy (vendored reference, unmodified)
│   │   ├── libraries/
│   │   │   ├── LibDiamond.sol          # vendored reference implementation
│   │   │   ├── LibAccess.sol           # roles over namespaced storage
│   │   │   └── LibVaultStorage.sol     # ERC-7201 namespaced storage structs (one per domain)
│   │   ├── facets/
│   │   │   ├── DiamondCutFacet.sol     # vendored
│   │   │   ├── DiamondLoupeFacet.sol   # vendored
│   │   │   ├── AccessFacet.sol         # role admin (grant/revoke), Owner-gated
│   │   │   ├── CustodyFacet.sol        # ERC-721 receipt, rescue
│   │   │   ├── TrancheFacet.sol        # tranche registry + cooldown accounting
│   │   │   ├── TargetsFacet.sol        # setTargets + guardrails + strategyRef
│   │   │   ├── ExecutionFacet.sol      # rotate / harvest / compound
│   │   │   └── protocol/
│   │   │       ├── AerodromeFacet.sol      # live v2 integration (Base)
│   │   │       ├── MockAeroFacet.sol       # simulated v3 semantics for tests
│   │   │       └── AeroFacet.sol           # v3 integration (drafted M2, finalized M5)
│   │   ├── interfaces/
│   │   │   ├── IProtocolFacet.sol      # the selector set every protocol facet implements
│   │   │   └── external/               # minimal Aerodrome v2 interfaces (Voter, VotingEscrow, RewardsDistributor, Router)
│   │   └── init/DiamondInit.sol        # one-time storage initialization per cut
│   ├── facets.json                 # facet manifest: name → selectors → deployed address (CI-checked vs loupe)
│   ├── test/
│   │   ├── unit/                   # per-facet pure-logic tests
│   │   ├── diamond/                # cut/loupe/storage-collision/upgrade suites
│   │   ├── fork/                   # Base mainnet fork tests (needs RPC_URL)
│   │   ├── invariant/              # fuzz + invariant suites
│   │   └── differential/           # replay TS-generated fixtures
│   ├── script/
│   │   ├── Deploy.s.sol            # deploy facets + diamond + init
│   │   └── Cut.s.sol               # parameterized diamondCut (used for the protocol swaps)
│   └── foundry.toml
├── packages/core/              # the TypeScript twin — single source of shared logic
│   ├── src/
│   │   ├── math/                   # fixed-point helpers mirroring Solidity semantics
│   │   ├── model/                  # protocol models: EpochModel (v2), ContinuousModel (v3)
│   │   ├── strategies/             # see §6
│   │   ├── scheduler/              # tranche + cooldown scheduler (shared by keeper & sim)
│   │   ├── backtest/               # runner + metrics (vs passive benchmark)
│   │   ├── data/                   # Alchemy/viem indexer for Aerodrome history
│   │   └── fixtures/               # generators emitting JSON test vectors
│   └── test/                       # vitest + property tests
├── apps/web/                   # Vite React static site, imports @aero-poc/core
├── apps/keeper/                # thin CLI: watch → compute targets → submit txs
├── data/                       # versioned JSON datasets built by CI (never secrets)
├── docs/
│   ├── ARCHITECTURE.md
│   └── OPERATIONS.md           # governors & maintainers guide
└── .github/workflows/
    ├── ci.yml                  # lint + core tests + forge test (unit/diamond/invariant) + differential + manifest check
    ├── fork-tests.yml          # fork suite, nightly + labeled PRs (uses secrets)
    ├── data.yml                # scheduled dataset builder (uses secrets)
    └── pages.yml               # build site + deploy to GitHub Pages
```

DRY mechanics: the Solidity↔TypeScript boundary is exactly two shared artifacts — JSON fixture vectors and generated ABIs consumed by viem's typed clients (the diamond presents one merged ABI assembled from `facets.json`). No logic is written twice except the deliberately duplicated deterministic core verified under P2.

## 4. Smart contracts

### 4.1 The diamond and its facets

One diamond proxy; each facet small (~60–150 lines), single-purpose, and independently replaceable:

- **DiamondCutFacet / DiamondLoupeFacet** — vendored reference implementation, unmodified. Cut authority: Owner Safe only. Loupe is the on-chain source of truth for what code is live; `facets.json` is its off-chain mirror, diffed in CI and in every deployment checklist.
- **AccessFacet** — grant/revoke for `OWNER`, `STRATEGIST` (Strategist Safe), `KEEPER` (hot key), implemented via `LibAccess` over namespaced storage.
- **CustodyFacet** — ERC-721 receipt (`onERC721Received` gated to the escrow contract), owner rescue of any NFT/token — a feature under single-owner custody, not a bug. Custody state never moves: every upgrade in this system is a facet swap around the NFTs, never a transfer of them.
- **TrancheFacet** — registry mapping `trancheId → positionTokenId` with per-tranche `lastActionAt` for cooldown accounting. Positions are created as separate stakes from the start: v3 positions cannot be split, so staggered-cooldown tranche structure must exist at stake time, and the same discipline is applied to v2.
- **TargetsFacet** — `setTargets(targets, strategyRef)` stores the strategist's allocation as a **queued intent** after guardrail validation: pool allowlist, max per-pool weight fraction, max reallocation delta, per-tranche cooldown check (config: 7d for the v2 grid; 48h/24h/1h for v3 modes), optional min-organic-flow oracle hook (stubbed). One strategist signature drives many keeper executions, so multisig latency costs signal freshness, never liveness — a deliberate speed governor against panicked reallocation. For post-Aero short-cadence operation, a Safe module delegating submission to a bounded hot key is a documented v1 option (the guardrails already cap any strategist's damage).
- **ExecutionFacet** — `rotate(trancheId)` (reset + re-allocate toward the stored target), `harvest(trancheId)` (claim fees/bribes/rebase), `compound(trancheId, minOut)` (swap claims to AERO, increase the stake; the v2 path mirrors the batched `CLAIM → SWAP → ADD → STAKE` flow the v3 MetaRouter spec anticipates for relay compounding). Keeper-gated, mechanical, converges tranches as cooldowns unlock.
- **Protocol facets** — `AerodromeFacet` (live v2), `MockAeroFacet` (test-only v3 semantics: per-position rolling cooldown, per-second streaming revenue, gauge caps with overage burn, optional decaying weights, every parameter test-settable), `AeroFacet` (drafted from specs in M2, finalized against published code in M5). All implement the same `IProtocolFacet` selector set (~10 functions: `createStake`, `allocate`, `reset`, `claimable`, `claim`, `positionWeight`, `cooldownRemaining`, epoch/window metadata). **The August/September protocol transitions are a single `diamondCut`** replacing one facet's selectors with another's — custody, tranches, targets, roles, and address untouched. Aerodrome addresses are verified from official docs at implementation time, never from this document.

**Strategy identity.** Per P1 the contracts are strategy-blind. Exactly two traces of strategy identity touch the chain: the cooldown/cadence guardrail parameter (Owner-set — operationally, this is what "switching strategy class" means on-chain), and the opaque `bytes32 strategyRef` on `setTargets`, emitted in the event but never validated — a free attribution tag (keccak of the TS strategy config) linking every target to the config that produced it. Attribution, not enforcement.

Explicitly out of scope (documented in OPERATIONS.md): share token, deposit/withdraw queue, performance fees, withdraw-to-NFT integration (role-gated in v3; the design must not depend on a role grant), and *verifiable* strategy commitments — publishing config pre-images so third parties can check targets against a committed strategy is a v1 extension already enabled by the `strategyRef` hash.

### 4.2 Storage discipline (the diamond's real risk surface)

All state lives in ERC-7201 namespaced structs in `LibVaultStorage`, one namespace per domain (`aero.autopilot.access`, `.custody`, `.tranches`, `.targets`, `.protocol.config`), each at a keccak-derived slot. Rules, CI-enforced where possible:

1. Structs are **append-only**: fields are never reordered, retyped, or deleted — deprecate by renaming to `__deprecated_*`.
2. No facet declares contract-level state variables (lint rule: zero storage in facets).
3. Every namespace string is registered in one file; a CI check fails on duplicates or on structs whose layout hash changed without an append.
4. `DiamondInit` is the only writer during cuts; each cut ships an idempotent init guarded against re-execution.

### 4.3 Standards

Solidity 0.8.2x, custom errors, events on every state change (consumed by keeper, monitoring, and site), NatSpec throughout, `forge fmt` + `slither` in CI (with the delegatecall findings from the vendored diamond triaged once, documented, and pinned).

### 4.4 What the diamond buys, and what it costs

Buys: one immortal custody address; protocol-swap-as-cut for the two hard transitions this project faces on a fixed external timeline; small, separately auditable logic units; loupe-based introspection for monitoring. Costs: delegatecall/shared-storage risk (contained by §4.2), selector-collision management (CI-checked against the manifest), harder block-explorer UX (§9.6), and cut power as a single point of catastrophic failure (contained by Owner Safe threshold and the cut runbook in §9.5). An immutability endgame is available and documented: once the system is final, a cut can remove `diamondCut` itself, freezing the diamond permanently — a v1+ decision, not a PoC one.

## 5. TypeScript core (`packages/core`)

- **`math/`** — 1e18-bigint fixed-point utilities whose rounding matches Solidity exactly; the foundation that makes differential testing meaningful. No floating point in fixture-relevant paths (floats allowed in analytics/plotting only).
- **`model/`** — two protocol models behind one interface. `EpochModel` (v2): weekly flips, one vote change per epoch, persistent votes, pro-rata lump-sum rewards at epoch end. `ContinuousModel` (v3): per-second revenue streaming pro-rata by weight; per-position cooldown (default 48h); gauge caps `emissions ≤ κ × trailingRevenue` with overage burned (default κ = 1.2); optional weight decay; crowd models (reactive herd with lag, static, adversarial wash-bait).
- **`data/`** — viem indexer against `RPC_URL`/`ALCHEMY_KEY`: 12+ months of per-epoch, per-pool fees, bribes, vote weights, and emissions for the top ~30 Aerodrome pools, output as schema-versioned JSON. Plus a synthetic-scenario generator (persistent / bursty / regime-switching fee processes calibrated to empirical Aerodrome distributions) for Aero-model experiments.
- **`scheduler/`** — the tranche/cooldown state machine used identically by simulator, keeper, and fixture generation: given tranche states and a target, emits the action list.
- **`backtest/`** — runs a strategy against a model + dataset. Metrics: total return; return vs the passive benchmark (global revenue ÷ global weight); max drawdown vs benchmark; turnover; on-target-% — reproducing Aero's published 48%→70% emissions-accuracy methodology as a calibration check of the whole pipeline.

## 6. Strategy suite

All implement `Strategy { propose(state: MarketState, portfolio: Portfolio): TargetAllocation }`, simple → complex:

1. **`FixedGridWeekly`** — one vote per epoch, submitted late in the epoch on a trailing-fee signal. The only live-runnable strategy on Aerodrome today; the baseline.
2. **`FixedGrid{48h,24h,1h}`** — same signal, shorter grid; Aero-model only. Isolates the value of cadence.
3. **`PersistenceCarry`** — persistence-weighted trailing revenue (haircut proportional to revenue volatility), (s,S)-threshold reallocation, lock-timing aware: the optimal reactive strategy under a 48h cooldown.
4. **`WaterFilling`** — size-aware marginal-yield equalizer, `max Σ wᵢRᵢ/(Wᵢ+wᵢ)`; standalone and as the allocator inside strategies 3 and 5.
5. **`ContinuousGreedy`** — event-driven: reallocate any unlocked tranche when the marginal-yield gap exceeds threshold plus costs; cooldown parameter down to one block (the latency-race limit, per P3).

Each strategy ships a config schema (drives the web UI forms) and a golden backtest snapshot asserted in CI, so refactors that change results fail loudly.

## 7. Test plan

1. **Unit** — every facet function, guardrail branch, and protocol facet against the mock. Coverage gate ≥95% of `src/` lines.
2. **Diamond suite** — loupe invariants (every manifest selector routes to the expected facet; no orphan selectors); cut access control (only Owner Safe; non-owner cuts revert); selector-collision detection against `facets.json`; storage-namespace collision and layout-hash checks; **upgrade tests**: populate full state, execute a protocol-facet swap via `Cut.s.sol`, assert every namespace byte-identical and all flows functional post-cut — this test *is* the September migration rehearsal in miniature and runs in CI on every change to any facet.
3. **Fork (Base mainnet, pinned block)** — the money path end-to-end against real Aerodrome through the diamond: create lock → vote → warp across the epoch flip → claim fees/bribes/rebase → compound → re-vote. Edge cases: vote near the flip boundary (verify any vote-window restriction empirically), same-epoch re-vote reverts, zero-reward claims, NFT transfer in/out. Plus a fork-level facet swap mid-lifecycle (Aerodrome→Mock→Aerodrome) proving custody and tranche state survive. Nightly + labeled PRs.
4. **Invariant/fuzz (Foundry)** — cooldowns can never be violated by any call sequence; Σ tranche weights ≤ position weight; guardrail bounds hold under fuzzed strategist inputs; mock-v3 conservation (streamed + burned = emitted); the diamond holds no unaccounted tokens after harvest; no call sequence excluding `diamondCut` can alter selector routing.
5. **Differential (P2)** — TS fixture generators emit vectors for cooldown-scheduler transitions, pro-rata revenue accounting, water-filling allocations, and cap/burn math; a Foundry harness replays each and asserts exact equality.
6. **Scenario (MockAeroFacet)** — narrative tests: the early-allocator arc (early weight → outsized revenue share → decay as the crowd arrives); a wash-bait pool rejected by the organic-flow filter; cooldown shortening mid-run; 48h cap recalibration.

`packages/core` carries its own vitest suite with property-based tests (fast-check) over the math and scheduler — the same vectors, approached from the other side.

## 8. Web app (`apps/web`)

Static Vite + React with no backend, importing `@aero-poc/core` directly — the simulator running in the browser is byte-identical to the one CI tested.

- **Data:** versioned JSON from `/data/` for historical Aerodrome; synthetic Aero scenarios generated client-side from seeds, reproducible via URL params.
- **UI:** strategy picker with schema-driven config forms; model picker (v2 epoch / v3 continuous) with cooldown {7d, 48h, 24h, 1h, 1 block}, cap κ, and crowd-lag controls; results as equity curve vs passive benchmark, allocation heat-map over time, turnover and on-target-% panels; preset story scenarios (early-allocator, latency race, wash-bait).
- **Engineering:** heavy runs in a web worker; deterministic seeds so shared links reproduce exactly.
- **Design:** an intentional visual identity rather than a dashboard template; the protocol's own engine/flight vocabulary is a natural direction.
- **Hosting:** `pages.yml` builds on push to `main` → GitHub Pages from day one (P7 keeps live-RPC mode disabled there). The Vite `base` path is switchable, so a later Vercel migration is `vercel.json` plus one config flip — zero code changes; a Vercel serverless proxy can then optionally enable a live-data mode while static JSON remains the default.

## 9. OPERATIONS.md — governors & maintainers guide (contents)

1. **Roles & keys.** The two-Safe + keeper structure of P6, signer and key rotation runbooks, and explicit per-compromise damage ceilings — with `diamondCut` called out as the system's root permission.
2. **Deployment runbook.** Fork rehearsal → Base Sepolia dry run (mock protocol facet) → mainnet canary (§11) → scale. Address book with checksums covering the diamond *and every facet*; post-deploy verification checklist: roles granted, guardrails set, loupe output diffed clean against `facets.json`, init executed exactly once, event emission spot-checked, Basescan verification complete (§9.6).
3. **Keeper operations.** Cadence per function (rotation strategy-dependent; harvest/compound daily; nothing protocol-forced in v3, but v2 forces weekly awareness). Monitoring and alerts: no vote recorded in the final 12h of an Aerodrome epoch; failed transactions; strategist-target staleness; RPC failure; `strategyRef` mismatch (submitted ref ≠ hash of the approved config — catches a strategist running the wrong config, which is otherwise invisible precisely because the contracts are strategy-blind); **any `DiamondCut` event** (there is no legitimate unscheduled cut — page immediately).
4. **Failure modes & gotchas** (each with detection, impact, response):
   - Missed epoch vote (v2): prior votes persist but weights go stale and new signals go unexecuted — degraded, not zero, returns.
   - Voted too early (v2): locked until the flip while better information arrives; mitigated by the late-vote policy and its boundary-race test.
   - Static-vote decay (v2): ve balance decays while cast weight doesn't auto-update; periodic re-vote ("poke") policy.
   - Unclaimed rebase (v2): compounding drag; covered by weekly harvest.
   - **The migration event (September): the single highest-risk operational moment.** Positions must exit any custody contract before migrating to Aero; migrated positions receive new token/NFT ids; delay costs migration ratio as old-protocol rebases continue. Step-by-step runbook: exit positions from the diamond → migrate → re-stake into fresh tranches → cut `AeroFacet` in. Rehearsed with the canary (§11) and, structurally, by the CI upgrade test (§7.2).
   - Bad cut: wrong selectors, missing init, or storage clobber. Prevention: `Cut.s.sol` only, manifest diff, upgrade tests, Sepolia rehearsal of every mainnet cut. Response: cuts are reversible — re-cut the previous facet addresses from the archived manifest (archive every manifest version).
   - Protocol facet mismatch at Aero launch: final ABIs differ from the idea-draft specs; response is rewriting `AeroFacet` behind the frozen `IProtocolFacet` selector set (P8) and fork tests against published code before any funds move.
   - Data staleness / provider outage: the site degrades to last-published JSON with a staleness banner; the keeper falls back to a secondary RPC.
   - Secret hygiene: keys only in Actions secrets and the keeper environment; a CI step greps the built site bundle for key patterns and fails the deploy on a hit.
   - Upstream parameter changes: cooldown length and cap κ are protocol-settable; configs mirror them, with documented watch points (governance forum, `dromos-labs` repos, audit-contest findings).
5. **Cut runbook (diamond governance).** Every `diamondCut` follows the same ceremony: PR updating facet source + `facets.json` → CI green including upgrade tests → Sepolia rehearsal with loupe diff attached to the PR → Owner Safe signature collection with the exact calldata hash cross-checked by each signer against the PR → execution → post-cut loupe diff and smoke test → manifest archived and Basescan re-verification (§9.6). Emergency cuts follow the same steps compressed, never skipped.
6. **Contract verification on Basescan.** Diamonds need deliberate verification or the system is an unreadable black box to everyone but us:
   - Verify **every facet** and the **diamond itself** on Basescan at deploy time and after every cut, via `forge verify-contract` (Basescan/Etherscan v2 API key in Actions secrets; exact compiler version, optimizer runs, and via-IR settings pinned in `foundry.toml` — verification fails on any mismatch, so profiles are frozen per release tag). Constructor args archived alongside `facets.json`.
   - Basescan's proxy UI does not resolve EIP-2535 routing, so Read/Write-as-Proxy will not show facet functions against the diamond address. Document the two workarounds for maintainers and signers: (a) **louper.dev** pointed at the diamond on Base, which resolves loupe data into a browsable facet/function view — link it in the repo README and the Safe transaction descriptions; (b) the merged-ABI artifact from `facets.json`, published in the repo, loadable into Basescan's "Custom ABI" feature or any local tool to interact with the diamond directly.
   - Add Sourcify verification as a fallback publisher (single command in the deploy script) so verification never depends on one explorer's API being up during a launch-week cut.
   - Acceptance: OPERATIONS.md includes the exact commands, and the deployment checklist treats "all facets verified + louper resolves the diamond + merged ABI published" as a release gate, not a nice-to-have.
7. **Sunset/emergency.** Pause semantics (keeper stop + strategist revoke leave funds safe: allocations persist and keep earning), full-exit runbook, the immutability endgame (removing `diamondCut` to freeze the system permanently — documented as a v1+ option), and the depositor implications if v1 adds shares.

## 10. Environment & secrets

`RPC_URL` (private endpoint), `ALCHEMY_KEY`, and `BASESCAN_API_KEY`, consumed only by: contract fork tests (`foundry.toml` `rpc_endpoints` reading env), the core data indexer, the keeper, deploy/verify scripts, and GitHub Actions repository secrets (`data.yml`, `fork-tests.yml`). Never referenced in `apps/web`. `.env.example` documents all variables; `.env` is gitignored; CI secret-scans every site build. The implementing agent's local environment comes pre-provisioned with the keys.

## 11. Mainnet canary

A small live Aerodrome position (suggested 500–1,000 AERO plus gas float) exercises the real money path before Aero launches — **gated** on: the full fork suite green against a pinned block, both Safes deployed with roles verified, the Sepolia deployment checklist executed, and all facets verified on Basescan. If the gate isn't met by ~August 17, operation stays fork-only until Aero launches.

**Illiquidity warning:** locked AERO is not withdrawable before lock expiry. The canary's exits are (a) the September migration itself — which is the point: it rehearses the highest-risk runbook with real funds, including the live `AeroFacet` cut — or (b) selling the veNFT on a secondary marketplace. Treat the principal as committed through migration, and choose the shortest lock duration that still earns representative rewards rather than a reflexive max lock.

## 12. Milestones

| Phase | Dates (2026) | Deliverables & acceptance criteria |
|---|---|---|
| **M0 Scaffold** | Jul 20–24 | Monorepo builds; MIT LICENSE committed; both Safes deployed on Base, addresses recorded; diamond scaffold (vendored cut/loupe + `LibVaultStorage` + manifest CI check) compiling with the diamond suite green on empty facets; indexer pulls 12mo of top-30 Aerodrome pools into `data/`. |
| **M1 Core & sim** | Jul 27–Aug 7 | `core` complete: both models, five strategies, backtester reproducing Aero's published on-target-% methodology within tolerance; vitest + property tests green; fixture vectors emitted. |
| **M2 Contracts** | Aug 3–14 | All facets + both protocol facets; unit/diamond/invariant/differential suites green; fork suite green at pinned block including the mid-lifecycle facet-swap test. Begin absorbing the Aug 3+ Aero code drops into a draft `AeroFacet` with a spec-diff log. |
| **M3 Web** | Aug 10–21 | Site live on Pages from Actions; interactive backtests on historical + synthetic data; URL-reproducible runs; secret-scan enforced. |
| **M4 Ops & v3 readiness** | Aug 24–Sep 11 | OPERATIONS.md complete incl. migration and cut runbooks and Basescan verification procedure; Sepolia dry run incl. a rehearsed cut; canary gate check → fund and operate the live position via the Safes; `AeroFacet` updated against published code; audit-contest findings tracked for spec changes. |
| **M5 Launch week** | Sep (post-contest) | Final `AeroFacet` vs deployed addresses; fork tests vs real Aero; canary migrated through the real flow with the production `AeroFacet` cut executed per runbook; all facets re-verified on Basescan; repo flipped public (MIT); go/no-go checklist executed. |

Estimated effort: one experienced full-stack/protocol engineer (or agent), ~6.5 weeks — the diamond scaffolding and its test suite add roughly half a week to M0/M2. The critical path remains M1→M2 differential testing plus the diamond upgrade suite, not the UI.
