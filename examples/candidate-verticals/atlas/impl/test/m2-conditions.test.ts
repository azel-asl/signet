// M2 conditional-pass corrections: tests for Conditions 1–4.
import { describe, expect, it } from 'vitest';
import { getStateAtTime, runScenario, GetStateError, RunScenarioError } from '../src/capabilities.js';
import { compareScenarios, calibrate, ComparisonError } from '../src/compare.js';
import { canonHash } from '../src/simulate.js';
import { buildBranchLog } from '../src/branch.js';
import { m2Setup, TB } from './m2-setup.js';
import { SCENARIO_FILE } from './paths.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

describe('Condition 1 — getStateAtTime claim/mode correctness', () => {
  it('historical ledger → mode RECONSTRUCT, claim_class derived, no arm', async () => {
    const { world, ledger } = await m2Setup();
    const out: any = getStateAtTime({ world, ledger: ledger.events, t: TB, branch: 'history:day1' });
    expect(out.mode).toBe('RECONSTRUCT');
    expect(out.claim_class).toBe('derived');
    expect(out.branch).toBe('history:day1');
    expect('arm' in out).toBe(false);
  });

  it('baseline branch log → mode SIMULATE, claim_class simulated, arm baseline', async () => {
    const { world, ledger, baseline } = await m2Setup();
    const log = buildBranchLog(ledger.events, TB, baseline.events);
    const out: any = getStateAtTime({ world, ledger: log, t: TB + 3600 });
    expect(out.mode).toBe('SIMULATE');
    expect(out.claim_class).toBe('simulated');
    expect(out.arm).toBe('baseline');
    expect(out.branch).toBe(baseline.branch);
  });

  it('scenario branch log → mode SIMULATE, claim_class simulated, arm scenario', async () => {
    const { world, ledger, scenarioArm } = await m2Setup();
    const log = buildBranchLog(ledger.events, TB, scenarioArm.events);
    const out: any = getStateAtTime({ world, ledger: log, t: TB + 3600 });
    expect(out.mode).toBe('SIMULATE');
    expect(out.claim_class).toBe('simulated');
    expect(out.arm).toBe('scenario');
    expect(out.branch).toBe(scenarioArm.branch);
  });

  it('simulated ledger never silently appears historical (no branch param)', async () => {
    const { world, ledger, baseline } = await m2Setup();
    const log = buildBranchLog(ledger.events, TB, baseline.events);
    const out: any = getStateAtTime({ world, ledger: log, t: TB + 3600 });
    // No branch metadata supplied; classification must still come from the ledger.
    expect(out.mode).toBe('SIMULATE');
    expect(out.claim_class).toBe('simulated');
  });

  it('metadata mismatch fails loudly: branch log labeled history', async () => {
    const { world, ledger, baseline } = await m2Setup();
    const log = buildBranchLog(ledger.events, TB, baseline.events);
    expect(() =>
      getStateAtTime({ world, ledger: log, t: TB + 3600, branch: 'history:day1' }),
    ).toThrow(GetStateError);
  });

  it('metadata mismatch fails loudly: history labeled sim', async () => {
    const { world, ledger } = await m2Setup();
    expect(() =>
      getStateAtTime({ world, ledger: ledger.events, t: TB, branch: 'sim:baseline:fake' }),
    ).toThrow(GetStateError);
  });

  it('wrong sim branch id fails loudly', async () => {
    const { world, ledger, baseline } = await m2Setup();
    const log = buildBranchLog(ledger.events, TB, baseline.events);
    expect(() =>
      getStateAtTime({ world, ledger: log, t: TB + 3600, branch: 'sim:scenario:wrong' }),
    ).toThrow(/GETSTATE_BRANCH_MISMATCH/);
  });
});

describe('Condition 2 — comparison/calibration input verification', () => {
  it('altered completed_orders is rejected', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const tampered: any = {
      receipt: baseline.receipt,
      windowMetrics: { ...baseline.windowMetrics, completed_orders: 999 },
      branch: baseline.branch,
    };
    expect(() => compareScenarios(world, tampered, scenarioArm as any, scenario.id)).toThrow(
      /COMPARE_METRICS_MISMATCH/,
    );
  });

  it('observed metrics passed as baseline are rejected', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const { computeWindowMetrics } = await import('../src/window.js');
    const { ledger } = await m2Setup();
    const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, TB, TB + 70 * 60, scenario.comparison_window);
    const fake: any = {
      receipt: baseline.receipt,
      windowMetrics: obsMetrics,
      branch: baseline.branch,
    };
    expect(() => compareScenarios(world, fake, scenarioArm as any, scenario.id)).toThrow(ComparisonError);
  });

  it('baseline metrics passed as scenario are rejected', async () => {
    const { world, baseline, scenario } = await m2Setup();
    expect(() => compareScenarios(world, baseline as any, baseline as any, scenario.id)).toThrow(
      /COMPARE_ARM_MISMATCH/,
    );
  });

  it('tampered receipt hash is rejected', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const tampered: any = {
      receipt: { ...baseline.receipt, receipt_sha256: '0'.repeat(64) },
      windowMetrics: baseline.windowMetrics,
      branch: baseline.branch,
    };
    expect(() => compareScenarios(world, tampered, scenarioArm as any, scenario.id)).toThrow(
      /COMPARE_RECEIPT_TAMPERED/,
    );
  });

  it('tampered metrics hash in receipt is rejected', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const tamperedReceipt: any = {
      ...baseline.receipt,
      outputs: { ...baseline.receipt.outputs, window_metrics_sha256: '1'.repeat(64) },
    };
    // Recompute the outer hash so only the metrics commitment is wrong.
    const { receipt_sha256: _x, ...rest } = tamperedReceipt;
    tamperedReceipt.receipt_sha256 = canonHash(rest);
    const tampered: any = {
      receipt: tamperedReceipt,
      windowMetrics: baseline.windowMetrics,
      branch: baseline.branch,
    };
    expect(() => compareScenarios(world, tampered, scenarioArm as any, scenario.id)).toThrow(
      /COMPARE_METRICS_MISMATCH/,
    );
  });

  it('valid baseline/scenario comparison still matches frozen reference', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const cmp: any = compareScenarios(world, baseline as any, scenarioArm as any, scenario.id);
    const expected = JSON.parse(await readFile(
      new URL('../../fixtures/restaurant-v0/expected/comparison.json', import.meta.url), 'utf8'));
    // Operational subset must match (expected has economic fields we exclude per §13).
    const opKeys = ['orders_arrived', 'orders_completed', 'orders_open_at_horizon', 'throughput_per_hour',
      'avg_kitchen_time_s', 'p90_kitchen_time_s', 'max_kitchen_time_s', 'over_target_share', 'delay_minutes_over_target'];
    for (const k of opKeys) {
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
  });

  it('valid baseline/observed calibration still matches frozen reference', async () => {
    const { world, ledger, baseline, scenario, manifest } = await m2Setup();
    const { computeWindowMetrics } = await import('../src/window.js');
    const { buildWorkload } = await import('../src/simulate.js');
    const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, TB, TB + 70 * 60, scenario.comparison_window);
    const cal: any = calibrate(
      baseline as any, obsMetrics, 'history:day1',
      manifest.files['normalized/events.ndjson'], canonHash(buildWorkload(ledger.events, TB, TB + 70 * 60)),
    );
    const expected = JSON.parse(await readFile(
      new URL('../../fixtures/restaurant-v0/expected/comparison.json', import.meta.url), 'utf8'));
    const expObs = expected.calibration_inputs.observed_day1_same_window;
    const opKeys = ['orders_arrived', 'orders_completed', 'orders_open_at_horizon', 'throughput_per_hour',
      'avg_kitchen_time_s', 'p90_kitchen_time_s', 'max_kitchen_time_s', 'over_target_share', 'delay_minutes_over_target'];
    for (const k of opKeys) expect(cal.observed.metrics[k]).toBe(expObs[k]);
    for (const st of ['st_fry', 'st_prep']) {
      expect(cal.observed.metrics.max_queue[st]).toBe(expObs.max_queue[st]);
      expect(cal.observed.metrics.overloaded_seconds[st]).toBe(expObs.overloaded_seconds[st]);
    }
    expect(cal.comparable).toBe(true);
  });

  it('calibrate rejects tampered baseline metrics', async () => {
    const { world, ledger, baseline, scenario, manifest } = await m2Setup();
    const { computeWindowMetrics } = await import('../src/window.js');
    const { buildWorkload } = await import('../src/simulate.js');
    const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, TB, TB + 70 * 60, scenario.comparison_window);
    const tampered: any = {
      receipt: baseline.receipt,
      windowMetrics: { ...baseline.windowMetrics, completed_orders: 999 },
      branch: baseline.branch,
    };
    expect(() =>
      calibrate(tampered, obsMetrics, 'history:day1',
        manifest.files['normalized/events.ndjson'], canonHash(buildWorkload(ledger.events, TB, TB + 70 * 60))),
    ).toThrow(/COMPARE_METRICS_MISMATCH/);
  });
});

describe('Condition 3 — runScenario input hash provenance', () => {
  it('fake world hash is rejected', async () => {
    const { world, ledger } = await m2Setup();
    await expect(
      runScenario({
        world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
        expectedWorldSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(RunScenarioError);
  });

  it('fake parent ledger hash is rejected', async () => {
    const { world, ledger } = await m2Setup();
    await expect(
      runScenario({
        world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
        expectedParentLedgerSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/RUNSCENARIO_LEDGER_HASH_MISMATCH/);
  });

  it('fake scenario hash is rejected', async () => {
    const { world, ledger } = await m2Setup();
    await expect(
      runScenario({
        world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
        expectedScenarioSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/RUNSCENARIO_SCENARIO_HASH_MISMATCH/);
  });

  it('valid expected hashes are accepted and receipt carries computed hashes', async () => {
    const { world, ledger } = await m2Setup();
    const expectedWorld = canonHash(world);
    const expectedLedger = canonHash(ledger.events);
    const scenarioBytes = await readFile(SCENARIO_FILE);
    const expectedScenario = createHash('sha256').update(scenarioBytes).digest('hex');
    const out = await runScenario({
      world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
      expectedWorldSha256: expectedWorld,
      expectedParentLedgerSha256: expectedLedger,
      expectedScenarioSha256: expectedScenario,
    });
    const rb: any = out.baseline.receipt;
    expect(rb.inputs.world_sha256).toBe(expectedWorld);
    expect(rb.inputs.parent_ledger_sha256).toBe(expectedLedger);
    expect(rb.source.scenario_sha256).toBe(expectedScenario);
  });

  it('omitted expected hashes still yield correctly computed receipt hashes', async () => {
    const { world, ledger } = await m2Setup();
    const out = await runScenario({ world, ledger: ledger.events, scenarioPath: SCENARIO_FILE });
    const rb: any = out.baseline.receipt;
    const rs: any = out.scenario.receipt;
    expect(rb.inputs.world_sha256).toBe(canonHash(world));
    expect(rb.inputs.parent_ledger_sha256).toBe(canonHash(ledger.events));
    expect(rs.inputs.world_sha256).toBe(canonHash(world));
    expect(rs.inputs.parent_ledger_sha256).toBe(canonHash(ledger.events));
    // Both arms share the same authoritative input hashes.
    expect(rs.inputs.world_sha256).toBe(rb.inputs.world_sha256);
    expect(rs.inputs.parent_ledger_sha256).toBe(rb.inputs.parent_ledger_sha256);
  });
});
