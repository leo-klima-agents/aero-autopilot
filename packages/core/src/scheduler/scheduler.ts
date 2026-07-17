/**
 * The tranche/cooldown state machine shared by the simulator, the keeper, and
 * fixture generation: given tranche states and a target, emit the action list.
 *
 * Deterministic core (P2). The planning rule is deliberately simple:
 *   - a tranche rotates iff its cooldown has elapsed AND its current
 *     allocation differs from the target by more than `epsilonWad`
 *     (half L1 distance between weight vectors);
 *   - rotation stamps lastActionAt = now (starting a fresh cooldown).
 */
import { canAct } from "./cooldown.js";
import type { AllocationVector, PoolId, TargetAllocation, TrancheView } from "../types.js";
import { allocationToVector } from "../types.js";

export interface RotateAction {
  kind: "rotate";
  trancheId: number;
}

export interface SchedulerPlan {
  actions: RotateAction[];
  /** Tranche states after applying the plan at `now`. */
  next: TrancheView[];
}

/** Half L1 distance between two allocation vectors, wad. 0 = identical, WAD = disjoint. */
export function allocationDistanceWad(a: AllocationVector, b: AllocationVector): bigint {
  const keys = new Set<PoolId>([...a.keys(), ...b.keys()]);
  let l1 = 0n;
  for (const k of keys) {
    const av = a.get(k) ?? 0n;
    const bv = b.get(k) ?? 0n;
    l1 += av > bv ? av - bv : bv - av;
  }
  return l1 / 2n;
}

export function planRotations(
  tranches: readonly TrancheView[],
  now: bigint,
  cooldownSec: bigint,
  target: TargetAllocation,
  epsilonWad: bigint,
): SchedulerPlan {
  const targetVec = allocationToVector(target);
  const actions: RotateAction[] = [];
  const next: TrancheView[] = [];
  for (const t of tranches) {
    const stale = allocationDistanceWad(t.weights, targetVec) > epsilonWad;
    if (stale && canAct(t.lastActionAt, cooldownSec, now)) {
      actions.push({ kind: "rotate", trancheId: t.id });
      next.push({ ...t, lastActionAt: now, weights: targetVec });
    } else {
      next.push(t);
    }
  }
  return { actions, next };
}
