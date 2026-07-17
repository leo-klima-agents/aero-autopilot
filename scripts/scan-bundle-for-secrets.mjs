#!/usr/bin/env node
/**
 * P7 enforcement: grep the built site bundle for anything that smells like a
 * key or private endpoint and fail the deploy on a hit. Runs in pages.yml
 * after every build — the site must be fully static and secret-free.
 *
 * Usage: node scripts/scan-bundle-for-secrets.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = process.argv[2];
if (!distDir) {
  console.error("usage: scan-bundle-for-secrets.mjs <dist-dir>");
  process.exit(2);
}

const PATTERNS = [
  // env names that must never be referenced client-side
  /BASE_RPC_URL/,
  /ETHERSCAN_API_KEY/,
  /KEEPER_PRIVATE_KEY/,
  // key shapes
  /\b0x[0-9a-fA-F]{64}\b/, // raw 32-byte hex (private key shaped)
  // provider-URL shapes: a leaked BASE_RPC_URL is a key even without the env name
  /alchemy\.com\/v2\/[A-Za-z0-9_-]{20,}/,
  /https:\/\/[a-z0-9-]+\.g\.alchemy\.com/,
];

// 32-byte hex constants that are legitimately public (role ids, keccak slots,
// strategyRef examples) would false-positive; allow explicit hashes here.
const ALLOWLIST = [
  /0x0{64}/, // zero word
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|css|html|json|map|txt)$/.test(entry)) yield p;
  }
}

let hits = 0;
for (const file of walk(distDir)) {
  const content = readFileSync(file, "utf8");
  for (const pattern of PATTERNS) {
    const m = content.match(pattern);
    if (m && !ALLOWLIST.some((a) => a.test(m[0]))) {
      console.error(`SECRET-SHAPED CONTENT in ${file}: ${pattern} matched "${m[0].slice(0, 24)}…"`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`\n${hits} hit(s) — refusing to deploy this bundle (P7).`);
  process.exit(1);
}
console.log("bundle clean: no secret-shaped content found");
