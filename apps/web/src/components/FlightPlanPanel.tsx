/**
 * Flight plan: which protocol model to fly against and the environment dials —
 * scenario preset, seed, cooldown, gauge-cap κ, herd lag, tranche count.
 * κ and herd-lag scale the preset's own values (they never replace them), so
 * the URL stays a pure {preset, seed, dials} record.
 */
import { SCENARIOS, type ScenarioName } from "@aero-poc/core";
import { fmtDuration } from "../lib/format";
import {
  COOLDOWN_PRESETS,
  EPOCH_DATASET_SHAPE,
  SCENARIO_NAMES,
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
  onChange: (patch: Partial<SimState>) => void;
}) {
  const { state, onChange } = props;
  const continuous = state.model === "continuous";
  const scenario = SCENARIOS[state.scenario](state.seed);
  const kappa = (Number(scenario.kappaWad) / 1e18) * (state.kappaPct / 100);
  const lagSec =
    scenario.crowd.kind === "reactive"
      ? Math.max(1, Math.round((scenario.crowd.lagSteps * state.crowdLagPct) / 100)) *
        Number(scenario.stepSec)
      : null;

  return (
    <section className="panel">
      <h2 className="panel-title">Flight plan</h2>

      <div className="field">
        <div className="segments" role="group" aria-label="Protocol model">
          <button
            type="button"
            className="segment"
            aria-pressed={!continuous}
            onClick={() => onChange({ model: "epoch" })}
          >
            <span className="seg-name">Aerodrome v2</span>
            <span className="seg-sub">
              weekly epochs · {EPOCH_DATASET_SHAPE.pools} pools × {EPOCH_DATASET_SHAPE.epochs} wk
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

      <div className="field">
        <label htmlFor="seed">Seed</label>
        <div className="seed-row">
          <input
            id="seed"
            type="number"
            min={0}
            step={1}
            value={state.seed}
            onChange={(e) => {
              const n = Math.max(0, Math.round(Number(e.target.value)));
              if (Number.isFinite(n)) onChange({ seed: n });
            }}
          />
          <button
            type="button"
            className="reroll"
            onClick={() => onChange({ seed: Math.floor(Math.random() * 100_000) })}
          >
            Reroll
          </button>
        </div>
        <div className="help">Every run is seed-deterministic — share the URL to reproduce it.</div>
      </div>

      <div className="field">
        <label htmlFor="cooldown">Reallocation cooldown</label>
        <select
          id="cooldown"
          value={state.cooldownSec}
          onChange={(e) => onChange({ cooldownSec: e.target.value })}
        >
          {COOLDOWN_PRESETS.map((c) => (
            <option key={c.sec} value={c.sec}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="tranches">
          Tranches<span className="readout">{state.tranches}</span>
        </label>
        <input
          id="tranches"
          type="range"
          min={1}
          max={12}
          step={1}
          value={state.tranches}
          onChange={(e) => onChange({ tranches: Number(e.target.value) })}
        />
        <div className="help">Staggered cooldown sleeves — some power is always (eventually) unlocked.</div>
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
