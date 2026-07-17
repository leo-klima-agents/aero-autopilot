/**
 * Backtest client: posts BacktestRequests to the core worker so heavy runs
 * stay off the UI thread. When Worker is unavailable (jsdom tests, ancient
 * embeds) it falls back to executeRequest on the main thread — same module
 * graph either way, so results are identical to what CI tested (plan §8).
 */
import {
  executeRequest,
  type BacktestRequest,
  type BacktestResponse,
  type BacktestResult,
} from "@aero-poc/core";

interface Pending {
  resolve: (r: BacktestResult) => void;
  reject: (e: Error) => void;
}

const pending = new Map<number, Pending>();
// undefined = not tried yet; null = unavailable, use the main-thread fallback.
let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return worker;
  }
  worker.onmessage = (e: MessageEvent<BacktestResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return; // superseded run — drop silently
    pending.delete(e.data.id);
    if (e.data.ok && e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? "backtest failed"));
  };
  worker.onerror = (e) => {
    // A worker-level fault (load/parse) sinks every in-flight run.
    const err = new Error(e.message || "backtest worker error");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

export function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  const w = getWorker();
  if (w) {
    return new Promise((resolve, reject) => {
      pending.set(req.id, { resolve, reject });
      w.postMessage(req);
    });
  }
  // Fallback: yield a tick first so the loading state paints before we block.
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(executeRequest(req));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  });
}
