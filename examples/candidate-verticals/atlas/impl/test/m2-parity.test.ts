// F6: reference parity (§H mapping).
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/views.js';
import { buildBranchLog } from '../src/branch.js';
import { canonicalJson } from '../src/canon.js';
import { compareScenarios, calibrate } from '../src/compare.js';
import { computeWindowMetrics } from '../src/window.js';
import { buildWorkload, canonHash } from '../src/simulate.js';
import { m2Setup, TB, TH } from './m2-setup.js';
import { FIX } from './paths.js';

const OP_KEYS = ['orders_arrived', 'orders_completed', 'orders_open_at_horizon', 'throughput_per_hour',
  'avg_kitchen_time_s', 'p90_kitchen_time_s', 'max_kitchen_time_s', 'over_target_share', 'delay_minutes_over_target'];

describe('F6 reference parity', () => {
  it('branch events equal oracle traces field-for-field except provenance.adapter', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    for (const [r, name] of [[baseline, 'baseline'], [scenarioArm, 'scenario']] as const) {
      const expected = (await readFile(`${FIX}/expected/sim_${name}.events.ndjson`, 'utf8'))
        .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      expect(r.events.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        const e = { ...expected[i] };
        delete e.provenance.adapter;
        const m: any = { ...r.events[i] };
        delete m.provenance.adapter;
        expect(JSON.stringify(m), `event ${i}`).toBe(JSON.stringify(e));
      }
    }
  });

  it('trace_content_sha256 equals the §H values', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    expect(baseline.receipt.outputs.trace_content_sha256).toBe(
      '9c4089b7e6682ea7df701856e31cf593c423f14f3e7642ccc6927daa8c684f9b');
    expect(scenarioArm.receipt.outputs.trace_content_sha256).toBe(
      '97e0d1fbb4e329df31f7dee08d09b2f945b217f6c5ecfa30f0ce10009b710ede');
  });

  it('s4/s4b snapshots: state, metrics, diagnosis, state_hash equal (not evidence_refs)', async () => {
    const { world, ledger, baseline, scenarioArm } = await m2Setup();
    const tS4 = TB + 40 * 60; // 19:00
    const cases = [
      { r: baseline, fixture: 'expected/s4b_simulated_baseline.json' },
      { r: scenarioArm, fixture: 'snapshots/s4_simulated_intervention.json' },
    ] as const;
    for (const { r, fixture } of cases) {
      const expected = JSON.parse(await readFile(`${FIX}/${fixture}`, 'utf8'));
      const branchLog = buildBranchLog(ledger.events, TB, r.events);
      const snap: any = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: branchLog, t: tS4,
        branch: r.branch, mode: 'SIMULATE', claim_class: 'simulated', narrative: '',
      });
      expect(snap.state_hash).toBe(expected.state_hash);
      expect(canonicalJson(snap.state)).toBe(canonicalJson(expected.state));
      expect(canonicalJson(snap.metrics)).toBe(canonicalJson(expected.metrics));
      expect(canonicalJson(snap.diagnosis)).toBe(canonicalJson(expected.diagnosis));
    }
  });

  it('comparison and calibration operational subsets equal expected', async () => {
    const { world, ledger, baseline, scenarioArm, scenario, manifest } = await m2Setup();
    const expected = JSON.parse(await readFile(`${FIX}/expected/comparison.json`, 'utf8'));
    const cmp: any = compareScenarios(world, baseline, scenarioArm, scenario.id);
    for (const k of OP_KEYS) {
      expect(cmp.baseline[k]).toBe(expected.baseline[k]);
      expect(cmp.scenario[k]).toBe(expected.scenario[k]);
    }
    for (const st of ['st_fry', 'st_prep']) {
      expect(cmp.baseline.max_queue[st]).toBe(expected.baseline.max_queue[st]);
      expect(cmp.scenario.max_queue[st]).toBe(expected.scenario.max_queue[st]);
      expect(cmp.baseline.overloaded_seconds[st]).toBe(expected.baseline.overloaded_seconds[st]);
      expect(cmp.scenario.overloaded_seconds[st]).toBe(expected.scenario.overloaded_seconds[st]);
    }
    expect(cmp.baseline.utilization_at_horizon_15m.st_fry).toBe(expected.baseline.fry_utilization_at_horizon_15m);
    expect(cmp.baseline.utilization_at_horizon_15m.st_prep).toBe(expected.baseline.prep_utilization_at_horizon_15m);
    for (const k of ['orders_completed', 'throughput_per_hour', 'avg_kitchen_time_s', 'p90_kitchen_time_s', 'over_target_share']) {
      expect(cmp.delta[k]).toBe(expected.delta[k]);
    }
    expect(cmp.delta.max_queue.st_fry).toBe(expected.delta.max_fry_queue);
    expect(cmp.delta.max_queue.st_prep).toBe(expected.delta.max_prep_queue);
    expect(cmp.delta.overloaded_seconds.st_fry).toBe(expected.delta.fry_overloaded_seconds);
    expect(cmp.delta.overloaded_seconds.st_prep).toBe(expected.delta.prep_overloaded_seconds);

    const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, TB, TH, scenario.comparison_window);
    const obsWorkload = buildWorkload(ledger.events, TB, TH);
    const cal: any = calibrate(baseline, obsMetrics, 'history:day1',
      manifest.files['normalized/events.ndjson'], canonHash(obsWorkload));
    const expObs = expected.calibration_inputs.observed_day1_same_window;
    for (const k of OP_KEYS) expect(cal.observed.metrics[k]).toBe(expObs[k]);
    expect(cal.predicted.metrics).toEqual(baseline.windowMetrics);
  });
});
