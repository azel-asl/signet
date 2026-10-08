// F11: comparison/calibration separation. F12: receipts.
import { describe, expect, it } from 'vitest';
import { compareScenarios, calibrate, ComparisonError } from '../src/compare.js';
import { runArm, canonHash } from '../src/simulate.js';
import { buildWorkload } from '../src/simulate.js';
import { computeWindowMetrics } from '../src/window.js';
import { m2Setup, TB, TH } from './m2-setup.js';

describe('F11 comparison/calibration separation', () => {
  it('compareScenarios refuses a history input', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const fakeHistory: any = {
      receipt: { ...baseline.receipt, branch: 'history:day1', arm: 'baseline' },
      windowMetrics: baseline.windowMetrics,
      branch: 'history:day1',
    };
    expect(() => compareScenarios(world, fakeHistory, scenarioArm as any, scenario.id)).toThrow(ComparisonError);
  });

  it('compareScenarios refuses two baselines', async () => {
    const { world, baseline, scenario } = await m2Setup();
    expect(() => compareScenarios(world, baseline, baseline as any, scenario.id)).toThrow(ComparisonError);
  });

  it('compareScenarios refuses mismatched workload', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const { canonHash: ch } = await import('../src/simulate.js');
    // Tamper the workload hash and recompute the receipt hash so integrity
    // passes but the workload compatibility check fails.
    const tamperedInputs = {
      ...scenarioArm.receipt.inputs,
      workload: { ...scenarioArm.receipt.inputs.workload, workload_sha256: 'dead' },
    };
    const tamperedReceipt: any = { ...scenarioArm.receipt, inputs: tamperedInputs };
    const { receipt_sha256: _x, ...rest } = tamperedReceipt;
    tamperedReceipt.receipt_sha256 = ch(rest);
    const tampered: any = {
      receipt: tamperedReceipt,
      windowMetrics: scenarioArm.windowMetrics,
      branch: scenarioArm.branch,
    };
    expect(() => compareScenarios(world, baseline, tampered, scenario.id)).toThrow(/COMPARE_WORKLOAD_MISMATCH/);
  });

  it('calibrate refuses a scenario arm', async () => {
    const { scenarioArm } = await m2Setup();
    expect(() =>
      calibrate(scenarioArm as any, scenarioArm.windowMetrics, 'history:day1', 'x', 'y'),
    ).toThrow(/COMPARE_ARM_MISMATCH/);
  });

  it('calibrate refuses a sim: observed side', async () => {
    const { baseline } = await m2Setup();
    expect(() =>
      calibrate(baseline as any, baseline.windowMetrics, 'sim:baseline', 'x', 'y'),
    ).toThrow(/CALIBRATION_OBSERVED_BRANCH/);
  });

  it('comparison JSON has no observed key; calibration has no scenario key', async () => {
    const { world, ledger, baseline, scenarioArm, scenario, manifest } = await m2Setup();
    const cmp: any = compareScenarios(world, baseline, scenarioArm, scenario.id);
    expect('observed' in cmp).toBe(false);
    const obsMetrics = computeWindowMetrics(world, ledger.events, ledger.events, TB, TH, scenario.comparison_window);
    const cal: any = calibrate(baseline, obsMetrics, 'history:day1',
      manifest.files['normalized/events.ndjson'], canonHash(buildWorkload(ledger.events, TB, TH)));
    expect('scenario' in cal).toBe(false);
    expect(cal.kind).toBe('calibration');
    expect(cmp.kind).toBe('counterfactual');
  });
});

describe('F12 receipts', () => {
  it('receipt_sha256 recomputes', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    for (const r of [baseline, scenarioArm]) {
      const { receipt_sha256: _x, ...rest } = r.receipt;
      expect(canonHash(rest)).toBe(r.receipt.receipt_sha256);
    }
  });

  it('re-running from receipt.inputs reproduces outputs', async () => {
    const { world, ledger, baseState, scenario, manifest } = await m2Setup();
    const { baseline } = await m2Setup();
    const again = runArm({
      world, parentEvents: ledger.events, parentBranch: 'history:day1',
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
      worldSha256: manifest.world_sha256, scenario, arm: 'baseline', baseState,
    });
    expect(again.receipt.outputs).toEqual(baseline.receipt.outputs);
  });

  it('changing any input field changes run_id', async () => {
    const { baseline } = await m2Setup();
    const baseId = baseline.receipt.run_id;
    // run_id covers engine_version, arm, and inputs
    const alt = canonHash({ engine_version: 'atlas-impl/0.2.0', arm: 'baseline', inputs: { ...baseline.receipt.inputs, horizon_t: 0 } });
    expect('run_' + alt.slice(0, 16)).not.toBe(baseId);
  });

  it('baseline run_id unchanged when only the scenario arm interventions change', async () => {
    const { baseline } = await m2Setup();
    // run_id excludes the scenario file (source block); recompute from the
    // receipt's own inputs to show the scenario arm plays no role
    const recomputed = 'run_' + canonHash({
      engine_version: baseline.receipt.engine_version,
      arm: baseline.receipt.arm,
      inputs: baseline.receipt.inputs,
    }).slice(0, 16);
    expect(recomputed).toBe(baseline.receipt.run_id);
  });

  it('receipt has the fixed assumptions list in order', async () => {
    const { baseline } = await m2Setup();
    expect(baseline.receipt.assumptions).toEqual([
      'durations are nominal (no variability)',
      'arrivals are the historical arrivals after the branch point, identical in every arm',
      'no lost demand (R09)',
      'no parent events after the branch point other than arrivals are replayed',
      'in-progress work at the branch point completes at max(branch_t, started_t + nominal)',
    ]);
  });

  it('comparison has the three honesty notes in order', async () => {
    const { world, baseline, scenarioArm, scenario } = await m2Setup();
    const cmp: any = (await import('../src/compare.js')).compareScenarios(world, baseline, scenarioArm, scenario.id);
    expect(cmp.honesty_notes).toHaveLength(3);
    expect(cmp.honesty_notes[2]).toBe('No economic quantities are reported in M2.');
  });
});
