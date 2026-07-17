/**
 * Instruments: altimeter-style stat tiles for the backtest metrics. Values
 * wear text tokens; only the excess-return delta wears status color (direction
 * × up-is-good), always paired with a sign so color never carries it alone.
 */
import type { BacktestMetrics } from "@aero-poc/core";
import { fmtPct, fmtSignedPct, fmtTurns } from "../lib/format";

interface Tile {
  label: string;
  value: string;
  sub?: string;
  delta?: "up" | "down";
}

export function MetricsPanel(props: { metrics: BacktestMetrics }) {
  const m = props.metrics;
  const tiles: Tile[] = [
    { label: "Total return", value: fmtPct(m.totalReturn), sub: "revenue ÷ power" },
    { label: "Benchmark", value: fmtPct(m.benchmarkReturn), sub: "passive pro-rata" },
    {
      label: "Excess return",
      value: fmtSignedPct(m.excessReturn),
      sub: "vs benchmark",
      delta: m.excessReturn >= 0 ? "up" : "down",
    },
    { label: "Max drawdown", value: fmtPct(m.maxDrawdownVsBenchmark), sub: "of excess, peak → trough" },
    { label: "Turnover", value: fmtTurns(m.turnover), sub: "power moved" },
    { label: "On target", value: fmtPct(m.onTargetPct), sub: "steps within ε" },
    ...(m.emissionsAccuracy !== null
      ? [{ label: "Emissions accuracy", value: fmtPct(m.emissionsAccuracy), sub: "emitted ÷ scheduled" }]
      : []),
    { label: "Rotations", value: String(m.rotations), sub: "tranche moves" },
  ];

  return (
    <div className="tiles fade-while-running">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="t-label">{t.label}</div>
          <div className={`t-value${t.delta ? ` delta-${t.delta}` : ""}`}>{t.value}</div>
          {t.sub ? <div className="t-sub">{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
