/**
 * Aero Autopilot — strategy simulator (plan §8). Fully static: every run
 * executes in the visitor's browser against @aero-poc/core, off-thread in a
 * web worker, reproduced exactly by the URL hash (seed-deterministic core).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BacktestResult, EpochDataset } from "@aero-poc/core";
import { AllocationHeatmap, AllocationTable } from "./components/AllocationHeatmap";
import { EquityChart, EquityTable } from "./components/EquityChart";
import { Figure } from "./components/Figure";
import { FlightPlanPanel } from "./components/FlightPlanPanel";
import { MetricsPanel } from "./components/MetricsPanel";
import { StrategyPanel } from "./components/StrategyPanel";
import { runBacktest } from "./lib/backtest";
import { datasetMeta, loadLiveDataset } from "./lib/liveData";
import {
  buildRequest,
  defaultState,
  readLocationState,
  writeLocationState,
  type SimState,
} from "./lib/state";
import { storyFor } from "./lib/stories";

type RunStatus = "running" | "done" | "error";

interface RunState {
  status: RunStatus;
  result: BacktestResult | null;
  error: string | null;
}

export function App() {
  const [state, setState] = useState<SimState>(() => readLocationState() ?? defaultState());
  const [run, setRun] = useState<RunState>({ status: "running", result: null, error: null });
  const [copied, setCopied] = useState(false);
  // undefined = fetching, null = unavailable (fall back to synthetic).
  const [live, setLive] = useState<EpochDataset | null | undefined>(undefined);
  const runSeq = useRef(0);

  const patch = useCallback((p: Partial<SimState>) => setState((s) => ({ ...s, ...p })), []);

  // The historical dataset ships with the page as plain JSON; one fetch, then
  // the (state, live) effect below re-runs anything that was waiting on it.
  useEffect(() => {
    let cancelled = false;
    void loadLiveDataset().then((d) => {
      if (!cancelled) setLive(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // State is the single source of truth: every change updates the shareable
  // hash and (debounced) auto-runs — including the initial load of a shared link.
  useEffect(() => {
    writeLocationState(state);
    const id = ++runSeq.current;
    setRun((r) => ({ status: "running", result: r.result, error: null }));
    const timer = setTimeout(() => {
      runBacktest(buildRequest(state, id, live)).then(
        (result) => {
          if (runSeq.current === id) setRun({ status: "done", result, error: null });
        },
        (err: unknown) => {
          if (runSeq.current === id) {
            setRun((r) => ({
              status: "error",
              result: r.result, // keep the last good frame under the error
              error: err instanceof Error ? err.message : String(err),
            }));
          }
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [state, live]);

  // Back/forward or a pasted link while the app is open.
  useEffect(() => {
    const onHash = () => {
      const s = readLocationState();
      if (s) setState(s);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const story = storyFor(state.model, state.scenario);
  const unit = state.model === "continuous" ? "d" : "wk";
  // A shared epoch-live link degrades to synthetic until/unless the dataset loads.
  const liveFallback = state.model === "epoch-live" && live === null;
  const running = run.status === "running";
  const lamp = running ? "run" : run.status === "error" ? "fault" : "ok";
  const lampLabel = running ? "computing" : run.status === "error" ? "fault" : "ready";

  return (
    <div className="app">
      <header className="masthead">
        <h1>
          Aero Autopilot <span className="thin">— strategy simulator</span>
        </h1>
        <div className="spacer" />
        <span className={`lamp ${lamp}`}>{lampLabel}</span>
        <button type="button" className="copy-link" onClick={copyLink}>
          {copied ? "Link copied" : "Copy run link"}
        </button>
      </header>

      <div className="layout">
        <aside>
          <FlightPlanPanel
            state={state}
            live={live === undefined ? undefined : live === null ? null : datasetMeta(live)}
            onChange={patch}
          />
          <StrategyPanel strategy={state.strategy} onChange={(strategy) => patch({ strategy })} />
        </aside>

        <main className={`results${running ? " stale" : ""}`}>
          <section className="panel story">
            <h2>{story.title}</h2>
            <p>{story.body}</p>
          </section>

          {liveFallback ? (
            <div className="error-strip" role="alert">
              <strong>Degraded</strong>
              The historical dataset could not be loaded — showing the synthetic v2 epochs instead
              (plan §9.4 degradation).
            </div>
          ) : null}

          {run.error !== null ? (
            <div className="error-strip" role="alert">
              <strong>Fault</strong>
              {run.error}
            </div>
          ) : null}

          {run.result ? (
            <>
              <MetricsPanel metrics={run.result.metrics} />
              <Figure
                title="Flight path — cumulative return"
                chart={<EquityChart series={run.result.series} unit={unit} />}
                table={<EquityTable series={run.result.series} unit={unit} />}
              />
              <Figure
                title="Allocation map — weight by pool over time"
                chart={<AllocationHeatmap allocations={run.result.allocations} unit={unit} />}
                table={<AllocationTable allocations={run.result.allocations} />}
              />
            </>
          ) : running ? (
            <div className="panel empty-state">Running the first backtest in a web worker…</div>
          ) : null}
        </main>
      </div>

      <footer className="foot">
        Fully static — no backend, no external calls. Runs execute @aero-poc/core in your browser;
        the URL hash reproduces any run exactly.
      </footer>
    </div>
  );
}
