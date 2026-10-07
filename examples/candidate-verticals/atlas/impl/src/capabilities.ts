// Capability facade: JSON-in/JSON-out boundary for future SignalWorks use (16 §D9).
// No transport. No reducer, scheduler, checkpoint or ledger-index type crosses
// this boundary. SignalWorks is NOT integrated; this is the internal boundary.
import { buildSnapshot, evidenceRefs, diagnose, computeMetrics, iso } from './views.js';
import { reduceTo } from './reducer.js';
import { loadScenario } from './scenario.js';
import { runArm, buildWorkload, canonHash, sha256FileBytes } from './simulate.js';
import { compareScenarios as buildComparison, calibrate as buildCalibration } from './compare.js';
import { computeWindowMetrics } from './window.js';
import type { AtlasEvent, World } from './types.js';

function asJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** getStateAtTime({world, ledger, t, branch?}) → snapshot. */
export function getStateAtTime(input: { world: World; ledger: AtlasEvent[]; t: number; branch?: string }): Record<string, unknown> {
  const snap = buildSnapshot(input.world, {
    id: 'facade', title: 'facade', log: input.ledger, t: input.t,
    branch: input.branch ?? 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: '',
  });
  return asJson(snap);
}

export interface FacadeArm {
  receipt: unknown;
  events: unknown;
  windowMetrics: unknown;
}

/**
 * runScenario({world, ledger, scenario, worldSha256, parentLedgerSha256})
 * → { baseline: {receipt, events, windowMetrics}, scenario: {...} }.
 * The scenario is validated; both arms run deterministically.
 */
export async function runScenario(input: {
  world: World;
  ledger: AtlasEvent[];
  scenarioPath: string;
  worldSha256: string;
  parentLedgerSha256: string;
}): Promise<{ baseline: FacadeArm; scenario: FacadeArm }> {
  const { world, ledger } = input;
  const { readFile } = await import('node:fs/promises');
  const scenarioJson = JSON.parse(await readFile(input.scenarioPath, 'utf8'));
  const tB = Math.floor(Date.parse(scenarioJson.base.t) / 1000);
  const parentBranch = (ledger[0]?.branch as string) ?? 'history:day1';
  const { state: baseState } = reduceTo(world, ledger, tB);
  const scenario = await loadScenario(input.scenarioPath, world, baseState, parentBranch);
  const run = (arm: 'baseline' | 'scenario') =>
    runArm({
      world,
      parentEvents: ledger,
      parentBranch,
      parentLedgerSha256: input.parentLedgerSha256,
      worldSha256: input.worldSha256,
      scenario,
      arm,
      baseState,
    });
  const b = run('baseline');
  const s = run('scenario');
  const arm = (r: typeof b): FacadeArm => asJson({ receipt: r.receipt, events: r.events, windowMetrics: r.windowMetrics });
  return { baseline: arm(b), scenario: arm(s) };
}

/** compareScenarios({world, baseline, scenario, scenarioId}) → comparison. */
export function compareScenariosFacade(input: {
  world: World;
  baseline: FacadeArm;
  scenario: FacadeArm;
  scenarioId: string;
}): unknown {
  // Rehydrate the arm results the comparison needs.
  const b: any = input.baseline;
  const s: any = input.scenario;
  const cmp = buildComparison(
    input.world,
    { receipt: b.receipt, windowMetrics: b.windowMetrics, branch: b.receipt.branch } as any,
    { receipt: s.receipt, windowMetrics: s.windowMetrics, branch: s.receipt.branch } as any,
    input.scenarioId,
  );
  return asJson(cmp);
}

/**
 * calibrate({world, baseline, observedLedger, observedBranch, observedLedgerSha256, tB, tH, comparisonWindow})
 * → calibration. Observed window metrics and workload hash come from the ledger.
 */
export function calibrateFacade(input: {
  world: World;
  baseline: FacadeArm;
  observedLedger: AtlasEvent[];
  observedBranch: string;
  observedLedgerSha256: string;
  tB: number;
  tH: number;
  comparisonWindow: { from: string; to: string };
}): unknown {
  const b: any = input.baseline;
  const observedMetrics = computeWindowMetrics(
    input.world, input.observedLedger, input.observedLedger, input.tB, input.tH, input.comparisonWindow,
  );
  const observedWorkload = buildWorkload(input.observedLedger, input.tB, input.tH);
  const cal = buildCalibration(
    { receipt: b.receipt, windowMetrics: b.windowMetrics, branch: b.receipt.branch } as any,
    asJson(observedMetrics),
    input.observedBranch,
    input.observedLedgerSha256,
    canonHash(observedWorkload),
  );
  return asJson(cal);
}

/** getEvidence({ledger, subject?, work_id?}) → matching events with provenance. */
export function getEvidence(input: { ledger: AtlasEvent[]; subject?: string; work_id?: string }): unknown {
  const out = input.ledger
    .filter((e) => (!input.subject || e.subject === input.subject) &&
      (!input.work_id || (e.data.work_id as string) === input.work_id))
    .map((e) => ({
      event_id: e.event_id,
      seq: e.seq,
      branch: e.branch,
      t: e.t,
      ts: e.ts,
      type: e.type,
      subject: e.subject,
      claim_class: e.provenance.claim_class,
      record_id: e.provenance.record_id,
    }));
  return asJson(out);
}

export { sha256FileBytes };
export type { World };
