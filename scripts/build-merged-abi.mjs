#!/usr/bin/env node
/**
 * Assemble the diamond's merged ABI from the facet artifacts listed in
 * facets.json (§3 DRY mechanics / OPERATIONS §6): one ABI for the one
 * address, loadable into Basescan's "Custom ABI", louper, or any viem typed
 * client. Protocol facets share the frozen IProtocolFacet selector set, so
 * their function entries are deduped by selector; mock-only hooks are
 * included (harmless when not cut in — calls simply revert via the fallback).
 *
 * Usage: node scripts/build-merged-abi.mjs [--check]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "contracts");
const manifestPath = join(contractsDir, "facets.json");
const outPath = join(contractsDir, "diamond.abi.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const merged = [];
const seen = new Set(); // dedupe by type+name+inputs signature

function keyOf(entry) {
  const inputs = (entry.inputs ?? []).map((i) => i.type).join(",");
  return `${entry.type}:${entry.name ?? ""}(${inputs})`;
}

for (const name of Object.keys(manifest.facets)) {
  const abi = JSON.parse(
    execFileSync("forge", ["inspect", name, "abi", "--json"], { cwd: contractsDir, encoding: "utf8" }),
  );
  for (const entry of abi) {
    if (entry.type === "constructor") continue;
    const k = keyOf(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(entry);
  }
}

merged.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
const serialized = JSON.stringify(merged, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (current !== serialized) {
    console.error("diamond.abi.json is stale — run: node scripts/build-merged-abi.mjs");
    process.exit(1);
  }
  console.log("diamond.abi.json is up to date");
} else {
  writeFileSync(outPath, serialized);
  console.log(`wrote ${outPath} (${merged.length} entries)`);
}
