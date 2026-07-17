/**
 * Synthetic epoch-dataset generator: persistent / bursty / regime-switching
 * weekly revenue processes with herd-following vote weights, calibrated to
 * the shape of empirical Aerodrome distributions (heavy-tailed pool sizes,
 * vote weight chasing last epoch's revenue). Used for tests, the committed
 * sample dataset, and Aero-model experiments before real data lands.
 */
import { Prng } from "../model/prng.js";
import type { EpochDataset } from "../model/types.js";

const WAD = 10n ** 18n;
const WEEK = 604_800n;
/** Thursday 2026-01-01-adjacent epoch boundary (multiple of WEEK, matches v2 flips). */
const GENESIS = 1_767_225_600n - (1_767_225_600n % WEEK);

export interface SyntheticDatasetOptions {
  pools: number;
  epochs: number;
  seed: number;
  /** Total external vote weight across all pools, wad (default ≈ 800M). */
  totalVotesWad?: bigint;
}

export function generateSyntheticEpochDataset(opts: SyntheticDatasetOptions): EpochDataset {
  const { pools, epochs, seed } = opts;
  const totalVotes = opts.totalVotesWad ?? 800_000_000n * WAD;
  const prng = new Prng(seed);

  // Heavy-tailed base revenue: pool i base ≈ 600k / (i+1)^1.2 AERO/epoch (integer approx).
  const baseRevenue: bigint[] = [];
  for (let i = 0; i < pools; i++) {
    const rank = BigInt(i + 1);
    baseRevenue.push((600_000n * WAD * 100n) / (rank * rank * 10n + rank * 90n + 10n));
  }

  const ids = Array.from({ length: pools }, (_, i) => `synthetic-pool-${String(i).padStart(2, "0")}`);
  const regimeHigh: boolean[] = ids.map(() => false);

  const revenueByEpoch: bigint[][] = [];
  for (let e = 0; e < epochs; e++) {
    const row: bigint[] = [];
    for (let i = 0; i < pools; i++) {
      // Mix: most pools persistent, every 4th bursty, every 5th regime-switching.
      let r = baseRevenue[i]!;
      if (i % 5 === 4) {
        if (prng.bernoulliPpm(120_000)) regimeHigh[i] = !regimeHigh[i];
        r = regimeHigh[i] ? r * 4n : r / 2n;
      } else if (i % 4 === 3) {
        r = prng.bernoulliPpm(150_000) ? r * 6n : r;
      }
      row.push(prng.jitter(r, 15));
    }
    revenueByEpoch.push(row);
  }

  // Votes chase last epoch's revenue with inertia (70% hold, 30% chase).
  let votes: bigint[] = baseRevenue.map((r) => {
    let total = 0n;
    for (const b of baseRevenue) total += b;
    return (totalVotes * r) / total;
  });
  const rows = revenueByEpoch.map((rev, e) => {
    if (e > 0) {
      const prev = revenueByEpoch[e - 1]!;
      let prevTotal = 0n;
      for (const r of prev) prevTotal += r;
      votes = votes.map((v, i) => {
        const chased = prevTotal > 0n ? (totalVotes * prev[i]!) / prevTotal : v;
        return (v * 7n + chased * 3n) / 10n;
      });
    }
    // Emissions ∝ votes, ~10M AERO/epoch system-wide.
    let voteTotal = 0n;
    for (const v of votes) voteTotal += v;
    const emissions = votes.map((v) => (10_000_000n * WAD * v) / (voteTotal === 0n ? 1n : voteTotal));
    return {
      start: (GENESIS + BigInt(e) * WEEK).toString(),
      revenueWad: rev.map((x) => x.toString()),
      externalVotesWad: votes.map((x) => x.toString()),
      emissionsWad: emissions.map((x) => x.toString()),
    };
  });

  return {
    schemaVersion: 1,
    source: `synthetic:seed-${seed}`,
    chainId: 0,
    epochSec: WEEK.toString(),
    pools: ids,
    epochs: rows,
  };
}
