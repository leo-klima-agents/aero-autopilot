/**
 * Per-preset "what to look for" briefs (plan §8). Copy only — the mechanics
 * they describe live in @aero-poc/core scenarios and strategies.
 */
import type { ScenarioName } from "@aero-poc/core";
import type { ModelKind } from "./state";

export interface Story {
  title: string;
  body: string;
}

export const SCENARIO_STORIES: Record<ScenarioName, Story> = {
  "early-allocator": {
    title: "Early-allocator arc",
    body:
      "A quiet pool's organic revenue ramps sharply while the herd reacts a day late. " +
      "Watch the blue line pull away from the benchmark during the ramp — early weight earns an outsized share — " +
      "then flatten as the lagged crowd arrives and dilutes the edge. Stretch the herd-lag dial to widen the window; " +
      "shrink it to watch the edge close.",
  },
  "latency-race": {
    title: "Latency-race futility",
    body:
      "Bursts here are shorter than the herd's lag, so speed looks like alpha. Set cooldown to 1 block and pick " +
      "ContinuousGreedy: excess return converges toward zero — at block cadence a reactive chaser earns the system " +
      "average minus latency costs. The race has no finish line; cooldowns are the point, not the obstacle.",
  },
  "wash-bait": {
    title: "The wash-bait trap",
    body:
      "pool-bait advertises enormous revenue that allocators never realize, then collapses at day 10. A naive " +
      "trailing-revenue chaser (FixedGrid) rotates in and sits trapped through its cooldown earning nothing. " +
      "PersistenceCarry's volatility haircut smells the spiky wash prints and refuses the bait — compare the two.",
  },
  "mixed-market": {
    title: "Mixed market",
    body:
      "A generic market — two blue-chips, a regime-switcher, a burster, and a volatile tail — for free-form " +
      "exploration. Good for feeling out how tranche count, cooldown, and the (s,S) move band trade turnover " +
      "against tracking.",
  },
};

export const EPOCH_STORY: Story = {
  title: "Aerodrome v2 — weekly epochs",
  body:
    "26 synthetic weekly epochs shaped like the live protocol: heavy-tailed pool sizes, votes chasing last week's " +
    "revenue. One vote per epoch is the whole game here — weekly FixedGrid is the only strategy that can run live " +
    "today, so this is the baseline every v3 result should be read against.",
};

export function storyFor(model: ModelKind, scenario: ScenarioName): Story {
  return model === "epoch" ? EPOCH_STORY : SCENARIO_STORIES[scenario];
}
