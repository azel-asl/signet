// M2 parity runner: runs both arms and checks every §H target.
// Writes reports/m2-parity-report.{json,md}. Exits non-zero on any failure.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { reduceTo } from '../src/reducer.js';
import { loadScenario } from '../src/scenario.js';
import { runArm, buildWorkload, canonHash, sha256FileBytes } from '../src/simulate.js';
import { compareScenarios, calibrate } from '../src/compare.js';
import { computeWindowMetrics } from '../src/window.js';
import { buildSnapshot, iso } from '../src/views.js';
import { canonicalJson } from '../src/canon.js';
import { ENGINE_VERSION } from '../src/scenario.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // dist/scripts -> atlas/
const FIX = `${ROOT}/fixtures/restaurant-v0`;
const IMPL = `${ROOT}/impl`;

const EXPECTED = {
  base_state_hash: '67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84',
  workload_sha256: 'ae7ad2b264fc003cd70413c2e0ad96baa726861ace6f85d6aab9258880bd471d',
  baseline: {
    events: 872, first_seq: 545,
    trace_content_sha256: '9c4089b7e6682ea7df701856e31cf593c423f14f3e7642ccc6927daa8c684f9b',
    final_state_hash: '176e0d643322b0d15fbb3fb28a19c3d9bdb5c18d1d185d0c67c4399092b43b42',
  },
  scenario: {
    events: 994, first_seq: 545,
    trace_content_sha256: '97e0d1fbb4e329df31f7dee08d09b2f945b217f6c5ecfa30f0ce10009b710ede',
    final_state_hash: 'e11f66e8eb0389b57427da2515ff7f5f0d41c7708b9073a1a3e874de0ec9d279',
  },
};

interface Check { name: string; pass: boolean; detail?: string }

async function main(): Promise<void> {
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const world = await loadWorld(`${FIX}/world.restaurant-v0.json`, `${ROOT}/schema/atlas-world-definition.schema.json`);
  const ledger = await loadLedger(`${FIX}/normalized/events.ndjson`, `${ROOT}/schema/atlas-event.schema.json`);
  const manifest = JSON.parse(await readFile(`${FIX}/manifest.json`, 'utf8'));
  const tB = Math.floor(Date.parse('2026-10-06T18:20:00-07:00') / 1000);
  const tH = Math.floor(Date.parse('2026-10-06T19:30:00-07:00') / 1000);
  const { state: baseState } = reduceTo(world, ledger.events, tB);
  const scenario = await loadScenario(`${FIX}/scenario.fry-rush.json`, world, baseState, 'history:day1');

  check('scenario loads and validates', true, `id=${scenario.id}`);

  const arms: Record<string, ReturnType<typeof runArm>> = {};
  for (const arm of ['baseline', 'scenario'] as const) {
    const r = runArm({
      world, parentEvents: ledger.events, parentBranch: 'history:day1',
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
      worldSha256: manifest.world_sha256,
      scenario, arm, baseState,
    });
    arms[arm] = r;
    const exp = EXPECTED[arm];
    check(`${arm}: base_state_hash == s3`, r.branchPoint.base_state_hash === EXPECTED.base_state_hash);
    check(`${arm}: events_applied == 544`, r.branchPoint.events_applied === 544);
    check(`${arm}: event count`, r.events.length === exp.events, `${r.events.length}`);
    check(`${arm}: first seq`, r.events[0].seq === exp.first_seq, `${r.events[0].seq}`);
    check(`${arm}: workload_sha256`, r.receipt.inputs.workload.workload_sha256 === EXPECTED.workload_sha256);
    check(`${arm}: trace_content_sha256`, r.receipt.outputs.trace_content_sha256 === exp.trace_content_sha256);
    check(`${arm}: final_state_hash`, r.receipt.outputs.final_state_hash === exp.final_state_hash);
    check(`${arm}: receipt_sha256 recomputes`, (() => {
      const { receipt_sha256: _r, ...rest } = r.receipt;
      return canonHash(rest) === r.receipt.receipt_sha256;
    })());
  }

  // s4/s4b snapshot parity at 19:00 (state, metrics, diagnosis, state_hash; not evidence_refs)
  const tS4 = Math.floor(Date.parse('2026-10-06T19:00:00-07:00') / 1000);
  const snapCases = [
    { arm: 'baseline', fixture: 'expected/s4b_simulated_baseline.json' },
    { arm: 'scenario', fixture: 'snapshots/s4_simulated_intervention.json' },
  ] as const;
  for (const { arm, fixture } of snapCases) {
    const expected = JSON.parse(await readFile(`${FIX}/${fixture}`, 'utf8'));
    const r = arms[arm];
    const branchLog = [...ledger.events.filter((e) => e.t <= tB), ...r.events];
    const snap: any = buildSnapshot(world, {
      id: expected.id, title: expected.title, log: branchLog, t: tS4,
      branch: r.branch, mode: 'SIMULATE', claim_class: 'simulated', narrative: '',
    });
    check(`${arm}: snapshot state_hash`, snap.state_hash === expected.state_hash);
    check(`${arm}: snapshot state`, canonicalJson(snap.state) === canonicalJson(expected.state));
    check(`${arm}: snapshot metrics`, canonicalJson(snap.metrics) === canonicalJson(expected.metrics));
    check(`${arm}: snapshot diagnosis`, canonicalJson(snap.diagnosis) === canonicalJson(expected.diagnosis));
  }

  // comparison / calibration vs expected/comparison.json (§H mapping)
  const expCmp = JSON.parse(await readFile(`${FIX}/expected/comparison.json`, 'utf8'));
  const cmp: any = compareScenarios(world, arms.baseline, arms.scenario, scenario.id);
  const opKeys = ['orders_arrived', 'orders_completed', 'orders_open_at_horizon', 'throughput_per_hour',
    'avg_kitchen_time_s', 'p90_kitchen_time_s', 'max_kitchen_time_s', 'over_target_share', 'delay_minutes_over_target'];
  let cmpOk = true;
  for (const k of opKeys) {
    if (cmp.baseline[k] !== expCmp.baseline[k] || cmp.scenario[k] !== expCmp.scenario[k]) cmpOk = false;
  }
  for (const st of ['st_fry', 'st_prep']) {
    if (cmp.baseline.max_queue[st] !== expCmp.baseline.max_queue[st]) cmpOk = false;
    if (cmp.scenario.max_queue[st] !== expCmp.scenario.max_queue[st]) cmpOk = false;
    if (cmp.baseline.overloaded_seconds[st] !== expCmp.baseline.overloaded_seconds[st]) cmpOk = false;
    if (cmp.scenario.overloaded_seconds[st] !== expCmp.scenario.overloaded_seconds[st]) cmpOk = false;
  }
  if (cmp.baseline.utilization_at_horizon_15m.st_fry !== expCmp.baseline.fry_utilization_at_horizon_15m) cmpOk = false;
  if (cmp.baseline.utilization_at_horizon_15m.st_prep !== expCmp.baseline.prep_utilization_at_horizon_15m) cmpOk = false;
  if (cmp.scenario.utilization_at_horizon_15m.st_fry !== expCmp.scenario.fry_utilization_at_horizon_15m) cmpOk = false;
  if (cmp.scenario.utilization_at_horizon_15m.st_prep !== expCmp.scenario.prep_utilization_at_horizon_15m) cmpOk = false;
  const dkeys = ['orders_completed', 'throughput_per_hour', 'avg_kitchen_time_s', 'p90_kitchen_time_s', 'over_target_share'];
  for (const k of dkeys) if (cmp.delta[k] !== expCmp.delta[k]) cmpOk = false;
  if (cmp.delta.max_queue.st_fry !== expCmp.delta.max_fry_queue) cmpOk = false;
  if (cmp.delta.max_queue.st_prep !== expCmp.delta.max_prep_queue) cmpOk = false;
  if (cmp.delta.overloaded_seconds.st_fry !== expCmp.delta.fry_overloaded_seconds) cmpOk = false;
  if (cmp.delta.overloaded_seconds.st_prep !== expCmp.delta.prep_overloaded_seconds) cmpOk = false;
  check('comparison operational subset == expected', cmpOk);

  const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, tB, tH, scenario.comparison_window);
  const obsWorkload = buildWorkload(ledger.events, tB, tH);
  const cal: any = calibrate(arms.baseline, obsMetrics, 'history:day1',
    manifest.files['normalized/events.ndjson'], canonHash(obsWorkload));
  let calOk = cal.comparable === true;
  const expObs = expCmp.calibration_inputs.observed_day1_same_window;
  for (const k of opKeys) if (cal.observed.metrics[k] !== expObs[k]) calOk = false;
  for (const st of ['st_fry', 'st_prep']) {
    if (cal.observed.metrics.max_queue[st] !== expObs.max_queue[st]) calOk = false;
    if (cal.observed.metrics.overloaded_seconds[st] !== expObs.overloaded_seconds[st]) calOk = false;
  }
  if (JSON.stringify(cal.predicted.metrics) !== JSON.stringify(arms.baseline.windowMetrics)) calOk = false;
  check('calibration operational subset == expected, comparable', calOk);

  // determinism: run baseline again
  const r2 = runArm({
    world, parentEvents: ledger.events, parentBranch: 'history:day1',
    parentLedgerSha256: manifest.files['normalized/events.ndjson'],
    worldSha256: manifest.world_sha256,
    scenario, arm: 'baseline', baseState,
  });
  check('deterministic rerun', r2.receipt.outputs.trace_sha256 === arms.baseline.receipt.outputs.trace_sha256 &&
    JSON.stringify(r2.receipt) === JSON.stringify(arms.baseline.receipt));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\noverall: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length})`);

  await mkdir(`${IMPL}/reports`, { recursive: true });
  const report = {
    generated: new Date().toISOString(),
    engine: ENGINE_VERSION,
    reference: 'cae5adf',
    checks,
    arms: Object.fromEntries(Object.entries(arms).map(([k, r]) => [k, {
      run_id: r.receipt.run_id,
      receipt_sha256: r.receipt.receipt_sha256,
      events: r.receipt.outputs.events_generated,
      trace_sha256: r.receipt.outputs.trace_sha256,
      trace_content_sha256: r.receipt.outputs.trace_content_sha256,
      final_state_hash: r.receipt.outputs.final_state_hash,
      window_metrics_sha256: r.receipt.outputs.window_metrics_sha256,
    }])),
    workload_sha256: EXPECTED.workload_sha256,
    overall: failed.length === 0 ? 'PASS' : 'FAIL',
  };
  await writeFile(`${IMPL}/reports/m2-parity-report.json`, JSON.stringify(report, null, 2));
  const md = [
    '# ATLAS V0 Milestone 2 — parity report',
    '',
    `Generated ${report.generated} · engine ${ENGINE_VERSION} · reference cae5adf`,
    `Workload sha256: \`${EXPECTED.workload_sha256}\``,
    '',
    '| Arm | Events | trace_content_sha256 | final_state_hash | run_id |',
    '|---|---|---|---|---|',
    ...Object.entries(report.arms).map(([k, a]: [string, any]) =>
      `| ${k} | ${a.events} | \`${a.trace_content_sha256}\` | \`${a.final_state_hash}\` | \`${a.run_id}\` |`),
    '',
    '## Checks',
    '',
    ...checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    '',
    `**Overall: ${report.overall}**`,
    '',
  ].join('\n');
  await writeFile(`${IMPL}/reports/m2-parity-report.md`, md);

  if (failed.length > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
