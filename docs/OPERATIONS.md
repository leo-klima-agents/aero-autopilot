# Operations — governors & maintainers guide

**Audience:** Owner Safe signers, Strategist Safe signers, keeper operators, repo maintainers.
**Companions:** [ARCHITECTURE.md](./ARCHITECTURE.md) (what is built), [PLAN.md](./PLAN.md) (the founding spec; §9 is this document's charter).

Every runbook step below is a command or a Safe action you can execute verbatim. Placeholders:
`$DIAMOND` (diamond address), `$BASE_RPC_URL` (private Base RPC), addresses from the address book
(§2.4). Run `forge`/`cast` commands from `contracts/`; `pnpm` commands from the repo root.

---

## 1. Roles & keys

### 1.1 The two-Safe + keeper structure (P6)

| Principal | Instrument | Threshold guidance | On-chain identity | Powers |
|---|---|---|---|---|
| **Owner** | Owner Safe (Base) | 2/3 minimum, cold-ish signers | diamond owner via IERC173 (`owner()` on the diamond) | `diamondCut` (**the system's root permission**), `transferOwnership`, `grantRole`/`revokeRole`, `setGuardrails`, `setPoolAllowlist`, `setRewardTokenAllowlist`, `setMinFlowOracle`, `setTrancheActive`, `rescueERC721`/`rescueERC20`, direct protocol-facet calls (migration path), `mock_*` hooks |
| **Strategist** | Strategist Safe (Base) | lower threshold (1/2 or 2/4), responsive signers | `STRATEGIST_ROLE = keccak256("aero.autopilot.role.strategist")` = `0x660da86c44f8f33c9116ba5717b918d5d06236ed44f3343d059725e0f992a419` | `setTargets(pools, weightsWad, strategyRef)` — nothing else |
| **Keeper** | hot key (EOA) | n/a — assume compromise is possible | `KEEPER_ROLE = keccak256("aero.autopilot.role.keeper")` = `0xa80c4f7a35ec283afa52139b5d870f36e60e7950031433bca44f07d299ac1e03` | `createTranche`, `rotate`, `harvest`, `compound` — mechanical, guardrail-bounded, no discretion |

Cross-check the role hashes on-chain any time:

```bash
cast call $DIAMOND "STRATEGIST_ROLE()(bytes32)" --rpc-url $BASE_RPC_URL
cast call $DIAMOND "KEEPER_ROLE()(bytes32)" --rpc-url $BASE_RPC_URL
```

### 1.2 Damage ceilings per compromise

| Compromised | Worst case | Why it is bounded | Response |
|---|---|---|---|
| Keeper key | **Liveness only.** Wasted gas; rotations to the already-stored target; harvests into the diamond; swaps that must end in AERO with allowlisted hops and `minOut` | every keeper-callable function executes the queued intent or moves value into the diamond; route/pool validation lives in the facets, not the keeper | §1.3 keeper rotation, same day |
| Strategist Safe | **Bad-but-bounded allocation**: targets inside the pool allowlist, per-pool ≤ `maxPoolWeightWad`, move ≤ `maxDeltaWad` per submission, cadence ≤ the cooldown | `TargetsFacet` guardrails validate every submission; funds never leave custody | Owner Safe: `revokeRole(STRATEGIST_ROLE, oldSafe)` immediately, then investigate |
| Owner Safe | **Everything** — cut power can replace any facet, including custody | nothing bounds the owner; that is the design | prevention only: highest threshold, coldest signers, the §5 cut ceremony, the DiamondCut pager alert (§3.2) |

### 1.3 Key & signer rotation runbooks

**Rotate the keeper key** (Owner Safe, two transactions — order matters: grant before revoke so
liveness never gaps):

1. Safe tx 1 — to `$DIAMOND`, `grantRole(bytes32,address)` with
   `0xa80c4f7a35ec283afa52139b5d870f36e60e7950031433bca44f07d299ac1e03`, `<new keeper address>`.
2. Safe tx 2 — to `$DIAMOND`, `revokeRole(bytes32,address)` with the same role hash and the old
   address.
3. Update the keeper host: set `KEEPER_PRIVATE_KEY` to the new key, restart the watch loop, then
   verify:

```bash
cast call $DIAMOND "hasRole(bytes32,address)(bool)" \
  0xa80c4f7a35ec283afa52139b5d870f36e60e7950031433bca44f07d299ac1e03 <new> --rpc-url $BASE_RPC_URL   # true
cast call $DIAMOND "hasRole(bytes32,address)(bool)" \
  0xa80c4f7a35ec283afa52139b5d870f36e60e7950031433bca44f07d299ac1e03 <old> --rpc-url $BASE_RPC_URL   # false
pnpm --filter @aero-poc/keeper keeper -- status
```

**Rotate the Strategist Safe** (replacing the whole Safe): same grant-then-revoke pattern with
`STRATEGIST_ROLE` (`0x660d…a419`). Rotating signers *within* the Strategist Safe is a Safe-UI owner
management action and needs no diamond transaction.

**Rotate Owner Safe signers:** Safe UI owner management (add owner → raise/confirm threshold →
remove old owner). No diamond transaction.

**Replace the Owner Safe entirely:** from the old Owner Safe, one transaction to `$DIAMOND`:
`transferOwnership(address)` with the new Safe. Verify:
`cast call $DIAMOND "owner()(address)" --rpc-url $BASE_RPC_URL`. Treat this with cut-ceremony
seriousness (§5): whoever owns the diamond owns everything.

**Secret storage:** `KEEPER_PRIVATE_KEY`, `BASE_RPC_URL`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`
exist only in the keeper host environment and GitHub Actions repository secrets (P7). `.env` is
gitignored; `.env.example` is the canonical variable list.

---

## 2. Deployment runbook

Order of operations: **fork rehearsal → Base Sepolia dry run (mock protocol facet) → mainnet canary
→ scale.** Never skip a stage.

### 2.1 Stage 0 — fork rehearsal

```bash
cd contracts
BASE_RPC_URL=<private endpoint> forge test --match-path 'test/fork/*' -vv
```

Gate: **7/7 green** at the pinned block (48,750,000; override with `FORK_BLOCK` only to re-pin
deliberately). Last verified green: 2026-07-17.

### 2.2 Stage 1 — Base Sepolia dry run (mock protocol)

Deploy with `PROTOCOL=mock` (cuts in `MockAeroFacet` — Aerodrome does not exist on Sepolia) and an
EOA owner, exercise the flows, then rehearse a cut (§5) against this deployment:

```bash
cd contracts
OWNER_SAFE=<sepolia owner EOA or Safe> \
STRATEGIST_SAFE=<strategist addr> \
KEEPER_ADDRESS=<keeper addr> \
PROTOCOL=mock \
COOLDOWN_SEC=3600 \
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

### 2.3 Stage 2 — Base mainnet

`Deploy.s.sol` environment (see its NatSpec): `OWNER_SAFE`, `STRATEGIST_SAFE`, `KEEPER_ADDRESS`
(required); `PROTOCOL` (`aerodrome` | `mock`); `AERO`, `VOTING_ESCROW`, `VOTER`,
`REWARDS_DISTRIBUTOR`, `ROUTER`; `MAX_POOL_WEIGHT_WAD` (default `6e17` = 60%), `MAX_DELTA_WAD`
(default `5e17` = 50%), `COOLDOWN_SEC` (default 7 days). **Re-verify the protocol addresses against
official Aerodrome docs before running — never trust a document, including this one.** The values
below were additionally cross-verified on-chain (`escrow.token() == AERO`, `voter.ve() == escrow`,
`rewardsDistributor.ve() == escrow`, `router.voter() == voter`):

```bash
cd contracts
OWNER_SAFE=<Owner Safe> \
STRATEGIST_SAFE=<Strategist Safe> \
KEEPER_ADDRESS=<keeper hot key> \
PROTOCOL=aerodrome \
AERO=0x940181a94A35A4569E4529A3CDfB74e38FD98631 \
VOTING_ESCROW=0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4 \
VOTER=0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 \
REWARDS_DISTRIBUTOR=0x227f65131A261548b057215bB1D5Ab2997964C7d \
ROUTER=0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 \
MAX_POOL_WEIGHT_WAD=600000000000000000 \
MAX_DELTA_WAD=500000000000000000 \
COOLDOWN_SEC=604800 \
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

The script prints the diamond and every facet address. Post-deploy Owner Safe actions (the
allowlists are deliberately empty at genesis):

1. Safe tx — `setPoolAllowlist(address[],bool)` with the approved pools, `true`.
2. Safe tx — `setRewardTokenAllowlist(address[],bool)` with the approved reward tokens (e.g. WETH),
   `true`.

Generate the calldata for the Safe UI with `cast`:

```bash
cast calldata "setPoolAllowlist(address[],bool)" '[<pool1>,<pool2>]' true
```

### 2.4 Address book

Maintain a checksummed address book covering the diamond **and every facet** — commit it as the
`address` fields of `contracts/facets.json` (edit the addresses from the deploy log, then
`pnpm manifest:build`, which preserves recorded non-zero addresses, and commit) plus a
`deployments/` note per network recording: deployer, tx hashes, constructor args (needed for
verification, §6), init `initId`, and the Safe addresses.

### 2.5 Post-deploy verification checklist

Execute every line; attach outputs to the deployment PR.

```bash
# 1. Ownership: cut power is the Owner Safe and nothing else
cast call $DIAMOND "owner()(address)" --rpc-url $BASE_RPC_URL

# 2. Roles granted exactly as intended
cast call $DIAMOND "hasRole(bytes32,address)(bool)" 0x660da86c44f8f33c9116ba5717b918d5d06236ed44f3343d059725e0f992a419 $STRATEGIST_SAFE --rpc-url $BASE_RPC_URL
cast call $DIAMOND "hasRole(bytes32,address)(bool)" 0xa80c4f7a35ec283afa52139b5d870f36e60e7950031433bca44f07d299ac1e03 $KEEPER_ADDRESS --rpc-url $BASE_RPC_URL

# 3. Guardrails set
cast call $DIAMOND "guardrails()(uint256,uint256,uint64,address)" --rpc-url $BASE_RPC_URL

# 4. Protocol identity + config
cast call $DIAMOND "protocolId()(bytes32)" --rpc-url $BASE_RPC_URL   # "AERODROME_V2" right-padded

# 5. Loupe output diffed clean against facets.json
cast call $DIAMOND "facets()((address,bytes4[])[])" --rpc-url $BASE_RPC_URL
pnpm manifest:check     # manifest ↔ code; compare the loupe output against facets.json selectorList

# 6. Init executed exactly once: the genesis initId is
#    keccak256(abi.encodePacked("genesis", block.chainid)); DiamondInit reverts
#    AlreadyInitialized on any replay — confirmed structurally by the diamond suite.
#    Spot-check the deploy logs for exactly one DiamondCut event:
cast logs --address $DIAMOND --from-block <deploy block> \
  0x8faa70878671ccd212d20771b795c50af8fd3ff6cf27f4bde57e5d4de0aeb673 --rpc-url $BASE_RPC_URL

# 7. Event emission spot-check (RoleGranted, GuardrailsSet at deploy block)
cast logs --address $DIAMOND --from-block <deploy block> --rpc-url $BASE_RPC_URL

# 8. Keeper connectivity end-to-end (dry run)
pnpm --filter @aero-poc/keeper keeper -- status
```

Then complete §6 (verification) — "all facets verified + louper resolves the diamond + merged ABI
published" is a **release gate**, not a nice-to-have.

### 2.6 Stage 3 — mainnet canary (PLAN.md §11)

A small live position (suggested 500–1,000 AERO + gas float) exercises the real money path before
Aero launches. **Gate — all four, checked in order:** (a) fork suite green at the pinned block;
(b) both Safes deployed, roles verified per §2.5; (c) the Sepolia checklist executed including a
rehearsed cut; (d) all facets verified per §6. If the gate isn't met by ~August 17, stay fork-only
until Aero launches.

Funding and first tranche:

```bash
# Owner sends AERO to the diamond (from the Owner Safe: ERC-20 transfer to $DIAMOND), then:
pnpm --filter @aero-poc/keeper keeper -- status                       # confirm balance context
cast send $DIAMOND "createTranche(uint256,uint256)" <amountWad> <lockDurationSec> \
  --private-key $KEEPER_PRIVATE_KEY --rpc-url $BASE_RPC_URL
```

**Illiquidity warning:** locked AERO is not withdrawable before lock expiry. The canary's exits are
(a) the September migration itself — the point: it rehearses the highest-risk runbook with real
funds — or (b) selling the veNFT on a secondary marketplace. Treat the principal as committed
through migration and choose the shortest lock duration that still earns representative rewards,
not a reflexive max lock.

### 2.7 Stage 4 — scale

Only after the canary has survived at least one full epoch cycle (vote → flip → harvest → compound)
with clean §3.2 monitoring: add capital as additional staggered tranches (`createTranche` per §2.6 —
never by enlarging a single stake; v3 positions cannot be split, so the tranche structure must exist
at stake time) and widen the pool allowlist deliberately, one Owner Safe action at a time.

---

## 3. Keeper operations

### 3.1 Cadence per function

All commands dry-run by default; add `--execute` to send. Env: `BASE_RPC_URL`,
`BASE_RPC_URL_FALLBACK`, `KEEPER_PRIVATE_KEY` (execute mode), `DIAMOND_ADDRESS`.

| Function | Cadence (Aerodrome v2) | Command |
|---|---|---|
| status | every watch tick; on demand | `pnpm --filter @aero-poc/keeper keeper -- status --config strategy.json` |
| rotate | strategy-dependent — weekly grid: once per tranche per epoch, after the strategist's late-epoch target refresh, inside the vote window (open `epoch start + 1h` → `epoch end − 1h`, verified empirically) | `pnpm --filter @aero-poc/keeper keeper -- rotate --execute` |
| harvest | daily is safe and cheap; **must** run at least once per epoch, shortly after the flip, to sweep the prior epoch's fees/bribes and the rebase | `pnpm --filter @aero-poc/keeper keeper -- harvest --execute` |
| compound | weekly, after harvest, once reward balances justify gas. Not yet a CLI command — call `compound(uint256,bytes,uint256)` directly: `swapData = abi.encode(IRouter.Route[][], uint256[] amountsIn)`, every hop allowlisted, every route ending in AERO, aggregate `minOut` | `cast send $DIAMOND "compound(uint256,bytes,uint256)" <trancheId> <swapData> <minOut> --private-key $KEEPER_PRIVATE_KEY --rpc-url $BASE_RPC_URL` |
| watch loop | continuous (status → rotate → harvest every interval) | `pnpm --filter @aero-poc/keeper keeper -- watch --interval 600 --execute` |
| compute-targets | when the strategist wants a payload; the keeper **cannot** submit targets by design | `pnpm --filter @aero-poc/keeper keeper -- compute-targets --config strategy.json` |

Nothing is protocol-forced in v3 (continuous), but v2 forces weekly awareness: a missed window is a
missed epoch. `rotate` skips tranches that are cooling down or already on the current target
(`lastActionAt ≥ targetsUpdatedAt`); it converges, it never decides.

Strategist submission path (Strategist Safe, one transaction): target `$DIAMOND`, function
`setTargets(address[],uint256[],bytes32)`. Build calldata:

```bash
cast calldata "setTargets(address[],uint256[],bytes32)" \
  '[<pool1>,<pool2>]' '[600000000000000000,400000000000000000]' <strategyRef from compute-targets>
```

One strategist signature drives many keeper executions: multisig latency costs signal freshness,
never liveness — a deliberate speed governor.

### 3.2 Monitoring and alerts

| Alert | Detection | Severity / action |
|---|---|---|
| **Any `DiamondCut` event** | log watch on `$DIAMOND`, topic0 `0x8faa70878671ccd212d20771b795c50af8fd3ff6cf27f4bde57e5d4de0aeb673` | **Page immediately. There is no legitimate unscheduled cut.** Cross-check against the §5 calendar; if unscheduled, assume Owner Safe compromise |
| No vote recorded in the final 12h of an Aerodrome epoch | no `Rotated` event (topic0 `0x04529f9a705067b0424d81c2ea7c4807e863609b2132064e51ece39916505e7d`) this epoch while a fresh target exists | page keeper operator — the window closes 1h before the flip |
| Failed transactions | tx receipts with status 0 from the keeper address; `watch` logs `watch iteration failed` | investigate same day; check guardrail reverts vs RPC issues |
| Strategist-target staleness | `currentTargets()` → `updatedAt` older than the strategy cadence (`status` prints it) | nag the strategist; stale targets degrade, they don't endanger |
| RPC failure | keeper errors; provider status | switch to `BASE_RPC_URL_FALLBACK`; the transport already retries (`retryCount: 2`) |
| **`strategyRef` mismatch** | `keeper -- status --config strategy.json` warns `strategyRef mismatch … PAGE THE STRATEGIST` when on-chain ref ≠ keccak of the approved config | page the strategist — this catches a strategist running the wrong config, otherwise invisible because the contracts are strategy-blind |

Log-watch example (any monitoring service, or cron + cast):

```bash
cast logs --address $DIAMOND \
  0x8faa70878671ccd212d20771b795c50af8fd3ff6cf27f4bde57e5d4de0aeb673 \
  --from-block <last checked> --rpc-url $BASE_RPC_URL
```

---

## 4. Failure modes & gotchas

Each with detection → impact → response.

**Missed epoch vote (v2).**
*Detection:* the final-12h alert (§3.2). *Impact:* prior votes persist, so returns degrade rather
than zero out — but weights go stale and new signals go unexecuted. *Response:* fix keeper liveness;
rotate in the next window. No funds at risk.

**Voted too early (v2).**
*Detection:* `Rotated` event early in the epoch while the strategist intended a late submission.
*Impact:* locked until the flip while better information arrives. *Response:* policy, not code —
strategist submits late in the epoch; keeper rotates on fresh targets. The window boundary race is
covered by `test_fork_voteWindowBoundary`.

**Static-vote decay (v2).**
*Detection:* `positionWeight()` (ve balance) drifting down while cast votes don't auto-update.
*Impact:* slow bleed of relative weight. *Response:* periodic re-vote ("poke") — the weekly `rotate`
re-casts the full current power each epoch, which is the poke. Keep rotating even when the target
hasn't changed for multiple epochs (note: `rotate` skips on-target tranches, so schedule a re-vote
by having the strategist re-submit the same target to refresh `targetsUpdatedAt`).

**Unclaimed rebase (v2).**
*Detection:* `harvest` cadence lapses (§3.1). *Impact:* compounding drag — rebases via
`RewardsDistributor.claim()` compound into the lock only when claimed. *Response:* weekly harvest
minimum; `ExecutionFacet.harvest` claims rewards and rebase in one call.

**The migration event (September) — the single highest-risk operational moment.**
Positions must exit any custody contract before migrating to Aero; migrated positions receive new
token/NFT ids; delay costs migration ratio as old-protocol rebases continue. Runbook (rehearsed on
the canary and, structurally, by `contracts/test/diamond/Upgrade.t.sol` and
`test_fork_facetSwapMidLifecycle` in CI):

1. Final v2 sweep: `pnpm --filter @aero-poc/keeper keeper -- harvest --execute`, then compound
   (§3.1) so no rewards strand.
2. Exit each position from the diamond (Owner Safe, per tranche): Safe tx to `$DIAMOND`,
   `rescueERC721(address,uint256,address)` with `(0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4,
   <positionId>, <Owner Safe>)`. Position ids come from
   `cast call $DIAMOND "getTranche(uint256)(uint256,uint64,bool)" <id>`.
3. Retire the old tranches (Owner Safe, per tranche): `setTrancheActive(uint256,bool)` with
   `(<trancheId>, false)` — inactive tranches refuse execution.
4. Execute the `AeroFacet` cut per §5 with `NEW_PROTOCOL=aero`, the published v3 addresses in
   `AERO`/`VOTING_ESCROW`/`VOTER`/`REWARDS_DISTRIBUTOR`/`ROUTER`, and `PROTOCOL_COOLDOWN_SEC` per
   the published cooldown. `ProtocolSwapInit` updates `protocolId` and config atomically; the
   custody gate (`onERC721Received`) now accepts the **new** escrow.
5. Migrate the exited positions through Aero's official migration flow (from the Owner Safe,
   outside the diamond). Do this promptly — every day of delay costs migration ratio.
6. Re-stake into fresh tranches. If migration yields underlying AERO to stake:
   Owner Safe transfers it to `$DIAMOND`, then per tranche:
   `cast send $DIAMOND "createTranche(uint256,uint256)" <amountWad> <lockSec> --private-key $KEEPER_PRIVATE_KEY --rpc-url $BASE_RPC_URL`.
   If migration yields new position NFTs directly, transfer them to the diamond
   (`safeTransferFrom` from the Owner Safe — accepted because step 4 updated `votingEscrow`) and
   register per the adoption path the final `AeroFacet` rewrite lands with (P8: exact mechanics
   depend on published code; update this step when the Aug 3+ drops land).
7. Owner Safe sets v3 guardrails: `setGuardrails(uint256,uint256,uint64)` with the v3 cooldown
   (e.g. 48h = `172800`), and refreshes the pool allowlist for v3 pools.
8. Post-cut checks: §5 step 8, then strategist re-submits targets and the keeper resumes.

**Bad cut** (wrong selectors, missing init, storage clobber).
*Prevention:* cuts go through `script/Cut.s.sol` only (which composes via `DiamondBuilder`, the same
code CI exercises); manifest diff (`pnpm manifest:check`); the upgrade tests; a Sepolia rehearsal of
every mainnet cut. *Detection:* post-cut loupe diff fails, smoke test reverts, or the DiamondCut
pager fired unscheduled. *Response:* **cuts are reversible.** Re-cut the previous facet addresses
from the archived manifest (every manifest version is archived per §5 step 9) — build the reverse
cut with the archived addresses and the same ceremony, compressed but never skipped.

**Protocol facet mismatch at Aero launch** (final ABIs differ from the idea-draft specs).
*Detection:* fork tests against published code fail; spec-diff log in
`contracts/src/facets/protocol/AeroFacet.sol` accumulates breaking entries. *Impact:* schedule, not
funds — `AeroFacet` mutating calls revert `NotLive` until finalized. *Response:* rewrite `AeroFacet`
behind the frozen `IProtocolFacet` selector set (P8 — budgeted from day one), fork-test against
published code before any funds move.

**Data staleness / provider outage.**
*Detection:* indexer failures in `data.yml`; keeper RPC errors. *Impact:* the site degrades to
last-published JSON with a staleness banner; keeper liveness at risk. *Response:* keeper falls back
to `BASE_RPC_URL_FALLBACK`; re-run the indexer
(`pnpm --filter @aero-poc/core index-data -- --pools 30 --epochs 52`) when the provider recovers.

**Secret hygiene.**
*Prevention:* keys only in Actions secrets and the keeper environment (P7);
`scripts/scan-bundle-for-secrets.mjs` greps every built site bundle for key patterns and forbidden
env names (`ALCHEMY_API_KEY`, `BASE_RPC_URL`, `ETHERSCAN_API_KEY`, `KEEPER_PRIVATE_KEY`, raw 32-byte
hex, Alchemy URLs) and fails the deploy on a hit. *Response to a leak:* rotate the key at the
provider, rotate the keeper key per §1.3 if `KEEPER_PRIVATE_KEY` is affected, purge and re-deploy.

**Upstream parameter changes** (cooldown length and cap κ are protocol-settable).
*Detection — documented watch points:* the Aerodrome/Aero governance forum, the `dromos-labs`
GitHub org (spec + code drops from Aug 3), audit-contest findings (Aug 24 – Sep 11). *Response:*
mirror into configs — Owner Safe `setGuardrails` for the vault cooldown, strategy config
(`kappaWad`, cadence) for the simulation side; re-run golden backtests.

---

## 5. Cut runbook (diamond governance)

Every `diamondCut` — routine or emergency — follows the same ceremony. Emergency cuts compress the
timeline; they never skip steps.

1. **PR**: facet source changes + regenerate the manifest — `pnpm manifest:build` — and commit
   `contracts/facets.json` in the same PR.
2. **CI green**, including the upgrade tests (`contracts/test/diamond/Upgrade.t.sol` runs in the
   default suite on every PR) and `pnpm manifest:check`.
3. **Sepolia rehearsal** — execute the same cut against the Sepolia diamond (EOA owner, direct
   path):

   ```bash
   cd contracts
   DIAMOND=$SEPOLIA_DIAMOND NEW_PROTOCOL=<aerodrome|mock|aero> OLD_HAS_MOCK=<true|false> \
   INIT_ID=<unique, e.g. swap-2026-09-15-rehearsal> \
   forge script script/Cut.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast \
     --private-key $DEPLOYER_PRIVATE_KEY
   ```

   Attach the pre/post loupe diff (`cast call $DIAMOND "facets()((address,bytes4[])[])"`) to the PR.
4. **Preview on mainnet** — deploy the new facet + init and print the exact `diamondCut` calldata
   plus its keccak256 for signature collection:

   ```bash
   cd contracts
   DIAMOND=$DIAMOND NEW_PROTOCOL=<aerodrome|mock|aero> OLD_HAS_MOCK=<true|false> \
   INIT_ID=<unique, e.g. swap-2026-09-15> \
   AERO=<addr|0x0 keep> VOTING_ESCROW=<addr|0x0> VOTER=<addr|0x0> \
   REWARDS_DISTRIBUTOR=<addr|0x0> ROUTER=<addr|0x0> PROTOCOL_COOLDOWN_SEC=<sec|0 keep> \
   forge script script/Cut.s.sol --sig "preview()" --rpc-url $BASE_RPC_URL --broadcast \
     --private-key $DEPLOYER_PRIVATE_KEY
   ```

   `preview()` broadcasts only the facet + init deployments, never the cut. It prints
   `diamondCut target`, `diamondCut calldata`, and `calldata keccak256`. Paste all three into the
   PR. `INIT_ID` must be unique per cut — `ProtocolSwapInit` reverts `AlreadyInitialized` on reuse.
5. **Owner Safe signature collection** — create the Safe transaction: to `$DIAMOND`, value 0, data =
   the printed calldata. **Each signer independently** recomputes and cross-checks the hash against
   the PR before signing:

   ```bash
   cast keccak <calldata hex from the Safe UI>
   ```

   Signature rule: hash mismatch = do not sign, no exceptions. Include the louper.dev link (§6) in
   the Safe transaction description.
6. **Execute** the Safe transaction.
7. **Post-cut loupe diff**: `cast call $DIAMOND "facets()((address,bytes4[])[])" --rpc-url $BASE_RPC_URL`
   against the expected manifest; confirm the new protocol facet address serves exactly the frozen
   selector set (plus/minus `mock_*` extras).
8. **Smoke test**:

   ```bash
   cast call $DIAMOND "protocolId()(bytes32)" --rpc-url $BASE_RPC_URL
   pnpm --filter @aero-poc/keeper keeper -- status        # dry-run reads through the new facet
   ```
9. **Archive**: commit the updated `facets.json` addresses (edit + `pnpm manifest:build`), tag the
   repo, and archive the superseded manifest version (git history + a `deployments/` copy) — the
   archived manifest is the bad-cut rollback source (§4).
10. **Re-verify on Basescan + Sourcify** (§6) for the new facet and init addresses.

---

## 6. Contract verification on Basescan

Diamonds need deliberate verification or the system is an unreadable black box to everyone but us.
Compiler settings are pinned in `contracts/foundry.toml` (solc **0.8.26**, optimizer **200 runs**,
`via_ir = false`, EVM **cancun**) and frozen per release tag — verification fails on any mismatch,
so bump them deliberately, never casually.

### 6.1 Verify every facet and the diamond (Etherscan v2 multichain API)

At deploy time and after every cut, from `contracts/`:

```bash
# the diamond itself (constructor args required — archive them at deploy time, §2.4)
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch \
  --constructor-args <abi-encoded (FacetCut[], DiamondArgs)> \
  <diamond address> src/Diamond.sol:Diamond

# every facet (no constructor args)
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/DiamondCutFacet.sol:DiamondCutFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/DiamondLoupeFacet.sol:DiamondLoupeFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/OwnershipFacet.sol:OwnershipFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/AccessFacet.sol:AccessFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/CustodyFacet.sol:CustodyFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/TrancheFacet.sol:TrancheFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/TargetsFacet.sol:TargetsFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/ExecutionFacet.sol:ExecutionFacet
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/facets/protocol/AerodromeFacet.sol:AerodromeFacet

# the init contract(s) used by the cut
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/init/DiamondInit.sol:DiamondInit
forge verify-contract --chain 8453 --etherscan-api-key $ETHERSCAN_API_KEY --watch <addr> src/init/ProtocolSwapInit.sol:ProtocolSwapInit
```

After a protocol swap, add the incoming facet
(`src/facets/protocol/MockAeroFacet.sol:MockAeroFacet` or
`src/facets/protocol/AeroFacet.sol:AeroFacet`). Constructor args for the diamond are archived
alongside `facets.json` (§2.4).

### 6.2 Sourcify fallback

Verification must never depend on one explorer's API being up during a launch-week cut:

```bash
forge verify-contract --verifier sourcify --chain 8453 <address> <path>:<Contract>
```

Run it for the diamond and every facet, same list as §6.1.

### 6.3 Reading the diamond anyway: louper.dev and the merged ABI

Basescan's proxy UI does **not** resolve EIP-2535 routing — Read/Write-as-Proxy will not show facet
functions against the diamond address, even fully verified. Two workarounds, both mandatory to
publish:

1. **louper.dev** — `https://louper.dev/diamond/<diamond address>?network=base` resolves the loupe
   into a browsable facet/function view. Link it in the repo README and in every Safe transaction
   description so signers can inspect what they are signing against.
2. **Merged ABI** — assemble one ABI from all live facets (the same set `facets.json` records) and
   publish it in the repo; load it into Basescan's *Custom ABI* feature (or any local tool) to
   interact with the diamond directly:

   ```bash
   cd contracts
   for f in DiamondCutFacet DiamondLoupeFacet OwnershipFacet AccessFacet CustodyFacet \
            TrancheFacet TargetsFacet ExecutionFacet AerodromeFacet; do
     forge inspect $f abi --json
   done | jq -s 'add | unique_by(.type + (.name // "") + ((.inputs // []) | map(.type) | join(",")))' \
     > ../diamond.abi.json
   ```

**Acceptance (release gate):** all facets verified on Basescan, Sourcify fallback published, louper
resolves the diamond, merged ABI committed. The §2.5 checklist and §5 step 10 both point here.

---

## 7. Sunset / emergency

### 7.1 Pause semantics

There is no pause switch and none is needed: stopping the actors leaves funds safe, allocated, and
earning (votes persist in v2; allocations persist in the mock/v3 model).

1. Stop the keeper process (kill the `watch` loop).
2. Owner Safe (if key compromise is suspected): `revokeRole(bytes32,address)` for
   `KEEPER_ROLE` (`0xa80c…1e03`) and/or `STRATEGIST_ROLE` (`0x660d…a419`).
3. Result: no rotations, no target changes; existing allocations keep earning; harvest resumes
   whenever a keeper is re-granted. Degradation is the §4 static-decay / unclaimed-rebase drag,
   nothing worse.

### 7.2 Full-exit runbook

1. Final sweep: `pnpm --filter @aero-poc/keeper keeper -- harvest --execute`, then compound or skip.
2. Owner Safe, per tranche: `rescueERC721(0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4, <positionId>, <destination>)`.
3. Owner Safe, per token: `rescueERC20(<token>, <amount>, <destination>)` for any AERO/reward
   balances held by the diamond
   (`cast call <token> "balanceOf(address)(uint256)" $DIAMOND --rpc-url $BASE_RPC_URL`).
4. Owner Safe, per tranche: `setTrancheActive(<trancheId>, false)`.
5. Realize value from the veNFTs outside the diamond: wait out lock expiry and withdraw from the
   escrow, or sell on a secondary marketplace (the §2.6 illiquidity warning applies in reverse).
6. Revoke both roles (§7.1). The diamond persists, empty, at its immortal address — restartable by
   re-funding and re-granting.

### 7.3 The immutability endgame (v1+ option, documented not scheduled)

Once the system is final, a last cut can `Remove` the `diamondCut` selector (`0x1f931c1c`) itself,
freezing the diamond permanently. Irreversible by construction — after it, no facet can ever be
added, replaced, or removed, and every §4 response that says "re-cut" stops existing. Execute (if
ever) with the full §5 ceremony and a public announcement period. Not a PoC decision.

### 7.4 Depositor implications if v1 adds shares

This PoC is single-owner custody (P6): rescue powers and full-exit above are features. If v1 adds a
depositor share token, every Owner power in this document becomes a trust assumption on other
people's money: rescue must be constrained (timelock or removal), the §7.1 revoke-everything pause
must not be able to strand depositor withdrawals, the migration runbook needs a depositor
communication plan, and the immutability endgame changes meaning entirely. Re-derive this document
before accepting the first external deposit.
