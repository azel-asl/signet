// Reducer unit tests against a hand-built minimal world (no fixtures).
// Table-driven where the spec gives exact formulas (R01, R02, R07).
import { describe, expect, it } from 'vitest';
import { applyEvent, createState, reduceTo } from '../src/reducer.js';
import { capacity, staffAt, stationStatus } from '../src/views.js';
import { canonicalJson } from '../src/canon.js';
import type { AtlasEvent, World, WorldState } from '../src/types.js';

function miniWorld(): World {
  return {
    atlas_schema: 'atlas-world/0.1',
    metadata: { id: 'mini', name: 'Mini', version: '0.0.1', domain: 'test' },
    time: { unit: 'second', timezone: 'UTC', origin: '2026-10-06T17:00:00+00:00' },
    entity_types: [
      { id: 'station' }, { id: 'equipment' }, { id: 'person' }, { id: 'product' },
    ],
    entities: [
      { id: 'st_a', type: 'station', attrs: { staffing: 'required', per_staff_concurrency: 2, overload_queue: 6, overload_wait_s: 240 } },
      { id: 'eq_a1', type: 'equipment', attrs: { capacity: 4, status: 'OPERATIONAL' } },
      { id: 'emp_a', type: 'person', attrs: { skills: ['a'] } },
      { id: 'prod_x', type: 'product', attrs: { price: 10, process: 'proc_x' } },
    ],
    relationships: [{ type: 'attached_to', from: 'eq_a1', to: 'st_a' }],
    processes: [
      { id: 'proc_x', applies_to: 'prod_x', steps: [{ id: 'a', station: 'st_a', duration_s: 60 }] },
      { id: 'proc_order', applies_to: 'order', steps: [{ id: 'pass', station: 'st_a', duration_s: 30 }], handoff_s: 60 },
    ],
    rules: [
      { id: 'r1', kind: 'station_capacity', description: '' },
      { id: 'r2', kind: 'queue_discipline', description: '' },
      { id: 'r3', kind: 'station_status', description: '' },
    ],
    initial_state: { clock_in: [], assignments: {}, equipment: {} },
    metrics: [],
    goals: [{ id: 'g_kitchen_time', metric: 'avg_kitchen_time_s', op: '<=', target: 600 }],
  };
}

let seq = 0;
function ev(t: number, type: string, subject: string, data: Record<string, unknown>): AtlasEvent {
  seq++;
  return {
    seq, event_id: `ev_${seq}`, branch: 'history:test', ts: new Date(t * 1000).toISOString(),
    t, type, subject, data,
    provenance: { source: 'test', record_id: `test:${seq}`, record_ts: new Date(t * 1000).toISOString(), claim_class: 'observed', adapter: 'test/0' },
  };
}

const T0 = 1791331200;

describe('createState', () => {
  it('initializes stations empty, equipment from attrs, people off shift', () => {
    const s = createState(miniWorld());
    expect(s.stations.st_a).toEqual({ queue: [], in_progress: [] });
    expect(s.equipment.eq_a1).toEqual({ status: 'OPERATIONAL', capacity: 4, nominal_capacity: 4 });
    expect(s.on_shift.emp_a).toBe(false);
    expect(s.assignments.emp_a).toBeNull();
  });
});

describe('applyEvent transitions', () => {
  it('runs an order through the full lifecycle', () => {
    const w = miniWorld();
    const s = createState(w);
    const t = T0;
    applyEvent(s, ev(t, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }));
    applyEvent(s, ev(t, 'ASSIGNMENT_CHANGED', 'emp_a', { employee_id: 'emp_a', station_id: 'st_a' }));
    applyEvent(s, ev(t + 1, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'dine_in', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
    expect(s.orders.o_1.state).toBe('OPEN');
    applyEvent(s, ev(t + 2, 'WORK_QUEUED', 'o_1', { work_id: 'w_1', order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
    expect(s.stations.st_a.queue).toEqual(['w_1']);
    applyEvent(s, ev(t + 3, 'WORK_STARTED', 'o_1', { work_id: 'w_1', station_id: 'st_a' }));
    expect(s.stations.st_a.queue).toEqual([]);
    expect(s.stations.st_a.in_progress).toEqual(['w_1']);
    expect(s.work.w_1.state).toBe('IN_PROGRESS');
    applyEvent(s, ev(t + 63, 'WORK_COMPLETED', 'o_1', { work_id: 'w_1', station_id: 'st_a' }));
    expect(s.work.w_1.state).toBe('DONE');
    expect(s.work.w_1.completed_t).toBe(t + 63);
    applyEvent(s, ev(t + 64, 'ORDER_READY', 'o_1', { order_id: 'o_1' }));
    expect(s.orders.o_1.state).toBe('READY');
    applyEvent(s, ev(t + 124, 'ORDER_COMPLETED', 'o_1', { order_id: 'o_1' }));
    expect(s.orders.o_1.state).toBe('COMPLETED');
    expect(s.orders.o_1.completed_t).toBe(t + 124);
  });

  it('records measurements and human reports without changing operational facts', () => {
    const s = createState(miniWorld());
    const before = canonicalJson({ q: s.stations.st_a.queue, ip: s.stations.st_a.in_progress });
    applyEvent(s, ev(T0, 'MEASUREMENT_RECORDED', 'eq_a1', { metric: 'temp', value: 350 }));
    applyEvent(s, ev(T0, 'HUMAN_REPORT', 'eq_a1', { about: 'eq_a1', reporter: 'emp_a', text: 'hot' }));
    expect(s.measurements).toHaveLength(1);
    expect(s.reports).toHaveLength(1);
    expect(canonicalJson({ q: s.stations.st_a.queue, ip: s.stations.st_a.in_progress })).toBe(before);
  });

  it('throws on unknown event types (newer schema)', () => {
    const s = createState(miniWorld());
    expect(() => applyEvent(s, ev(T0, 'WORMHOLE_OPENED', 'st_a', {}))).toThrow(/unknown event type/);
  });

  it('applies equipment degradation with the carried capacity (R01 input)', () => {
    const s = createState(miniWorld());
    applyEvent(s, ev(T0, 'EQUIPMENT_STATE_CHANGED', 'eq_a1', { equipment_id: 'eq_a1', status: 'DEGRADED', capacity: 2 }));
    expect(s.equipment.eq_a1).toEqual({ status: 'DEGRADED', capacity: 2, nominal_capacity: 4 });
  });
});

describe('queue discipline (R02)', () => {
  it('keeps the queue sorted by (queued_t, order created_t, work_id)', () => {
    const w = miniWorld();
    const s = createState(w);
    // two orders created at different times; queue their work out of order
    applyEvent(s, ev(T0, 'ORDER_CREATED', 'o_b', { order_id: 'o_b', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
    applyEvent(s, ev(T0 + 10, 'ORDER_CREATED', 'o_a', { order_id: 'o_a', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
    applyEvent(s, ev(T0 + 20, 'WORK_QUEUED', 'o_a', { work_id: 'w_a', order_id: 'o_a', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
    applyEvent(s, ev(T0 + 20, 'WORK_QUEUED', 'o_b', { work_id: 'w_b', order_id: 'o_b', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
    // same queued_t: earlier-created order first
    expect(s.stations.st_a.queue).toEqual(['w_b', 'w_a']);
  });
});

describe('capacity (R01)', () => {
  function staffedState(degraded: boolean): WorldState {
    const w = miniWorld();
    const s = createState(w);
    applyEvent(s, ev(T0, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }));
    applyEvent(s, ev(T0, 'ASSIGNMENT_CHANGED', 'emp_a', { employee_id: 'emp_a', station_id: 'st_a' }));
    if (degraded) {
      applyEvent(s, ev(T0 + 1, 'EQUIPMENT_STATE_CHANGED', 'eq_a1', { equipment_id: 'eq_a1', status: 'DEGRADED', capacity: 2 }));
    }
    return s;
  }
  it('effective = min(equipment, staff * per_staff_concurrency)', () => {
    const w = miniWorld();
    expect(capacity(w, staffedState(false), 'st_a')).toEqual({ equipment: 4, staff: 2, effective: 2 });
  });
  it('degraded equipment contributes its reduced capacity', () => {
    const w = miniWorld();
    expect(capacity(w, staffedState(true), 'st_a')).toEqual({ equipment: 2, staff: 2, effective: 2 });
  });
  it('DOWN equipment contributes 0', () => {
    const w = miniWorld();
    const s = staffedState(false);
    applyEvent(s, ev(T0 + 2, 'EQUIPMENT_STATE_CHANGED', 'eq_a1', { equipment_id: 'eq_a1', status: 'DOWN', capacity: 0 }));
    expect(capacity(w, s, 'st_a')).toEqual({ equipment: 0, staff: 2, effective: 0 });
  });
  it('staffing-required station with no staff has effective 0', () => {
    const w = miniWorld();
    const s = createState(w);
    expect(capacity(w, s, 'st_a')).toEqual({ equipment: 4, staff: 0, effective: 0 });
  });
});

describe('station status (R07)', () => {
  it('UNSTAFFED when effective=0 and queue>0; NORMAL when queue empty', () => {
    const w = miniWorld();
    const s = createState(w);
    expect(stationStatus(w, s, 'st_a', T0)).toBe('NORMAL');
    applyEvent(s, ev(T0, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
    applyEvent(s, ev(T0 + 1, 'WORK_QUEUED', 'o_1', { work_id: 'w_1', order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
    expect(stationStatus(w, s, 'st_a', T0 + 1)).toBe('UNSTAFFED');
  });

  it('BUSY when in_progress >= effective; OVERLOADED on queue length / wait', () => {
    const w = miniWorld();
    const s = createState(w);
    applyEvent(s, ev(T0, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }));
    applyEvent(s, ev(T0, 'ASSIGNMENT_CHANGED', 'emp_a', { employee_id: 'emp_a', station_id: 'st_a' }));
    // effective = 2. Start 2 -> BUSY.
    for (let i = 0; i < 2; i++) {
      const o = `o_${i}`;
      applyEvent(s, ev(T0 + 1, 'ORDER_CREATED', o, { order_id: o, channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
      applyEvent(s, ev(T0 + 2, 'WORK_QUEUED', o, { work_id: `w_${i}`, order_id: o, item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
      applyEvent(s, ev(T0 + 3, 'WORK_STARTED', o, { work_id: `w_${i}`, station_id: 'st_a' }));
    }
    expect(stationStatus(w, s, 'st_a', T0 + 3)).toBe('BUSY');
    // queue 6 more -> OVERLOADED by queue length
    for (let i = 2; i < 8; i++) {
      const o = `o_${i}`;
      applyEvent(s, ev(T0 + 4, 'ORDER_CREATED', o, { order_id: o, channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }));
      applyEvent(s, ev(T0 + 5, 'WORK_QUEUED', o, { work_id: `w_${i}`, order_id: o, item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }));
    }
    expect(stationStatus(w, s, 'st_a', T0 + 5)).toBe('OVERLOADED');
  });
});

describe('reduceTo determinism', () => {
  it('two runs over identical inputs produce identical states', () => {
    const w = miniWorld();
    const events = [
      ev(T0, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }),
      ev(T0, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }),
      ev(T0 + 5, 'WORK_QUEUED', 'o_1', { work_id: 'w_1', order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }),
    ];
    const a = reduceTo(w, events, T0 + 100);
    const b = reduceTo(w, events, T0 + 100);
    expect(canonicalJson(a.state)).toBe(canonicalJson(b.state));
    expect(a.eventsApplied).toBe(3);
  });

  it('reduceTo stops at T and stamps state.t = T', () => {
    const w = miniWorld();
    const events = [
      ev(T0, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'x', items: [], total: 0 }),
      ev(T0 + 1000, 'ORDER_CREATED', 'o_2', { order_id: 'o_2', channel: 'x', items: [], total: 0 }),
    ];
    const r = reduceTo(w, events, T0 + 100);
    expect(r.state.t).toBe(T0 + 100);
    expect(Object.keys(r.state.orders)).toEqual(['o_1']);
    expect(r.eventsApplied).toBe(1);
  });

  it('staffAt lists assigned on-shift employees in world order', () => {
    const w = miniWorld();
    const s = createState(w);
    applyEvent(s, ev(T0, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }));
    applyEvent(s, ev(T0, 'ASSIGNMENT_CHANGED', 'emp_a', { employee_id: 'emp_a', station_id: 'st_a' }));
    expect(staffAt(w, s, 'st_a')).toEqual(['emp_a']);
  });
});
