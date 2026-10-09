// ATLAS M4 DIAGNOSE: station-flow/0.1 rule pack per 18 §C.2, §F, §G.
// CRITICAL: No entity IDs, no restaurant words. Pure functions keyed on
// world RULE KINDS (station_capacity, assembly_barrier, station_status).
// Methodology mirrors reference/m4/derive-expectations.mjs (frozen).
import type { AtlasEvent, World } from '../../types.js';
import type { Claim, Ref, UnknownReason } from '../types.js';

export const PACK_ID = 'station-flow';
export const PACK_VERSION = '0.1';
export const REQUIRES_RULE_KINDS = ['station_capacity', 'assembly_barrier', 'station_status'];

const WINDOW_S = 900; // 15 minutes

/** Snapshot station metrics shape (from getStateAtTime). */
interface StationMetrics {
  status: string;
  queue_len: number;
  in_progress: number;
  in_progress_count?: number;
  staff: string[];
  capacity: { equipment: number | null; staff: number; effective: number };
  oldest_wait_s?: number;
}

/** World entity attributes for stations. */
interface StationAttrs {
  per_staff_concurrency: number;
  staffing: string;
  overload_queue?: number;
  overload_wait_s?: number;
}

/**
 * R01: station capacity from the world's modeled semantics.
 * @param attrs Station attributes (per_staff_concurrency, staffing).
 * @param staffCount Number of staff assigned.
 * @param eqCaps Sum of attached equipment capacities, or null if no equipment.
 */
function r01(
  attrs: StationAttrs,
  staffCount: number,
  eqCaps: number | null,
): { has_equipment: boolean; equipment: number | null; staff: number; effective: number } {
  const staffCap = staffCount * attrs.per_staff_concurrency;
  if (attrs.staffing === 'required' && staffCount === 0) {
    return { has_equipment: eqCaps !== null, equipment: eqCaps, staff: 0, effective: 0 };
  }
  if (eqCaps === null) {
    return { has_equipment: false, equipment: null, staff: staffCap, effective: staffCap };
  }
  return { has_equipment: true, equipment: eqCaps, staff: staffCap, effective: Math.min(eqCaps, staffCap) };
}

/**
 * Get attached equipment IDs for a station via 'attached_to' relationships.
 */
function attachedEquipment(world: World, stationId: string): string[] {
  return (world.relationships as { type: string; from: string; to: string }[])
    .filter((r) => r.type === 'attached_to' && r.to === stationId)
    .map((r) => r.from);
}

/**
 * Get station IDs in world order.
 */
function stationIds(world: World): string[] {
  return (world.entities as { id: string; type: string }[])
    .filter((e) => e.type === 'station')
    .map((e) => e.id);
}

/**
 * Get nominal step duration from world.processes.
 */
function nominalDuration(world: World, stationId: string, stepId: string): number {
  for (const proc of (world as { processes: { steps: { id: string; station: string; duration_s: number }[] }[] }).processes) {
    for (const step of proc.steps) {
      if (step.station === stationId && step.id === stepId) {
        return step.duration_s;
      }
    }
  }
  throw new Error(`no nominal duration for ${stationId}/${stepId}`);
}

/**
 * Capacity integral: ∫ effective(τ) dτ over (t-900, t].
 * Replays only capacity-relevant events (clock-in, assignment, equipment).
 */
function capacityIntegral(
  world: World,
  ledger: AtlasEvent[],
  stationId: string,
  t: number,
): number {
  const entities = world.entities as { id: string; type: string; attrs: { status?: string; capacity?: number } }[];
  const entById = new Map(entities.map((e) => [e.id, e]));
  const station = entById.get(stationId)!;
  const attrs = station.attrs as unknown as StationAttrs;
  const attached = attachedEquipment(world, stationId);

  const on = new Map<string, boolean>();
  const asg = new Map<string, string>();
  const eq = new Map<string, { status: string; capacity: number }>();
  for (const e of entities.filter((x) => x.type === 'equipment')) {
    eq.set(e.id, { status: e.attrs.status ?? 'OPERATIONAL', capacity: e.attrs.capacity ?? 0 });
  }

  const effective = (): number => {
    let staff = 0;
    for (const [emp, st] of asg) {
      if (st === stationId && on.get(emp)) staff++;
    }
    const eqCaps = attached.length === 0 ? null :
      attached.reduce((sum, id) => {
        const e = eq.get(id)!;
        return sum + (e.status === 'DOWN' ? 0 : e.capacity);
      }, 0);
    return r01(attrs, staff, eqCaps).effective;
  };

  let last = t - WINDOW_S;
  let integral = 0;
  let cap = 0; // Start at 0; will be set by replaying from start.

  // First, replay all events up to t-W to get the starting capacity.
  for (const e of ledger) {
    if (e.t > t - WINDOW_S) break;
    if (e.type === 'EMPLOYEE_CLOCKED_IN') on.set(e.data.employee_id as string, true);
    else if (e.type === 'ASSIGNMENT_CHANGED') asg.set(e.data.employee_id as string, e.data.station_id as string);
    else if (e.type === 'EQUIPMENT_STATE_CHANGED') {
      eq.set(e.data.equipment_id as string, { status: e.data.status as string, capacity: e.data.capacity as number });
    }
  }
  cap = effective();

  // Then integrate over the window.
  for (const e of ledger) {
    if (e.t <= t - WINDOW_S) continue;
    if (e.t > t) break;
    if (!['EMPLOYEE_CLOCKED_IN', 'ASSIGNMENT_CHANGED', 'EQUIPMENT_STATE_CHANGED'].includes(e.type)) continue;
    integral += cap * (e.t - last);
    last = e.t;
    if (e.type === 'EMPLOYEE_CLOCKED_IN') on.set(e.data.employee_id as string, true);
    else if (e.type === 'ASSIGNMENT_CHANGED') asg.set(e.data.employee_id as string, e.data.station_id as string);
    else if (e.type === 'EQUIPMENT_STATE_CHANGED') {
      eq.set(e.data.equipment_id as string, { status: e.data.status as string, capacity: e.data.capacity as number });
    }
    cap = effective();
  }
  return integral + cap * (t - last);
}

/**
 * Queue length at time t (from WORK_QUEUED/WORK_STARTED events).
 */
function queueLenAt(ledger: AtlasEvent[], stationId: string, t: number): number {
  const queued = new Set<string>();
  for (const e of ledger) {
    if (e.t > t) break;
    if (e.type === 'WORK_QUEUED' && e.data.station_id === stationId) {
      queued.add(e.data.work_id as string);
    } else if (e.type === 'WORK_STARTED') {
      queued.delete(e.data.work_id as string);
    }
  }
  return queued.size;
}

/** Pack context: everything the pack needs, no domain words. */
export interface PackContext {
  world: World;
  ledger: AtlasEvent[];
  snapshot: Record<string, unknown>;
  t: number;
  branch: string;
  claim_class: 'derived' | 'simulated';
}

/**
 * Run the station-flow pack for one station.
 * Returns claims for that station.
 */
export function diagnoseStation(ctx: PackContext, stationId: string): Claim[] {
  const { world, ledger, snapshot, t, claim_class } = ctx;
  const claims: Claim[] = [];

  const snap = snapshot as {
    metrics: { stations: Record<string, StationMetrics> };
    state: { equipment: Record<string, { status: string; capacity: number; nominal_capacity: number }> };
    ts: string;
  };

  const m = snap.metrics.stations[stationId];
  if (!m) return claims;

  const entities = world.entities as { id: string; type: string; attrs: Record<string, unknown>; name?: string }[];
  const entById = new Map(entities.map((e) => [e.id, e]));
  const station = entById.get(stationId)!;
  const attrs = station.attrs as unknown as StationAttrs;
  const subjectName = (station as { name?: string }).name ?? stationId;

  const attached = attachedEquipment(world, stationId);
  const hasEquipment = attached.length > 0;

  // R01 facts.
  const staffN = m.staff.length;
  const eqCap = hasEquipment ? m.capacity.equipment : null;
  const base = r01(attrs, staffN, eqCap);
  const atCapacity = base.effective > 0 && m.in_progress >= base.effective;
  const backlogged = m.queue_len > 0;

  // Marginal deltas (F §F.3).
  const dStaff = r01(attrs, staffN + 1, eqCap).effective - base.effective;
  const dEquip = eqCap === null ? null : r01(attrs, staffN, (eqCap ?? 0) + 1).effective - base.effective;

  // Binding constraint class (F §F.1-3).
  let limitClass: string | null = null;
  let unknownReason: UnknownReason | null = null;
  if (base.effective === 0) {
    if (backlogged) {
      limitClass = (staffN === 0 && (eqCap === null || (eqCap ?? 0) > 0)) ? 'STAFF'
        : (eqCap === 0 && staffN > 0) ? 'EQUIPMENT' : 'CO_BINDING';
    } else {
      limitClass = 'DEMAND';
    }
  } else if (!atCapacity) {
    if (backlogged) {
      unknownReason = 'MODEL_UNEXPLAINED_IDLE';
    } else {
      limitClass = 'DEMAND';
    }
  } else {
    limitClass = (dStaff > 0 && !(dEquip !== null && dEquip > 0)) ? 'STAFF'
      : (dEquip !== null && dEquip > 0 && !(dStaff > 0)) ? 'EQUIPMENT' : 'CO_BINDING';
  }

  const claimClass = claim_class;
  const ruleRef = (id: string) => ({ id, version: PACK_VERSION, world_rules: [id] });

  // Helper to build a claim.
  // CCR-005 C1: unknown claims use c:unknown_<reason>:<subject> for uniqueness.
  const mkClaim = (
    kind: Claim['kind'], role: Claim['role'], template: string,
    values: Claim['values'], basis: Claim['basis'],
    ruleIds: string[], evidence: Ref[], assumptions: string[] = [],
    unknownReason?: UnknownReason,
  ): Claim => {
    let id: string;
    if (kind === 'unknown' && unknownReason) {
      const reasonSlug = unknownReason.toLowerCase();
      id = `c:unknown_${reasonSlug}:${stationId}`;
    } else {
      id = `c:${kind}:${stationId}`;
    }
    return {
      id,
      kind, role, subject: stationId, template, values, basis,
      rule: { id: `${PACK_ID}/${kind}`, version: PACK_VERSION, world_rules: ruleIds },
      claim_class: claimClass,
      support: 'deterministic',
      confidence: null,
      assumptions,
      evidence,
      links: [],
    };
  };

  // --- overload (R07) ---
  const isOverloaded = m.status === 'OVERLOADED' || m.status === 'UNSTAFFED';
  // Check for conflicting facts (J): OVERLOADED with queue 0 and wait below threshold.
  const overloadQueue = (attrs.overload_queue as number) ?? 0;
  const overloadWait = (attrs.overload_wait_s as number) ?? 0;
  const oldestWait = m.oldest_wait_s ?? 0;
  if (isOverloaded) {
    if (m.queue_len === 0 && oldestWait < overloadWait) {
      // CONFLICTING_FACTS: no symptom claim.
      claims.push(mkClaim('unknown', 'unknown', 'T_UNKNOWN',
        { subject_name: subjectName, detail: 'overload state', reason: 'CONFLICTING_FACTS' },
        'rule', ['R07'],
        [{ kind: 'state', path: `/metrics/stations/${stationId}/status` }],
        [], 'CONFLICTING_FACTS',
      ));
      const unk = claims[claims.length - 1];
      unk.reason = 'CONFLICTING_FACTS';
      unk.support = 'none';
    } else {
      claims.push(mkClaim('overload', 'symptom', 'T_OVERLOAD',
        {
          subject_name: subjectName,
          status: m.status,
          queue_len: m.queue_len,
          oldest_wait_s: oldestWait,
          overload_queue: overloadQueue,
          overload_wait_s: overloadWait,
        },
        'rule', ['R07'],
        [
          { kind: 'state', path: `/metrics/stations/${stationId}/status` },
          { kind: 'state', path: `/metrics/stations/${stationId}/queue_len` },
          { kind: 'world_rule', rule: 'R07' },
        ],
      ));
    }
  }

  // --- backlog ---
  if (backlogged) {
    claims.push(mkClaim('backlog', 'condition', 'T_BACKLOG',
      { subject_name: subjectName, queue_len: m.queue_len, oldest_wait_s: oldestWait },
      'state', [],
      [{ kind: 'state', path: `/metrics/stations/${stationId}/queue_len` }],
    ));
  }

  // --- backlog_growth ---
  // Only if window is within the branch log.
  const windowStart = t - WINDOW_S;
  const logStart = ledger.length > 0 ? ledger[0].t : t;
  if (windowStart >= logStart) {
    const qStart = queueLenAt(ledger, stationId, windowStart);
    if (m.queue_len > qStart) {
      const growthEvents = ledger.filter((e) =>
        (e.type === 'WORK_QUEUED' || e.type === 'WORK_STARTED') &&
        e.data.station_id === stationId && e.t > windowStart && e.t <= t
      );
      claims.push(mkClaim('backlog_growth', 'condition', 'T_BACKLOG_GROWTH',
        {
          subject_name: subjectName,
          queue_at_window_start: qStart,
          queue_at_t: m.queue_len,
          window_minutes: 15,
        },
        'state', [],
        [
          { kind: 'state', path: `/metrics/stations/${stationId}/queue_len` },
          ...growthEvents.slice(0, 5).map((e): Ref => ({ kind: 'event', event_id: e.event_id })),
        ],
      ));
    }
  } else if (backlogged || m.queue_len > 0) {
    // INSUFFICIENT_WINDOW instead of backlog_growth/demand_vs_capacity.
    // (Handled below for demand_vs_capacity; backlog_growth skipped.)
  }

  // --- demand_vs_capacity (R01) ---
  if (windowStart >= logStart) {
    const queuedEvents = ledger.filter((e) =>
      e.type === 'WORK_QUEUED' && e.data.station_id === stationId &&
      e.t > windowStart && e.t <= t
    );
    if (queuedEvents.length > 0) {
      let demand = 0;
      for (const e of queuedEvents) {
        demand += nominalDuration(world, stationId, e.data.step as string);
      }
      const capacity = capacityIntegral(world, ledger, stationId, t);
      // Use toFixed(2) to match the reference implementation's rounding.
      const ratio = capacity > 0 ? Number((demand / capacity).toFixed(2)) : null;
      const exceeds = capacity > 0 && demand > capacity;
      claims.push(mkClaim('demand_vs_capacity', 'condition', 'T_DEMAND_VS_CAPACITY',
        {
          subject_name: subjectName,
          demand_work_s: demand,
          capacity_work_s: Math.round(capacity),
          ratio,
          exceeds,
          window_minutes: 15,
        },
        'rule', ['R01'],
        [
          // CCR-005 C6: evidence is COMPLETE, not sampled. All window events.
          ...queuedEvents.map((e): Ref => ({ kind: 'event', event_id: e.event_id })),
          { kind: 'world_rule', rule: 'R01' },
        ],
        ['demand uses nominal step durations from world.processes'],
      ));
    }
  } else {
    // INSUFFICIENT_WINDOW.
    if (backlogged) {
      const unk = mkClaim('unknown', 'unknown', 'T_UNKNOWN',
        { subject_name: subjectName, detail: 'demand vs capacity', reason: 'INSUFFICIENT_WINDOW' },
        'rule', [],
        [{ kind: 'state', path: `/metrics/stations/${stationId}/queue_len` }],
        [], 'INSUFFICIENT_WINDOW',
      );
      unk.reason = 'INSUFFICIENT_WINDOW';
      unk.support = 'none';
      claims.push(unk);
    }
  }

  // --- at_capacity (R01, R03) ---
  if (atCapacity) {
    claims.push(mkClaim('at_capacity', 'condition', 'T_AT_CAPACITY',
      {
        subject_name: subjectName,
        in_progress: m.in_progress,
        effective: base.effective,
      },
      'rule', ['R01', 'R03'],
      [
        { kind: 'state', path: `/metrics/stations/${stationId}/in_progress` },
        { kind: 'world_rule', rule: 'R01' },
      ],
    ));
  }

  // --- capacity_limit (R01) ---
  if (limitClass && limitClass !== 'DEMAND') {
    const classText: Record<string, string> = {
      STAFF: 'staffing',
      EQUIPMENT: 'equipment',
      CO_BINDING: 'staffing and equipment together',
      DEMAND: 'incoming work, not capacity',
    };
    claims.push(mkClaim('capacity_limit', 'limitation', 'T_CAPACITY_LIMIT',
      {
        subject_name: subjectName,
        class_text: classText[limitClass] ?? limitClass,
        effective: base.effective,
        equipment: base.equipment,
        staff: base.staff,
        add_one_staff: dStaff,
        add_one_equipment_slot: dEquip,
        add_one_equipment_slot_text: dEquip === null ? 'nothing (no equipment)' : String(dEquip),
        // Store the raw class for testing (not in template).
        class: limitClass,
      },
      'rule', ['R01'],
      [
        { kind: 'state', path: `/metrics/stations/${stationId}/capacity` },
        { kind: 'state', path: `/metrics/stations/${stationId}/in_progress` },
        { kind: 'world_rule', rule: 'R01' },
      ],
    ));
    // Remove the 'class' from values if the template doesn't use it.
    // Actually, keep it for testing; the formatter only substitutes placeholders in the template.
  } else if (unknownReason === 'MODEL_UNEXPLAINED_IDLE') {
    const unk = mkClaim('unknown', 'unknown', 'T_UNKNOWN',
      { subject_name: subjectName, detail: 'capacity limitation', reason: 'MODEL_UNEXPLAINED_IDLE' },
      'rule', ['R01'],
      [{ kind: 'state', path: `/metrics/stations/${stationId}/queue_len` }],
      [], 'MODEL_UNEXPLAINED_IDLE',
    );
    unk.reason = 'MODEL_UNEXPLAINED_IDLE';
    unk.support = 'none';
    claims.push(unk);
  }

  // --- equipment_degradation (R01) ---
  for (const eqId of attached) {
    const eqState = (snap.state.equipment as Record<string, { status: string; capacity: number; nominal_capacity: number }>)[eqId];
    if (!eqState || eqState.status === 'OPERATIONAL') continue;
    const eqEnt = entById.get(eqId);
    const eqName = (eqEnt as { name?: string } | undefined)?.name ?? eqId;
    // restoring_raises_effective: R01 with this unit at nominal exceeds effective.
    const restoredCap = attached.reduce((sum, id) => {
      if (id === eqId) return sum + eqState.nominal_capacity;
      const s = (snap.state.equipment as Record<string, { status: string; capacity: number }>)[id];
      return sum + (s.status === 'DOWN' ? 0 : s.capacity);
    }, 0);
    const raises = r01(attrs, staffN, restoredCap).effective > base.effective;
    const role = raises ? 'limitation' : 'non_limitation';
    claims.push(mkClaim('equipment_degradation', role, 'T_EQUIPMENT_DEGRADATION',
      {
        subject_name: subjectName,
        equipment_name: eqName,
        status: eqState.status,
        capacity: eqState.capacity,
        nominal_capacity: eqState.nominal_capacity,
        raises_text: raises ? 'would raise' : 'would not raise',
        restoring_raises_effective: raises,
      },
      'rule', ['R01'],
      [
        { kind: 'state', path: `/state/equipment/${eqId}/status` },
        { kind: 'world_rule', rule: 'R01' },
      ],
    ));
  }

  // --- assembly_blocking (R05) ---
  // Only if the world has the assembly_barrier rule kind.
  const hasBarrier = (world.rules as { kind: string }[]).some((r) => r.kind === 'assembly_barrier');
  if (hasBarrier && backlogged) {
    const snapState = snapshot as {
      state: {
        work_open: { id: string; order_id: string; station_id: string; step: string }[];
        orders_open: { id: string; state: string }[];
      };
    };
    const open = snapState.state.work_open ?? [];
    const orders = snapState.state.orders_open ?? [];
    // CCR-005 C4: item work is open work whose step is NOT a step of the world
    // process with applies_to='order'. Identify structurally, never by name.
    const orderStepIds = new Set<string>();
    for (const proc of (world.processes as { applies_to?: string; steps: { id: string }[] }[])) {
      if (proc.applies_to === 'order') {
        for (const step of proc.steps) orderStepIds.add(step.id);
      }
    }
    const isItemWork = (w: { step: string }): boolean => !orderStepIds.has(w.step);
    const pending: string[] = [];
    const sole: string[] = [];
    for (const o of orders) {
      if (o.state !== 'OPEN') continue;
      const items = open.filter((w) => w.order_id === o.id && isItemWork(w));
      if (!items.some((w) => w.station_id === stationId)) continue;
      pending.push(o.id);
      if (items.every((w) => w.station_id === stationId)) {
        sole.push(o.id);
      }
    }
    if (sole.length > 0) {
      claims.push(mkClaim('assembly_blocking', 'downstream_effect', 'T_ASSEMBLY_BLOCKING',
        {
          subject_name: subjectName,
          count_sole: sole.length,
          sole_remaining_blocker_for: [...sole].sort(),
          orders_with_pending_work: [...pending].sort(),
          order_list: [...sole].sort().join(', '),
        },
        'structure', ['R05'],
        [
          { kind: 'world_rule', rule: 'R05' },
        ],
      ));
    }
  }

  // --- Links (C.3) ---
  const byKind = new Map(claims.map((c) => [c.kind, c]));
  const overload = byKind.get('overload');
  const backlog = byKind.get('backlog');
  const backlogGrowth = byKind.get('backlog_growth');
  const demandVsCap = byKind.get('demand_vs_capacity');
  const atCap = byKind.get('at_capacity');
  const capLimit = byKind.get('capacity_limit');
  const assembly = byKind.get('assembly_blocking');

  if (overload) {
    // overload —supports← from backlog, backlog_growth, demand_vs_capacity (if exceeds).
    if (backlog) backlog.links.push({ rel: 'supports', to: overload.id });
    if (backlogGrowth) backlogGrowth.links.push({ rel: 'supports', to: overload.id });
    if (demandVsCap && demandVsCap.values.exceeds) {
      demandVsCap.links.push({ rel: 'supports', to: overload.id });
    }
    // overload —limited_by→ capacity_limit.
    if (capLimit) overload.links.push({ rel: 'limited_by', to: capLimit.id });
    // overload —blocks→ assembly_blocking.
    if (assembly) overload.links.push({ rel: 'blocks', to: assembly.id });
  } else {
    // backlog —limited_by→ capacity_limit when no overload.
    if (backlog && capLimit) backlog.links.push({ rel: 'limited_by', to: capLimit.id });
    // backlog —blocks→ assembly_blocking.
    if (backlog && assembly) backlog.links.push({ rel: 'blocks', to: assembly.id });
  }

  if (capLimit) {
    // capacity_limit —supports← from at_capacity.
    if (atCap) atCap.links.push({ rel: 'supports', to: capLimit.id });
    // capacity_limit —supports← from each equipment_degradation with role limitation.
    for (const c of claims) {
      if (c.kind === 'equipment_degradation' && c.role === 'limitation') {
        c.links.push({ rel: 'supports', to: capLimit.id });
      }
    }
  }

  return claims;
}

/**
 * Check if the world has the required rule kinds for this pack.
 */
export function hasRequiredRuleKinds(world: World): boolean {
  const kinds = new Set((world.rules as { kind: string }[]).map((r) => r.kind));
  return REQUIRES_RULE_KINDS.every((k) => kinds.has(k));
}
