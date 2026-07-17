/**
 * Strategy registry: construct any strategy from its serializable config.
 * The registry drives both the web UI (schema-driven forms) and the keeper
 * (config file → strategy → strategyRef).
 */
import type { Strategy, StrategyConfig } from "../types.js";
import { fixedGridDescriptor, FixedGrid, type FixedGridConfig } from "./fixedGrid.js";
import { persistenceCarryDescriptor, PersistenceCarry, type PersistenceCarryConfig } from "./persistenceCarry.js";
import { waterFillingDescriptor, WaterFilling, type WaterFillingConfig } from "./waterFillingStrategy.js";
import { continuousGreedyDescriptor, ContinuousGreedy, type ContinuousGreedyConfig } from "./continuousGreedy.js";
import type { StrategyDescriptor } from "./base.js";

const WEEK = 7 * 86_400;

/** The suite of plan §6, simple → complex. */
export const STRATEGY_DESCRIPTORS: StrategyDescriptor[] = [
  fixedGridDescriptor(WEEK),
  fixedGridDescriptor(48 * 3600),
  fixedGridDescriptor(24 * 3600),
  fixedGridDescriptor(3600),
  persistenceCarryDescriptor(),
  waterFillingDescriptor(),
  continuousGreedyDescriptor(),
];

export function createStrategy(config: StrategyConfig): Strategy {
  switch (config.kind) {
    case "fixed-grid":
      return new FixedGrid(config as FixedGridConfig);
    case "persistence-carry":
      return new PersistenceCarry(config as PersistenceCarryConfig);
    case "water-filling":
      return new WaterFilling(config as WaterFillingConfig);
    case "continuous-greedy":
      return new ContinuousGreedy(config as ContinuousGreedyConfig);
    default:
      throw new Error(`unknown strategy kind: ${config.kind}`);
  }
}

export * from "./base.js";
export * from "./waterfill.js";
export { FixedGrid, type FixedGridConfig } from "./fixedGrid.js";
export { PersistenceCarry, type PersistenceCarryConfig } from "./persistenceCarry.js";
export { WaterFilling, type WaterFillingConfig } from "./waterFillingStrategy.js";
export { ContinuousGreedy, type ContinuousGreedyConfig } from "./continuousGreedy.js";
