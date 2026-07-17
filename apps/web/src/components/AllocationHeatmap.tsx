/**
 * Allocation map: pools × time, one hue (blue), weight = lightness — anchor
 * flipped for the dark surface so zero recedes and conviction glows. Time is
 * bucketed to ≤120 columns so the grid stays a grid at any run length; each
 * cell carries a hover tooltip (mark = hit target) and the table view is the
 * accessible twin.
 */
import { useMemo, useRef, useState } from "react";
import type { AllocationSample } from "@aero-poc/core";
import { fmtElapsed, fmtPct, shortPool } from "../lib/format";
import { CHART, HEAT_RAMP, heatColor } from "../lib/palette";
import type { TimeUnit } from "./EquityChart";

const MAX_COLS = 120;
const MAX_ROWS = 14; // beyond this, fold the tail into "other" — never more hues/rows
const ROW_PX = 18;

interface Grid {
  pools: string[]; // row order: total weight desc, "other" last
  cols: number;
  cells: number[][]; // [row][col] mean weight
  colT: number[]; // representative t per column (bucket start)
  t0: number;
  t1: number;
  max: number;
}

function buildGrid(allocations: AllocationSample[]): Grid | null {
  if (allocations.length === 0) return null;
  const totals = new Map<string, number>();
  for (const a of allocations) {
    for (const [pool, w] of Object.entries(a.weights)) {
      if (w > 0) totals.set(pool, (totals.get(pool) ?? 0) + w);
    }
  }
  if (totals.size === 0) return null;
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const kept = ranked.slice(0, MAX_ROWS);
  const folded = new Set(ranked.slice(MAX_ROWS));
  const pools = folded.size > 0 ? [...kept, "other"] : kept;
  const rowIndex = new Map(pools.map((p, i) => [p, i]));

  const n = allocations.length;
  const cols = Math.min(n, MAX_COLS);
  const cells = pools.map(() => new Array<number>(cols).fill(0));
  const colT = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    const lo = Math.floor((c * n) / cols);
    const hi = Math.max(lo + 1, Math.floor(((c + 1) * n) / cols));
    colT[c] = allocations[lo]!.t;
    for (let s = lo; s < hi; s++) {
      for (const [pool, w] of Object.entries(allocations[s]!.weights)) {
        const r = rowIndex.get(folded.has(pool) ? "other" : pool);
        if (r !== undefined) cells[r]![c] = (cells[r]![c] ?? 0) + w / (hi - lo);
      }
    }
  }
  let max = 0;
  for (const row of cells) for (const w of row) if (w > max) max = w;
  return {
    pools,
    cols,
    cells,
    colT,
    t0: allocations[0]!.t,
    t1: allocations[n - 1]!.t,
    max: max || 1,
  };
}

export function AllocationHeatmap(props: { allocations: AllocationSample[]; unit: TimeUnit }) {
  const { allocations, unit } = props;
  const grid = useMemo(() => buildGrid(allocations), [allocations]);
  const [hover, setHover] = useState<{ row: number; col: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!grid) {
    return <div className="empty-state">No allocations — the strategy proposed an empty target.</div>;
  }

  const rows = grid.pools.length;
  const height = rows * ROW_PX;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * grid.cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * rows)));
    setHover({ row, col, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hovered = hover ? { pool: grid.pools[hover.row]!, w: grid.cells[hover.row]![hover.col] ?? 0, t: grid.colT[hover.col]! } : null;

  return (
    <div>
      <div className="heatmap">
        <div className="hm-labels" style={{ height }}>
          {grid.pools.map((p) => (
            <span className="hm-label" key={p} title={p}>
              {p === "other" ? "other" : shortPool(p)}
            </span>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <svg
            ref={svgRef}
            className="hm-grid"
            viewBox={`0 0 ${grid.cols} ${rows}`}
            preserveAspectRatio="none"
            style={{ height }}
            role="img"
            aria-label="Allocation weight per pool over time"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {grid.cells.map((row, r) =>
              row.map((w, c) =>
                w > 0 ? (
                  <rect
                    key={`${r}-${c}`}
                    x={c + 0.04}
                    y={r + 0.06}
                    width={0.92}
                    height={0.88}
                    fill={heatColor(w / grid.max)}
                  />
                ) : null,
              ),
            )}
            {hover ? (
              // hover lift: a surface-white outline that never scales away
              <rect
                x={hover.col + 0.04}
                y={hover.row + 0.06}
                width={0.92}
                height={0.88}
                fill="none"
                stroke="#ffffff"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {hover && hovered ? (
            <div
              className="viz-tooltip hm-tooltip"
              style={{
                left: Math.min(hover.x + 14, Math.max(0, (svgRef.current?.getBoundingClientRect().width ?? 200) - 150)),
                top: Math.max(0, hover.y - 8),
              }}
            >
              <div className="tt-when">{fmtElapsed(hovered.t - grid.t0, unit)}</div>
              <div className="tt-row">
                <span className="tt-key" style={{ borderColor: heatColor(hovered.w / grid.max) }} />
                <span className="tt-value">{fmtPct(hovered.w)}</span>
                <span className="tt-name">{hovered.pool === "other" ? "other" : shortPool(hovered.pool)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="hm-axis">
          <span>{fmtElapsed(0, unit)}</span>
          <span>{fmtElapsed((grid.t1 - grid.t0) / 2, unit)}</span>
          <span>{fmtElapsed(grid.t1 - grid.t0, unit)}</span>
        </div>
        <div className="hm-scale">
          <span>0%</span>
          <span
            className="ramp"
            style={{ background: `linear-gradient(90deg, ${CHART.surface}, ${HEAT_RAMP.join(", ")})` }}
          />
          <span>{fmtPct(grid.max)} of power</span>
        </div>
      </div>
    </div>
  );
}

export function AllocationTable(props: { allocations: AllocationSample[] }) {
  const grid = useMemo(() => buildGrid(props.allocations), [props.allocations]);
  if (!grid) return <div className="empty-state">No allocations.</div>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Pool</th>
          <th>Mean weight</th>
          <th>Peak weight</th>
          <th>Final weight</th>
        </tr>
      </thead>
      <tbody>
        {grid.pools.map((p, r) => {
          const row = grid.cells[r]!;
          const mean = row.reduce((a, b) => a + b, 0) / (row.length || 1);
          const peak = row.reduce((a, b) => Math.max(a, b), 0);
          const final = row[row.length - 1] ?? 0;
          return (
            <tr key={p}>
              <td>{p}</td>
              <td>{fmtPct(mean)}</td>
              <td>{fmtPct(peak)}</td>
              <td>{fmtPct(final)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
