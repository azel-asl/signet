// F2: branching.
import { describe, expect, it } from 'vitest';
import { reduceTo } from '../src/reducer.js';
import { buildBranchLog } from '../src/branch.js';
import { buildSnapshot } from '../src/views.js';
import { canonicalJson } from '../src/canon.js';
import { m2Setup, TB } from './m2-setup.js';

describe('F2 branching', () => {
  it('base state hash == s3 (67f66b29…)', async () => {
    const { baseline } = await m2Setup();
    expect(baseline.branchPoint.base_state_hash).toBe(
      '67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84',
    );
  });

  it('events_applied == 544', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    expect(baseline.branchPoint.events_applied).toBe(544);
    expect(scenarioArm.branchPoint.events_applied).toBe(544);
  });

  it('branch ids are sim:baseline and sim:scenario', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    expect(baseline.branch).toBe('sim:baseline');
    expect(scenarioArm.branch).toBe('sim:scenario');
    expect(baseline.branch).not.toBe(scenarioArm.branch);
  });

  it('shared prefix: branch log starts with the parent events (t <= tB)', async () => {
    // F2 "(shared prefix)": the branch log's first events_applied entries are
    // exactly the parent prefix. (Branch events at tB itself are expected per
    // E5 — the first instant is always tB — so the full branch log reduced to
    // tB includes them; the shared part is the parent prefix.)
    const { world, ledger, baseline, scenarioArm } = await m2Setup();
    const parentPrefix = ledger.events.filter((e) => e.t <= TB);
    expect(parentPrefix.length).toBe(544);
    for (const r of [baseline, scenarioArm]) {
      const branchLog = buildBranchLog(ledger.events, TB, r.events);
      expect(branchLog.slice(0, 544).map((e) => e.event_id)).toEqual(
        parentPrefix.map((e) => e.event_id),
      );
      const viaPrefix = reduceTo(world, branchLog.slice(0, 544), TB);
      const viaHistory = reduceTo(world, ledger.events, TB);
      expect(canonicalJson(viaPrefix.state)).toBe(canonicalJson(viaHistory.state));
    }
  });

  it('branch events start at seq 545 with the D4 event_id form', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    expect(baseline.events[0].seq).toBe(545);
    expect(baseline.events[0].event_id).toBe('ev_sim:baseline_000001');
    expect(scenarioArm.events[0].event_id).toBe('ev_sim:scenario_000001');
    expect(baseline.events[0].provenance.record_id).toBe('sim:baseline:1');
  });
});
