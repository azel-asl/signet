#!/usr/bin/env node
// ATLAS M4 DIAGNOSE answer key (18 §M). Independent of any ATLAS runtime: reads only the frozen
// world, normalized ledger, M2 branch traces and frozen snapshots, and re-derives the semantic
// diagnostic expectations from R01 (station_capacity), R05 (assembly_barrier) and R07
// (station_status) as stated in 06. Usage: node derive-expectations.mjs [--check]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const here = path.dirname(new URL(import.meta.url).pathname); const ATLAS = path.resolve(here, '..', '..');
const F = path.join(ATLAS, 'fixtures', 'restaurant-v0');
const J = (p) => JSON.parse(fs.readFileSync(path.join(F, p), 'utf8'));
const ND = (p) => fs.readFileSync(path.join(F, p), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const world = J('world.restaurant-v0.json'); const history = ND('normalized/events.ndjson');
const W = 900;
const ent = Object.fromEntries(world.entities.map((e) => [e.id, e]));
const stations = world.entities.filter((e) => e.type === 'station').map((e) => e.id);
const attached = (st) => world.relationships.filter((r) => r.type === 'attached_to' && r.to === st).map((r) => r.from);
const nominal = (st, step) => { for (const p of world.processes) for (const x of p.steps) if (x.station === st && x.id === step) return x.duration_s; throw new Error(`no nominal ${st}/${step}`); };
// R01, with explicit "has attached equipment" (a station without equipment has no equipment constraint).
function r01(st, staffCount, eqCaps) {
  const a = ent[st].attrs; const staffCap = staffCount * a.per_staff_concurrency;
  if (a.staffing === 'required' && staffCount === 0) return { has_equipment: eqCaps !== null, equipment: eqCaps, staff: 0, effective: 0 };
  if (eqCaps === null) return { has_equipment: false, equipment: null, staff: staffCap, effective: staffCap };
  return { has_equipment: true, equipment: eqCaps, staff: staffCap, effective: Math.min(eqCaps, staffCap) };
}
// Minimal capacity replay (clock-in, assignment, equipment events only) for the capacity integral.
function capacityIntegral(log, st, t) {
  const on = {}, asg = {}, eq = {}; for (const e of world.entities.filter((x) => x.type === 'equipment')) eq[e.id] = { status: e.attrs.status, capacity: e.attrs.capacity };
  const eff = () => { const staff = Object.keys(asg).filter((p) => asg[p] === st && on[p]).length; const eqs = attached(st); return r01(st, staff, eqs.length ? eqs.reduce((s, id) => s + (eq[id].status === 'DOWN' ? 0 : eq[id].capacity), 0) : null).effective; };
  let last = t - W, integ = 0, cap = 0;
  for (const e of log) { if (e.t > t) break; if (!['EMPLOYEE_CLOCKED_IN', 'ASSIGNMENT_CHANGED', 'EQUIPMENT_STATE_CHANGED'].includes(e.type)) continue;
    if (e.t > t - W) { integ += cap * (e.t - last); last = e.t; }
    if (e.type === 'EMPLOYEE_CLOCKED_IN') on[e.data.employee_id] = true; else if (e.type === 'ASSIGNMENT_CHANGED') asg[e.data.employee_id] = e.data.station_id; else eq[e.data.equipment_id] = { status: e.data.status, capacity: e.data.capacity };
    cap = eff(); }
  return integ + cap * (t - last);
}
function queueLenAt(log, st, t) { const q = new Set(); for (const e of log) { if (e.t > t) break; if (e.type === 'WORK_QUEUED' && e.data.station_id === st) q.add(e.data.work_id); if (e.type === 'WORK_STARTED') q.delete(e.data.work_id); } return q.size; }
function limitation(st, snap) {
  const c = snap.metrics.stations[st].capacity; const staffN = snap.metrics.stations[st].staff.length; const eqs = attached(st);
  const eqCap = eqs.length ? c.equipment : null; const base = r01(st, staffN, eqCap);
  const q = snap.metrics.stations[st].queue_len, ip = snap.metrics.stations[st].in_progress;
  const at_capacity = base.effective > 0 && ip >= base.effective, backlogged = q > 0;
  const dStaff = r01(st, staffN + 1, eqCap).effective - base.effective;
  const dEquip = eqCap === null ? null : r01(st, staffN, eqCap + 1).effective - base.effective;
  let cls;
  if (base.effective === 0) cls = backlogged ? (staffN === 0 && (eqCap === null || eqCap > 0) ? 'STAFF' : eqCap === 0 && staffN > 0 ? 'EQUIPMENT' : 'CO_BINDING') : 'DEMAND';
  else if (!at_capacity) cls = backlogged ? 'UNKNOWN' : 'DEMAND';
  else cls = dStaff > 0 && !(dEquip > 0) ? 'STAFF' : dEquip > 0 && !(dStaff > 0) ? 'EQUIPMENT' : 'CO_BINDING';
  const degraded = eqs.filter((id) => snap.state.equipment[id].status !== 'OPERATIONAL').map((id) => {
    const restored = eqs.reduce((s, x) => s + (x === id ? snap.state.equipment[x].nominal_capacity : snap.state.equipment[x].status === 'DOWN' ? 0 : snap.state.equipment[x].capacity), 0);
    return { id, status: snap.state.equipment[id].status, restoring_raises_effective: r01(st, staffN, restored).effective > base.effective }; });
  return { at_capacity, backlogged, limitation: cls, marginal: { add_one_staff: dStaff, add_one_equipment_slot: dEquip }, degraded_equipment: degraded };
}
function soleBlocked(st, snap) {
  const open = snap.state.work_open; const out = [], pending = [];
  for (const o of snap.state.orders_open) { if (o.state !== 'OPEN') continue; const items = open.filter((w) => w.order_id === o.id && !w.id.endsWith('_0_pass'));
    if (!items.some((w) => w.station_id === st)) continue; pending.push(o.id); if (items.every((w) => w.station_id === st)) out.push(o.id); }
  return { orders_with_pending_work: pending.sort(), sole_remaining_blocker_for: out.sort() };
}
const cases = [
  ['observed', 'history:day1', 'snapshots/s1_normal.json', null], ['observed', 'history:day1', 'snapshots/s2_bottleneck_emerging.json', null],
  ['observed', 'history:day1', 'snapshots/s3_bottleneck_active.json', null], ['observed', 'history:day1', 'expected/s4_observed_reference.json', null],
  ['baseline', 'sim:baseline', 'expected/s4b_simulated_baseline.json', 'expected/sim_baseline.events.ndjson'],
  ['scenario', 'sim:scenario', 'snapshots/s4_simulated_intervention.json', 'expected/sim_scenario.events.ndjson'],
];
const out = { atlas_schema: 'atlas-m4-expectations/0.1', generated_by: 'reference/m4/derive-expectations.mjs', window_s: W,
  note: 'Semantic answer key, not a frozen output. Values derived from R01/R05/R07 over frozen artifacts only.', cases: [] };
for (const [register, branch, snapF, traceF] of cases) {
  const snap = J(snapF); const t = snap.t;
  const log = traceF ? [...history.filter((e) => e.t <= 1791336000), ...ND(traceF)] : history;
  const st = {};
  for (const s of stations) {
    const m = snap.metrics.stations[s]; const demand = log.filter((e) => e.type === 'WORK_QUEUED' && e.data.station_id === s && e.t > t - W && e.t <= t).reduce((a, e) => a + nominal(s, e.data.step), 0);
    const capS = capacityIntegral(log, s, t);
    st[s] = { status: m.status, overloaded: m.status === 'OVERLOADED', ...limitation(s, snap),
      demand_vs_capacity: { demand_work_s: demand, capacity_work_s: capS, ratio: capS > 0 ? +(demand / capS).toFixed(2) : null, exceeds: capS > 0 && demand > capS },
      backlog_growth: { queue_at_window_start: queueLenAt(log, s, t - W), queue_at_t: m.queue_len },
      assembly_blocking: soleBlocked(s, snap) };
  }
  out.cases.push({ register, branch, claim_class: register === 'observed' ? 'derived' : 'simulated', t, ts: snap.ts, snapshot: snapF, snapshot_state_hash: snap.state_hash,
    overload_onset_ts: snap.diagnosis?.since ?? null, stations: st });
}
const text = JSON.stringify(out, null, 2) + '\n'; const target = path.join(here, 'diagnosis-expectations.json');
if (process.argv.includes('--check')) { const ok = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text; console.log(ok ? 'OK: diagnosis-expectations.json reproduces' : 'MISMATCH'); process.exit(ok ? 0 : 1); }
fs.writeFileSync(target, text); console.log('wrote', target, crypto.createHash('sha256').update(text).digest('hex'));
