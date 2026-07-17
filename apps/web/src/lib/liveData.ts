/**
 * Loader for the CI-built historical Aerodrome dataset the site ships as a
 * plain static file (see vite.config.ts). The payload is same-origin but
 * treated as untrusted anyway: shape-checked before a byte of it reaches the
 * backtester, null on any failure so the app degrades to synthetic data
 * (plan §9.4: degrade to last-published JSON, banner the staleness).
 */
import type { EpochDataset } from "@aero-poc/core";

export interface LiveDatasetMeta {
  pools: number;
  epochs: number;
  /** Start of the newest epoch, unix seconds. */
  lastEpochStart: number;
  /** True when the newest epoch is older than one flip + grace (data.yml missed a run). */
  stale: boolean;
}

export function datasetMeta(d: EpochDataset, nowMs = Date.now()): LiveDatasetMeta {
  const lastEpochStart = Number(d.epochs[d.epochs.length - 1]!.start);
  const epochSec = Number(d.epochSec);
  // Fresh = the newest complete epoch ended less than (one epoch + 2d grace) ago.
  const stale = nowMs / 1000 - (lastEpochStart + epochSec) > epochSec + 2 * 86_400;
  return { pools: d.pools.length, epochs: d.epochs.length, lastEpochStart, stale };
}

function isValid(d: unknown): d is EpochDataset {
  if (d === null || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  return (
    x.schemaVersion === 1 &&
    typeof x.epochSec === "string" &&
    Array.isArray(x.pools) &&
    x.pools.length > 0 &&
    Array.isArray(x.epochs) &&
    x.epochs.length > 0 &&
    x.epochs.every(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        typeof (e as Record<string, unknown>).start === "string" &&
        Array.isArray((e as Record<string, unknown>).revenueWad) &&
        Array.isArray((e as Record<string, unknown>).externalVotesWad),
    )
  );
}

export async function loadLiveDataset(): Promise<EpochDataset | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/aerodrome.json`);
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
