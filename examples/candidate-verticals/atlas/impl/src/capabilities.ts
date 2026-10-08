// Capability facade: JSON-in/JSON-out boundary for future SignalWorks use (16 §D9).
// No transport. No reducer, scheduler, checkpoint or ledger-index type crosses
// this boundary. SignalWorks is NOT integrated; this is the internal boundary.
import { buildSnapshot, evidenceRefs, diagnose, computeMetrics, iso } from './views.js';
import { reduceTo } from './reducer.js';
import { loadScenario } from './scenario.js';
import { runArm, buildWorkload, canonHash, sha256FileBytes } from './simulate.js';
import { compareScenarios as buildComparison, calibrate as buildCalibration } from './compare.js';
import { computeWindowMetrics } from './window.js';
import { buildBranchLog } from './branch.js';
import { loadWorld } from './world.js';
import { loadLedger } from './ledger.js';
import type { AtlasEvent, World, EvidenceRef, Seconds } from './types.js';

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

export { sha256FileBytes, canonHash, iso };
export type { World };

// ---------------------------------------------------------------------------
// M3 source loading (17 §4): the facade is the only engine-facing import for
// the experience layer. These load from file paths and return plain data.
// ---------------------------------------------------------------------------

/** Load a world from a JSON file path (for experience/source.ts). */
export async function loadWorldFile(worldPath: string, schemaPath: string): Promise<World> {
  return loadWorld(worldPath, schemaPath);
}

/** Load a ledger from an NDJSON file path (for experience/source.ts). */
export async function loadLedgerFile(ledgerPath: string, schemaPath: string): Promise<AtlasEvent[]> {
  const ledger = await loadLedger(ledgerPath, schemaPath);
  return ledger.events;
}

// ---------------------------------------------------------------------------
// M3 additive facade functions (17 §4). No change to existing signatures.
// ---------------------------------------------------------------------------

/**
 * buildBranchLedger({ledger, branchEvents, tB}) → AtlasEvent[] in E3 order:
 * parent events with t ≤ tB followed by the branch events.
 */
export function buildBranchLedger(input: {
  ledger: AtlasEvent[];
  branchEvents: AtlasEvent[];
  tB: number;
}): AtlasEvent[] {
  return asJson(buildBranchLog(input.ledger, input.tB as Seconds, input.branchEvents));
}

/**
 * getSupportingEvidence({world, ledger, t, entity}) → EvidenceRef[].
 * For a station: exactly the M1 evidenceRefs(world, state(t), t, ledger, station).
 * For any other entity: every event with t ≤ T whose subject equals the id or
 * whose data has work_id/order_id/employee_id/equipment_id/station_id equal to
 * the id, in ledger order.
 */
export function getSupportingEvidence(input: {
  world: World;
  ledger: AtlasEvent[];
  t: number;
  entity: string;
}): EvidenceRef[] {
  const { world, ledger, t, entity } = input;
  const isStation = (world.entities as { id: string; type: string }[]).some(
    (e) => e.id === entity && e.type === 'station',
  );
  if (isStation) {
    const { state } = reduceTo(world, ledger, t as Seconds);
    return asJson(evidenceRefs(world, state, t as Seconds, ledger, entity));
  }
  const touchKeys = ['work_id', 'order_id', 'employee_id', 'equipment_id', 'station_id'];
  const out: EvidenceRef[] = [];
  for (const e of ledger) {
    if (e.t > t) continue;
    const d = e.data as Record<string, unknown>;
    const touches =
      e.subject === entity || touchKeys.some((k) => d[k] === entity);
    if (!touches) continue;
    out.push({
      event_id: e.event_id,
      type: e.type,
      ts: e.ts,
      source: e.provenance.source,
      record_id: e.provenance.record_id,
      record_ts: e.provenance.record_ts,
      claim_class: e.provenance.claim_class,
      adapter: e.provenance.adapter,
      ...(e.provenance.note ? { note: e.provenance.note } : {}),
    });
  }
  return asJson(out);
}

/**
 * listInstants({ledger, from, to}) → distinct event t values with
 * from ≤ t ≤ to, ascending.
 */
export function listInstants(input: {
  ledger: AtlasEvent[];
  from: number;
  to: number;
}): number[] {
  const set = new Set<number>();
  for (const e of input.ledger) {
    if (e.t >= input.from && e.t <= input.to) set.add(e.t);
  }
  return [...set].sort((a, b) => a - b);
}
// ============================================================================

import { diagnoseAtTime as diagnoseImpl } from './diagnose/diagnose.js';
import { formatDiagnosis } from './diagnose/format.js';
import type { Diagnosis, ResolvedRef } from './diagnose/types.js';

/**
 * diagnoseAtTime({world, ledger, t, branch?}) → Diagnosis.
 * Per 18 §K. JSON in and out. Never mutates inputs. Does not rerun simulation.
 */
export function diagnoseAtTime(input: {
  world: World;
  ledger: AtlasEvent[];
  t: number;
  branch?: string;
}): Diagnosis {
  const diagnosis = diagnoseImpl({
    world: input.world,
    ledger: input.ledger,
    t: input.t,
    branch: input.branch,
  });
  // Return as JSON (deep copy) to ensure no internal references leak.
  return JSON.parse(JSON.stringify(diagnosis)) as Diagnosis;
}

/**
 * explainDiagnosis({diagnosis, claim_id?}) → {lines: [{claim_id, text, claim_class}]}.
 * Per 18 §K, §L. Pure function of the diagnosis.
 */
export function explainDiagnosis(input: {
  diagnosis: Diagnosis;
  claim_id?: string;
}): { lines: { claim_id: string; text: string; claim_class: string }[] } {
  const { diagnosis, claim_id } = input;
  const claims = claim_id
    ? diagnosis.claims.filter((c) => c.id === claim_id)
    : diagnosis.claims;
  if (claim_id && claims.length === 0) {
    throw new Error(`unknown claim_id: ${claim_id}`);
  }
  const lines = formatDiagnosis(claims, diagnosis.context.claim_class);
  return { lines };
}

/**
 * resolveDiagnosticEvidence({world, ledger, diagnosis, claim_id}) → ResolvedRef[].
 * Per 18 §K, §I. Resolves each ref in the claim.
 */
export function resolveDiagnosticEvidence(input: {
  world: World;
  ledger: AtlasEvent[];
  diagnosis: Diagnosis;
  claim_id: string;
}): ResolvedRef[] {
  const { world, ledger, diagnosis, claim_id } = input;
  const claim = diagnosis.claims.find((c) => c.id === claim_id);
  if (!claim) {
    throw new Error(`unknown claim_id: ${claim_id}`);
  }

  // Get the snapshot for state refs.
  const snap = getStateAtTime({
    world,
    ledger,
    t: diagnosis.context.t,
    branch: diagnosis.context.branch,
  }) as Record<string, unknown>;

  const resolved: ResolvedRef[] = [];
  for (const ref of claim.evidence) {
    let value: unknown = null;
    let refClaimClass: string | undefined;

    if (ref.kind === 'event') {
      const event = ledger.find((e) => e.event_id === ref.event_id);
      if (event) {
        value = {
          event_id: event.event_id,
          t: event.t,
          ts: event.ts,
          type: event.type,
          branch: event.branch,
          claim_class: (event.provenance as { claim_class: string }).claim_class,
          source: (event.provenance as { source: string }).source,
          record_id: (event.provenance as { record_id: string }).record_id,
        };
        refClaimClass = (event.provenance as { claim_class: string }).claim_class;
      }
    } else if (ref.kind === 'state') {
      // JSON pointer into the snapshot.
      value = resolvePointer(snap, ref.path!);
    } else if (ref.kind === 'world') {
      // JSON pointer into the world.
      value = resolvePointer(world as unknown as Record<string, unknown>, ref.path!);
    } else if (ref.kind === 'world_rule') {
      const rules = (world.rules as { id: string }[]);
      value = rules.find((r) => r.id === ref.rule) ?? null;
    }

    resolved.push({ ref, resolved: value, claim_class: refClaimClass });
  }

  return resolved;
}

/** Resolve a JSON pointer (RFC 6901) against an object. */
function resolvePointer(obj: Record<string, unknown>, pointer: string): unknown {
  if (!pointer.startsWith('/')) return null;
  const parts = pointer.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}
