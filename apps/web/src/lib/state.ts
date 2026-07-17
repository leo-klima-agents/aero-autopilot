/**
 * URL-reproducible simulator state (plan §8): everything a run depends on is
 * serialized into the location hash as base64url JSON, so a shared link
 * regenerates the exact same deterministic backtest. Strategy configs already
 * carry bigint-wads as strings, so the whole state is JSON-safe — no bigint
 * ever reaches JSON.stringify.
 */
import {
  SCENARIOS,
  STRATEGY_DESCRIPTORS,
  generateSyntheticEpochDataset,
  type BacktestRequest,
  type EpochDataset,
  type ScenarioName,
  type StrategyConfig,
  type StrategyDescriptor,
} from "@aero-poc/core";

/** "epoch" = synthetic v2 weeks; "epoch-live" = the CI-built historical
 * Aerodrome dataset shipped with the site; "continuous" = Aero v3 sim. */
export type ModelKind = "epoch" | "epoch-live" | "continuous";

export interface SimState {
  model: ModelKind;
  /** Continuous model only: which preset generator to call. */
  scenario: ScenarioName;
  seed: number;
  cooldownSec: string;
  /** Staggered cooldown tranches, 1–12 (v3 positions can't be split). */
  tranches: number;
  /** Gauge-cap κ as % of the scenario's own kappaWad (continuous only). */
  kappaPct: number;
  /** Reactive-crowd lagSteps as % of the scenario's own lag (continuous only). */
  crowdLagPct: number;
  strategy: StrategyConfig;
}

/** One power/epsilon everywhere so results only vary with what the UI exposes. */
const TOTAL_POWER_WAD = (500_000n * 10n ** 18n).toString();
const EPSILON_WAD = (10n ** 16n).toString(); // 1% half-L1 rotation band

export const EPOCH_DATASET_SHAPE = { pools: 20, epochs: 26 };

export const COOLDOWN_PRESETS = [
  { label: "7 d", sec: "604800" },
  { label: "48 h", sec: "172800" },
  { label: "24 h", sec: "86400" },
  { label: "1 h", sec: "3600" },
  { label: "1 block (2 s)", sec: "2" },
] as const;

/** Duration menu for schema `seconds` fields (decision cadence). */
export const DURATION_PRESETS = [
  { label: "1 block (2 s)", sec: 2 },
  { label: "10 min", sec: 600 },
  { label: "1 h", sec: 3600 },
  { label: "24 h", sec: 86400 },
  { label: "48 h", sec: 172800 },
  { label: "7 d", sec: 604800 },
] as const;

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export function defaultState(): SimState {
  // Landing default chosen to *show* the early-allocator arc: WaterFilling on
  // a 24h clock beats the passive line while the herd is still lagging.
  const descriptor = STRATEGY_DESCRIPTORS.find((d) => d.kind === "water-filling") ?? STRATEGY_DESCRIPTORS[0]!;
  return {
    model: "continuous",
    scenario: "early-allocator",
    seed: 1337,
    cooldownSec: "86400",
    tranches: 4,
    kappaPct: 100,
    crowdLagPct: 100,
    strategy: { ...descriptor.defaults },
  };
}

/**
 * Pick the descriptor a config belongs to. fixed-grid ships four descriptors
 * differing only in default cadence, so match the nearest cadence — that keeps
 * the liveOn badge honest when the weekly grid is tightened (P3) without
 * reimplementing the descriptor's own liveOn rule.
 */
export function descriptorFor(config: StrategyConfig): StrategyDescriptor {
  const byKind = STRATEGY_DESCRIPTORS.filter((d) => d.kind === config.kind);
  if (byKind.length === 0) return STRATEGY_DESCRIPTORS[0]!;
  const cadence = Number(config.cadenceSec);
  let best = byKind[0]!;
  for (const d of byKind) {
    if (Math.abs(Number(d.defaults.cadenceSec) - cadence) < Math.abs(Number(best.defaults.cadenceSec) - cadence)) {
      best = d;
    }
  }
  return best;
}

/** ── base64url round-trip ─────────────────────────────────────────────────── */

export function encodeState(state: SimState): string {
  const json = JSON.stringify(state);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeState(raw: string): SimState | null {
  try {
    const b64 = raw.replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

const clampInt = (x: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof x === "number" && Number.isFinite(x) ? Math.round(x) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

const asSeconds = (x: unknown, dflt: string): string =>
  typeof x === "string" && /^\d{1,10}$/.test(x) && Number(x) >= 1 ? x : dflt;

/**
 * Hash payloads are untrusted input: every field is validated or replaced with
 * a default, and strategy configs are rebuilt from descriptor defaults so only
 * schema-known keys with the right primitive types survive.
 */
function sanitize(parsed: unknown): SimState {
  const d = defaultState();
  if (parsed === null || typeof parsed !== "object") return d;
  const p = parsed as Record<string, unknown>;

  const model: ModelKind =
    p.model === "epoch" || p.model === "epoch-live" ? p.model : "continuous";
  const scenario = SCENARIO_NAMES.includes(p.scenario as ScenarioName)
    ? (p.scenario as ScenarioName)
    : d.scenario;

  return {
    model,
    scenario,
    seed: clampInt(p.seed, 0, 2 ** 31 - 1, d.seed),
    cooldownSec: asSeconds(p.cooldownSec, d.cooldownSec),
    tranches: clampInt(p.tranches, 1, 12, d.tranches),
    kappaPct: clampInt(p.kappaPct, 10, 400, d.kappaPct),
    crowdLagPct: clampInt(p.crowdLagPct, 10, 400, d.crowdLagPct),
    strategy: sanitizeStrategy(p.strategy, d.strategy),
  };
}

function sanitizeStrategy(raw: unknown, dflt: StrategyConfig): StrategyConfig {
  if (raw === null || typeof raw !== "object") return dflt;
  const r = raw as Record<string, unknown>;
  const descriptor = STRATEGY_DESCRIPTORS.find((s) => s.kind === r.kind);
  if (!descriptor) return dflt;
  const out: StrategyConfig = { ...descriptor.defaults };
  for (const field of descriptor.schema) {
    const v = r[field.key];
    if (field.kind === "int") {
      out[field.key] = clampInt(v, field.min ?? 0, field.max ?? Number.MAX_SAFE_INTEGER, out[field.key] as number);
    } else if (field.kind === "seconds") {
      out[field.key] = asSeconds(v, out[field.key] as string);
    } else if (field.kind === "wadPct") {
      // wad fractions travel as decimal strings; anything else keeps the default
      out[field.key] = typeof v === "string" && /^\d{1,30}$/.test(v) ? v : out[field.key];
    } else if (field.kind === "select") {
      out[field.key] = typeof v === "string" && (field.options ?? []).includes(v) ? v : out[field.key];
    }
  }
  return out;
}

/** ── location hash plumbing ───────────────────────────────────────────────── */

const HASH_KEY = "#s=";

export function readLocationState(): SimState | null {
  const h = window.location.hash;
  return h.startsWith(HASH_KEY) ? decodeState(h.slice(HASH_KEY.length)) : null;
}

export function writeLocationState(state: SimState): void {
  // replaceState: shared-link fidelity without a history entry per keystroke.
  history.replaceState(null, "", HASH_KEY + encodeState(state));
}

/** ── request assembly ─────────────────────────────────────────────────────── */

/**
 * @param live the fetched historical dataset; when "epoch-live" is selected
 * but the dataset isn't available (fetch failed / still loading), the run
 * falls back to the synthetic epoch model so the page always renders — the
 * panel communicates the degradation.
 */
export function buildRequest(state: SimState, id: number, live?: EpochDataset | null): BacktestRequest {
  const model =
    state.model === "epoch-live" && live
      ? { kind: "epoch" as const, dataset: live }
      : state.model === "epoch" || state.model === "epoch-live"
        ? { kind: "epoch" as const, dataset: generateSyntheticEpochDataset({ ...EPOCH_DATASET_SHAPE, seed: state.seed }) }
        : { kind: "continuous" as const, scenario: scaledScenario(state) };
  return {
    id,
    model,
    strategy: state.strategy,
    trancheCount: state.tranches,
    totalPowerWad: TOTAL_POWER_WAD,
    cooldownSec: state.cooldownSec,
    epsilonWad: EPSILON_WAD,
    // The strategy's own cadence field is the single decision-cadence control;
    // the runner consults on the same clock the config is hashed with.
    cadenceSec: String(state.strategy.cadenceSec),
  };
}

/** Preset scenario with the κ and crowd-lag dials applied (both scale, never replace). */
export function scaledScenario(state: SimState) {
  const base = SCENARIOS[state.scenario](state.seed);
  return {
    ...base,
    kappaWad: ((BigInt(base.kappaWad) * BigInt(state.kappaPct)) / 100n).toString(),
    crowd:
      base.crowd.kind === "reactive"
        ? { ...base.crowd, lagSteps: Math.max(1, Math.round((base.crowd.lagSteps * state.crowdLagPct) / 100)) }
        : base.crowd,
  };
}
