# data/

Versioned JSON datasets consumed by the simulator and backtester. Built by CI
(`data.yml`) with repository secrets — **never** fetched live from the browser
(P7); the site reads these plain files.

## Files

| file | source | notes |
|---|---|---|
| `aerodrome-sample.json` | synthetic (seed 20260717) | 30 pools × 52 weekly epochs, heavy-tailed revenue with herd-following votes, calibrated to the *shape* of Aerodrome distributions. Regenerate: see below. |
| `aerodrome-raw.json` | live indexer (data.yml) | raw per-epoch votes, reward events (per token), gauge emissions for the top-N pools. Not committed until the scheduled job lands it. |
| `aerodrome.json` | `calibrate.ts` over the raw file | AERO-denominated `EpochDataset` the EpochModel consumes. |
| `prices.json` | hand-maintained | static token→AERO conversion table used by the calibrator (documented approximation; v1 would use per-epoch TWAPs). |

## Schema

`EpochDataset` (schemaVersion 1): see `packages/core/src/model/types.ts`.
All amounts are stringified 1e18 wads; `start` is unix seconds at the epoch
flip (Thursday 00:00 UTC).

## Regenerating

```bash
# synthetic sample (deterministic)
pnpm --filter @aero-poc/core exec tsx -e '
  import("./src/data/synthetic.js").then(m => {
    const d = m.generateSyntheticEpochDataset({ pools: 30, epochs: 52, seed: 20260717 });
    require("node:fs").writeFileSync("../../data/aerodrome-sample.json", JSON.stringify(d, null, 1));
  })'

# live index (requires BASE_RPC_URL on a PAID tier — Alchemy free tier caps
# eth_getLogs at a 10-block range, which makes full-epoch scans infeasible;
# use --span to match your provider limit)
pnpm --filter @aero-poc/core index-data -- --pools 30 --epochs 52 --out ../../data/aerodrome-raw.json

# reduce raw → AERO-denominated dataset
pnpm --filter @aero-poc/core calibrate -- ../../data/aerodrome-raw.json ../../data/prices.json ../../data/aerodrome.json
```

Indexer status (2026-07-17): pool discovery, epoch-boundary binary search, and
vote-weight multicalls verified against live Base; the reward-event scan needs
a paid-tier key (`data.yml` expects one in `BASE_RPC_URL`).

## Troubleshooting a failed `data.yml` run

The indexer preflights the endpoint (eth_chainId + block number) before the
crawl and prints a diagnosis, so most misconfigurations fail in seconds:

- **Timeout on the first call** — the endpoint isn't answering CI. Check the
  `BASE_RPC_URL` secret is a plain JSON-RPC URL (no trailing whitespace or
  newline — re-paste it), and that the provider is reachable from GitHub's
  runners. JSON-RPC *array batching* is a classic silent-hang cause on some
  providers/gateways; the indexer therefore sends single requests by default —
  only pass `--batch` on a provider known to support batches.
- **`preflight: … chain X, expected Base (8453)`** — the secret points at the
  wrong network.
- **`eth_getLogs` range errors mid-run** — provider tier caps the block range
  (free Alchemy: 10 blocks). Use a paid tier or shrink `--span` to the cap
  (a full epoch is ~302,400 Base blocks, so tiny spans are impractically slow).
- **"N/second request limit reached"** — the provider caps requests per
  second (e.g. QuickNode entry tiers at 50 rps). All indexer requests run
  sequentially under a pacer budgeted at `--rps` (default 15); lower it to
  match a stricter cap. Multicalls are sent as ONE aggregate3 request per
  300-call chunk precisely so the budget holds.
- Reproduce locally with a small slice before burning CI minutes:
  `BASE_RPC_URL=… pnpm --filter @aero-poc/core index-data -- --pools 3 --epochs 1`.
