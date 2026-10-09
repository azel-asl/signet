#!/usr/bin/env node
// ATLAS M5 RECOMMEND + ECONOMICS answer key (19 §T). Independent of the ATLAS runtime (impl/):
// it loads the FROZEN fixture oracle's own scheduler/reducer (an unmodified copy of
// fixtures/restaurant-v0/oracle/generate.mjs with only its root path and its final `main();`
// replaced by exports), simulates every canonical candidate, and computes the M5 metrics,
// economics, statuses and ranking defined in 19 with its own code.
// Usage: node derive-expectations.mjs [--check]
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto'; import { pathToFileURL } from 'node:url';
const here = path.dirname(new URL(import.meta.url).pathname); const ATLAS = path.resolve(here, '..', '..');
const FIX = path.join(ATLAS, 'fixtures', 'restaurant-v0'); const ORACLE = path.join(FIX, 'oracle', 'generate.mjs');
const src = fs.readFileSync(ORACLE, 'utf8');
const ROOT_LINE = "const root = path.resolve(here, '..');";
if (!src.includes(ROOT_LINE) || !/\nmain\(\);\s*$/.test(src)) throw new Error('oracle shape changed; answer key cannot load it');
const patched = src.replace(ROOT_LINE, `const root = ${JSON.stringify(FIX)};`).replace(/\nmain\(\);\s*$/, '\nexport { runBranch, createState, applyEvent, stationStatus, capacity, world, scenario, iso };\n');
const tmp = path.join(os.tmpdir(), `atlas-m5-oracle-${crypto.createHash('sha256').update(patched).digest('hex').slice(0, 12)}.mjs`);
fs.writeFileSync(tmp, patched);
const O = await import(pathToFileURL(tmp).href);
const world = O.world; const history = fs.readFileSync(path.join(FIX, 'normalized', 'events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tB = Math.floor(Date.parse(O.scenario.base.t) / 1000), tH = Math.floor(Date.parse(O.scenario.horizon) / 1000);
const CFG = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const stations = world.entities.filter((e) => e.type === 'station').map((e) => e.id);
const persons = world.entities.filter((e) => e.type === 'person');
const target = world.goals.find((g) => g.metric === 'avg_kitchen_time_s').target;
// ---- candidate enumeration (19 §D) for diagnosis: capacity_limit STAFF at DEST, observed 18:20
const DEST = 'st_fry'; const shortName = (st) => st.startsWith('st_') ? st.slice(3) : st; // CCR-003 convention, same rule as the world loader
const base = (() => { const s = O.createState(); for (const e of history) { if (e.t > tB) break; O.applyEvent(s, e); } return s; })();
const windows = CFG.candidate_windows.map((w) => ({ start: tB + w.start_offset_s, end: w.end === 'horizon' ? tH : tB + w.end_offset_s, label: w.label }));
const cands = [];
for (const p of persons) { if (!base.on_shift[p.id] || base.assignments[p.id] === DEST) continue;
  for (const w of windows) {
    const from = base.assignments[p.id]; const id = `cand:reassign_resource:${p.id}:${DEST}:${w.label}`;
    const reasons = [];
    if (!(p.attrs.skills ?? []).includes(shortName(DEST))) reasons.push('SKILL_MISSING');
    if (w.start < tB || w.end > tH || w.end <= w.start) reasons.push('WINDOW_INVALID');
    cands.push({ id, resource: p.id, from, to: DEST, window: w, eligible: reasons.length === 0, ineligible_reasons: reasons });
  } }
// ---- simulation via the frozen oracle scheduler
const iso = O.iso;
const toInterventions = (c) => [{ id: 'iv_01', kind: 'reassign', employee: c.resource, from: c.from, to: c.to, at: iso(c.window.start) },
                                { id: 'iv_02', kind: 'reassign', employee: c.resource, from: c.to, to: c.from, at: iso(c.window.end) }];
// ---- metrics (19 §G, §H) over (tB, tH]
function metrics(log) {
  const s = O.createState(); let i = 0; const samples = [];
  const snap = (t) => samples.push({ t, st: Object.fromEntries(stations.map((x) => [x, { q: s.stations[x].queue.length, status: O.stationStatus(s, x, t) }])) });
  for (; i < log.length && log[i].t <= tB; i++) O.applyEvent(s, log[i]); snap(tB);
  while (i < log.length && log[i].t <= tH) { const t = log[i].t; while (i < log.length && log[i].t === t) O.applyEvent(s, log[i++]); snap(t); }
  const per = Object.fromEntries(stations.map((x) => [x, { queue_burden_s: 0, overload_s: 0, max_queue: 0, overload_last_t: null }]));
  samples.forEach((p, k) => { const end = k + 1 < samples.length ? samples[k + 1].t : tH; for (const x of stations) { const v = per[x]; v.queue_burden_s += p.st[x].q * (end - p.t); v.max_queue = Math.max(v.max_queue, p.st[x].q);
    if (p.st[x].status === 'OVERLOADED' || p.st[x].status === 'UNSTAFFED') { v.overload_s += end - p.t; v.overload_last_t = p.t; } } });
  let tis = 0, completed = 0, open = 0, delay_s = 0;
  for (const o of Object.values(s.orders)) { const c = o.completed_t ?? Infinity; const a = Math.max(o.created_t, tB), b = Math.min(c, tH); if (b > a) tis += b - a;
    if (o.completed_t != null && o.completed_t > tB && o.completed_t <= tH) completed++;
    if (o.created_t > tB && o.created_t <= tH) { if (!(o.completed_t != null && o.completed_t <= tH)) open++; delay_s += Math.max(0, (Math.min(c, tH) - o.created_t) - target); } }
  return { order_time_in_system_s: tis, orders_completed_in_window: completed, orders_open_at_horizon: open, delay_s_over_target_censored: delay_s, stations: per };
}
const histTrace = (log) => crypto.createHash('sha256').update(JSON.stringify(log.filter((e) => e.branch.startsWith('sim:')).map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data })))).digest('hex');
const B = O.runBranch(history, [], 'sim:baseline'); const mB = metrics(B.log);
const frozenScn = fs.readFileSync(path.join(FIX, 'expected', 'sim_scenario.events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const frozenProj = crypto.createHash('sha256').update(JSON.stringify(frozenScn.map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data })))).digest('hex');
// ---- deltas, economics, statuses, ranking (19 §G–§N)
const rate = world.economics.delay_cost_per_order_minute_over_target.value;
const econ = (m, r, moves) => +(((m.delay_s_over_target_censored / 60) * r) + moves * CFG.economics.reassignment_cost_per_move).toFixed(2);
const results = [];
for (const c of cands) {
  if (!c.eligible) { results.push({ id: c.id, resource: c.resource, from: c.from, to: c.to, window: c.window, eligible: false, ineligible_reasons: c.ineligible_reasons, status: 'infeasible', simulated: false }); continue; }
  const run = O.runBranch(history, toInterventions(c), 'sim:candidate'); const m = metrics(run.log);
  const d = { order_time_in_system_s: m.order_time_in_system_s - mB.order_time_in_system_s, orders_completed_in_window: m.orders_completed_in_window - mB.orders_completed_in_window,
    orders_open_at_horizon: m.orders_open_at_horizon - mB.orders_open_at_horizon, delay_s_over_target_censored: m.delay_s_over_target_censored - mB.delay_s_over_target_censored,
    stations: Object.fromEntries(stations.map((x) => [x, { queue_burden_s: m.stations[x].queue_burden_s - mB.stations[x].queue_burden_s, overload_s: m.stations[x].overload_s - mB.stations[x].overload_s }])) };
  const new_overload = stations.filter((x) => mB.stations[x].overload_s === 0 && m.stations[x].overload_s > 0);
  const worsened = stations.filter((x) => x !== c.to && (m.stations[x].queue_burden_s > mB.stations[x].queue_burden_s || m.stations[x].overload_s > mB.stations[x].overload_s));
  const improvement = -d.order_time_in_system_s; const moves = 2;
  const economics = Object.fromEntries(Object.entries(CFG.sensitivity.delay_cost_per_order_minute).map(([k, r]) => [k, { baseline_cost: econ(mB, r, 0), scenario_cost: econ(m, r, moves), net_effect: +(econ(mB, r, 0) - econ(m, r, moves)).toFixed(2) }]));
  results.push({ id: c.id, resource: c.resource, from: c.from, to: c.to, window: c.window, eligible: true, simulated: true, sim_events: run.events_generated,
    trace_projection_sha256: histTrace(run.log), metrics: m, delta: d, improvement_order_s: improvement, new_overload_stations: new_overload, worsened_stations: worsened, economics });
}
// dominance over (order_time_in_system_s down, orders_completed up, total new overload_s down, moves cost down)
const sim = results.filter((r) => r.simulated);
const vec = (r) => [r.metrics.order_time_in_system_s, -r.metrics.orders_completed_in_window, r.new_overload_stations.reduce((a, x) => a + r.metrics.stations[x].overload_s, 0)];
for (const r of sim) { r.dominated_by = sim.filter((o) => o !== r && vec(o).every((v, i) => v <= vec(r)[i]) && vec(o).some((v, i) => v < vec(r)[i])).map((o) => o.id).sort(); }
for (const r of sim) r.status = r.improvement_order_s <= 0 ? 'not_recommended' : r.dominated_by.length ? 'dominated' : r.new_overload_stations.length ? 'conditionally_recommended' : 'recommended';
for (const r of results) r.assumptions = r.from === null ? ['resource has no modeled assignment at the source; any unmodeled duties are not represented'] : [];
const rankable = sim.filter((r) => r.status === 'recommended' || r.status === 'conditionally_recommended')
  .sort((a, b) => (a.status === b.status ? 0 : a.status === 'recommended' ? -1 : 1) || b.improvement_order_s - a.improvement_order_s || (a.id < b.id ? -1 : 1));
rankable.forEach((r, i) => { r.rank = i + 1; });
const top = rankable[0]?.id ?? 'no_action';
// operational selection over a restricted candidate set (CASE 6): same rules, subset only
const selectTop = (ids) => { const pool = sim.filter((r) => ids.includes(r.id));
  const dom = (r) => pool.some((o) => o !== r && vec(o).every((v, i) => v <= vec(r)[i]) && vec(o).some((v, i) => v < vec(r)[i]));
  const ok = pool.filter((r) => r.improvement_order_s > 0 && !dom(r)).sort((a, b) => (a.new_overload_stations.length - b.new_overload_stations.length) || b.improvement_order_s - a.improvement_order_s || (a.id < b.id ? -1 : 1));
  return ok[0]?.id ?? 'no_action'; };
const restricted = sim.filter((r) => r.resource === 'emp_02').map((r) => r.id);
// economic selection with a configured per-move cost (CASE 5b): no_action when no candidate has positive net effect
const econTop = (rateKey, moveCost) => { const r0 = CFG.sensitivity.delay_cost_per_order_minute[rateKey];
  const scored = sim.map((r) => ({ id: r.id, net: +(((mB.delay_s_over_target_censored - r.metrics.delay_s_over_target_censored) / 60) * r0 - 2 * moveCost).toFixed(2) }))
    .filter((x) => x.net > 0).sort((a, b) => b.net - a.net || (a.id < b.id ? -1 : 1)); return { top: scored[0]?.id ?? 'no_action', best_net: scored[0]?.net ?? null }; };
const econRank = Object.fromEntries(Object.keys(CFG.sensitivity.delay_cost_per_order_minute).map((k) => [k, [...sim].sort((a, b) => b.economics[k].net_effect - a.economics[k].net_effect || (a.id < b.id ? -1 : 1)).map((r) => r.id)[0]]));
const out = { atlas_schema: 'atlas-m5-answer-key/0.1', generated_by: 'reference/m5/derive-expectations.mjs', oracle: 'fixtures/restaurant-v0/oracle/generate.mjs (unmodified copy, exports appended)',
  note: 'Semantic answer key. Simulation by the frozen fixture oracle; metrics, economics, statuses and ranking by this script per 19.',
  context: { branch: 'history:day1', diagnosis_t: tB, tB, tH, destination: DEST, diagnosis: { capacity_limit: 'STAFF', subject: DEST } },
  parity: { frozen_baseline_projection_sha256: crypto.createHash('sha256').update(JSON.stringify(fs.readFileSync(path.join(FIX, 'expected', 'sim_baseline.events.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data })))).digest('hex'),
    regenerated_baseline_projection_sha256: histTrace(B.log), frozen_scenario_projection_sha256: frozenProj, regenerated_emp_04_horizon_projection_sha256: results.find((r) => r.id === `cand:reassign_resource:emp_04:${DEST}:to_horizon`)?.trace_projection_sha256 ?? null },
  baseline: { sim_events: B.events_generated, trace_projection_sha256: histTrace(B.log), metrics: mB },
  config: CFG, candidates: results, ranking: rankable.map((r) => r.id), top_recommendation: top,
  sensitivity: { economic_top_by_rate: econRank, economic_top_stable: new Set(Object.values(econRank)).size === 1 },
  cases: {
    case6_restricted_to_net_worse_candidates: { candidate_ids: restricted, expected_top: selectTop(restricted) },
    case5b_costly_moves_economic_objective: { reassignment_cost_per_move: 80, by_rate: Object.fromEntries(Object.keys(CFG.sensitivity.delay_cost_per_order_minute).map((k) => [k, econTop(k, 80)])) },
    case5_economics_scale_with_rate: Object.fromEntries(Object.keys(CFG.sensitivity.delay_cost_per_order_minute).map((k) => [k, results.find((r) => r.id === top)?.economics?.[k]?.net_effect ?? null])),
    case_unsupported_diagnosis: { diagnosis: { capacity_limit: 'EQUIPMENT', subject: 'st_fry', register: 'scenario', t: 1791338400 }, expected_candidates: 0, expected_top: 'no_action', reason: 'NO_SUPPORTED_INTERVENTION' }
  } };
const text = JSON.stringify(out, null, 2) + '\n'; const target_file = path.join(here, 'answer-key.json');
if (process.argv.includes('--check')) { const ok = fs.existsSync(target_file) && fs.readFileSync(target_file, 'utf8') === text; console.log(ok ? 'OK: answer-key.json reproduces' : 'MISMATCH'); process.exit(ok ? 0 : 1); }
fs.writeFileSync(target_file, text); console.log('wrote', target_file, crypto.createHash('sha256').update(text).digest('hex'));
