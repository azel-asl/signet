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

export class GetStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'GetStateError';
    this.code = code;
  }
}

type LedgerClass =
  | { mode: 'RECONSTRUCT'; claim_class: 'derived'; branch?: undefined; arm?: undefined }
  | { mode: 'SIMULATE'; claim_class: 'simulated'; branch: string; arm: 'baseline' | 'scenario' };

/**
 * Derive the ledger's claim semantics from the ledger itself (Condition 1).
 * A ledger containing simulated events is a simulated branch; the branch id
 * and arm come from those events' branch field (sim:<arm>:<scenario_id>).
 * A ledger with no simulated events is historical. Never infer from timestamps.
 */
function classifyLedger(ledger: AtlasEvent[]): LedgerClass {
  const simEvents = ledger.filter((e) => (e.provenance as { claim_class?: string } | undefined)?.claim_class === 'simulated');
  if (simEvents.length === 0) {
    return { mode: 'RECONSTRUCT', claim_class: 'derived' };
  }
  const branches = [...new Set(simEvents.map((e) => e.branch).filter(Boolean))];
  if (branches.length !== 1) {
    throw new GetStateError('GETSTATE_MIXED_BRANCHES', `ledger has simulated events from ${branches.length} branches`);
  }
  const branchId = branches[0] as string;
  const m = /^sim:(baseline|scenario)$/.exec(branchId);
  if (!m) {
    throw new GetStateError('GETSTATE_BAD_SIM_BRANCH', `unrecognized simulated branch id: ${branchId}`);
  }
  return { mode: 'SIMULATE', claim_class: 'simulated', branch: branchId, arm: m[1] as 'baseline' | 'scenario' };
}

/**
 * getStateAtTime({world, ledger, t, branch?}) → snapshot.
 * The mode/claim_class/arm are derived from the ledger itself. If the caller
 * supplies branch metadata, it must match the derived classification;
 * a simulated ledger can never silently appear historical.
 */
export function getStateAtTime(input: { world: World; ledger: AtlasEvent[]; t: number; branch?: string }): Record<string, unknown> {
  const cls = classifyLedger(input.ledger);
  if (input.branch !== undefined) {
    if (cls.mode === 'SIMULATE') {
      if (input.branch !== cls.branch) {
        throw new GetStateError(
          'GETSTATE_BRANCH_MISMATCH',
          `caller branch '${input.branch}' does not match ledger branch '${cls.branch}'`,
        );
      }
    } else if (input.branch.startsWith('sim:')) {
      throw new GetStateError(
        'GETSTATE_BRANCH_MISMATCH',
        `historical ledger cannot be labeled with simulated branch '${input.branch}'`,
      );
    }
  }
  const branch = cls.mode === 'SIMULATE' ? cls.branch : (input.branch ?? 'history:day1');
  const snap = buildSnapshot(input.world, {
    id: 'facade', title: 'facade', log: input.ledger, t: input.t,
    branch, mode: cls.mode, claim_class: cls.claim_class, narrative: '',
  });
  const out = asJson(snap) as Record<string, unknown>;
  if (cls.mode === 'SIMULATE') {
    out.arm = cls.arm;
  }
  return out;
}

export interface FacadeArm {
  receipt: unknown;
  events: unknown;
  windowMetrics: unknown;
}

export class RunScenarioError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RunScenarioError';
    this.code = code;
  }
}

/**
 * runScenario({world, ledger, scenarioPath, expectedWorldSha256?, expectedParentLedgerSha256?, expectedScenarioSha256?})
 * → { baseline: {receipt, events, windowMetrics}, scenario: {...} }.
 * The scenario is validated; both arms run deterministically.
 *
 * Condition 3: the receipt records hashes computed from the actual inputs used
 * by the engine (canonical XAS-CANON-1 hashes of the world object, ledger array,
 * and scenario file bytes). Caller-supplied expected* hashes are treated only
 * as assertions: the actual hash is computed and the call is rejected on mismatch.
 */
export async function runScenario(input: {
  world: World;
  ledger: AtlasEvent[];
  scenarioPath: string;
  expectedWorldSha256?: string;
  expectedParentLedgerSha256?: string;
  expectedScenarioSha256?: string;
}): Promise<{ baseline: FacadeArm; scenario: FacadeArm }> {
  const { world, ledger } = input;
  // Authoritative hashes from the actual inputs used in the run.
  const actualWorldSha256 = canonHash(world);
  const actualParentLedgerSha256 = canonHash(ledger);
  if (input.expectedWorldSha256 !== undefined && input.expectedWorldSha256 !== actualWorldSha256) {
    throw new RunScenarioError(
      'RUNSCENARIO_WORLD_HASH_MISMATCH',
      'expected world hash does not match the actual world input',
    );
  }
  if (input.expectedParentLedgerSha256 !== undefined && input.expectedParentLedgerSha256 !== actualParentLedgerSha256) {
    throw new RunScenarioError(
      'RUNSCENARIO_LEDGER_HASH_MISMATCH',
      'expected parent ledger hash does not match the actual ledger input',
    );
  }
  const { readFile } = await import('node:fs/promises');
  const scenarioJson = JSON.parse(await readFile(input.scenarioPath, 'utf8'));
  const tB = Math.floor(Date.parse(scenarioJson.base.t) / 1000);
  const parentBranch = (ledger[0]?.branch as string) ?? 'history:day1';
  const { state: baseState } = reduceTo(world, ledger, tB);
  const scenario = await loadScenario(input.scenarioPath, world, baseState, parentBranch);
  // loadScenario hashes the scenario file bytes itself; authoritative.
  if (input.expectedScenarioSha256 !== undefined && input.expectedScenarioSha256 !== scenario.sha256) {
    throw new RunScenarioError(
      'RUNSCENARIO_SCENARIO_HASH_MISMATCH',
      'expected scenario hash does not match the actual scenario file',
    );
  }
  const run = (arm: 'baseline' | 'scenario') =>
    runArm({
      world,
      parentEvents: ledger,
      parentBranch,
      parentLedgerSha256: actualParentLedgerSha256,
      worldSha256: actualWorldSha256,
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
