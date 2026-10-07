// Checkpoints: a pure speed cache over the ledger (04).
// Written every N=500 events and at every EQUIPMENT_STATE_CHANGED or
// ASSIGNMENT_CHANGED. Deleting them changes nothing but speed.
import type { AtlasEvent, Checkpoint, Seconds, World } from './types.js';
import { applyEvent, cloneState, createState, reduceTo } from './reducer.js';
import { computeMetrics } from './views.js';
import { stateHash } from './canon.js';

export const CHECKPOINT_EVERY_N = 500;
const CHECKPOINT_TYPES = new Set(['EQUIPMENT_STATE_CHANGED', 'ASSIGNMENT_CHANGED']);

export function buildCheckpoints(world: World, events: AtlasEvent[]): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  const s = createState(world);
  for (const e of events) {
    applyEvent(s, e);
    if (e.seq % CHECKPOINT_EVERY_N === 0 || CHECKPOINT_TYPES.has(e.type)) {
      const m = computeMetrics(world, s, e.t, events);
      checkpoints.push({
        t: e.t,
        state: cloneState(s),
        ledger_seq: e.seq,
        state_hash: stateHash(s, m),
      });
    }
  }
  return checkpoints;
}

/** Nearest checkpoint with cp.t <= T (latest t, then latest ledger_seq). */
export function nearestCheckpoint(checkpoints: Checkpoint[], t: Seconds): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const cp of checkpoints) {
    if (cp.t > t) continue;
    if (!best || cp.t > best.t || (cp.t === best.t && cp.ledger_seq > best.ledger_seq)) {
      best = cp;
    }
  }
  return best;
}

/** reduceTo resuming from the nearest checkpoint at or before T. */
export function reduceToCheckpointed(world: World, events: AtlasEvent[], checkpoints: Checkpoint[], t: Seconds) {
  const cp = nearestCheckpoint(checkpoints, t);
  return { result: reduceTo(world, events, t, cp ?? undefined), checkpoint: cp };
}
