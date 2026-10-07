#!/usr/bin/env node
// ATLAS restaurant-v0 FIXTURE ORACLE.
//
// This is NOT the ATLAS engine. It is a ~600-line, dependency-free reference
// that turns world.restaurant-v0.json + scenario.fry-rush.json into the
// canonical V0 fixtures:
//
//   raw/*.csv             source-shaped evidence (POS, KDS, staff hub, IoT, notes)
//   normalized/events.ndjson   the normalized ATLAS event ledger (what adapters must produce)
//   snapshots/s1..s4.json      canonical WorldState snapshots (replay + binding fixtures)
//   expected/*.json            branch simulation outputs and the baseline-vs-scenario comparison
//   manifest.json              sha256 of every generated file
//
// Design rule it demonstrates (and that the real engine must keep):
//   ONE state model, ONE reducer. History = evidence-derived events through the
//   reducer. Simulation = the same reducer fed by a scheduler that emits events
//   from the rules. The renderer and the detectors read WorldState only.
//
// Usage:  node generate.mjs            (re)generate fixtures
//         node generate.mjs --check    regenerate in memory and compare with manifest.json
//
// Determinism: integer seconds everywhere, mulberry32 PRNG, stable sort keys.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ORACLE_VERSION = 'oracle-0.1.0';
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const CHECK = process.argv.includes('--check');

const world = JSON.parse(fs.readFileSync(path.join(root, 'world.restaurant-v0.json'), 'utf8'));
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'scenario.fry-rush.json'), 'utf8'));

// ───────────────────────── time ─────────────────────────
const originMs = Date.parse(world.time.origin);
const offsetStr = world.time.origin.slice(-6);            // "-07:00"
const offsetSec = (parseInt(offsetStr.slice(1, 3), 10) * 3600 + parseInt(offsetStr.slice(4, 6), 10) * 60) * (offsetStr[0] === '-' ? -1 : 1);
const T0 = Math.floor(originMs / 1000);
const T_END = Math.floor(Date.parse(world.time.end) / 1000);
const iso = (t) => new Date((t + offsetSec) * 1000).toISOString().replace('.000Z', offsetStr);
const parseISO = (s) => Math.floor(Date.parse(s) / 1000);
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return T0 + ((h - 17) * 3600) + m * 60; };

// ───────────────────────── rng ─────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ───────────────────────── world lookups ─────────────────────────
const ent = Object.fromEntries(world.entities.map(e => [e.id, e]));
const products = world.entities.filter(e => e.type === 'product');
const stations = world.entities.filter(e => e.type === 'station').map(e => e.id);
const procById = Object.fromEntries(world.processes.map(p => [p.id, p]));
const orderProc = procById.proc_order;
const equipmentOf = (st) => world.relationships.filter(r => r.type === 'attached_to' && r.to === st).map(r => r.from);
const rev = {}; for (const [src, m] of Object.entries(world.aliases)) { rev[src] = Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])); }

// ───────────────────────── event ordering ─────────────────────────
const RANK = { EQUIPMENT_STATE_CHANGED: 0, MEASUREMENT_RECORDED: 0, EMPLOYEE_CLOCKED_IN: 1, ASSIGNMENT_CHANGED: 1, HUMAN_REPORT: 2,
  WORK_COMPLETED: 3, ORDER_READY: 4, ORDER_COMPLETED: 5, ORDER_CREATED: 6, WORK_QUEUED: 7, WORK_STARTED: 8 };
const sortKey = (e) => [e.t, RANK[e.type], e.subject, e.data.work_id ?? ''];
function cmpKeys(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }
const byLedgerOrder = (a, b) => cmpKeys(sortKey(a), sortKey(b));

// ───────────────────────── state + reducer ─────────────────────────
function createState() {
  const s = { t: T0, on_shift: {}, assignments: {}, equipment: {}, stations: {}, orders: {}, work: {}, reports: [], measurements: [] };
  for (const st of stations) s.stations[st] = { queue: [], in_progress: [] };
  for (const e of world.entities.filter(e => e.type === 'equipment')) s.equipment[e.id] = { status: e.attrs.status, capacity: e.attrs.capacity, nominal_capacity: e.attrs.capacity };
  for (const e of world.entities.filter(e => e.type === 'person')) { s.on_shift[e.id] = false; s.assignments[e.id] = null; }
  return s;
}

function queueInsert(s, st, workId) {
  const q = s.stations[st].queue;
  const key = (w) => [s.work[w].queued_t, s.orders[s.work[w].order_id].created_t, w];
  q.push(workId);
  q.sort((a, b) => cmpKeys(key(a), key(b)));
}

function applyEvent(s, e) {
  s.t = e.t;
  const d = e.data;
  switch (e.type) {
    case 'EMPLOYEE_CLOCKED_IN': s.on_shift[d.employee_id] = true; break;
    case 'ASSIGNMENT_CHANGED': s.assignments[d.employee_id] = d.station_id; break;
    case 'EQUIPMENT_STATE_CHANGED': s.equipment[d.equipment_id].status = d.status; s.equipment[d.equipment_id].capacity = d.capacity; break;
    case 'MEASUREMENT_RECORDED': s.measurements.push({ t: e.t, subject: e.subject, metric: d.metric, value: d.value }); break;
    case 'HUMAN_REPORT': s.reports.push({ t: e.t, about: d.about, reporter: d.reporter, text: d.text }); break;
    case 'ORDER_CREATED': s.orders[d.order_id] = { state: 'OPEN', created_t: e.t, ready_t: null, completed_t: null, channel: d.channel, items: d.items, total: d.total }; break;
    case 'WORK_QUEUED': s.work[d.work_id] = { order_id: d.order_id, item_seq: d.item_seq, station_id: d.station_id, step: d.step, state: 'QUEUED', queued_t: e.t, started_t: null, completed_t: null }; queueInsert(s, d.station_id, d.work_id); break;
    case 'WORK_STARTED': { const w = s.work[d.work_id]; const st = s.stations[w.station_id]; st.queue.splice(st.queue.indexOf(d.work_id), 1); st.in_progress.push(d.work_id); w.state = 'IN_PROGRESS'; w.started_t = e.t; break; }
    case 'WORK_COMPLETED': { const w = s.work[d.work_id]; const st = s.stations[w.station_id]; st.in_progress.splice(st.in_progress.indexOf(d.work_id), 1); w.state = 'DONE'; w.completed_t = e.t; break; }
    case 'ORDER_READY': s.orders[d.order_id].state = 'READY'; s.orders[d.order_id].ready_t = e.t; break;
    case 'ORDER_COMPLETED': s.orders[d.order_id].state = 'COMPLETED'; s.orders[d.order_id].completed_t = e.t; break;
    default: throw new Error('unknown event type ' + e.type);
  }
}

// derived (never stored as fact): capacity, status, metrics
function staffAt(s, st) { return Object.entries(s.assignments).filter(([emp, a]) => a === st && s.on_shift[emp]).map(([emp]) => emp); }
function capacity(s, st) {
  const attrs = ent[st].attrs;
  const eqCap = equipmentOf(st).reduce((sum, eq) => sum + (s.equipment[eq].status === 'DOWN' ? 0 : s.equipment[eq].capacity), 0);
  const staff = staffAt(s, st);
  if (attrs.staffing === 'required' && staff.length === 0) return { equipment: eqCap, staff: 0, effective: 0 };
  const staffCap = staff.length * attrs.per_staff_concurrency;
  const eqs = equipmentOf(st);
  return { equipment: eqs.length ? eqCap : staffCap, staff: staffCap, effective: eqs.length ? Math.min(eqCap, staffCap) : staffCap };
}
function stationStatus(s, st, t) {
  const a = ent[st].attrs, S = s.stations[st], cap = capacity(s, st);
  const oldest = S.queue.length ? t - s.work[S.queue[0]].queued_t : 0;
  if (cap.effective === 0 && S.queue.length > 0) return 'UNSTAFFED';
  if (S.queue.length >= a.overload_queue || oldest >= a.overload_wait_s) return 'OVERLOADED';
  if (cap.effective > 0 && S.in_progress.length >= cap.effective) return 'BUSY';
  return 'NORMAL';
}

// ───────────────────────── scheduler (simulation = reducer + this) ─────────────────────────
function itemsNeedingWork(order) { return order.items.filter(it => ent[it.product_id].attrs.process); }
function stepsFor(it) { return procById[ent[it.product_id].attrs.process].steps; }

function makeEngine(s, { durationOf, emit }) {
  const timers = []; // {t, kind:'complete'|'handoff', work_id|order_id}
  const itemDone = {}; // order_id -> Set(item_seq)
  const work = (order_id, seq, step) => `w_${order_id.slice(2)}_${seq}_${step}`;

  function push(e) { emit(e); applyEvent(s, e); }
  function queueStep(t, order_id, it, stepIdx) {
    const step = stepsFor(it)[stepIdx];
    push({ t, type: 'WORK_QUEUED', subject: order_id, data: { work_id: work(order_id, it.seq, step.id), order_id, item_seq: it.seq, station_id: step.station, step: step.id, step_index: stepIdx } });
  }
  function queuePass(t, order_id) {
    push({ t, type: 'WORK_QUEUED', subject: order_id, data: { work_id: work(order_id, 0, 'pass'), order_id, item_seq: 0, station_id: orderProc.steps[0].station, step: 'pass', step_index: 0 } });
  }
  function onOrderCreated(t, e) {
    const o = s.orders[e.data.order_id];
    itemDone[e.data.order_id] = new Set();
    const need = itemsNeedingWork(o);
    if (need.length === 0) queuePass(t, e.data.order_id); else for (const it of need) queueStep(t, e.data.order_id, it, 0);
  }
  function onWorkCompleted(t, work_id) {
    const w = s.work[work_id]; const o = s.orders[w.order_id];
    if (w.step === 'pass') {
      push({ t, type: 'ORDER_READY', subject: w.order_id, data: { order_id: w.order_id } });
      timers.push({ t: t + orderProc.handoff_s, kind: 'handoff', order_id: w.order_id });
      return;
    }
    const it = o.items.find(i => i.seq === w.item_seq);
    const steps = stepsFor(it); const idx = steps.findIndex(st => st.id === w.step);
    if (idx + 1 < steps.length) queueStep(t, w.order_id, it, idx + 1);
    else { itemDone[w.order_id].add(w.item_seq); if (itemDone[w.order_id].size === itemsNeedingWork(o).length) queuePass(t, w.order_id); }
  }
  function dispatch(t) {
    for (const st of stations) {
      const S = s.stations[st];
      while (S.queue.length && S.in_progress.length < capacity(s, st).effective) {
        const work_id = S.queue[0]; const w = s.work[work_id];
        const o = s.orders[w.order_id];
        const nominal = w.step === 'pass' ? orderProc.steps[0].duration_s : stepsFor(o.items.find(i => i.seq === w.item_seq))[w.step_index ?? stepsFor(o.items.find(i => i.seq === w.item_seq)).findIndex(x => x.id === w.step)].duration_s;
        push({ t, type: 'WORK_STARTED', subject: w.order_id, data: { work_id, station_id: st } });
        timers.push({ t: t + durationOf(nominal, work_id), kind: 'complete', work_id });
      }
    }
  }
  // adopt in-progress work from a branched state (completes at max(now, started + nominal))
  function adoptInProgress(now) {
    for (const [order_id, o] of Object.entries(s.orders)) {
      if (o.state === 'COMPLETED') continue;
      itemDone[order_id] = new Set();
      for (const it of itemsNeedingWork(o)) { const last = stepsFor(it).at(-1); const w = s.work[work(order_id, it.seq, last.id)]; if (w && w.state === 'DONE') itemDone[order_id].add(it.seq); }
      if (o.state === 'READY') timers.push({ t: Math.max(now, o.ready_t + orderProc.handoff_s), kind: 'handoff', order_id });
    }
    for (const [work_id, w] of Object.entries(s.work)) {
      if (w.state !== 'IN_PROGRESS') continue;
      const o = s.orders[w.order_id];
      const nominal = w.step === 'pass' ? orderProc.steps[0].duration_s : stepsFor(o.items.find(i => i.seq === w.item_seq)).find(x => x.id === w.step).duration_s;
      timers.push({ t: Math.max(now, w.started_t + nominal), kind: 'complete', work_id });
    }
  }
  function run({ from, until, arrivals, scheduled }) {
    const external = [...arrivals, ...scheduled].filter(e => e.t >= from && e.t <= until).sort(byLedgerOrder);
    let ei = 0, t = from;
    dispatch(t);
    while (true) {
      timers.sort((a, b) => a.t - b.t || (a.kind > b.kind ? 1 : -1) || ((a.work_id ?? a.order_id) > (b.work_id ?? b.order_id) ? 1 : -1));
      const nextTimer = timers.length ? timers[0].t : Infinity;
      const nextExt = ei < external.length ? external[ei].t : Infinity;
      t = Math.min(nextTimer, nextExt);
      if (t === Infinity || t > until) break;
      // completions first, then external events (equipment/assignments/arrivals) in rank order, then dispatch
      while (timers.length && timers[0].t === t) {
        const tm = timers.shift();
        if (tm.kind === 'complete') { push({ t, type: 'WORK_COMPLETED', subject: s.work[tm.work_id].order_id, data: { work_id: tm.work_id, station_id: s.work[tm.work_id].station_id } }); onWorkCompleted(t, tm.work_id); }
        else push({ t, type: 'ORDER_COMPLETED', subject: tm.order_id, data: { order_id: tm.order_id } });
        timers.sort((a, b) => a.t - b.t);
      }
      while (ei < external.length && external[ei].t === t) { const e = external[ei++]; push(e); if (e.type === 'ORDER_CREATED') onOrderCreated(t, e); }
      dispatch(t);
    }
    s.t = until;
  }
  return { run, adoptInProgress };
}

// ───────────────────────── metrics ─────────────────────────
function pct(sorted, p) { if (!sorted.length) return null; const k = Math.max(1, Math.ceil(p * sorted.length)); return sorted[k - 1]; }
function utilization(s, st, t, log) {
  // busy slot-seconds over window / integral of effective capacity over window; capacity is piecewise constant between events.
  const w0 = t - 900;
  let busy = 0;
  for (const w of Object.values(s.work)) { if (w.station_id !== st || w.started_t == null) continue; const a = Math.max(w.started_t, w0), b = Math.min(w.completed_t ?? t, t); if (b > a) busy += b - a; }
  // capacity integral: replay capacity-affecting events in window
  const caps = []; const tmp = createState();
  let last = w0, integral = 0, capNow = 0;
  for (const e of log) {
    if (e.t > t) break;
    if (['EMPLOYEE_CLOCKED_IN', 'ASSIGNMENT_CHANGED', 'EQUIPMENT_STATE_CHANGED'].includes(e.type)) {
      if (e.t > w0) { integral += capNow * (e.t - last); last = e.t; }
      applyEvent(tmp, e); capNow = capacity(tmp, st).effective;
    }
  }
  integral += capNow * (t - last);
  return integral > 0 ? +(busy / integral).toFixed(3) : null;
}
function metrics(s, t, log) {
  const orders = Object.values(s.orders);
  const done15 = orders.filter(o => o.completed_t != null && o.completed_t > t - 900 && o.completed_t <= t);
  const kt = done15.map(o => o.completed_t - o.created_t).sort((a, b) => a - b);
  const target = world.goals.find(g => g.id === 'g_kitchen_time').target;
  const m = {
    orders_open: orders.filter(o => o.state !== 'COMPLETED').length,
    orders_completed: orders.filter(o => o.state === 'COMPLETED').length,
    throughput_per_hour: orders.filter(o => o.completed_t != null && o.completed_t > t - 3600 && o.completed_t <= t).length,
    avg_kitchen_time_s: kt.length ? Math.round(kt.reduce((a, b) => a + b, 0) / kt.length) : null,
    p90_kitchen_time_s: pct(kt, 0.9),
    over_target_share: kt.length ? +(kt.filter(x => x > target).length / kt.length).toFixed(2) : null,
    revenue_completed: +orders.filter(o => o.state === 'COMPLETED').reduce((a, o) => a + o.total, 0).toFixed(2),
    stations: {}
  };
  for (const st of stations) {
    const S = s.stations[st]; const cap = capacity(s, st);
    m.stations[st] = { queue_len: S.queue.length, in_progress: S.in_progress.length, oldest_wait_s: S.queue.length ? t - s.work[S.queue[0]].queued_t : 0,
      capacity: cap, staff: staffAt(s, st), status: stationStatus(s, st, t), utilization: utilization(s, st, t, log) };
  }
  return m;
}

// ───────────────────────── diagnosis (V0.2 logic, deterministic) ─────────────────────────
function diagnose(s, t, m, log) {
  const over = stations.filter(st => m.stations[st].status === 'OVERLOADED' || m.stations[st].status === 'UNSTAFFED');
  if (!over.length) return { bottleneck: null, claim_class: 'derived', summary: 'No station is overloaded.' };
  const st = over.sort((a, b) => m.stations[b].oldest_wait_s - m.stations[a].oldest_wait_s)[0];
  // when did it start: last transition into OVERLOADED (scan state over log)
  const tmp = createState(); let since = null, prev = 'NORMAL';
  for (const e of log) { if (e.t > t) break; applyEvent(tmp, e); const st2 = stationStatus(tmp, st, e.t); if (st2 === 'OVERLOADED' && prev !== 'OVERLOADED') since = e.t; if (st2 !== 'OVERLOADED') since = null; prev = st2; }
  const cap = m.stations[st].capacity;
  const binding = cap.effective === 0 ? 'staffing' : (cap.staff < cap.equipment ? 'staffing' : (cap.staff > cap.equipment ? 'equipment' : 'both'));
  const affected = s.stations[st].queue.map(w => s.work[w].order_id).filter((v, i, a) => a.indexOf(v) === i);
  const degraded = equipmentOf(st).filter(eq => s.equipment[eq].status !== 'OPERATIONAL');
  return {
    claim_class: 'derived', bottleneck: st, since_t: since, since: since ? iso(since) : null,
    queue_len: m.stations[st].queue_len, oldest_wait_s: m.stations[st].oldest_wait_s, utilization_15m: m.stations[st].utilization,
    capacity: cap, binding_constraint: binding, affected_orders: affected,
    degraded_equipment: degraded.map(eq => ({ id: eq, status: s.equipment[eq].status, capacity: s.equipment[eq].capacity, nominal_capacity: s.equipment[eq].nominal_capacity, binding: cap.equipment <= cap.staff })),
    downstream: stations.filter(x => x !== st).map(x => ({ station: x, queue_len: m.stations[x].queue_len, status: m.stations[x].status })),
    summary: `${ent[st].name} is OVERLOADED since ${since ? iso(since).slice(11, 19) : '?'}: queue ${m.stations[st].queue_len}, oldest wait ${m.stations[st].oldest_wait_s}s, effective capacity ${cap.effective} bound by ${binding}${degraded.length ? ` (${degraded.join(', ')} ${s.equipment[degraded[0]].status} but not binding)` : ''}.`
  };
}

// ───────────────────────── history generation (ground truth with seeded jitter) ─────────────────────────
function generateArrivals(rng, dayLabel) {
  const mix = world.arrival_model.order_mix; const arrivals = []; let n = 0;
  const pick = (table) => { const r = rng(); let acc = 0; for (const [k, p] of Object.entries(table)) { acc += p; if (r < acc) return k; } return Object.keys(table).at(-1); };
  for (const seg of world.arrival_model.segments) {
    let t = clock(seg.from); const end = clock(seg.to); const rate = seg.orders_per_hour / 3600;
    t += Math.round(-Math.log(1 - rng()) / rate);
    while (t < end) {
      n++; const order_id = `o_${String(n).padStart(4, '0')}`; const items = []; let seq = 1;
      items.push({ seq: seq++, product_id: pick(mix.mains) });
      if (rng() < mix.second_main_p) items.push({ seq: seq++, product_id: pick(mix.mains) });
      if (rng() < mix.fries_p) items.push({ seq: seq++, product_id: 'prod_fries' });
      if (rng() < mix.drink_p) items.push({ seq: seq++, product_id: 'prod_drink' });
      const total = +items.reduce((a, it) => a + ent[it.product_id].attrs.price, 0).toFixed(2);
      arrivals.push({ t, type: 'ORDER_CREATED', subject: order_id, data: { order_id, channel: pick(mix.channel), items, total } });
      t += Math.round(-Math.log(1 - rng()) / rate);
    }
  }
  return arrivals;
}

function historyExternalEvents(day) {
  const ev = [];
  for (const emp of world.initial_state.clock_in) ev.push({ t: T0, type: 'EMPLOYEE_CLOCKED_IN', subject: emp, data: { employee_id: emp } });
  for (const [emp, st] of Object.entries(world.initial_state.assignments)) if (st) ev.push({ t: T0, type: 'ASSIGNMENT_CHANGED', subject: emp, data: { employee_id: emp, station_id: st, reason: 'shift_start' } });
  // fryer 2 telemetry then degradation (both days)
  const tDeg = clock('18:02') + 14;
  ev.push({ t: clock('17:58') + 5, type: 'MEASUREMENT_RECORDED', subject: 'eq_fryer_2', data: { metric: 'oil_temp_f', value: 351 } });
  ev.push({ t: clock('18:00') + 40, type: 'MEASUREMENT_RECORDED', subject: 'eq_fryer_2', data: { metric: 'oil_temp_f', value: 338 } });
  ev.push({ t: clock('18:01') + 40, type: 'MEASUREMENT_RECORDED', subject: 'eq_fryer_2', data: { metric: 'oil_temp_f', value: 306 } });
  ev.push({ t: tDeg, type: 'EQUIPMENT_STATE_CHANGED', subject: 'eq_fryer_2', data: { equipment_id: 'eq_fryer_2', status: 'DEGRADED', capacity: 2, detail: 'right bay heating fault, one basket usable' } });
  ev.push({ t: clock('18:04') + 30, type: 'HUMAN_REPORT', subject: 'eq_fryer_2', data: { about: 'eq_fryer_2', reporter: 'emp_03', text: 'Fryer 2 right bay not heating, running the left basket only.' } });
  if (day === 2) { // Wednesday: the manager actually makes the move (calibration day)
    ev.push({ t: clock('18:20'), type: 'ASSIGNMENT_CHANGED', subject: 'emp_04', data: { employee_id: 'emp_04', station_id: 'st_fry', reason: 'manager_reassignment' } });
    ev.push({ t: clock('19:30'), type: 'ASSIGNMENT_CHANGED', subject: 'emp_04', data: { employee_id: 'emp_04', station_id: 'st_prep', reason: 'manager_reassignment' } });
  }
  return ev;
}

function generateHistory(day, seed) {
  const rng = mulberry32(seed);
  const arrivals = generateArrivals(rng, day);
  const jitterRng = mulberry32(seed + 1000);
  const log = [];
  const s = createState();
  const eng = makeEngine(s, { durationOf: (nominal) => Math.max(15, Math.round(nominal * (0.8 + 0.45 * jitterRng()))), emit: (e) => log.push({ ...e }) });
  eng.run({ from: T0, until: T_END, arrivals, scheduled: historyExternalEvents(day) });
  return log.sort(byLedgerOrder);
}

// ───────────────────────── raw source writers (what adapters will read) ─────────────────────────
const CODE = { st_prep: 'PREP', st_grill: 'GRILL', st_fry: 'FRY', st_pass: 'PASS' };
function writeRaw(dir, log) {
  const orders = {}; const kds = []; const staff = []; const iot = []; const notes = [];
  for (const e of log) {
    const d = e.data;
    switch (e.type) {
      case 'ORDER_CREATED': orders[d.order_id] = { order_no: d.order_id.slice(2), opened_at: iso(e.t), channel: d.channel, items: d.items.map(i => rev.pos[i.product_id]).join(';'), total: d.total.toFixed(2), closed_at: '' }; break;
      case 'ORDER_COMPLETED': orders[d.order_id].closed_at = iso(e.t); break;
      case 'WORK_QUEUED': kds.push([`${d.order_id.slice(2)}-${d.item_seq}-${CODE[d.station_id]}`, d.order_id.slice(2), d.item_seq, CODE[d.station_id], 'FIRED', iso(e.t)]); break;
      case 'WORK_STARTED': { const w = d.work_id.split('_'); kds.push([`${w[1]}-${w[2]}-${CODE[d.station_id]}`, w[1], w[2], CODE[d.station_id], 'STARTED', iso(e.t)]); break; }
      case 'WORK_COMPLETED': { const w = d.work_id.split('_'); kds.push([`${w[1]}-${w[2]}-${CODE[d.station_id]}`, w[1], w[2], CODE[d.station_id], 'BUMPED', iso(e.t)]); break; }
      case 'EMPLOYEE_CLOCKED_IN': staff.push([rev.staffhub[d.employee_id], 'CLOCK_IN', '', iso(e.t)]); break;
      case 'ASSIGNMENT_CHANGED': staff.push([rev.staffhub[d.employee_id], 'ASSIGN', rev.staffhub[d.station_id], iso(e.t)]); break;
      case 'MEASUREMENT_RECORDED': iot.push([rev.iot[e.subject], iso(e.t), 'TEMP', String(d.value)]); break;
      case 'EQUIPMENT_STATE_CHANGED': iot.push([rev.iot[d.equipment_id], iso(e.t), 'STATE', `${d.status};baskets=${d.capacity};${d.detail}`]); break;
      case 'HUMAN_REPORT': notes.push([iso(e.t), rev.staffhub[d.reporter], rev.iot[d.about], d.text]); break;
    }
  }
  const csv = (rows) => rows.map(r => r.map(v => (String(v).includes(',') ? `"${v}"` : v)).join(',')).join('\n') + '\n';
  return {
    'pos_orders.csv': csv([['order_no', 'opened_at', 'channel', 'items', 'total', 'closed_at'], ...Object.values(orders).map(o => [o.order_no, o.opened_at, o.channel, o.items, o.total, o.closed_at])]),
    'kds_tickets.csv': csv([['ticket_id', 'order_no', 'item_seq', 'station', 'event', 'ts'], ...kds]),
    'staff_events.csv': csv([['badge', 'event', 'station', 'ts'], ...staff]),
    'equipment_events.csv': csv([['device', 'ts', 'event', 'detail'], ...iot]),
    'shift_notes.csv': csv([['ts', 'reporter', 'about', 'text'], ...notes]),
  };
}

// ───────────────────────── normalizer (raw → ATLAS events with provenance); independent of the engine ─────────────────────────
const ADAPTER = { pos: 'adapter.pos-csv/0.1', kds: 'adapter.kds-csv/0.1', staffhub: 'adapter.staffhub-csv/0.1', iot: 'adapter.iot-csv/0.1', notes: 'adapter.shift-notes-csv/0.1' };
function parseCsv(text) { const [h, ...rows] = text.trim().split('\n'); const hd = h.split(','); return rows.map(r => { const cells = r.match(/("([^"]*)"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '')); return Object.fromEntries(hd.map((k, i) => [k, cells[i] ?? ''])); }); }
function normalize(raw, branch) {
  const out = [];
  const prov = (source, record_id, record_ts, claim_class = 'observed', parent = undefined) => ({ source, record_id, record_ts, claim_class, adapter: ADAPTER[source], ...(parent ? { derived_from: parent } : {}) });
  for (const r of parseCsv(raw['pos_orders.csv'])) {
    const order_id = `o_${r.order_no}`; const items = r.items.split(';').map((c, i) => ({ seq: i + 1, product_id: world.aliases.pos[c] }));
    out.push({ t: parseISO(r.opened_at), type: 'ORDER_CREATED', subject: order_id, data: { order_id, channel: r.channel, items, total: +r.total }, provenance: prov('pos', `pos:${r.order_no}:opened`, r.opened_at) });
    if (r.closed_at) out.push({ t: parseISO(r.closed_at), type: 'ORDER_COMPLETED', subject: order_id, data: { order_id }, provenance: prov('pos', `pos:${r.order_no}:closed`, r.closed_at) });
  }
  const productOf = {}; for (const e of out) if (e.type === 'ORDER_CREATED') for (const it of e.data.items) productOf[`${e.data.order_id}:${it.seq}`] = it.product_id;
  for (const r of parseCsv(raw['kds_tickets.csv'])) {
    const order_id = `o_${r.order_no}`; const station_id = world.aliases.kds[r.station]; const seq = +r.item_seq;
    const step = r.station === 'PASS' ? 'pass' : procById[ent[productOf[`${order_id}:${seq}`]].attrs.process].steps.find(st => st.station === station_id).id;
    const work_id = `w_${r.order_no}_${seq}_${step}`; const rid = `kds:${r.ticket_id}:${r.event}`;
    if (r.event === 'FIRED') { const step_index = r.station === 'PASS' ? 0 : procById[ent[productOf[`${order_id}:${seq}`]].attrs.process].steps.findIndex(st => st.id === step); out.push({ t: parseISO(r.ts), type: 'WORK_QUEUED', subject: order_id, data: { work_id, order_id, item_seq: seq, station_id, step, step_index }, provenance: prov('kds', rid, r.ts) }); }
    if (r.event === 'STARTED') out.push({ t: parseISO(r.ts), type: 'WORK_STARTED', subject: order_id, data: { work_id, station_id }, provenance: prov('kds', rid, r.ts) });
    if (r.event === 'BUMPED') {
      out.push({ t: parseISO(r.ts), type: 'WORK_COMPLETED', subject: order_id, data: { work_id, station_id }, provenance: prov('kds', rid, r.ts) });
      if (r.station === 'PASS') out.push({ t: parseISO(r.ts), type: 'ORDER_READY', subject: order_id, data: { order_id }, provenance: prov('kds', rid, r.ts, 'derived', [rid]) });
    }
  }
  for (const r of parseCsv(raw['staff_events.csv'])) {
    const employee_id = world.aliases.staffhub[r.badge];
    if (r.event === 'CLOCK_IN') out.push({ t: parseISO(r.ts), type: 'EMPLOYEE_CLOCKED_IN', subject: employee_id, data: { employee_id }, provenance: prov('staffhub', `staffhub:${r.badge}:${r.ts}:CLOCK_IN`, r.ts) });
    if (r.event === 'ASSIGN') out.push({ t: parseISO(r.ts), type: 'ASSIGNMENT_CHANGED', subject: employee_id, data: { employee_id, station_id: world.aliases.staffhub[r.station], reason: parseISO(r.ts) === T0 ? 'shift_start' : 'manager_reassignment' }, provenance: prov('staffhub', `staffhub:${r.badge}:${r.ts}:ASSIGN`, r.ts) });
  }
  for (const r of parseCsv(raw['equipment_events.csv'])) {
    const equipment_id = world.aliases.iot[r.device]; const rid = `iot:${r.device}:${r.ts}:${r.event}`;
    if (r.event === 'TEMP') out.push({ t: parseISO(r.ts), type: 'MEASUREMENT_RECORDED', subject: equipment_id, data: { metric: 'oil_temp_f', value: +r.detail }, provenance: prov('iot', rid, r.ts) });
    if (r.event === 'STATE') { const [status, baskets, detail] = r.detail.split(';'); out.push({ t: parseISO(r.ts), type: 'EQUIPMENT_STATE_CHANGED', subject: equipment_id, data: { equipment_id, status, capacity: +baskets.split('=')[1], detail }, provenance: prov('iot', rid, r.ts) }); }
  }
  for (const r of parseCsv(raw['shift_notes.csv'])) {
    out.push({ t: parseISO(r.ts), type: 'HUMAN_REPORT', subject: world.aliases.iot[r.about], data: { about: world.aliases.iot[r.about], reporter: world.aliases.staffhub[r.reporter], text: r.text }, provenance: prov('notes', `notes:${r.ts}:${r.reporter}`, r.ts, 'human_reported') });
  }
  out.sort(byLedgerOrder);
  return out.map((e, i) => ({ seq: i + 1, event_id: `ev_${branch}_${String(i + 1).padStart(6, '0')}`, branch, ts: iso(e.t), t: e.t, type: e.type, subject: e.subject, data: e.data, provenance: e.provenance }));
}

// ───────────────────────── snapshots ─────────────────────────
function sha256(x) { return crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex'); }
function reduceTo(log, t) { const s = createState(); let n = 0; for (const e of log) { if (e.t > t) break; applyEvent(s, e); n++; } s.t = t; return { s, n }; }
function snapshot({ id, log, t, branch, mode, claim_class, title, narrative }) {
  const { s, n } = reduceTo(log, t);
  const m = metrics(s, t, log);
  const diag = diagnose(s, t, m, log);
  const openOrders = Object.entries(s.orders).filter(([, o]) => o.state !== 'COMPLETED').map(([id, o]) => ({ id, state: o.state, created: iso(o.created_t), age_s: t - o.created_t, items: o.items.map(i => i.product_id), total: o.total }));
  const workOpen = Object.entries(s.work).filter(([, w]) => w.state !== 'DONE').map(([id, w]) => ({ id, order_id: w.order_id, station_id: w.station_id, step: w.step, state: w.state, queued: iso(w.queued_t), started: w.started_t ? iso(w.started_t) : null }));
  // evidence for the Fry station's state at t: everything about its equipment and staffing, plus the records that queued/started the work currently there.
  const fryWork = new Set([...s.stations.st_fry.queue, ...s.stations.st_fry.in_progress]);
  const fryStaff = new Set(staffAt(s, 'st_fry'));
  const evidence = log.filter(e => e.t <= t && e.provenance && (
    equipmentOf('st_fry').includes(e.subject) ||
    (e.type === 'ASSIGNMENT_CHANGED' && (fryStaff.has(e.subject) || e.data.station_id === 'st_fry')) ||
    ((e.type === 'WORK_QUEUED' || e.type === 'WORK_STARTED') && fryWork.has(e.data.work_id))
  )).map(e => ({ event_id: e.event_id, type: e.type, ts: e.ts, ...e.provenance }));
  const state = {
    t, ts: iso(t), ledger_events_applied: n,
    employees: Object.fromEntries(Object.keys(s.assignments).map(emp => [emp, { on_shift: s.on_shift[emp], station: s.assignments[emp] }])),
    equipment: s.equipment,
    stations: Object.fromEntries(stations.map(st => [st, { status: m.stations[st].status, staff: m.stations[st].staff, capacity: m.stations[st].capacity, queue: s.stations[st].queue, in_progress: s.stations[st].in_progress }])),
    orders_open: openOrders, work_open: workOpen,
    reports: s.reports.filter(r => r.t <= t).map(r => ({ ...r, ts: iso(r.t) })),
    last_measurements: Object.fromEntries(s.measurements.filter(x => x.t <= t).map(x => [x.subject + ':' + x.metric, { value: x.value, ts: iso(x.t) }])),
  };
  const snap = { atlas_schema: 'atlas-snapshot/0.1', id, title, world: world.metadata.id, branch, mode, claim_class, t, ts: iso(t), engine: ORACLE_VERSION, narrative, state, metrics: m, diagnosis: diag, evidence_refs: evidence };
  snap.state_hash = sha256(JSON.stringify({ state: snap.state, metrics: snap.metrics }));
  return snap;
}

// ───────────────────────── branch simulation ─────────────────────────
function runBranch(historyLog, interventions, branchId) {
  const tB = parseISO(scenario.base.t), tH = parseISO(scenario.horizon);
  const { s } = reduceTo(historyLog, tB);
  const simLog = historyLog.filter(e => e.t <= tB).map(e => ({ ...e }));   // shared prefix (history)
  const branchEvents = [];
  const eng = makeEngine(s, { durationOf: (nominal) => nominal, emit: (e) => branchEvents.push({ ...e }) });
  eng.adoptInProgress(tB);
  const arrivals = historyLog.filter(e => e.type === 'ORDER_CREATED' && e.t > tB && e.t <= tH).map(e => ({ t: e.t, type: e.type, subject: e.subject, data: e.data }));
  const scheduled = interventions.map(iv => ({ t: parseISO(iv.at), type: 'ASSIGNMENT_CHANGED', subject: iv.employee, data: { employee_id: iv.employee, station_id: iv.to, reason: `intervention:${iv.id}` } }));
  eng.run({ from: tB, until: tH, arrivals, scheduled });
  branchEvents.sort(byLedgerOrder);
  const simEvents = branchEvents.map((e, i) => ({ seq: simLog.length + i + 1, event_id: `ev_${branchId}_${String(i + 1).padStart(6, '0')}`, branch: branchId, ts: iso(e.t), t: e.t, type: e.type, subject: e.subject, data: e.data,
    provenance: { source: 'simulation', record_id: `${branchId}:${i + 1}`, record_ts: iso(e.t), claim_class: e.type === 'ORDER_CREATED' ? 'observed' : 'simulated', adapter: ORACLE_VERSION, ...(e.type === 'ORDER_CREATED' ? { note: 'historical arrival replayed into the branch' } : {}) } }));
  return { log: [...simLog, ...simEvents], events_generated: simEvents.length, tB, tH };
}
function windowMetrics(log, tB, tH) {
  const { s } = reduceTo(log, tH);
  const inWin = Object.values(s.orders).filter(o => o.created_t > tB && o.created_t <= tH);
  const done = inWin.filter(o => o.completed_t != null && o.completed_t <= tH);
  const kt = done.map(o => o.completed_t - o.created_t).sort((a, b) => a - b);
  const target = world.goals.find(g => g.id === 'g_kitchen_time').target;
  // max fry queue and time overloaded
  const tmp = createState(); let maxQ = { st_fry: 0, st_prep: 0 }, overloaded_s = { st_fry: 0, st_prep: 0 }, lastT = tB, lastStatus = {};
  for (const e of log) { if (e.t > tH) break; if (e.t > tB) { for (const st of ['st_fry', 'st_prep']) if (lastStatus[st] === 'OVERLOADED') overloaded_s[st] += e.t - lastT; lastT = e.t; } applyEvent(tmp, e); if (e.t >= tB) for (const st of ['st_fry', 'st_prep']) { maxQ[st] = Math.max(maxQ[st], tmp.stations[st].queue.length); lastStatus[st] = stationStatus(tmp, st, e.t); } }
  for (const st of ['st_fry', 'st_prep']) if (lastStatus[st] === 'OVERLOADED') overloaded_s[st] += tH - lastT;
  const delayMin = done.reduce((a, o) => a + Math.max(0, (o.completed_t - o.created_t) - target) / 60, 0);
  const rate = world.economics.delay_cost_per_order_minute_over_target.value;
  return {
    window: { from: iso(tB), to: iso(tH), minutes: (tH - tB) / 60 },
    orders_arrived: inWin.length, orders_completed: done.length, orders_open_at_horizon: inWin.length - done.length,
    throughput_per_hour: +(done.length / ((tH - tB) / 3600)).toFixed(1),
    avg_kitchen_time_s: kt.length ? Math.round(kt.reduce((a, b) => a + b, 0) / kt.length) : null,
    p90_kitchen_time_s: pct(kt, 0.9), max_kitchen_time_s: kt.at(-1) ?? null,
    over_target_share: kt.length ? +(kt.filter(x => x > target).length / kt.length).toFixed(2) : null,
    max_queue: maxQ, overloaded_seconds: overloaded_s,
    fry_utilization_at_horizon_15m: metrics(s, tH, log).stations.st_fry.utilization, prep_utilization_at_horizon_15m: metrics(s, tH, log).stations.st_prep.utilization,
    revenue_completed_in_window: +done.reduce((a, o) => a + o.total, 0).toFixed(2),
    revenue_open_at_horizon: +(inWin.length - done.length ? inWin.filter(o => !(o.completed_t != null && o.completed_t <= tH)).reduce((a, o) => a + o.total, 0) : 0).toFixed(2),
    delay_minutes_over_target: +delayMin.toFixed(1),
    delay_cost_assumed: { value: +(delayMin * rate).toFixed(2), claim_class: 'assumed', basis: `${rate} USD per order-minute over ${target}s target` },
    labor_cost_in_window: +(Object.values(s.on_shift).filter(Boolean).length ? world.entities.filter(e => e.type === 'person').reduce((a, p) => a + world.economics.labor_cost_per_hour[p.attrs.role], 0) * ((tH - tB) / 3600) : 0).toFixed(2),
  };
}

// ───────────────────────── main ─────────────────────────
function main() {
  const files = {};
  const put = (rel, content) => { files[rel] = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n'; };

  // DAY 1 (Tuesday, demo day): generate truth, derive raw, normalize raw, assert equality
  const truth1 = generateHistory(1, 20261006);
  const raw1 = writeRaw('raw', truth1);
  for (const [name, text] of Object.entries(raw1)) put(`raw/${name}`, text);
  const ledger1 = normalize(raw1, 'history:day1');
  const strip = (e) => JSON.stringify({ t: e.t, type: e.type, subject: e.subject, data: e.data });
  { const i = ledger1.findIndex((e, i) => strip(e) !== strip(truth1[i])); if (ledger1.length !== truth1.length || i >= 0) { console.error("len", ledger1.length, truth1.length, "first mismatch", i, "\nL:", strip(ledger1[i]), "\nT:", strip(truth1[i])); throw new Error("normalizer does not reproduce engine truth (day1)"); } }
  put('normalized/events.ndjson', ledger1.map(e => JSON.stringify(e)).join('\n') + '\n');

  // DAY 2 (Wednesday, calibration day): manager really made the move
  const truth2 = generateHistory(2, 20261007);
  const raw2 = writeRaw('raw', truth2);
  for (const [name, text] of Object.entries(raw2)) put(`day2/raw/${name}`, text);
  const ledger2 = normalize(raw2, 'history:day2');
  if (ledger2.length !== truth2.length || ledger2.some((e, i) => strip(e) !== strip(truth2[i]))) throw new Error('normalizer does not reproduce engine truth (day2)');
  put('day2/normalized/events.ndjson', ledger2.map(e => JSON.stringify(e)).join('\n') + '\n');

  // snapshots from the normalized ledger (replay fixtures)
  const S = [
    snapshot({ id: 's1_normal', title: 'Normal operation', log: ledger1, t: clock('17:45'), branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: 'Early dinner. Every station NORMAL or BUSY, no queue older than the overload threshold, both fryers operational, kitchen time inside target.' }),
    snapshot({ id: 's2_bottleneck_emerging', title: 'Bottleneck emerging', log: ledger1, t: clock('18:08'), branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: 'Arrival rate has risen and Fryer 2 reported DEGRADED at 18:02:14 (telemetry + shift note). Fry queue is growing. Diagnosis must state that fryer_2 is degraded but staffing, not equipment, is the binding constraint.' }),
    snapshot({ id: 's3_bottleneck_active', title: 'Bottleneck active (branch point)', log: ledger1, t: clock('18:20'), branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: 'Fry is OVERLOADED. This is the branch point for the scenario. Orders waiting on fry hold the pass, so kitchen time climbs.' }),
  ];
  for (const sn of S) put(`snapshots/${sn.id}.json`, sn);

  // branches
  const base = runBranch(ledger1, scenario.baseline.interventions, 'sim:baseline');
  const scn = runBranch(ledger1, scenario.scenario.interventions, 'sim:scenario');
  const tCmp = clock('19:00');
  const s4 = snapshot({ id: 's4_simulated_intervention', title: 'Counterfactual: Marcus on Fry (simulated)', log: scn.log, t: tCmp, branch: 'sim:scenario', mode: 'SIMULATE', claim_class: 'simulated', narrative: 'Same arrivals as history, nominal durations, emp_04 reassigned Prep→Fry at 18:20. Fry capacity is now bound by the degraded fryer (5) instead of staffing (3). Prep runs hotter with one cook.' });
  const s4b = snapshot({ id: 's4b_simulated_baseline', title: 'Counterfactual companion: do nothing (simulated)', log: base.log, t: tCmp, branch: 'sim:baseline', mode: 'SIMULATE', claim_class: 'simulated', narrative: 'Same branch point and arrivals, no intervention. Differs from the observed 19:00 state because durations are nominal, not jittered: this gap is the calibration signal.' });
  const s4obs = snapshot({ id: 's4_observed_reference', title: 'What actually happened at 19:00 (observed, day 1)', log: ledger1, t: tCmp, branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: 'Historical reference for the same instant. Never to be shown in the same visual register as a simulated state.' });
  put('snapshots/s4_simulated_intervention.json', s4);
  put('expected/s4b_simulated_baseline.json', s4b);
  put('expected/s4_observed_reference.json', s4obs);
  put('expected/sim_baseline.events.ndjson', base.log.filter(e => e.branch === 'sim:baseline').map(e => JSON.stringify(e)).join('\n') + '\n');
  put('expected/sim_scenario.events.ndjson', scn.log.filter(e => e.branch === 'sim:scenario').map(e => JSON.stringify(e)).join('\n') + '\n');

  const wb = windowMetrics(base.log, base.tB, base.tH), ws = windowMetrics(scn.log, scn.tB, scn.tH), wo = windowMetrics(ledger1, base.tB, base.tH), w2 = windowMetrics(ledger2, base.tB, base.tH);
  const delta = (a, b) => (a == null || b == null) ? null : +(b - a).toFixed(2);
  const comparison = {
    atlas_schema: 'atlas-comparison/0.1', scenario: scenario.id, engine: ORACLE_VERSION, claim_class: 'simulated',
    branch_point: scenario.base.t, horizon: scenario.horizon, arrivals: 'historical_replay (identical in both branches)',
    baseline: wb, scenario: ws,
    delta: { orders_completed: delta(wb.orders_completed, ws.orders_completed), throughput_per_hour: delta(wb.throughput_per_hour, ws.throughput_per_hour), avg_kitchen_time_s: delta(wb.avg_kitchen_time_s, ws.avg_kitchen_time_s), p90_kitchen_time_s: delta(wb.p90_kitchen_time_s, ws.p90_kitchen_time_s), over_target_share: delta(wb.over_target_share, ws.over_target_share), max_fry_queue: delta(wb.max_queue.st_fry, ws.max_queue.st_fry), max_prep_queue: delta(wb.max_queue.st_prep, ws.max_queue.st_prep), fry_overloaded_seconds: delta(wb.overloaded_seconds.st_fry, ws.overloaded_seconds.st_fry), prep_overloaded_seconds: delta(wb.overloaded_seconds.st_prep, ws.overloaded_seconds.st_prep), revenue_completed_in_window: delta(wb.revenue_completed_in_window, ws.revenue_completed_in_window), delay_cost_assumed: delta(wb.delay_cost_assumed.value, ws.delay_cost_assumed.value), labor_cost_in_window: delta(wb.labor_cost_in_window, ws.labor_cost_in_window) },
    trade_offs: [`prep max queue ${wb.max_queue.st_prep} → ${ws.max_queue.st_prep}; prep overloaded ${wb.overloaded_seconds.st_prep}s → ${ws.overloaded_seconds.st_prep}s`],
    honesty_notes: [
      'Revenue delta is a timing shift of already-paid orders inside the window, not new revenue (rule R09: no lost-demand model in V0).',
      'delay_cost_assumed is driven entirely by the ASSUMED 0.35 USD/order-minute parameter and must be labelled as such wherever shown.',
      'Baseline simulation differs from observed day-1 history because durations are nominal; see calibration.'
    ],
    calibration_inputs: { observed_day1_same_window: wo, observed_day2_same_window_with_real_move: w2 },
    calibration_records_example: [
      { metric: 'throughput_per_hour', prediction: { baseline: wb.throughput_per_hour, scenario: ws.throughput_per_hour, predicted_delta: delta(wb.throughput_per_hour, ws.throughput_per_hour) }, observed: { day1_no_move: wo.throughput_per_hour, day2_with_move: w2.throughput_per_hour, observed_delta: delta(wo.throughput_per_hour, w2.throughput_per_hour) }, verdict: 'NOT COMPARABLE: day 2 demand (' + w2.orders_arrived + ' arrivals) is below day 1 (' + wo.orders_arrived + '); throughput is demand-bound on day 2. Calibration must condition on arrivals.' },
      { metric: 'avg_kitchen_time_s', prediction: { baseline: wb.avg_kitchen_time_s, scenario: ws.avg_kitchen_time_s, predicted_delta: delta(wb.avg_kitchen_time_s, ws.avg_kitchen_time_s) }, observed: { day1_no_move: wo.avg_kitchen_time_s, day2_with_move: w2.avg_kitchen_time_s, observed_delta: delta(wo.avg_kitchen_time_s, w2.avg_kitchen_time_s) }, verdict: 'Direction and magnitude agree; still confounded by demand. Recorded, not yet used to change any model parameter.' }
    ],
    calibration_rule: 'Observation -> Calibration record -> explicitly approved model change. No parameter is rewritten automatically.'
  };
  put('expected/comparison.json', comparison);

  // manifest
  const manifest = { generated_by: ORACLE_VERSION, world: world.metadata.id, world_sha256: sha256(fs.readFileSync(path.join(root, 'world.restaurant-v0.json'), 'utf8')), scenario_sha256: sha256(fs.readFileSync(path.join(root, 'scenario.fry-rush.json'), 'utf8')), seeds: { day1: 20261006, day2: 20261007 }, counts: { day1_events: ledger1.length, day1_orders: truth1.filter(e => e.type === 'ORDER_CREATED').length, day2_events: ledger2.length, sim_baseline_events: base.events_generated, sim_scenario_events: scn.events_generated }, files: Object.fromEntries(Object.entries(files).sort().map(([k, v]) => [k, sha256(v)])) };

  if (CHECK) {
    const old = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const bad = Object.entries(manifest.files).filter(([k, v]) => old.files[k] !== v).map(([k]) => k);
    if (bad.length) { console.error('MISMATCH:', bad.join(', ')); process.exit(1); }
    console.log(`OK: ${Object.keys(manifest.files).length} files match manifest (${ledger1.length} day1 events, ${manifest.counts.day1_orders} orders)`);
    return;
  }
  for (const [rel, content] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ counts: manifest.counts, s1: S[0].metrics.stations.st_fry, s2: S[1].diagnosis.summary, s3: S[2].diagnosis.summary, s4: s4.diagnosis.summary, comparison: comparison.delta, baseline: wb, scenario: ws }, null, 2));
}
main();
