// Deterministic counterfactual scheduler (16 §E).
//
// The scheduler's only output is events. It keeps a private scratch state,
// advanced ONLY by the injected `apply` (default: applyEvent from reducer.ts),
// to make dispatch decisions. The scratch state is never published.
// Every published simulated state is computed by reduceTo over the branch log.
//
// At each instant τ (first is always tB):
//   1. due timers (completions before handoffs, then by id)
//   2. inputs in reduction order (interventions, then arrivals)
//   3. dispatch: stations in world entity order, R01/R02/R03
//
// No randomness. seed is recorded but unused. The engine never reads the clock.
import { applyEvent } from './reducer.js';
import { capacity } from './views.js';
import { reductionKey, compareKeys } from './ledger.js';
import type { AtlasEvent, Seconds, World, WorldState, WorkFact } from './types.js';
import type { Intervention } from './scenario.js';

export class BranchStateInconsistent extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchStateInconsistent';
  }
}

export type ApplyFn = (s: WorldState, e: AtlasEvent) => void;

export interface SchedulerTimers {
  t: Seconds;
  kind: 'complete' | 'handoff';
  id: string;
  work_id?: string;
  order_id?: string;
}

export interface EmittedEvent {
  t: Seconds;
  type: string;
  subject: string;
  data: Record<string, unknown>;
  claim_class: 'simulated' | 'observed';
  note?: string;
}

export interface SchedulerInput {
  world: World;
  baseState: WorldState;
  tB: Seconds;
  tH: Seconds;
  arrivals: { t: Seconds; type: string; subject: string; data: Record<string, unknown> }[];
  interventions: Intervention[];
  handoff_s: number;
  apply?: ApplyFn;
}

/** w_<order without o_>_<item_seq>_<step> (adapter convention, 16 §B/CCR-003). */
export function mintWorkId(orderId: string, itemSeq: number, step: string): string {
  const num = orderId.startsWith('o_') ? orderId.slice(2) : orderId;
  return `w_${num}_${itemSeq}_${step}`;
}

function processOf(world: World, productId: string) {
  return world.processes.find((p) => p.applies_to === productId);
}

function orderProcess(world: World) {
  const p = world.processes.find((pr) => pr.applies_to === 'order');
  if (!p) throw new BranchStateInconsistent('world has no order process');
  return p;
}

/** Nominal duration for a work item, via its order/item/process. */
export function nominalDuration(world: World, s: WorldState, w: WorkFact): number {
  if (w.item_seq === 0) {
    const proc = orderProcess(world);
    const step = proc.steps[w.step_index];
    if (!step || step.id !== w.step) {
      throw new BranchStateInconsistent(`order-step work ${w.order_id} has unknown step '${w.step}'`);
    }
    return Number(step.duration_s);
  }
  const order = s.orders[w.order_id];
  const item = order.items.find((i) => i.seq === w.item_seq);
  if (!item) throw new BranchStateInconsistent(`work ${w.order_id}/${w.item_seq}: unknown item`);
  const proc = processOf(world, item.product_id);
  if (!proc) throw new BranchStateInconsistent(`product '${item.product_id}' has no process`);
  const step = proc.steps[w.step_index];
  if (!step || step.id !== w.step) {
    throw new BranchStateInconsistent(`work step '${w.step}' not at index ${w.step_index}`);
  }
  return Number(step.duration_s);
}

/** True if the item's last step work is DONE (or the item has no process). */
function itemDone(world: World, s: WorldState, orderId: string, itemSeq: number): boolean {
  const order = s.orders[orderId];
  const item = order.items.find((i) => i.seq === itemSeq);
  if (!item) return false;
  const proc = processOf(world, item.product_id);
  if (!proc) return true;
  const last = proc.steps[proc.steps.length - 1];
  const w = s.work[mintWorkId(orderId, itemSeq, last.id)];
  return w?.state === 'DONE';
}

/** R05 barrier: every item with a process is done. */
function allItemsDone(world: World, s: WorldState, orderId: string): boolean {
  const order = s.orders[orderId];
  return order.items.every((item) => itemDone(world, s, orderId, item.seq));
}

/** The order-step work id (item_seq 0). */
function orderStepWorkId(world: World, orderId: string): string {
  const proc = orderProcess(world);
  return mintWorkId(orderId, 0, proc.steps[0].id);
}

function passWorkExists(world: World, s: WorldState, orderId: string): boolean {
  return orderStepWorkId(world, orderId) in s.work;
}

function toAtlasEvent(e: EmittedEvent): AtlasEvent {
  // Minimal event for applyEvent; provenance is assigned at numbering (E6/D4).
  return {
    seq: 0,
    event_id: '',
    branch: 'sim:pending',
    ts: '',
    t: e.t,
    type: e.type,
    subject: e.subject,
    data: e.data,
    provenance: {
      source: 'simulation',
      record_id: '',
      record_ts: '',
      claim_class: e.claim_class,
      adapter: '',
      ...(e.note ? { note: e.note } : {}),
    },
  };
}

export interface SchedulerResult {
  events: EmittedEvent[]; // in emission order
}

export function runScheduler(input: SchedulerInput): SchedulerResult {
  const { world, tB, tH, handoff_s } = input;
  const apply: ApplyFn = input.apply ?? applyEvent;
  const scratch = structuredClone(input.baseState);
  const emitted: EmittedEvent[] = [];
  const timers: SchedulerTimers[] = [];

  const emit = (e: EmittedEvent): void => {
    emitted.push(e);
    apply(scratch, toAtlasEvent(e));
  };

  // ── E2: adoption at tB ──
  for (const [workId, w] of Object.entries(scratch.work)) {
    if (w.state === 'IN_PROGRESS') {
      const dur = nominalDuration(world, scratch, w);
      timers.push({
        t: Math.max(tB, (w.started_t ?? tB) + dur),
        kind: 'complete',
        id: workId,
        work_id: workId,
      });
    }
  }
  for (const [orderId, o] of Object.entries(scratch.orders)) {
    if (o.state === 'READY') {
      timers.push({
        t: Math.max(tB, (o.ready_t ?? tB) + handoff_s),
        kind: 'handoff',
        id: orderId,
        order_id: orderId,
      });
    }
  }
  // Consistency: an OPEN order with all items done must have pass work.
  for (const [orderId, o] of Object.entries(scratch.orders)) {
    if (o.state === 'OPEN' && allItemsDone(world, scratch, orderId) && !passWorkExists(world, scratch, orderId)) {
      throw new BranchStateInconsistent(`order ${orderId}: all items done but no pass work exists`);
    }
  }

  // ── inputs merged and sorted in reduction order ──
  interface Input { t: Seconds; ev: EmittedEvent }
  const inputs: Input[] = [];
  for (const iv of input.interventions) {
    inputs.push({
      t: iv.at_t,
      ev: {
        t: iv.at_t,
        type: 'ASSIGNMENT_CHANGED',
        subject: iv.employee,
        data: { employee_id: iv.employee, station_id: iv.to, reason: `intervention:${iv.id}` },
        claim_class: 'simulated',
      },
    });
  }
  for (const a of input.arrivals) {
    inputs.push({
      t: a.t,
      ev: {
        t: a.t,
        type: 'ORDER_CREATED',
        subject: a.subject,
        data: a.data,
        claim_class: 'observed',
        note: 'historical arrival replayed into the branch',
      },
    });
  }
  inputs.sort((x, y) =>
    x.t - y.t || compareKeys(reductionKey(x.ev as any), reductionKey(y.ev as any)),
  );
  let inputIdx = 0;

  const stationOrder = world.entities.filter((e) => e.type === 'station').map((e) => e.id);

  // ── E5: instant loop. First instant is always tB. ──
  let first = true;
  for (;;) {
    let tau: Seconds | null = null;
    if (first) {
      tau = tB;
      first = false;
    } else {
      let next = Infinity;
      for (const tm of timers) if (tm.t < next) next = tm.t;
      for (let i = inputIdx; i < inputs.length; i++) if (inputs[i].t < next) next = inputs[i].t;
      if (next === Infinity || next > tH) break;
      tau = next;
    }
    if (tau > tH) break;

    // 1. due timers at τ: completions before handoffs, then by id
    const due = timers.filter((tm) => tm.t === tau).sort((a, b) =>
      a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === 'complete' ? -1 : 1,
    );
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t === tau) timers.splice(i, 1);
    for (const tm of due) {
      if (tm.kind === 'complete') {
        const w = scratch.work[tm.work_id!];
        const stationId = w.station_id;
        emit({ t: tau, type: 'WORK_COMPLETED', subject: w.order_id, data: { work_id: tm.work_id!, station_id: stationId }, claim_class: 'simulated' });
        const wAfter = scratch.work[tm.work_id!];
        if (wAfter.item_seq === 0) {
          // order step done → ORDER_READY + handoff timer
          emit({ t: tau, type: 'ORDER_READY', subject: wAfter.order_id, data: { order_id: wAfter.order_id }, claim_class: 'simulated' });
          timers.push({ t: tau + handoff_s, kind: 'handoff', id: wAfter.order_id, order_id: wAfter.order_id });
        } else {
          // next step, or item done → R05 barrier
          const order = scratch.orders[wAfter.order_id];
          const item = order.items.find((it) => it.seq === wAfter.item_seq)!;
          const proc = processOf(world, item.product_id)!;
          const nextStep = proc.steps[wAfter.step_index + 1];
          if (nextStep) {
            const nid = mintWorkId(wAfter.order_id, wAfter.item_seq, nextStep.id);
            emit({
              t: tau, type: 'WORK_QUEUED', subject: wAfter.order_id,
              data: { work_id: nid, order_id: wAfter.order_id, item_seq: wAfter.item_seq, station_id: nextStep.station, step: nextStep.id, step_index: wAfter.step_index + 1 },
              claim_class: 'simulated',
            });
          } else if (allItemsDone(world, scratch, wAfter.order_id) && !passWorkExists(world, scratch, wAfter.order_id)) {
            const proc0 = orderProcess(world);
            const nid = mintWorkId(wAfter.order_id, 0, proc0.steps[0].id);
            emit({
              t: tau, type: 'WORK_QUEUED', subject: wAfter.order_id,
              data: { work_id: nid, order_id: wAfter.order_id, item_seq: 0, station_id: proc0.steps[0].station, step: proc0.steps[0].id, step_index: 0 },
              claim_class: 'simulated',
            });
          }
        }
      } else {
        // handoff
        emit({ t: tau, type: 'ORDER_COMPLETED', subject: tm.order_id!, data: { order_id: tm.order_id! }, claim_class: 'simulated' });
      }
    }

    // 2. inputs at τ in reduction order
    while (inputIdx < inputs.length && inputs[inputIdx].t === tau) {
      const { ev } = inputs[inputIdx++];
      emit(ev);
      if (ev.type === 'ORDER_CREATED') {
        const order = scratch.orders[ev.subject];
        const withProc = order.items.filter((item) => processOf(world, item.product_id));
        if (withProc.length === 0) {
          const proc0 = orderProcess(world);
          const nid = mintWorkId(ev.subject, 0, proc0.steps[0].id);
          emit({
            t: tau, type: 'WORK_QUEUED', subject: ev.subject,
            data: { work_id: nid, order_id: ev.subject, item_seq: 0, station_id: proc0.steps[0].station, step: proc0.steps[0].id, step_index: 0 },
            claim_class: 'simulated',
          });
        } else {
          for (const item of withProc) {
            const proc = processOf(world, item.product_id)!;
            const step0 = proc.steps[0];
            const nid = mintWorkId(ev.subject, item.seq, step0.id);
            emit({
              t: tau, type: 'WORK_QUEUED', subject: ev.subject,
              data: { work_id: nid, order_id: ev.subject, item_seq: item.seq, station_id: step0.station, step: step0.id, step_index: 0 },
              claim_class: 'simulated',
            });
          }
        }
      }
    }

    // 3. dispatch: stations in world entity order; R01/R02/R03
    for (const stId of stationOrder) {
      for (;;) {
        const st = scratch.stations[stId];
        const eff = capacity(world, scratch, stId).effective;
        if (st.queue.length === 0 || st.in_progress.length >= eff) break;
        const workId = st.queue[0];
        const w = scratch.work[workId];
        emit({ t: tau, type: 'WORK_STARTED', subject: w.order_id, data: { work_id: workId, station_id: stId }, claim_class: 'simulated' });
        const dur = nominalDuration(world, scratch, scratch.work[workId]);
        timers.push({ t: tau + dur, kind: 'complete', id: workId, work_id: workId });
      }
    }
  }

  return { events: emitted };
}
