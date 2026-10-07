// Branch identity and branch-log construction (16 §D3, §E3).
import { iso } from './views.js';
import type { AtlasEvent, BranchId, Seconds, World } from './types.js';

export type Arm = 'baseline' | 'scenario';

export interface BranchPoint {
  parent_branch: BranchId;
  t: Seconds;
  ts: string;
  events_applied: number; // parent events with t <= tB (544 for the frozen scenario)
  base_state_hash: string; // snapshot stateHash({state, metrics}) at tB on the parent == s3.state_hash
}

export function branchId(arm: Arm): `sim:${Arm}` {
  return `sim:${arm}`;
}

/**
 * Build the branch point identity. base_state_hash is the snapshot
 * state_hash at tB (computed by the caller via buildSnapshot on the parent).
 */
export function buildBranchPoint(
  world: World,
  parentEvents: AtlasEvent[], // in reduction order
  parentBranch: BranchId,
  tB: Seconds,
  base_state_hash: string,
): BranchPoint {
  return {
    parent_branch: parentBranch,
    t: tB,
    ts: iso(world, tB),
    events_applied: parentEvents.filter((e) => e.t <= tB).length,
    base_state_hash,
  };
}

/**
 * Branch log (E3): parent events in reduction order with t <= tB,
 * followed by branch events in reduction order. The branch point is a
 * barrier: parent events precede branch events even at equal t.
 */
export function buildBranchLog(parentEvents: AtlasEvent[], tB: Seconds, branchEvents: AtlasEvent[]): AtlasEvent[] {
  return [...parentEvents.filter((e) => e.t <= tB), ...branchEvents];
}
