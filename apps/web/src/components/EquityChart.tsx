/**
 * Flight path: cumulative return vs the passive benchmark. Emphasis form —
 * the strategy takes categorical slot 1, the benchmark is de-emphasis gray
 * context. Crosshair tooltip reads both series at once; the table view is the
 * accessible twin.
 */
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { EquityPoint } from "@aero-poc/core";
import { fmtElapsed, fmtPct } from "../lib/format";
import { CHART } from "../lib/palette";

export type TimeUnit = "d" | "wk";

const UNIT_SEC: Record<TimeUnit, number> = { d: 86_400, wk: 604_800 };

interface Row {
  e: number; // elapsed seconds since the first sample
  ours: number;
  benchmark: number;
}

export function EquityChart(props: { series: EquityPoint[]; unit: TimeUnit }) {
  const { series, unit } = props;
  const t0 = series[0]?.t ?? 0;
  const rows = useMemo<Row[]>(
    () => series.map((p) => ({ e: p.t - t0, ours: p.ours, benchmark: p.benchmark })),
    [series, t0],
  );
  const maxE = rows[rows.length - 1]?.e ?? 0;
  const ticks = useMemo(() => niceTicks(maxE, UNIT_SEC[unit]), [maxE, unit]);

  if (rows.length === 0) {
    return <div className="empty-state">No samples — the run produced an empty series.</div>;
  }

  return (
    <div>
      <div className="legend">
        <span className="key">
          <span className="swatch-line" style={{ borderColor: CHART.series1 }} />
          Autopilot
        </span>
        <span className="key">
          <span className="swatch-line" style={{ borderColor: CHART.deemph }} />
          Passive benchmark
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="e"
            type="number"
            domain={[0, maxE]}
            ticks={ticks}
            tickFormatter={(v: number) => fmtElapsed(v, unit)}
            stroke={CHART.baseline}
            tick={{ fill: CHART.muted, fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => fmtPct(v)}
            stroke="none"
            tick={{ fill: CHART.muted, fontSize: 11 }}
            tickLine={false}
            width={58}
          />
          <Tooltip
            content={<EquityTooltip unit={unit} />}
            cursor={{ stroke: CHART.baseline, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ours"
            name="Autopilot"
            stroke={CHART.series1}
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="benchmark"
            name="Passive benchmark"
            stroke={CHART.deemph}
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Clean unit-aligned ticks: whole days/weeks, at most ~7 of them. */
function niceTicks(maxE: number, unitSec: number): number[] {
  if (maxE <= 0) return [0];
  const units = maxE / unitSec;
  const step = Math.max(1, Math.ceil(units / 6));
  const out: number[] = [];
  for (let u = 0; u * unitSec <= maxE; u += step) out.push(u * unitSec);
  return out;
}

function EquityTooltip(props: TooltipProps<number, string> & { unit: TimeUnit }) {
  const { active, payload, label, unit } = props;
  if (!active || !payload || payload.length === 0) return null;
  const elapsed = typeof label === "number" ? label : Number(label);
  const when =
    unit === "wk" ? `week ${(elapsed / 604_800).toFixed(1)}` : `day ${(elapsed / 86_400).toFixed(1)}`;
  return (
    <div className="viz-tooltip">
      <div className="tt-when">{when}</div>
      {payload.map((entry) => (
        <div className="tt-row" key={String(entry.dataKey)}>
          <span className="tt-key" style={{ borderColor: entry.color }} />
          <span className="tt-value">{fmtPct(entry.value ?? 0)}</span>
          <span className="tt-name">{entry.name}</span>
        </div>
      ))}
    </div>
  );
}

export function EquityTable(props: { series: EquityPoint[]; unit: TimeUnit }) {
  const { series, unit } = props;
  const t0 = series[0]?.t ?? 0;
  // ~24 evenly spaced rows keeps the twin readable; the chart has the rest.
  const step = Math.max(1, Math.floor(series.length / 24));
  const rows = series.filter((_, i) => i % step === 0 || i === series.length - 1);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Elapsed</th>
          <th>Autopilot</th>
          <th>Benchmark</th>
          <th>Excess</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.t}>
            <td>{fmtElapsed(p.t - t0, unit)}</td>
            <td>{fmtPct(p.ours)}</td>
            <td>{fmtPct(p.benchmark)}</td>
            <td>{fmtPct(p.ours - p.benchmark)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
