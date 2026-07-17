/**
 * Guidance: strategy picker + schema-driven config form. The form is rendered
 * entirely from STRATEGY_DESCRIPTORS FieldSpecs so the UI can never drift from
 * what core actually accepts, and the strategyRef shown is the keccak of the
 * exact config the worker runs — the bytes32 attribution tag that would be
 * emitted on-chain.
 */
import {
  STRATEGY_DESCRIPTORS,
  strategyRef,
  type FieldSpec,
  type StrategyConfig,
} from "@aero-poc/core";
import { fmtDuration, pctToWad, wadToPct } from "../lib/format";
import { descriptorFor, DURATION_PRESETS } from "../lib/state";

export function StrategyPanel(props: {
  strategy: StrategyConfig;
  onChange: (strategy: StrategyConfig) => void;
}) {
  const { strategy, onChange } = props;
  const descriptor = descriptorFor(strategy);
  const selectedIndex = STRATEGY_DESCRIPTORS.indexOf(descriptor);
  const live = descriptor.liveOn === "aerodrome-v2";

  return (
    <section className="panel">
      <h2 className="panel-title">Guidance</h2>

      <div className="field">
        <label htmlFor="strategy">Strategy</label>
        <select
          id="strategy"
          value={selectedIndex}
          onChange={(e) => {
            const d = STRATEGY_DESCRIPTORS[Number(e.target.value)];
            if (d) onChange({ ...d.defaults });
          }}
        >
          {STRATEGY_DESCRIPTORS.map((d, i) => (
            <option key={`${d.kind}-${d.defaults.cadenceSec}`} value={i}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      <span className={`badge ${live ? "live" : "sim"}`}>
        {live ? "live on Aerodrome v2" : "sim-only until Aero ships"}
      </span>
      <p className="strategy-summary">{descriptor.summary}</p>

      {descriptor.schema.map((field) => (
        <SchemaField
          key={field.key}
          field={field}
          value={strategy[field.key]}
          onChange={(v) => onChange({ ...strategy, [field.key]: v })}
        />
      ))}

      <div className="ref-tag">
        <span className="ref-label">strategyRef · on-chain attribution tag</span>
        <code>{strategyRef(strategy)}</code>
      </div>
    </section>
  );
}

function SchemaField(props: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: string | number) => void;
}) {
  const { field, value, onChange } = props;
  const id = `f-${field.key}`;

  if (field.kind === "int") {
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          step={1}
          value={Number(value)}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (!Number.isFinite(n)) return;
            const lo = field.min ?? 0;
            const hi = field.max ?? Number.MAX_SAFE_INTEGER;
            onChange(Math.min(hi, Math.max(lo, n)));
          }}
        />
        {field.help ? <div className="help">{field.help}</div> : null}
      </div>
    );
  }

  if (field.kind === "seconds") {
    const current = Number(value);
    const options = DURATION_PRESETS.filter(
      (d) => (field.min === undefined || d.sec >= field.min) && (field.max === undefined || d.sec <= field.max),
    );
    const isPreset = options.some((d) => d.sec === current);
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <select id={id} value={String(current)} onChange={(e) => onChange(e.target.value)}>
          {!isPreset ? <option value={String(current)}>{fmtDuration(current)}</option> : null}
          {options.map((d) => (
            <option key={d.sec} value={String(d.sec)}>
              {d.label}
            </option>
          ))}
        </select>
        {field.help ? <div className="help">{field.help}</div> : null}
      </div>
    );
  }

  if (field.kind === "wadPct") {
    // wad fraction travels as a decimal string in the config; the dial is %.
    const pct = wadToPct(String(value));
    return (
      <div className="field">
        <label htmlFor={id}>
          {field.label}
          <span className="readout">{pct.toFixed(1)}%</span>
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={200}
          step={0.5}
          value={pct}
          onChange={(e) => onChange(pctToWad(Number(e.target.value)))}
        />
        {field.help ? <div className="help">{field.help}</div> : null}
      </div>
    );
  }

  // select
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {field.help ? <div className="help">{field.help}</div> : null}
    </div>
  );
}
