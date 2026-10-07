// Derived operational views and metrics (03, 06). Views are computed from
// WorldState + World; nothing here mutates state or creates operational truth.
import type {
  AtlasEvent, Capacity, Diagnosis, EvidenceRef, Metrics, Seconds,
  StationStatus, StationView, World, WorldState,
} from './types.js';
import { applyEvent, createState, reduceTo } from './reducer.js';
import { stateHash } from './canon.js';

export const ENGINE_VERSION = 'atlas-impl/0.1.0';

// ── time ────────────────────────────────────────────────────────────────
export function offsetSeconds(world: World): number {
  const off = world.time.origin.slice(-6); // "-07:00"
  const sign = off[0] === '-' ? -1 : 1;
  return sign * (parseInt(off.slice(1, 3), 10) * 3600 + parseInt(off.slice(4, 6), 10) * 60);
}

/** ISO-8601 timestamp with the world's UTC offset (integer-second resolution). */
export function iso(world: World, t: Seconds): string {
  const off = world.time.origin.slice(-6);
  return new Date((t + offsetSeconds(world)) * 1000).toISOString().replace(/\.000Z$/, off);
}

export function stationIds(world: World): string[] {
  return world.entities.filter((e) => e.type === 'station').map((e) => e.id);
}

export function equipmentOf(world: World, stationId: string): string[] {
  return world.relationships
    .filter((r) => r.type === 'attached_to' && r.to === stationId)
    .map((r) => r.from);
}

export function entityName(world: World, id: string): string {
  return world.entities.find((e) => e.id === id)?.name ?? id;
}

// ── capacity & status (R01, R07) ────────────────────────────────────────
/** Employees on shift and assigned to the station, in world entity order. */
export function staffAt(world: World, s: WorldState, stationId: string): string[] {
  void world;
  return Object.entries(s.assignments)
    .filter(([emp, a]) => a === stationId && s.on_shift[emp])
    .map(([emp]) => emp);
}

export function capacity(world: World, s: WorldState, stationId: string): Capacity {
  const attrs = world.entities.find((e) => e.id === stationId)!.attrs!;
  const attached = equipmentOf(world, stationId);
  const eqCap = attached.reduce(
    (sum, eq) => sum + (s.equipment[eq].status === 'DOWN' ? 0 : s.equipment[eq].capacity),
    0,
  );
  const staff = staffAt(world, s, stationId);
  if (attrs.staffing === 'required' && staff.length === 0) {
    return { equipment: eqCap, staff: 0, effective: 0 };
  }
  const staffCap = staff.length * Number(attrs.per_staff_concurrency);
  return {
    equipment: attached.length ? eqCap : staffCap,
    staff: staffCap,
    effective: attached.length ? Math.min(eqCap, staffCap) : staffCap,
  };
}

export function stationStatus(world: World, s: WorldState, stationId: string, t: Seconds): StationStatus {
  const attrs = world.entities.find((e) => e.id === stationId)!.attrs!;
  const st = s.stations[stationId];
  const cap = capacity(world, s, stationId);
  const oldest = st.queue.length ? t - s.work[st.queue[0]].queued_t : 0;
  if (cap.effective === 0 && st.queue.length > 0) return 'UNSTAFFED';
  if (st.queue.length >= Number(attrs.overload_queue) || oldest >= Number(attrs.overload_wait_s)) {
    return 'OVERLOADED';
  }
  if (cap.effective > 0 && st.in_progress.length >= cap.effective) return 'BUSY';
  return 'NORMAL';
}

// ── utilization (06) ────────────────────────────────────────────────────
const CAPACITY_EVENTS = new Set(['EMPLOYEE_CLOCKED_IN', 'ASSIGNMENT_CHANGED', 'EQUIPMENT_STATE_CHANGED']);

/**
 * Busy slot-seconds over (t-900, t] divided by the integral of effective
 * capacity over the same window. The integral replays capacity-affecting
 * events from a fresh state; capacity is piecewise constant between them.
 */
export function utilization(
  world: World, s: WorldState, stationId: string, t: Seconds, log: AtlasEvent[],
): number | null {
  const w0 = t - 900;
  let busy = 0;
  for (const w of Object.values(s.work)) {
    if (w.station_id !== stationId || w.started_t == null) continue;
    const a = Math.max(w.started_t, w0);
    const b = Math.min(w.completed_t ?? t, t);
    if (b > a) busy += b - a;
  }
  const tmp = createState(world);
  let last = w0, integral = 0, capNow = 0;
  for (const e of log) {
    if (e.t > t) break;
    if (CAPACITY_EVENTS.has(e.type)) {
      if (e.t > w0) {
        integral += capNow * (e.t - last);
        last = e.t;
      }
      applyEvent(tmp, e);
      capNow = capacity(world, tmp, stationId).effective;
    }
  }
  integral += capNow * (t - last);
  return integral > 0 ? +(busy / integral).toFixed(3) : null;
}

// ── metrics (06) ────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const k = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[k - 1];
}

export function kitchenTarget(world: World): number {
  const g = world.goals.find((x) => x.id === 'g_kitchen_time');
  if (!g) throw new Error('world is missing goal g_kitchen_time');
  return g.target;
}

export function computeMetrics(world: World, s: WorldState, t: Seconds, log: AtlasEvent[]): Metrics {
  const orders = Object.values(s.orders);
  const done15 = orders.filter((o) => o.completed_t != null && o.completed_t > t - 900 && o.completed_t <= t);
  const kt = done15.map((o) => (o.completed_t as number) - o.created_t).sort((a, b) => a - b);
  const target = kitchenTarget(world);
  const stations: Record<string, StationView> = {};
  for (const st of stationIds(world)) {
    const S = s.stations[st];
    const cap = capacity(world, s, st);
    stations[st] = {
      queue_len: S.queue.length,
      in_progress: S.in_progress.length,
      oldest_wait_s: S.queue.length ? t - s.work[S.queue[0]].queued_t : 0,
      capacity: cap,
      staff: staffAt(world, s, st),
      status: stationStatus(world, s, st, t),
      utilization: utilization(world, s, st, t, log),
    };
  }
  return {
    orders_open: orders.filter((o) => o.state !== 'COMPLETED').length,
    orders_completed: orders.filter((o) => o.state === 'COMPLETED').length,
    throughput_per_hour: orders.filter((o) => o.completed_t != null && o.completed_t > t - 3600 && o.completed_t <= t).length,
    avg_kitchen_time_s: kt.length ? Math.round(kt.reduce((a, b) => a + b, 0) / kt.length) : null,
    p90_kitchen_time_s: percentile(kt, 0.9),
    over_target_share: kt.length ? +(kt.filter((x) => x > target).length / kt.length).toFixed(2) : null,
    revenue_completed: +orders.filter((o) => o.state === 'COMPLETED').reduce((a, o) => a + o.total, 0).toFixed(2),
    stations,
  };
}

// ── diagnosis (03; field computation per frozen fixtures) ───────────────
export function diagnose(world: World, s: WorldState, t: Seconds, m: Metrics, log: AtlasEvent[]): Diagnosis {
  const ids = stationIds(world);
  const over = ids.filter((st) => m.stations[st].status === 'OVERLOADED' || m.stations[st].status === 'UNSTAFFED');
  if (!over.length) {
    return { bottleneck: null, claim_class: 'derived', summary: 'No station is overloaded.' };
  }
  const st = [...over].sort((a, b) => m.stations[b].oldest_wait_s - m.stations[a].oldest_wait_s)[0];
  // When did it start: last transition into OVERLOADED, scanning the ledger.
  const tmp = createState(world);
  let since: Seconds | null = null, prev = 'NORMAL';
  for (const e of log) {
    if (e.t > t) break;
    applyEvent(tmp, e);
    const st2 = stationStatus(world, tmp, st, e.t);
    if (st2 === 'OVERLOADED' && prev !== 'OVERLOADED') since = e.t;
    if (st2 !== 'OVERLOADED') since = null;
    prev = st2;
  }
  const cap = m.stations[st].capacity;
  const binding =
    cap.effective === 0 ? 'staffing'
    : cap.staff < cap.equipment ? 'staffing'
    : cap.staff > cap.equipment ? 'equipment'
    : 'both';
  const affected = s.stations[st].queue
    .map((w) => s.work[w].order_id)
    .filter((v, i, a) => a.indexOf(v) === i);
  const degraded = equipmentOf(world, st).filter((eq) => s.equipment[eq].status !== 'OPERATIONAL');
  const degradedStr = degraded.join(', ');
  return {
    bottleneck: st,
    claim_class: 'derived',
    summary:
      `${entityName(world, st)} is OVERLOADED since ${since !== null ? iso(world, since).slice(11, 19) : '?'}: ` +
      `queue ${m.stations[st].queue_len}, oldest wait ${m.stations[st].oldest_wait_s}s, ` +
      `effective capacity ${cap.effective} bound by ${binding}` +
      (degraded.length ? ` (${degradedStr} ${s.equipment[degraded[0]].status} but not binding).` : '.'),
    since_t: since,
    since: since !== null ? iso(world, since) : null,
    queue_len: m.stations[st].queue_len,
    oldest_wait_s: m.stations[st].oldest_wait_s,
    utilization_15m: m.stations[st].utilization,
    capacity: cap,
    binding_constraint: binding,
    affected_orders: affected,
    degraded_equipment: degraded.map((eq) => ({
      id: eq,
      status: s.equipment[eq].status,
      capacity: s.equipment[eq].capacity,
      nominal_capacity: s.equipment[eq].nominal_capacity,
      binding: cap.equipment <= cap.staff,
    })),
    downstream: ids.filter((x) => x !== st).map((x) => ({
      station: x,
      queue_len: m.stations[x].queue_len,
      status: m.stations[x].status,
    })),
  };
}

// ── evidence refs ───────────────────────────────────────────────────────
/**
 * The station the snapshot's evidence_refs are anchored to: the diagnosed
 * bottleneck, else the station with the longest current queue wait
 * (world order tiebreak). For the frozen V0 fixtures this is st_fry at every
 * canonical T (see DECISIONS.md D9).
 */
export function evidenceStation(world: World, s: WorldState, t: Seconds, m: Metrics, d: Diagnosis): string {
  if (d.bottleneck) return d.bottleneck;
  const ids = stationIds(world);
  return [...ids].sort((a, b) => {
    const wa = m.stations[a].oldest_wait_s, wb = m.stations[b].oldest_wait_s;
    if (wb !== wa) return wb - wa;
    return ids.indexOf(a) - ids.indexOf(b);
  })[0];
}

export function evidenceRefs(
  world: World, s: WorldState, t: Seconds, log: AtlasEvent[], stationId: string,
): EvidenceRef[] {
  const workSet = new Set([...s.stations[stationId].queue, ...s.stations[stationId].in_progress]);
  const staffSet = new Set(staffAt(world, s, stationId));
  const attached = equipmentOf(world, stationId);
  return log
    .filter(
      (e) =>
        e.t <= t && e.provenance && (
          attached.includes(e.subject) ||
          (e.type === 'ASSIGNMENT_CHANGED' && (staffSet.has(e.subject) || (e.data.station_id as string) === stationId)) ||
          ((e.type === 'WORK_QUEUED' || e.type === 'WORK_STARTED') && workSet.has(e.data.work_id as string))
        ),
    )
    .map((e) => ({ event_id: e.event_id, type: e.type, ts: e.ts, ...e.provenance }));
}

// ── snapshot ────────────────────────────────────────────────────────────
export interface SnapshotInput {
  id: string;
  title: string;
  log: AtlasEvent[];
  t: Seconds;
  branch: string;
  mode: 'RECONSTRUCT' | 'LIVE' | 'SIMULATE' | 'COMPOSE';
  claim_class: 'derived' | 'simulated';
  narrative: string;
}

export function buildSnapshot(world: World, input: SnapshotInput): Record<string, unknown> {
  const { state: s, eventsApplied } = reduceTo(world, input.log, input.t);
  const m = computeMetrics(world, s, input.t, input.log);
  const diag = diagnose(world, s, input.t, m, input.log);
  const focus = evidenceStation(world, s, input.t, m, diag);

  const openOrders = Object.entries(s.orders)
    .filter(([, o]) => o.state !== 'COMPLETED')
    .map(([id, o]) => ({
      id,
      state: o.state,
      created: iso(world, o.created_t),
      age_s: input.t - o.created_t,
      items: o.items.map((i) => i.product_id),
      total: o.total,
    }));
  const workOpen = Object.entries(s.work)
    .filter(([, w]) => w.state !== 'DONE')
    .map(([id, w]) => ({
      id,
      order_id: w.order_id,
      station_id: w.station_id,
      step: w.step,
      state: w.state,
      queued: iso(world, w.queued_t),
      started: w.started_t != null ? iso(world, w.started_t) : null,
    }));

  const state = {
    t: input.t,
    ts: iso(world, input.t),
    ledger_events_applied: eventsApplied,
    employees: Object.fromEntries(
      Object.keys(s.assignments).map((emp) => [emp, { on_shift: s.on_shift[emp], station: s.assignments[emp] }]),
    ),
    equipment: s.equipment,
    stations: Object.fromEntries(
      stationIds(world).map((st) => [
        st,
        {
          status: m.stations[st].status,
          staff: m.stations[st].staff,
          capacity: m.stations[st].capacity,
          queue: s.stations[st].queue,
          in_progress: s.stations[st].in_progress,
        },
      ]),
    ),
    orders_open: openOrders,
    work_open: workOpen,
    reports: s.reports.filter((r) => r.t <= input.t).map((r) => ({ ...r, ts: iso(world, r.t) })),
    last_measurements: Object.fromEntries(
      s.measurements
        .filter((x) => x.t <= input.t)
        .map((x) => [`${x.subject}:${x.metric}`, { value: x.value, ts: iso(world, x.t) }]),
    ),
  };

  const snap: Record<string, unknown> = {
    atlas_schema: 'atlas-snapshot/0.1',
    id: input.id,
    title: input.title,
    world: world.metadata.id,
    branch: input.branch,
    mode: input.mode,
    claim_class: input.claim_class,
    t: input.t,
    ts: iso(world, input.t),
    engine: ENGINE_VERSION,
    narrative: input.narrative,
    state,
    metrics: m,
    diagnosis: diag,
    evidence_refs: evidenceRefs(world, s, input.t, input.log, focus),
  };
  snap.state_hash = stateHash(state, m);
  return snap;
}
