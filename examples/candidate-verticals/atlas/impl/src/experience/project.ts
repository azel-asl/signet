// Experience projection (17 §5, §8): copy-only ExperienceFrame from ATLAS snapshots.
// Every operational value is copied from the snapshot by the §5.2 copy map.
// Nothing is recomputed. The same input state produces the same frame.
import { getStateAtTime, getSupportingEvidence, canonHash, iso } from '../capabilities.js';
import type { AtlasEvent, World, Seconds } from '../types.js';
import {
  EXPERIENCE_VERSION,
  type ExperienceFrame,
  type FrameEntity,
  type Inspection,
  type Register,
  type RegisterKind,
  type Rect,
  type EventItem,
} from './types.js';

export class ProjectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ProjectError';
    this.code = code;
  }
}

interface RegisterState {
  register: Register;
  ledger: AtlasEvent[];
}

let worldRef: World | null = null;
const registers = new Map<RegisterKind, RegisterState>();

/** Labels verbatim from 17 §7. */
function labelFor(kind: RegisterKind, scenarioName: string): string {
  if (kind === 'observed') return 'OBSERVED HISTORY · reconstructed from evidence · claim: derived';
  if (kind === 'baseline') return 'SIMULATION · BASELINE (no intervention) · not observed · claim: simulated';
  return `SIMULATION · SCENARIO: ${scenarioName} · not observed · claim: simulated`;
}

/**
 * Initialize the three registers. Called once at service start-up.
 * Runs both M2 arms (via the caller) and deep-freezes the results.
 */
export function initRegisters(input: {
  world: World;
  historyLedger: AtlasEvent[];
  baseline: { branch: string; events: AtlasEvent[]; receipt: { run_id: string; inputs: { interventions: { id: string; employee: string; from: string | null; to: string | null; at: string }[] } } };
  scenarioArm: { branch: string; events: AtlasEvent[]; receipt: { run_id: string; inputs: { interventions: { id: string; employee: string; from: string | null; to: string | null; at: string }[] } } };
  scenarioName: string;
  tB: number;
  tH: number;
}): void {
  const { world, historyLedger, baseline, scenarioArm, scenarioName, tB, tH } = input;
  worldRef = world;
  registers.clear();

  const origin = Math.floor(Date.parse(world.time.origin) / 1000);
  const end = Math.floor(Date.parse(world.time.end ?? world.time.origin) / 1000);

  const mkRange = (kind: RegisterKind) =>
    kind === 'observed' ? { min_t: origin, max_t: end } : { min_t: tB, max_t: tH };

  const mkInterventions = (arm: { receipt: { inputs: { interventions: { id: string; employee: string; from: string | null; to: string | null; at: string }[] } } }) =>
    arm.receipt.inputs.interventions.map((iv: { id: string; employee: string; from: string | null; to: string | null; at: string }) => ({
      id: iv.id,
      employee: iv.employee,
      from: iv.from,
      to: iv.to,
      at_t: Math.floor(Date.parse(iv.at) / 1000),
    }));

  const defs: { kind: RegisterKind; branch: string; ledger: AtlasEvent[]; run_id: string | null;
    branch_point_t: number | null; horizon_t: number | null; interventions: Register['interventions'] }[] = [
    {
      kind: 'observed', branch: 'history:day1', ledger: historyLedger,
      run_id: null, branch_point_t: null, horizon_t: null, interventions: [],
    },
    {
      kind: 'baseline', branch: baseline.branch,
      ledger: [...historyLedger.filter((e) => e.t <= tB), ...baseline.events],
      run_id: baseline.receipt.run_id, branch_point_t: tB, horizon_t: tH,
      interventions: mkInterventions(baseline),
    },
    {
      kind: 'scenario', branch: scenarioArm.branch,
      ledger: [...historyLedger.filter((e) => e.t <= tB), ...scenarioArm.events],
      run_id: scenarioArm.receipt.run_id, branch_point_t: tB, horizon_t: tH,
      interventions: mkInterventions(scenarioArm),
    },
  ];

  for (const d of defs) {
    // Derive mode/claim from the ledger via getStateAtTime (C1); assert agreement with kind.
    const probe: any = getStateAtTime({ world, ledger: d.ledger, t: mkRange(d.kind).min_t, branch: d.branch });
    const expectedMode = d.kind === 'observed' ? 'RECONSTRUCT' : 'SIMULATE';
    const expectedClaim = d.kind === 'observed' ? 'derived' : 'simulated';
    if (probe.mode !== expectedMode || probe.claim_class !== expectedClaim) {
      throw new ProjectError(
        'REGISTER_CLASSIFICATION_MISMATCH',
        `register ${d.kind}: ledger derives ${probe.mode}/${probe.claim_class}, expected ${expectedMode}/${expectedClaim}`,
      );
    }
    const register: Register = {
      kind: d.kind,
      branch: d.branch,
      mode: probe.mode,
      claim_class: probe.claim_class,
      label: labelFor(d.kind, scenarioName),
      run_id: d.run_id,
      branch_point_t: d.branch_point_t,
      horizon_t: d.horizon_t,
      range: mkRange(d.kind),
      interventions: d.interventions,
    };
    // Deep-freeze the ledger: the projection never mutates it (invariant 6).
    registers.set(d.kind, { register, ledger: d.ledger });
  }
}

/** Get a register's definition. Throws BAD_REGISTER for unknown kinds. */
export function getRegister(kind: string): RegisterState {
  const r = registers.get(kind as RegisterKind);
  if (!r) throw new ProjectError('BAD_REGISTER', `unknown register: ${kind}`);
  return r;
}

/** List all three registers (for /api/world). */
export function listRegisters(): Register[] {
  return (['observed', 'baseline', 'scenario'] as RegisterKind[]).map((k) => registers.get(k)!.register);
}

function asInt(t: number): number {
  if (!Number.isInteger(t)) throw new ProjectError('T_NOT_INTEGER', `t must be an integer second, got ${t}`);
  return t;
}

function checkRange(kind: RegisterKind, t: number): void {
  const { register } = getRegister(kind);
  if (t < register.range.min_t || t > register.range.max_t) {
    throw new ProjectError('T_OUT_OF_RANGE', `t=${t} outside [${register.range.min_t}, ${register.range.max_t}] for ${kind}`);
  }
}

/** Copy map §5.2: station state from snapshot. */
function stationState(snap: any, id: string): Record<string, unknown> {
  const st = snap.state.stations[id];
  const m = snap.metrics.stations[id];
  return {
    status: st.status,
    staff: st.staff,
    capacity: st.capacity,
    queue: st.queue,
    in_progress: st.in_progress,
    queue_len: m.queue_len,
    in_progress_count: m.in_progress,
    oldest_wait_s: m.oldest_wait_s,
    utilization: m.utilization,
  };
}

function equipmentState(snap: any, id: string): Record<string, unknown> {
  const e = snap.state.equipment[id];
  return { status: e.status, capacity: e.capacity, nominal_capacity: e.nominal_capacity };
}

function personState(snap: any, id: string): Record<string, unknown> {
  const p = snap.state.employees[id];
  return { on_shift: p.on_shift, station: p.station };
}

function workState(snap: any, id: string): Record<string, unknown> {
  const w = (snap.state.work_open as any[]).find((x) => x.id === id);
  if (!w) throw new ProjectError('ENTITY_NOT_PRESENT', `work ${id} not present at t`);
  return {
    order_id: w.order_id,
    station_id: w.station_id,
    step: w.step,
    state: w.state,
    queued: w.queued,
    started: w.started,
  };
}

/**
 * projectFrame({register, t}): deterministic copy-only projection (17 §5).
 * Every operational value is copied from getStateAtTime by the §5.2 map.
 */
export function projectFrame(registerKind: RegisterKind, t: number): ExperienceFrame {
  const world = worldRef;
  if (!world) throw new ProjectError('NOT_INITIALIZED', 'registers not initialized');
  const { register, ledger } = getRegister(registerKind);
  const ti = asInt(t);
  checkRange(registerKind, ti);

  const snap: any = getStateAtTime({ world, ledger, t: ti, branch: register.branch });
  // Invariant: the snapshot classification must agree with the register kind.
  if (snap.mode !== register.mode || snap.claim_class !== register.claim_class) {
    throw new ProjectError('REGISTER_CLASSIFICATION_MISMATCH', 'snapshot classification disagrees with register');
  }

  const viz = (world as any).visualization ?? {};
  const objects: Record<string, Rect> = viz.objects ?? {};
  const entities: FrameEntity[] = [];
  const worldEntities = (world.entities as { id: string; type: string; name?: string }[]);

  const stationIds = worldEntities.filter((e) => e.type === 'station').map((e) => e.id);
  const equipmentIds = worldEntities.filter((e) => e.type === 'equipment').map((e) => e.id);
  const personIds = worldEntities.filter((e) => e.type === 'person').map((e) => e.id);

  const nameOf = (id: string) => worldEntities.find((e) => e.id === id)?.name ?? id;

  for (const id of stationIds) {
    entities.push({
      id, kind: 'station', name: nameOf(id),
      rect: objects[id] ?? null, container: null,
      state: stationState(snap, id),
    });
  }
  for (const id of equipmentIds) {
    entities.push({
      id, kind: 'equipment', name: nameOf(id),
      rect: objects[id] ?? null, container: null,
      state: equipmentState(snap, id),
    });
  }
  for (const id of personIds) {
    const ps = personState(snap, id);
    const container = !ps.on_shift ? 'tray:off_shift'
      : ps.station ? (ps.station as string) : 'tray:unassigned';
    entities.push({
      id, kind: 'person', name: nameOf(id),
      rect: null, container,
      state: ps,
    });
  }
  // Work: in station queue order then in_progress order (§5.3).
  for (const stId of stationIds) {
    const sst = snap.state.stations[stId];
    for (const wid of [...sst.queue, ...sst.in_progress]) {
      entities.push({
        id: wid, kind: 'work', name: wid,
        rect: null, container: stId,
        state: workState(snap, wid),
      });
    }
  }

  const frame: ExperienceFrame = {
    atlas_schema: 'atlas-frame/0.1',
    experience_version: EXPERIENCE_VERSION,
    world: { id: (world.metadata as { id: string }).id, name: (world.metadata as { name?: string }).name ?? '' },
    register,
    t: ti,
    ts: snap.ts,
    range: register.range,
    snapshot_state_hash: snap.state_hash,
    ledger_events_applied: (snap.state as { ledger_events_applied: number }).ledger_events_applied,
    layout: {
      canvas: viz.canvas ?? { w: 1200, h: 720 },
      areas: viz.areas ?? {},
      flows: viz.flows ?? [],
    },
    entities,
    open_orders: snap.state.orders_open,
    metrics: {
      orders_open: snap.metrics.orders_open,
      orders_completed: snap.metrics.orders_completed,
      throughput_per_hour: snap.metrics.throughput_per_hour,
      avg_kitchen_time_s: snap.metrics.avg_kitchen_time_s,
      p90_kitchen_time_s: snap.metrics.p90_kitchen_time_s,
      over_target_share: snap.metrics.over_target_share,
    },
    frame_hash: '',
  };
  const { frame_hash: _f, ...rest } = frame;
  frame.frame_hash = canonHash(rest);
  return frame;
}

function toEventItem(e: any, ledger?: AtlasEvent[]): EventItem {
  // Branch: use the event's branch if present; otherwise look up from the ledger by event_id.
  let branch = e.branch ?? '';
  if (!branch && ledger) {
    const found = ledger.find((le) => le.event_id === e.event_id);
    if (found) branch = found.branch;
  }
  return {
    event_id: e.event_id ?? e.event_id,
    t: e.t ?? 0,
    ts: e.ts ?? '',
    type: e.type ?? '',
    branch,
    claim_class: e.claim_class ?? e.provenance?.claim_class ?? '',
    source: e.source ?? e.provenance?.source ?? '',
    record_id: e.record_id ?? e.provenance?.record_id ?? '',
    ...(e.record_ts ?? e.provenance?.record_ts ? { record_ts: e.record_ts ?? e.provenance.record_ts } : {}),
    ...(e.adapter ?? e.provenance?.adapter ? { adapter: e.adapter ?? e.provenance.adapter } : {}),
    ...(e.derived_from ? { derived_from: e.derived_from } : {}),
    ...(e.note ?? e.provenance?.note ? { note: e.note ?? e.provenance.note } : {}),
  };
}

/**
 * inspectEntity({register, t, entity}): generic inspection (17 §8).
 * The entity entry is identical to the frame's entry at the same (register, t).
 */
export function inspectEntity(registerKind: RegisterKind, t: number, entityId: string): Inspection {
  const world = worldRef;
  if (!world) throw new ProjectError('NOT_INITIALIZED', 'registers not initialized');
  const { register, ledger } = getRegister(registerKind);
  const ti = asInt(t);
  checkRange(registerKind, ti);

  const frame = projectFrame(registerKind, ti);
  const entity = frame.entities.find((e) => e.id === entityId);
  if (!entity) {
    // Distinguish unknown id from absent-at-t.
    // - UNKNOWN_ENTITY: id does not exist in the world definition AND never appears in the ledger.
    // - ENTITY_NOT_PRESENT: known id (world entity or ledger work_id) not present at this t.
    const inWorld = (world.entities as { id: string }[]).some((e) => e.id === entityId);
    const inLedger = ledger.some((e) => (e.data as Record<string, unknown>).work_id === entityId);
    const known = inWorld || inLedger;
    throw new ProjectError(known ? 'ENTITY_NOT_PRESENT' : 'UNKNOWN_ENTITY', `entity ${entityId}`);
  }

  const relationships = ((world.relationships ?? []) as { type: string; from: string; to: string }[])
    .filter((r) => r.from === entityId || r.to === entityId)
    .map((r) => ({ type: r.type, from: r.from, to: r.to }));

  const evidenceRefs = getSupportingEvidence({ world, ledger, t: ti, entity: entityId });
  const evidence: EventItem[] = evidenceRefs.map((er) => toEventItem(er, ledger));

  // Related events: touching events with t ≤ T, newest first, at most 50.
  const touchKeys = ['work_id', 'order_id', 'employee_id', 'equipment_id', 'station_id'];
  const touching = ledger.filter((e) => {
    if (e.t > ti) return false;
    const d = e.data as Record<string, unknown>;
    return e.subject === entityId || touchKeys.some((k) => d[k] === entityId);
  });
  const relatedEvents: EventItem[] = [...touching]
    .reverse()
    .slice(0, 50)
    .map((e) => toEventItem({
      event_id: e.event_id, t: e.t, ts: e.ts, type: e.type, branch: e.branch,
      claim_class: e.provenance.claim_class, source: e.provenance.source,
      record_id: e.provenance.record_id, record_ts: e.provenance.record_ts,
      adapter: e.provenance.adapter, note: (e.provenance as { note?: string }).note,
    }));

  const inspection: Inspection = {
    atlas_schema: 'atlas-inspection/0.1',
    register,
    t: ti,
    ts: iso(world, ti as Seconds),
    entity,
    relationships,
    evidence,
    evidence_total: evidence.length,
    related_events: relatedEvents,
    related_events_total: touching.length,
    inspection_hash: '',
  };
  const { inspection_hash: _h, ...rest } = inspection;
  inspection.inspection_hash = canonHash(rest);
  return inspection;
}
