/**
 * Protocol models: one interface, two implementations (P: EpochModel for
 * Aerodrome v2 weekly epochs, ContinuousModel for the parameterized Aero v3
 * simulation). The backtest runner drives either.
 */
import type { MarketState, Portfolio } from "../types.js";

export interface StepResult {
  /** Revenue earned by our portfolio this step, wad. */
  revenueWad: bigint;
  /** Passive benchmark revenue this step: our power earning global revenue ÷ global weight, wad. */
  benchmarkRevenueWad: bigint;
  /** System emissions actually emitted this step (0 for the epoch model), wad. */
  emittedWad: bigint;
  /** System emissions burned above gauge caps this step, wad. */
  burnedWad: bigint;
}

export interface ProtocolModel {
  readonly kind: "epoch" | "continuous";
  /** Wall-clock seconds per step (one epoch, or the sim step). */
  readonly stepSec: bigint;
  readonly numSteps: number;
  /** Unix-ish time at the start of step k. */
  timeAt(k: number): bigint;
  /** What a strategy is allowed to see at the start of step k (trailing stats only). */
  marketState(k: number): MarketState;
  /** Advance step k with our portfolio allocated as given. */
  step(k: number, portfolio: Portfolio): StepResult;
}

/** ── Historical epoch dataset (built by the indexer / calibrator) ─────────── */
export interface EpochDataset {
  schemaVersion: 1;
  /** Provenance: "aerodrome-base-mainnet" | "synthetic:<name>" */
  source: string;
  chainId: number;
  epochSec: string;
  /** Pool ids (addresses for live data). */
  pools: string[];
  epochs: EpochRow[];
}

export interface EpochRow {
  /** Epoch start, unix seconds (stringified bigint). */
  start: string;
  /** Voter revenue (fees + incentives) per pool for this epoch, wad, AERO-denominated. */
  revenueWad: string[];
  /** External vote weight per pool at epoch end, wad. */
  externalVotesWad: string[];
  /** Emissions to the pool's gauge for this epoch, wad (0 if not indexed). */
  emissionsWad: string[];
}

/** ── Synthetic continuous scenario (regenerated client-side from seed, P7) ── */
export type RevenueProcess =
  | { kind: "persistent"; baseRateWad: string; volPct: number }
  | { kind: "bursty"; baseRateWad: string; burstProb: number; burstMult: number }
  | { kind: "regime"; rateAWad: string; rateBWad: string; switchProb: number }
  /** Advertises a high rate that collapses to zero at collapseStep (adversarial wash-bait). */
  | { kind: "washbait"; advertisedRateWad: string; collapseStep: number };

export interface SyntheticPool {
  id: string;
  process: RevenueProcess;
  /** Initial external (crowd) weight, wad. */
  externalWeightWad: string;
}

export type CrowdConfig =
  | { kind: "static" }
  /** Herd chases trailing revenue observed lagSteps ago, moving alphaWad of its weight per step. */
  | { kind: "reactive"; lagSteps: number; alphaWad: string };

export interface ContinuousScenarioConfig {
  schemaVersion: 1;
  name: string;
  stepSec: string;
  numSteps: number;
  seed: number;
  pools: SyntheticPool[];
  crowd: CrowdConfig;
  /** Gauge-cap multiple κ, wad. */
  kappaWad: string;
  /** Total scheduled emissions per second across the system, wad. */
  emissionsPerSecWad: string;
  /** Steps of trailing revenue used for caps and strategy windows. */
  trailingWindowSteps: number;
}
