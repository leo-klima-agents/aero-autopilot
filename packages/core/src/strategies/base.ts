/**
 * Strategy plumbing: deterministic weight normalization, the strategyRef
 * attribution hash (keccak of canonical config JSON — the exact bytes32 the
 * TargetsFacet emits, P1 "attribution, not enforcement"), and the config
 * schema spec that drives the web UI forms.
 */
import { keccak256, stringToBytes } from "viem";
import { WAD, mulDiv } from "../math/fixed.js";
import type { PoolId, StrategyConfig, TargetAllocation } from "../types.js";

/** Field spec for schema-driven config forms (plan §8). */
export interface FieldSpec {
  key: string;
  label: string;
  kind: "int" | "wadPct" | "seconds" | "select";
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
}

export interface StrategyDescriptor {
  kind: string;
  title: string;
  summary: string;
  /** Which protocol models this strategy may run against live (P3). */
  liveOn: "aerodrome-v2" | "aero-v3-sim-only";
  schema: FieldSpec[];
  defaults: StrategyConfig;
}

/** Canonical JSON: keys sorted, bigints stringified — stable across platforms. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** bytes32 attribution tag: keccak256 of the canonical config JSON. */
export function strategyRef(config: StrategyConfig): `0x${string}` {
  return keccak256(stringToBytes(canonicalJson(config)));
}

/**
 * Normalize raw scores to wad fractions summing exactly to WAD.
 * Floor-divides, then assigns the remainder to the largest-score pool
 * (ties → first) so the result is deterministic and Σ == WAD exactly.
 */
export function normalizeToWad(pools: readonly PoolId[], scores: readonly bigint[]): TargetAllocation {
  let total = 0n;
  for (const s of scores) total += s;
  if (total === 0n || pools.length === 0) return { pools: [], weightsWad: [] };
  const weights = scores.map((s) => mulDiv(s, WAD, total));
  let assigned = 0n;
  for (const w of weights) assigned += w;
  let largest = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[largest]!) largest = i;
  weights[largest] = weights[largest]! + (WAD - assigned);
  // Drop zero-weight pools for a clean on-chain target.
  const outPools: PoolId[] = [];
  const outWeights: bigint[] = [];
  pools.forEach((p, i) => {
    if (weights[i]! > 0n) {
      outPools.push(p);
      outWeights.push(weights[i]!);
    }
  });
  return { pools: outPools, weightsWad: outWeights };
}

/** Stable top-N by score (desc), ties broken by pool id asc. */
export function topN<T extends { pool: PoolId }>(
  items: readonly T[],
  score: (t: T) => bigint,
  n: number,
): T[] {
  return [...items]
    .sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0n) return d > 0n ? 1 : -1;
      return a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : 0;
    })
    .slice(0, n);
}
