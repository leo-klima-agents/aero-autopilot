/**
 * Reduce a RawDataset (indexer output, amounts in native reward tokens) to an
 * AERO-denominated EpochDataset the EpochModel consumes.
 *
 * APPROXIMATION, DOCUMENTED: reward tokens are converted with a static price
 * table (prices.json next to the dataset, editable). This is fine for a PoC
 * whose purpose is relative strategy comparison; a v1 would use per-epoch
 * TWAPs. Unknown tokens are dropped and reported.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { EpochDataset } from "../model/types.js";
import type { RawDataset } from "./indexer.js";

/** token address (lowercase) → { aeroPerTokenWad, decimals } */
export type PriceTable = Record<string, { aeroPerTokenWad: string; decimals: number; symbol: string }>;

export function calibrate(raw: RawDataset, prices: PriceTable): { dataset: EpochDataset; droppedTokens: string[] } {
  const dropped = new Set<string>();
  const poolIds = raw.pools.map((p) => p.pool);
  const poolIndex = new Map(poolIds.map((p, i) => [p.toLowerCase(), i]));

  const epochs = raw.epochs.map((row) => {
    const revenue = poolIds.map(() => 0n);
    for (const r of row.rewards) {
      const price = prices[r.token.toLowerCase()];
      if (!price) {
        dropped.add(r.token.toLowerCase());
        continue;
      }
      const idx = poolIndex.get(r.pool.toLowerCase());
      if (idx === undefined) continue;
      // amount (token base units) → wad AERO: amount × aeroPerToken / 10^decimals
      const aero = (BigInt(r.amount) * BigInt(price.aeroPerTokenWad)) / 10n ** BigInt(price.decimals);
      revenue[idx] = revenue[idx]! + aero;
    }
    return {
      start: row.start,
      revenueWad: revenue.map((x) => x.toString()),
      externalVotesWad: row.votesWad,
      emissionsWad: row.emissionsWad,
    };
  });

  return {
    dataset: {
      schemaVersion: 1,
      source: "aerodrome-base-mainnet",
      chainId: raw.chainId,
      epochSec: raw.epochSec,
      pools: poolIds,
      epochs,
    },
    droppedTokens: [...dropped],
  };
}

/** CLI: tsx src/data/calibrate.ts <raw.json> <prices.json> <out.json> */
const invokedDirectly = process.argv[1]?.endsWith("calibrate.ts");
if (invokedDirectly) {
  const [rawPath, pricesPath, outPath] = process.argv.slice(2);
  if (!rawPath || !pricesPath || !outPath) {
    console.error("usage: calibrate <raw.json> <prices.json> <out.json>");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RawDataset;
  const prices = JSON.parse(readFileSync(pricesPath, "utf8")) as PriceTable;
  const { dataset, droppedTokens } = calibrate(raw, prices);
  writeFileSync(outPath, JSON.stringify(dataset, null, 1));
  console.log(`wrote ${outPath} (${dataset.epochs.length} epochs × ${dataset.pools.length} pools)`);
  if (droppedTokens.length) console.warn(`dropped unknown reward tokens:\n  ${droppedTokens.join("\n  ")}`);
}
