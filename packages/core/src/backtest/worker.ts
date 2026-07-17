/**
 * Web-worker entry: heavy backtest runs execute off the UI thread (plan §8).
 * The worker receives plain-JSON requests (bigints as strings) and returns
 * plotting-ready results — byte-identical logic to what CI tests, because it
 * IS the same module graph.
 */
import { ContinuousModel } from "../model/continuous.js";
import { EpochModel } from "../model/epoch.js";
import type { ContinuousScenarioConfig, EpochDataset } from "../model/types.js";
import { createStrategy } from "../strategies/index.js";
import type { StrategyConfig } from "../types.js";
import { runBacktest, type BacktestResult } from "./runner.js";

export interface BacktestRequest {
  id: number;
  model:
    | { kind: "continuous"; scenario: ContinuousScenarioConfig }
    | { kind: "epoch"; dataset: EpochDataset };
  strategy: StrategyConfig;
  trancheCount: number;
  totalPowerWad: string;
  cooldownSec: string;
  epsilonWad: string;
  cadenceSec: string;
}

export interface BacktestResponse {
  id: number;
  ok: boolean;
  result?: BacktestResult;
  error?: string;
}

export function executeRequest(req: BacktestRequest): BacktestResult {
  const model =
    req.model.kind === "continuous"
      ? new ContinuousModel(req.model.scenario)
      : new EpochModel(req.model.dataset);
  return runBacktest({
    model,
    strategy: createStrategy(req.strategy),
    trancheCount: req.trancheCount,
    totalPowerWad: BigInt(req.totalPowerWad),
    cooldownSec: BigInt(req.cooldownSec),
    epsilonWad: BigInt(req.epsilonWad),
    cadenceSec: BigInt(req.cadenceSec),
  });
}

// Only wire the message handler when actually running inside a worker.
declare const self: { onmessage: ((e: { data: BacktestRequest }) => void) | null; postMessage(msg: unknown): void } | undefined;
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  self!.onmessage = (e) => {
    const req = e.data;
    try {
      const result = executeRequest(req);
      self!.postMessage({ id: req.id, ok: true, result } satisfies BacktestResponse);
    } catch (err) {
      self!.postMessage({ id: req.id, ok: false, error: String(err) } satisfies BacktestResponse);
    }
  };
}
