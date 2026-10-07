// Checkpoints: a pure speed cache over the ledger (04, 16 §B1).
// Written every N=500 events (by ordered position) and at every
// EQUIPMENT_STATE_CHANGED or ASSIGNMENT_CHANGED. The cursor is positional:
// ledger_pos counts events in the ordered array the checkpoint was built from.
// Deleting checkpoints changes nothing but speed.
import type { AtlasEvent, Checkpoint, Seconds, World } from './types.js';
import { applyEvent, cloneState, createState, reduceTo } from './reducer.js';
import { computeMetrics } from './views.js';
import { stateHash } from './canon.js';

export const CHECKPOINT_EVERY_N = 500;
const CHECKPOINT_TYPES = new Set(['EQUIPMENT_STATE_CHANGED', 'ASSIGNMENT_CHANGED']);

export function buildCheckpoints(world: World, events: AtlasEvent[]): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  const s = createState(world);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    applyEvent(s, e);
    const ledger_pos = i + 1;
    if (ledger_pos % CHECKPOINT_EVERY_N === 0 || CHECKPOINT_TYPES.has(e.type)) {
      const m = computeMetrics(world, s, e.t, events);
      checkpoints.push({
        t: e.t,
        ledger_pos,
        last_event_id: e.event_id,
        state: cloneState(s),
        state_hash: stateHash(s, m),
      });
    }
  }
  return checkpoints;
}

/**
 * Nearest checkpoint: greatest ledger_pos among checkpoints with t <= T (16 §B1).
 */
export function nearestCheckpoint(checkpoints: Checkpoint[], t: Seconds): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const cp of checkpoints) {
    if (cp.t > t) continue;
    if (!best || cp.ledger_pos > best.ledger_pos) {
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
