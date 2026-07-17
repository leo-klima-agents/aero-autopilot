/**
 * Chart container: title, table-view toggle (the WCAG-clean twin of every
 * chart — tooltips enhance, they never gate), and the chart body.
 */
import { useState, type ReactNode } from "react";

export function Figure(props: { title: string; chart: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="figure fade-while-running" style={{ margin: 0 }}>
      <div className="figure-head">
        <h3>{props.title}</h3>
        <button
          type="button"
          className="table-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {showTable ? <div className="table-scroll">{props.table}</div> : props.chart}
    </figure>
  );
}
