// Views unit tests with hand-computed expectations (no fixtures).
import { describe, expect, it } from 'vitest';
import { applyEvent, createState } from '../src/reducer.js';
import { computeMetrics, utilization } from '../src/views.js';
import type { AtlasEvent, World } from '../src/types.js';

function miniWorld(): World {
  return {
    atlas_schema: 'atlas-world/0.1',
    metadata: { id: 'mini', name: 'Mini', version: '0.0.1', domain: 'test' },
    time: { unit: 'second', timezone: 'UTC', origin: '2026-10-06T17:00:00+00:00' },
    entity_types: [{ id: 'station' }, { id: 'equipment' }, { id: 'person' }, { id: 'product' }],
    entities: [
      { id: 'st_a', type: 'station', attrs: { staffing: 'required', per_staff_concurrency: 2, overload_queue: 6, overload_wait_s: 240 } },
      { id: 'eq_a1', type: 'equipment', attrs: { capacity: 4, status: 'OPERATIONAL' } },
      { id: 'emp_a', type: 'person', attrs: { skills: ['a'] } },
      { id: 'prod_x', type: 'product', attrs: { price: 10, process: 'proc_x' } },
    ],
    relationships: [{ type: 'attached_to', from: 'eq_a1', to: 'st_a' }],
    processes: [{ id: 'proc_x', applies_to: 'prod_x', steps: [{ id: 'a', station: 'st_a', duration_s: 60 }] }],
    rules: [],
    initial_state: { clock_in: [], assignments: {}, equipment: {} },
    metrics: [],
    goals: [{ id: 'g_kitchen_time', metric: 'avg_kitchen_time_s', op: '<=', target: 600 }],
  };
}

const T0 = 1791331200;
let seq = 0;
function ev(t: number, type: string, subject: string, data: Record<string, unknown>): AtlasEvent {
  seq++;
  return {
    seq, event_id: `ev_${seq}`, branch: 'history:test', ts: new Date(t * 1000).toISOString(),
    t, type, subject, data,
    provenance: { source: 'test', record_id: `test:${seq}`, record_ts: new Date(t * 1000).toISOString(), claim_class: 'observed', adapter: 'test/0' },
  };
}

describe('utilization', () => {
  it('matches a hand-computed busy/integral case (700/1800 = 0.389)', () => {
    const w = miniWorld();
    const s = createState(w);
    const log = [
      ev(T0, 'EMPLOYEE_CLOCKED_IN', 'emp_a', { employee_id: 'emp_a' }),
      ev(T0, 'ASSIGNMENT_CHANGED', 'emp_a', { employee_id: 'emp_a', station_id: 'st_a' }),
      ev(T0, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }),
      ev(T0 + 100, 'WORK_QUEUED', 'o_1', { work_id: 'w_1', order_id: 'o_1', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }),
      ev(T0 + 100, 'WORK_STARTED', 'o_1', { work_id: 'w_1', station_id: 'st_a' }),
      ev(T0 + 400, 'WORK_COMPLETED', 'o_1', { work_id: 'w_1', station_id: 'st_a' }),
      ev(T0 + 500, 'ORDER_CREATED', 'o_2', { order_id: 'o_2', channel: 'x', items: [{ seq: 1, product_id: 'prod_x' }], total: 10 }),
      ev(T0 + 500, 'WORK_QUEUED', 'o_2', { work_id: 'w_2', order_id: 'o_2', item_seq: 1, station_id: 'st_a', step: 'a', step_index: 0 }),
      ev(T0 + 500, 'WORK_STARTED', 'o_2', { work_id: 'w_2', station_id: 'st_a' }),
    ];
    for (const e of log) applyEvent(s, e);
    // window (T0, T0+900]: effective = min(4, 1*2) = 2 throughout -> integral 1800
    // busy: w_1 300s + w_2 400s (still in progress at t) = 700
    expect(utilization(w, s, 'st_a', T0 + 900, log)).toBe(0.389);
  });

  it('is null when the capacity integral is 0 (no evidence of capacity)', () => {
    const w = miniWorld();
    const s = createState(w);
    expect(utilization(w, s, 'st_a', T0 + 900, [])).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('computes kitchen-time stats over the trailing 15-minute window', () => {
    const w = miniWorld();
    const s = createState(w);
    const log = [
      ev(T0, 'ORDER_CREATED', 'o_1', { order_id: 'o_1', channel: 'x', items: [], total: 10 }),
      ev(T0 + 600, 'ORDER_COMPLETED', 'o_1', { order_id: 'o_1' }), // kitchen time 600
      ev(T0 + 100, 'ORDER_CREATED', 'o_2', { order_id: 'o_2', channel: 'x', items: [], total: 20 }),
      ev(T0 + 800, 'ORDER_COMPLETED', 'o_2', { order_id: 'o_2' }), // kitchen time 700
    ];
    for (const e of log) applyEvent(s, e);
    const t = T0 + 900;
    const m = computeMetrics(w, s, t, log);
    expect(m.orders_open).toBe(0);
    expect(m.orders_completed).toBe(2);
    expect(m.throughput_per_hour).toBe(2);
    expect(m.avg_kitchen_time_s).toBe(650);
    expect(m.p90_kitchen_time_s).toBe(700);
    expect(m.over_target_share).toBe(0.5); // one of two over 600s target
    expect(m.revenue_completed).toBe(30);
  });

  it('returns nulls when no order completed in the window', () => {
    const w = miniWorld();
    const s = createState(w);
    const m = computeMetrics(w, s, T0 + 900, []);
    expect(m.avg_kitchen_time_s).toBeNull();
    expect(m.p90_kitchen_time_s).toBeNull();
    expect(m.over_target_share).toBeNull();
    expect(m.throughput_per_hour).toBe(0);
  });
});
