/**
 * Emit differential fixture vectors into contracts/test/differential/fixtures.
 * Committed to the repo; CI regenerates and fails on drift, so the TS and
 * Solidity implementations can never silently diverge (P2).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  genCapsFixture,
  genCooldownFixture,
  genDistanceFixture,
  genProRataFixture,
  genWaterfillFixture,
} from "./generators.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../../contracts/test/differential/fixtures");

const fixtures = {
  "cooldown.json": genCooldownFixture(),
  "caps.json": genCapsFixture(),
  "distance.json": genDistanceFixture(),
  "waterfill.json": genWaterfillFixture(),
  "prorata.json": genProRataFixture(),
};

mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(fixtures)) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${path} (${(data as { count: number }).count} cases)`);
}
