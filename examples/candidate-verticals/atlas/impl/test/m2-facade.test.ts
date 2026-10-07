// F13: capability facade — JSON-in/JSON-out round-trips.
import { describe, expect, it } from 'vitest';
import {
  getStateAtTime, runScenario, compareScenariosFacade, calibrateFacade, getEvidence,
} from '../src/capabilities.js';
import { m2Setup, TB } from './m2-setup.js';
import { SCENARIO_FILE, FIX } from './paths.js';
import { readFile } from 'node:fs/promises';

describe('F13 capability facade', () => {
  it('getStateAtTime output round-trips through JSON unchanged', async () => {
    const { world, ledger } = await m2Setup();
    const t = TB;
    const out: any = getStateAtTime({ world, ledger: ledger.events, t, branch: 'history:day1' });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.state_hash).toBe('67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84');
  });

  it('runScenario output round-trips; both arms present', async () => {
    const { world, ledger, manifest } = await m2Setup();
    const out = await runScenario({
      world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
      worldSha256: manifest.world_sha256,
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
    });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect((out.baseline.receipt as any).outputs.events_generated).toBe(872);
    expect((out.scenario.receipt as any).outputs.events_generated).toBe(994);
  });

  it('compareScenarios facade output round-trips', async () => {
    const { world, ledger, manifest, scenario } = await m2Setup();
    const { baseline, scenario: scn } = await runScenario({
      world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
      worldSha256: manifest.world_sha256,
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
    });
    const cmp: any = compareScenariosFacade({ world, baseline, scenario: scn, scenarioId: scenario.id });
    expect(JSON.parse(JSON.stringify(cmp))).toEqual(cmp);
    expect(cmp.kind).toBe('counterfactual');
  });

  it('calibrate facade output round-trips', async () => {
    const { world, ledger, manifest, scenario } = await m2Setup();
    const { baseline } = await runScenario({
      world, ledger: ledger.events, scenarioPath: SCENARIO_FILE,
      worldSha256: manifest.world_sha256,
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
    });
    const cal: any = calibrateFacade({
      world, baseline, observedLedger: ledger.events, observedBranch: 'history:day1',
      observedLedgerSha256: manifest.files['normalized/events.ndjson'],
      tB: TB, tH: TB + 70 * 60, comparisonWindow: scenario.comparison_window,
    });
    expect(JSON.parse(JSON.stringify(cal))).toEqual(cal);
    expect(cal.kind).toBe('calibration');
    expect(cal.comparable).toBe(true);
  });

  it('getEvidence output round-trips and filters', async () => {
    const { ledger } = await m2Setup();
    const out: any = getEvidence({ ledger: ledger.events, subject: 'o_0031' });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e: any) => e.subject === 'o_0031')).toBe(true);
  });
});
