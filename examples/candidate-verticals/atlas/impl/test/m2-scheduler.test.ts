// F4: scheduler units on a hand-built mini world (no fixtures).
// Tests the E5 instant procedure, capacity, dependencies, barriers, and adoption.
import { describe, expect, it } from 'vitest';
import { runScheduler, mintWorkId, type EmittedEvent } from '../src/scheduler.js';
import { createState, applyEvent } from '../src/reducer.js';
import { capacity } from '../src/views.js';
import type { World, WorldState } from '../src/types.js';

function miniWorld(): World {
  return {
    metadata: { id: 'mini', name: 'mini', version: '0' },
    time: { origin: '2026-10-06T17:00:00-07:00', end: '2026-10-06T20:00:00-07:00' },
    entity_types: [{ id: 'station' }, { id: 'person' }, { id: 'product' }],
    entities: [
      { id: 'st_a', type: 'station', attrs: { per_staff_concurrency: 2, overload_queue: 99, overload_wait_s: 9999 } },
      { id: 'st_b', type: 'station', attrs: { per_staff_concurrency: 1, overload_queue: 99, overload_wait_s: 9999 } },
      { id: 'emp_1', type: 'person', attrs: { skills: ['a', 'b'] } },
      { id: 'emp_2', type: 'person', attrs: { skills: ['a'] } },
      { id: 'prod_x', type: 'product', attrs: {} },
    ],
    relationships: [],
    processes: [
      {
        id: 'proc_x', applies_to: 'prod_x',
        steps: [
          { id: 's1', station: 'st_a', duration_s: 100 },
          { id: 's2', station: 'st_b', duration_s: 200 },
        ],
      },
      {
        id: 'proc_order', applies_to: 'order', handoff_s: 60,
        steps: [{ id: 'pass', station: 'st_a', duration_s: 50 }],
      },
    ],
    rules: [
      { id: 'R01', kind: 'station_capacity' },
      { id: 'R02', kind: 'queue_discipline' },
      { id: 'R06', kind: 'handoff' },
    ],
    initial_state: { clock_in: [], assignments: {}, equipment: {} },
    aliases: {},
    visualization: { objects: {} },
  } as unknown as World;
}

function baseStateWith(world: World, setup: (s: WorldState) => void): WorldState {
  const s = createState(world);
  setup(s);
  return s;
}

function onShiftAssigned(s: WorldState, emp: string, station: string | null): void {
  s.on_shift[emp] = true;
  s.assignments[emp] = station;
}

function mkArrival(t: number, orderId: string, items: { seq: number; product_id: string }[]): EmittedEvent & { data: any } {
  return {
    t, type: 'ORDER_CREATED', subject: orderId,
    data: { order_id: orderId, channel: 'dine_in', items, total: 10 },
    claim_class: 'observed', note: 'historical arrival replayed into the branch',
  } as any;
}

function runMini(opts: {
  setup: (s: WorldState) => void;
  arrivals?: { t: number; type: string; subject: string; data: Record<string, unknown> }[];
  interventions?: any[];
  tB?: number; tH?: number;
}): EmittedEvent[] {
  const world = miniWorld();
  const s = baseStateWith(world, opts.setup);
  const { events } = runScheduler({
    world, baseState: s, tB: opts.tB ?? 1000, tH: opts.tH ?? 5000,
    arrivals: (opts.arrivals ?? []) as any,
    interventions: opts.interventions ?? [],
    handoff_s: 60,
  });
  return events;
}

function typesAt(events: EmittedEvent[], t: number): string[] {
  return events.filter((e) => e.t === t).map((e) => e.type);
}

describe('F4 scheduler units', () => {
  it('capacity respected: 3 items, effective 2 → third starts at first completion', () => {
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', 'st_a'); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_x' }, { seq: 2, product_id: 'prod_x' }, { seq: 3, product_id: 'prod_x' }])],
    });
    // at t=1000: 3 WORK_QUEUED (s1), 2 WORK_STARTED (capacity 2)
    const started = events.filter((e) => e.type === 'WORK_STARTED');
    expect(started.filter((e) => e.t === 1000)).toHaveLength(2);
    // third starts when the first completes (t=1100)
    expect(started.filter((e) => e.t === 1100)).toHaveLength(1);
    expect(events.filter((e) => e.type === 'WORK_COMPLETED' && e.t === 1100)).toHaveLength(2);
  });

  it('two-step dependency: step 2 queued and started at step-1 completion', () => {
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', 'st_a'); onShiftAssigned(s, 'emp_2', 'st_b'); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_x' }])],
    });
    // s1 completes at 1100 → s2 queued and started (st_b has capacity 1)
    const q2 = events.find((e) => e.type === 'WORK_QUEUED' && (e.data as any).step === 's2');
    expect(q2?.t).toBe(1100);
    const s2workId = (q2!.data as any).work_id;
    const s2 = events.find((e) => e.type === 'WORK_STARTED' && (e.data as any).work_id === s2workId);
    expect(s2?.t).toBe(1100);
    // s2 completes at 1300 (200s)
    expect(events.find((e) => e.type === 'WORK_COMPLETED' && (e.data as any).work_id === s2workId)?.t).toBe(1300);
  });

  it('order-step barrier waits for all items', () => {
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', 'st_a'); onShiftAssigned(s, 'emp_2', 'st_b'); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_x' }, { seq: 2, product_id: 'prod_x' }])],
      tH: 10000,
    });
    const passQ = events.find((e) => e.type === 'WORK_QUEUED' && (e.data as any).step === 'pass');
    // both items must finish s1 (100s) and s2 (200s) before the pass is queued
    expect(passQ).toBeDefined();
    const passT = passQ!.t;
    // the last s2 completion determines it (match via the queued s2 work ids)
    const s2ids = new Set(
      events.filter((e) => e.type === 'WORK_QUEUED' && (e.data as any).step === 's2')
        .map((e) => (e.data as any).work_id),
    );
    const s2comps = events
      .filter((e) => e.type === 'WORK_COMPLETED' && s2ids.has((e.data as any).work_id))
      .map((e) => e.t);
    expect(s2comps.length).toBe(2);
    expect(passT).toBe(Math.max(...s2comps));
  });

  it('process-less order queues the order step at creation', () => {
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', 'st_a'); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_noproc' }])],
    });
    const q = events.find((e) => e.type === 'WORK_QUEUED');
    expect((q!.data as any).step).toBe('pass');
    expect((q!.data as any).item_seq).toBe(0);
    expect(q!.t).toBe(1000);
  });

  it('handoff at +60 after ORDER_READY', () => {
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', 'st_a'); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_noproc' }])],
      tH: 5000,
    });
    const ready = events.find((e) => e.type === 'ORDER_READY')!;
    const done = events.find((e) => e.type === 'ORDER_COMPLETED')!;
    expect(done.t - ready.t).toBe(60);
  });

  it('reassignment at τ changes capacity before dispatch at τ', () => {
    // emp_1 starts unassigned; at t=1000 an intervention assigns to st_a.
    // The arrival is also at t=1000. Dispatch must see capacity 2.
    const events = runMini({
      setup: (s) => { onShiftAssigned(s, 'emp_1', null); },
      arrivals: [mkArrival(1000, 'o_1', [{ seq: 1, product_id: 'prod_x' }])],
      interventions: [{ id: 'iv_1', kind: 'reassign', employee: 'emp_1', from: null, to: 'st_a', at: '2026-10-06T17:16:40-07:00', at_t: 1000 }],
    });
    const started = events.filter((e) => e.type === 'WORK_STARTED' && e.t === 1000);
    expect(started).toHaveLength(1);
  });

  it('R03: capacity drop leaves in-progress running and blocks starts', () => {
    // 2 staff on st_a (capacity 4). 5 items: 4 start at t=1000, 1 queued.
    // At t=1050 an intervention moves emp_2 away (capacity 2). In-progress (4)
    // keeps running; the queued item cannot start (4 >= 2).
    // At t=1100 the 4 complete; then the queued item starts.
    const world = miniWorld();
    const s = baseStateWith(world, (st) => {
      onShiftAssigned(st, 'emp_1', 'st_a');
      onShiftAssigned(st, 'emp_2', 'st_a');
    });
    const { events } = runScheduler({
      world, baseState: s, tB: 1000, tH: 5000,
      arrivals: [mkArrival(1000, 'o_1', [
        { seq: 1, product_id: 'prod_x' }, { seq: 2, product_id: 'prod_x' },
        { seq: 3, product_id: 'prod_x' }, { seq: 4, product_id: 'prod_x' },
        { seq: 5, product_id: 'prod_x' },
      ])] as any,
      interventions: [{ id: 'iv_1', kind: 'reassign', employee: 'emp_2', from: 'st_a', to: null, at: 'x', at_t: 1050 }],
      handoff_s: 60,
    });
    expect(events.filter((e) => e.type === 'WORK_STARTED' && e.t === 1000)).toHaveLength(4);
    // at t=1050: intervention only, no starts (blocked)
    expect(events.filter((e) => e.type === 'WORK_STARTED' && e.t === 1050)).toHaveLength(0);
    expect(events.find((e) => e.type === 'ASSIGNMENT_CHANGED')?.t).toBe(1050);
    // in-progress not preempted: all 4 complete at t=1100
    expect(events.filter((e) => e.type === 'WORK_COMPLETED' && e.t === 1100)).toHaveLength(4);
    // then the queued item starts
    expect(events.filter((e) => e.type === 'WORK_STARTED' && e.t === 1100)).toHaveLength(1);
  });

  it('adoption timers at max(tB, started_t + nominal)', () => {
    const world = miniWorld();
    const s = baseStateWith(world, (st) => {
      onShiftAssigned(st, 'emp_1', 'st_a');
      // in-progress work started at t=950, nominal 100 → completes at 1050 (> tB=1000)
      st.work['w_1_1_s1'] = {
        order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 's1', step_index: 0,
        state: 'IN_PROGRESS', queued_t: 950, started_t: 950, completed_t: null,
      } as any;
      st.stations['st_a'].in_progress.push('w_1_1_s1');
      st.orders['o_1'] = {
        state: 'OPEN', created_t: 900, ready_t: null, completed_t: null,
        channel: 'dine_in', items: [{ seq: 1, product_id: 'prod_x' }], total: 10,
      } as any;
    });
    const { events } = runScheduler({
      world, baseState: s, tB: 1000, tH: 5000, arrivals: [], interventions: [], handoff_s: 60,
    });
    const comp = events.find((e) => e.type === 'WORK_COMPLETED' && (e.data as any).work_id === 'w_1_1_s1');
    expect(comp?.t).toBe(1050);
  });

  it('intervention at tB moving a cook off a station applies before dispatch at tB', () => {
    // emp_1 on st_a with queued work; intervention at tB moves emp_1 away.
    // Dispatch at tB must see capacity 0 and start nothing.
    const world = miniWorld();
    const s = baseStateWith(world, (st) => {
      onShiftAssigned(st, 'emp_1', 'st_a');
      st.work['w_1_1_s1'] = {
        order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 's1', step_index: 0,
        state: 'QUEUED', queued_t: 900, started_t: null, completed_t: null,
      } as any;
      st.stations['st_a'].queue.push('w_1_1_s1');
      st.orders['o_1'] = {
        state: 'OPEN', created_t: 900, ready_t: null, completed_t: null,
        channel: 'dine_in', items: [{ seq: 1, product_id: 'prod_x' }], total: 10,
      } as any;
    });
    const { events } = runScheduler({
      world, baseState: s, tB: 1000, tH: 5000, arrivals: [],
      interventions: [{ id: 'iv_1', kind: 'reassign', employee: 'emp_1', from: 'st_a', to: null, at: 'x', at_t: 1000 }],
      handoff_s: 60,
    });
    // intervention applied at tB; dispatch sees no staff → no WORK_STARTED at tB
    expect(events.filter((e) => e.type === 'WORK_STARTED' && e.t === 1000)).toHaveLength(0);
    expect(events.find((e) => e.type === 'ASSIGNMENT_CHANGED')?.t).toBe(1000);
  });
});
