/**
 * Flight plan: which protocol model to fly against and the environment dials —
 * scenario preset, seed, cooldown, gauge-cap κ, herd lag, tranche count.
 * κ and herd-lag scale the preset's own values (they never replace them), so
 * the URL stays a pure {preset, seed, dials} record.
 *
 * Dial applicability by model — the disabled states below are the contract
 * the UI tests assert:
 *   continuous:  scenario ✓  seed ✓  cooldown ✓  tranches ✓  κ ✓  herd-lag ✓
 *   epoch:       scenario ✗  seed ✓  cooldown ✗  tranches ✗  κ ✗  herd-lag ✗
 *   epoch-live:  scenario ✗  seed ✗  cooldown ✗  tranches ✗  κ ✗  herd-lag ✗
 * Cooldown and tranches grey out in BOTH v2 modes: Aerodrome v2's single
 * global weekly epoch leaves no per-position clock to stagger against, so
 * sleeving and sub-weekly cooldowns are v3-only levers (pinned to 1 sleeve /
 * 7 d — see effectiveTranches/effectiveCooldownSec). Seed stays live for the
 * synthetic weeks but greys for recorded history, which generates nothing.
 */
import { SCENARIOS, type ScenarioName } from "@aero-poc/core";
import { fmtDuration } from "../lib/format";
import type { LiveDatasetMeta } from "../lib/liveData";
import {
  COOLDOWN_PRESETS,
  EPOCH_DATASET_SHAPE,
  SCENARIO_NAMES,
  effectiveCooldownSec,
  effectiveTranches,
  type SimState,
} from "../lib/state";

const SCENARIO_LABELS: Record<ScenarioName, string> = {
  "early-allocator": "Early allocator",
  "latency-race": "Latency race",
  "wash-bait": "Wash bait",
  "mixed-market": "Mixed market",
};

export function FlightPlanPanel(props: {
  state: SimState;
  /** undefined = still fetching, null = unavailable (ship without dataset / fetch failed). */
  live: LiveDatasetMeta | null | undefined;
  onChange: (patch: Partial<SimState>) => void;
}) {
  const { state, live, onChange } = props;
  const continuous = state.model === "continuous";
  const epochLive = state.model === "epoch-live";
  const seedable = !epochLive; // recorded history has no seed to turn
  // v2 pins these; show the pinned values while disabled (stored state is kept,
  // so switching back to Aero v3 restores the user's tuning).
  const effCooldown = effectiveCooldownSec(state);
  const effTranches = effectiveTranches(state);
  const scenario = SCENARIOS[state.scenario](state.seed);
  const kappa = (Number(scenario.kappaWad) / 1e18) * (state.kappaPct / 100);
  const lagSec =
    scenario.crowd.kind === "reactive"
      ? Math.max(1, Math.round((scenario.crowd.lagSteps * state.crowdLagPct) / 100)) *
        Number(scenario.stepSec)
      : null;

  const liveDate =
    live != null ? new Date(live.lastEpochStart * 1000).toISOString().slice(0, 10) : null;

  return (
    <section className="panel">
      <h2 className="panel-title">Flight plan</h2>

      <div className="field">
        <div className="segments" role="group" aria-label="Protocol model">
          <button
            type="button"
            className="segment"
            aria-pressed={state.model === "epoch"}
            onClick={() => onChange({ model: "epoch" })}
          >
            <span className="seg-name">Aerodrome v2 · synthetic</span>
            <span className="seg-sub">
              weekly epochs · {EPOCH_DATASET_SHAPE.pools} pools × {EPOCH_DATASET_SHAPE.epochs} wk
            </span>
          </button>
          <button
            type="button"
            className="segment"
            aria-pressed={epochLive}
            disabled={live == null}
            title={live == null ? "historical dataset unavailable" : undefined}
            onClick={() => onChange({ model: "epoch-live" })}
          >
            <span className="seg-name">Aerodrome v2 · historical</span>
            <span className="seg-sub">
              {live == null
                ? live === undefined
                  ? "loading dataset…"
                  : "dataset unavailable"
                : `live data · ${live.pools} pools × ${live.epochs} wk · to ${liveDate}`}
            </span>
          </button>
          <button
            type="button"
            className="segment"
            aria-pressed={continuous}
            onClick={() => onChange({ model: "continuous" })}
          >
            <span className="seg-name">Aero v3</span>
            <span className="seg-sub">continuous · per-second streams</span>
          </button>
        </div>
        {epochLive && live?.stale ? (
          <div className="help stale" role="status">
            Dataset is stale — newest epoch ended {liveDate}; the weekly data.yml run may have
            failed. Results reflect the last-published JSON (plan §9.4).
          </div>
        ) : null}
      </div>

      <div className={`field${continuous ? "" : " disabled"}`}>
        <label htmlFor="scenario">Scenario preset</label>
        <select
          id="scenario"
          value={state.scenario}
          disabled={!continuous}
          onChange={(e) => onChange({ scenario: e.target.value as ScenarioName })}
        >
          {SCENARIO_NAMES.map((name) => (
            <option key={name} value={name}>
              {SCENARIO_LABELS[name]}
            </option>
          ))}
        </select>
      </div>

      <div className={`field${seedable ? "" : " disabled"}`}>
        <label htmlFor="seed">Seed</label>
        <div className="seed-row">
          <input
            id="seed"
            type="number"
            min={0}
            step={1}
            value={state.seed}
            disabled={!seedable}
            onChange={(e) => {
              const n = Math.max(0, Math.round(Number(e.target.value)));
              if (Number.isFinite(n)) onChange({ seed: n });
            }}
          />
          <button
            type="button"
            className="reroll"
            disabled={!seedable}
            onClick={() => onChange({ seed: Math.floor(Math.random() * 100_000) })}
          >
            Reroll
          </button>
        </div>
        <div className="help">
          {seedable
            ? "Every run is seed-deterministic — share the URL to reproduce it."
            : "Recorded history — there is nothing to seed; the URL still reproduces the run."}
        </div>
      </div>

      <div className={`field${continuous ? "" : " disabled"}`}>
        <label htmlFor="cooldown">Reallocation cooldown</label>
        <select
          id="cooldown"
          value={effCooldown}
          disabled={!continuous}
          onChange={(e) => onChange({ cooldownSec: e.target.value })}
        >
          {COOLDOWN_PRESETS.map((c) => (
            <option key={c.sec} value={c.sec}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="help">
          {continuous
            ? "Minimum time between a single sleeve's reallocations."
            : "Pinned to the weekly epoch — v2 allows one vote change per epoch, protocol-wide."}
        </div>
      </div>

      <div className={`field${continuous ? "" : " disabled"}`}>
        <label htmlFor="tranches">
          Tranches<span className="readout">{effTranches}</span>
        </label>
        <input
          id="tranches"
          type="range"
          min={1}
          max={12}
          step={1}
          value={effTranches}
          disabled={!continuous}
          onChange={(e) => onChange({ tranches: Number(e.target.value) })}
        />
        <div className="help">
          {continuous
            ? "Staggered cooldown sleeves — some power is always (eventually) unlocked."
            : "Pinned to 1 — v2's global weekly epoch gives sleeving nothing to stagger against."}
        </div>
      </div>

      <div className={`field${continuous ? "" : " disabled"}`}>
        <label htmlFor="kappa">
          Gauge cap κ<span className="readout">×{(state.kappaPct / 100).toFixed(2)} → κ = {kappa.toFixed(2)}</span>
        </label>
        <input
          id="kappa"
          type="range"
          min={25}
          max={300}
          step={25}
          value={state.kappaPct}
          disabled={!continuous}
          onChange={(e) => onChange({ kappaPct: Number(e.target.value) })}
        />
        <div className="help">Emissions cap at κ × trailing realized revenue; overage burns.</div>
      </div>

      <div className={`field${continuous && lagSec !== null ? "" : " disabled"}`}>
        <label htmlFor="crowdlag">
          Herd lag
          <span className="readout">
            ×{(state.crowdLagPct / 100).toFixed(2)}
            {lagSec !== null ? ` → ${fmtDuration(lagSec)}` : ""}
          </span>
        </label>
        <input
          id="crowdlag"
          type="range"
          min={25}
          max={400}
          step={25}
          value={state.crowdLagPct}
          disabled={!continuous || lagSec === null}
          onChange={(e) => onChange({ crowdLagPct: Number(e.target.value) })}
        />
        <div className="help">How stale the reactive crowd's revenue signal is.</div>
      </div>
    </section>
  );
}
