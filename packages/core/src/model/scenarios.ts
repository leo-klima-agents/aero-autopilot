/**
 * Preset synthetic scenarios (plan §8): early-allocator, latency-race,
 * wash-bait — plus a generic mixed market. All quantities wad; rates are
 * per-second. Calibration intent: a "1.0" AERO/day pool ≈ 11574074074074 wad/s.
 */
import type { ContinuousScenarioConfig } from "./types.js";

const PER_DAY = 86_400n;
const rate = (aeroPerDay: bigint): string => ((aeroPerDay * 10n ** 18n) / PER_DAY).toString();

export const HOUR = 3600;
export const DAY = 86_400;

function base(
  name: string,
  overrides: Partial<ContinuousScenarioConfig>,
): ContinuousScenarioConfig {
  return {
    schemaVersion: 1,
    name,
    stepSec: "3600",
    numSteps: 24 * 28, // four weeks, hourly steps
    seed: 1337,
    pools: [],
    crowd: { kind: "reactive", lagSteps: 24, alphaWad: (10n ** 17n).toString() },
    kappaWad: (12n * 10n ** 17n).toString(), // κ = 1.2
    emissionsPerSecWad: rate(2_000n),
    trailingWindowSteps: 48,
    ...overrides,
  };
}

/**
 * Early-allocator arc: a quiet pool's organic revenue ramps sharply; early
 * weight earns an outsized share until the herd (lagged) arrives and dilutes.
 */
export function earlyAllocatorScenario(seed = 1337): ContinuousScenarioConfig {
  return base("early-allocator", {
    seed,
    pools: [
      { id: "pool-established-A", process: { kind: "persistent", baseRateWad: rate(400n), volPct: 5 }, externalWeightWad: (4_000_000n * 10n ** 18n).toString() },
      { id: "pool-established-B", process: { kind: "persistent", baseRateWad: rate(300n), volPct: 5 }, externalWeightWad: (3_000_000n * 10n ** 18n).toString() },
      { id: "pool-riser", process: { kind: "regime", rateAWad: rate(20n), rateBWad: rate(600n), switchProb: 0.004 }, externalWeightWad: (200_000n * 10n ** 18n).toString() },
      { id: "pool-tail", process: { kind: "persistent", baseRateWad: rate(50n), volPct: 20 }, externalWeightWad: (500_000n * 10n ** 18n).toString() },
    ],
  });
}

/**
 * Latency race: bursty revenue whose bursts are shorter than the herd's lag.
 * Run with cooldowns from 48h down to one block to show reactive returns at
 * block cadence converging to the system average minus latency costs (P3).
 */
export function latencyRaceScenario(seed = 4242): ContinuousScenarioConfig {
  return base("latency-race", {
    seed,
    stepSec: "600", // 10-minute steps
    numSteps: 6 * 24 * 14, // two weeks
    crowd: { kind: "reactive", lagSteps: 6, alphaWad: (3n * 10n ** 17n).toString() },
    trailingWindowSteps: 12,
    pools: [
      { id: "pool-bursty-A", process: { kind: "bursty", baseRateWad: rate(100n), burstProb: 0.02, burstMult: 12 }, externalWeightWad: (1_000_000n * 10n ** 18n).toString() },
      { id: "pool-bursty-B", process: { kind: "bursty", baseRateWad: rate(100n), burstProb: 0.02, burstMult: 12 }, externalWeightWad: (1_000_000n * 10n ** 18n).toString() },
      { id: "pool-steady", process: { kind: "persistent", baseRateWad: rate(220n), volPct: 3 }, externalWeightWad: (2_000_000n * 10n ** 18n).toString() },
    ],
  });
}

/**
 * Wash-bait: an adversarial pool advertises enormous revenue (wash volume)
 * that allocators never realize, then collapses. Strategies with a
 * persistence/organic filter should refuse it; naive trailing-revenue chasers
 * get trapped through their cooldown.
 */
export function washBaitScenario(seed = 7777): ContinuousScenarioConfig {
  return base("wash-bait", {
    seed,
    pools: [
      { id: "pool-honest-A", process: { kind: "persistent", baseRateWad: rate(350n), volPct: 6 }, externalWeightWad: (3_000_000n * 10n ** 18n).toString() },
      { id: "pool-honest-B", process: { kind: "persistent", baseRateWad: rate(250n), volPct: 6 }, externalWeightWad: (2_500_000n * 10n ** 18n).toString() },
      { id: "pool-bait", process: { kind: "washbait", advertisedRateWad: rate(1_500n), collapseStep: 24 * 10 }, externalWeightWad: (100_000n * 10n ** 18n).toString() },
    ],
  });
}

/** Generic mixed market for free-form exploration in the web UI. */
export function mixedMarketScenario(seed = 2026): ContinuousScenarioConfig {
  return base("mixed-market", {
    seed,
    pools: [
      { id: "pool-blue-A", process: { kind: "persistent", baseRateWad: rate(500n), volPct: 4 }, externalWeightWad: (5_000_000n * 10n ** 18n).toString() },
      { id: "pool-blue-B", process: { kind: "persistent", baseRateWad: rate(380n), volPct: 6 }, externalWeightWad: (4_000_000n * 10n ** 18n).toString() },
      { id: "pool-regime", process: { kind: "regime", rateAWad: rate(80n), rateBWad: rate(420n), switchProb: 0.01 }, externalWeightWad: (900_000n * 10n ** 18n).toString() },
      { id: "pool-bursty", process: { kind: "bursty", baseRateWad: rate(120n), burstProb: 0.015, burstMult: 10 }, externalWeightWad: (1_100_000n * 10n ** 18n).toString() },
      { id: "pool-tail", process: { kind: "persistent", baseRateWad: rate(40n), volPct: 25 }, externalWeightWad: (300_000n * 10n ** 18n).toString() },
    ],
  });
}

export const SCENARIOS = {
  "early-allocator": earlyAllocatorScenario,
  "latency-race": latencyRaceScenario,
  "wash-bait": washBaitScenario,
  "mixed-market": mixedMarketScenario,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
