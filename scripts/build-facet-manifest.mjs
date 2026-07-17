#!/usr/bin/env node
/**
 * Regenerate contracts/facets.json from forge artifacts.
 *
 * The manifest is the off-chain mirror of the loupe (§4.1): facet name →
 * function signatures → selectors → deployed address (zero until a
 * deployment records it). CI regenerates and diffs it (check mode) so the
 * committed manifest can never drift from the code; the diamond test suite
 * additionally asserts the loupe of a freshly built diamond matches it.
 *
 * Usage: node scripts/build-facet-manifest.mjs [--check]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "contracts");
const manifestPath = join(contractsDir, "facets.json");

/** Every facet that can be cut into the diamond. */
const FACETS = [
  "DiamondCutFacet",
  "DiamondLoupeFacet",
  "OwnershipFacet",
  "AccessFacet",
  "CustodyFacet",
  "TrancheFacet",
  "TargetsFacet",
  "ExecutionFacet",
  "AerodromeFacet",
  "MockAeroFacet",
  "AeroFacet",
];

function inspect(name) {
  const out = execFileSync("forge", ["inspect", name, "methodIdentifiers", "--json"], {
    cwd: contractsDir,
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const facets = {};
const selectorOwners = new Map(); // selector → [facet names] for collision check
for (const name of FACETS) {
  const methods = inspect(name);
  const selectors = {};
  for (const [sig, sel] of Object.entries(methods).sort(([a], [b]) => a.localeCompare(b))) {
    selectors[sig] = `0x${sel}`;
    const owners = selectorOwners.get(sel) ?? [];
    owners.push(name);
    selectorOwners.set(sel, owners);
  }
  // bytes32 right-padded form, consumed by the Solidity loupe/manifest test
  // (stdJson cannot iterate the signature map above).
  const selectorList = Object.values(selectors)
    .sort()
    .map((s) => s.padEnd(66, "0"));
  facets[name] = { selectors, selectorList, address: "0x0000000000000000000000000000000000000000" };
}

// Selector-collision check across facets that could ever coexist in one cut.
// Protocol facets deliberately share the IProtocolFacet selector set — they
// replace each other and never coexist.
const PROTOCOL_FACETS = new Set(["AerodromeFacet", "MockAeroFacet", "AeroFacet"]);
const collisions = [];
for (const [sel, owners] of selectorOwners) {
  const nonProtocol = owners.filter((o) => !PROTOCOL_FACETS.has(o));
  const protocolCount = owners.length - nonProtocol.length;
  if (nonProtocol.length > 1 || (nonProtocol.length >= 1 && protocolCount > 0)) {
    collisions.push({ selector: sel, owners });
  }
}
if (collisions.length) {
  console.error("selector collisions between coexisting facets:");
  for (const c of collisions) console.error(`  0x${c.selector}: ${c.owners.join(", ")}`);
  process.exit(1);
}

// Preserve any previously recorded deployment addresses.
if (existsSync(manifestPath)) {
  const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [name, entry] of Object.entries(prev.facets ?? {})) {
    if (facets[name] && entry.address && entry.address !== "0x0000000000000000000000000000000000000000") {
      facets[name].address = entry.address;
    }
  }
}

const manifest = {
  schemaVersion: 1,
  note: "Off-chain mirror of the loupe. Regenerate with: pnpm manifest:build. CI fails on drift.",
  facets,
};
const serialized = JSON.stringify(manifest, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  if (current !== serialized) {
    console.error("facets.json is stale — run: node scripts/build-facet-manifest.mjs");
    process.exit(1);
  }
  console.log("facets.json is up to date");
} else {
  writeFileSync(manifestPath, serialized);
  console.log(`wrote ${manifestPath} (${Object.keys(facets).length} facets)`);
}
