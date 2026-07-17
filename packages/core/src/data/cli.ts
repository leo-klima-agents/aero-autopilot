/**
 * Indexer CLI — run by data.yml on a schedule, or locally:
 *   pnpm --filter @aero-poc/core index-data -- --pools 30 --epochs 52 --out ../../data/aerodrome-raw.json
 * Requires BASE_RPC_URL in the environment (P7: secrets stay out of the browser).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { indexAerodrome } from "./indexer.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const rpcUrl = process.env.BASE_RPC_URL ?? process.env.RPC_URL;
if (!rpcUrl) {
  console.error("BASE_RPC_URL (or RPC_URL) must be set");
  process.exit(1);
}

const pools = Number(arg("pools", "30"));
const epochs = Number(arg("epochs", "52"));
const out = resolve(arg("out", "../../data/aerodrome-raw.json"));

const started = Date.now();
indexAerodrome({
  rpcUrl,
  topPools: pools,
  epochs,
  onProgress: (msg) => console.log(`[indexer] ${msg}`),
})
  .then((dataset) => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(dataset, null, 1));
    console.log(
      `wrote ${out}: ${dataset.epochs.length} epochs × ${dataset.pools.length} pools in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
