// Deterministic reducer: WorldState from a normalized event ledger (03, 04).
// applyEvent is pure: same state and event in, same state out. No clock,
// no randomness, no I/O.
import type { AtlasEvent, Checkpoint, Seconds, World, WorldState } from './types.js';
import { stateHash } from './canon.js';

export function createState(world: World): WorldState {
  const s: WorldState = {
    t: 0,
    on_shift: {},
    assignments: {},
    equipment: {},
    stations: {},
    orders: {},
    work: {},
    reports: [],
    measurements: [],
  };
  for (const e of world.entities) {
    if (e.type === 'station') s.stations[e.id] = { queue: [], in_progress: [] };
    else if (e.type === 'equipment') {
      const cap = Number(e.attrs?.capacity ?? 0);
      s.equipment[e.id] = {
        status: (e.attrs?.status as 'OPERATIONAL' | 'DEGRADED' | 'DOWN') ?? 'OPERATIONAL',
        capacity: cap,
        nominal_capacity: cap,
      };
    } else if (e.type === 'person') {
      s.on_shift[e.id] = false;
      s.assignments[e.id] = null;
    }
  }
  // Static world structure contributes the initial assignments (D2).
  for (const emp of world.initial_state.clock_in ?? []) {
    if (emp in s.on_shift) s.on_shift[emp] = true;
  }
  for (const [emp, station] of Object.entries(world.initial_state.assignments)) {
    if (emp in s.assignments) s.assignments[emp] = station;
  }
  for (const [eq, status] of Object.entries(world.initial_state.equipment)) {
    if (eq in s.equipment) s.equipment[eq].status = status as 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
  }
  return s;
}

/** Insert a work id into a station queue ordered by (queued_t, order created_t, work_id) — R02. */
function queueInsert(s: WorldState, stationId: string, workId: string): void {
  const q = s.stations[stationId].queue;
  const key = (w: string): [number, number, string] => [
    s.work[w].queued_t,
    s.orders[s.work[w].order_id].created_t,
    w,
  ];
  q.push(workId);
  q.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 3; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

function removeId(list: string[], id: string): void {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}

/**
 * Apply one event to a state, in place. The reducer accepts events in any order
 * (history can be messy); it never refuses an observed event.
 */
export function applyEvent(s: WorldState, e: AtlasEvent): void {
  s.t = e.t;
  const d = e.data;
  switch (e.type) {
    case 'EMPLOYEE_CLOCKED_IN':
      s.on_shift[d.employee_id as string] = true;
      break;
    case 'ASSIGNMENT_CHANGED':
      s.assignments[d.employee_id as string] = (d.station_id as string | null) ?? null;
      break;
    case 'EQUIPMENT_STATE_CHANGED': {
      const eq = s.equipment[d.equipment_id as string];
      eq.status = d.status as 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
      eq.capacity = Number(d.capacity);
      break;
    }
    case 'MEASUREMENT_RECORDED':
      s.measurements.push({ t: e.t, subject: e.subject, metric: d.metric as string, value: Number(d.value) });
      break;
    case 'HUMAN_REPORT':
      s.reports.push({ t: e.t, about: d.about as string, reporter: d.reporter as string, text: d.text as string });
      break;
    case 'ORDER_CREATED':
      s.orders[d.order_id as string] = {
        state: 'OPEN',
        created_t: e.t,
        ready_t: null,
        completed_t: null,
        channel: d.channel as string,
        items: d.items as { seq: number; product_id: string }[],
        total: Number(d.total),
      };
      break;
    case 'WORK_QUEUED': {
      const workId = d.work_id as string;
      s.work[workId] = {
        order_id: d.order_id as string,
        item_seq: Number(d.item_seq),
        station_id: d.station_id as string,
        step: d.step as string,
        step_index: Number(d.step_index),
        state: 'QUEUED',
        queued_t: e.t,
        started_t: null,
        completed_t: null,
      };
      queueInsert(s, d.station_id as string, workId);
      break;
    }
    case 'WORK_STARTED': {
      const w = s.work[d.work_id as string];
      const st = s.stations[w.station_id];
      removeId(st.queue, d.work_id as string);
      st.in_progress.push(d.work_id as string);
      w.state = 'IN_PROGRESS';
      w.started_t = e.t;
      break;
    }
    case 'WORK_COMPLETED': {
      const w = s.work[d.work_id as string];
      const st = s.stations[w.station_id];
      removeId(st.in_progress, d.work_id as string);
      w.state = 'DONE';
      w.completed_t = e.t;
      break;
    }
    case 'ORDER_READY': {
      const o = s.orders[d.order_id as string];
      o.state = 'READY';
      o.ready_t = e.t;
      break;
    }
    case 'ORDER_COMPLETED': {
      const o = s.orders[d.order_id as string];
      o.state = 'COMPLETED';
      o.completed_t = e.t;
      break;
    }
    default:
      throw new Error(`unknown event type '${e.type}' (ledger is from a newer schema)`);
  }
}

export function cloneState(s: WorldState): WorldState {
  return structuredClone(s);
}

export interface ReduceResult {
  state: WorldState;
  eventsApplied: number;
}

/**
 * reduceTo(world, ledger, T): reconstruct the WorldState at time T (04).
 * Optionally resumes from a checkpoint (checkpoint.t <= T); events with
 * seq <= checkpoint.ledger_seq are skipped via the checkpoint cursor.
 */
export function reduceTo(
  world: World,
  events: AtlasEvent[],
  t: Seconds,
  checkpoint?: Checkpoint,
): ReduceResult {
  const s = checkpoint ? cloneState(checkpoint.state) : createState(world);
  const skipSeq = checkpoint ? checkpoint.ledger_seq : 0;
  let n = checkpoint ? checkpoint.ledger_seq : 0;
  for (const e of events) {
    if (e.t > t) break;
    if (e.seq <= skipSeq) continue;
    applyEvent(s, e);
    n++;
  }
  s.t = t;
  return { state: s, eventsApplied: n };
}

/** Replay-contract hash of a reduced state: sha256(canonicalJson({state, metrics})). */
export function hashState(state: WorldState, metrics: unknown): string {
  return stateHash(state, metrics);
}
