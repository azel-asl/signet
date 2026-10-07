// Simulation arms: branch, schedule, number events, build receipts (16 §D3–D5, §E3, §E6).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runScheduler, type EmittedEvent } from './scheduler.js';
import { branchId, buildBranchLog, buildBranchPoint, type Arm, type BranchPoint } from './branch.js';
import { sortByReductionOrder, reductionKey, compareKeys } from './ledger.js';
import { reduceTo } from './reducer.js';
import { buildSnapshot, computeMetrics, iso } from './views.js';
import { canonicalJson, sha256Hex } from './canon.js';
import { ENGINE_VERSION, type Intervention, type Scenario } from './scenario.js';
import { computeWindowMetrics, type WindowMetrics } from './window.js';
import type { AtlasEvent, Seconds, World, WorldState } from './types.js';

export function canonHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface RunReceipt {
  atlas_schema: 'atlas-run/0.1';
  canon: 'XAS-CANON-1';
  run_id: string;
  engine_version: string;
  arm: Arm;
  branch: `sim:${Arm}`;
  source: { scenario_id: string; scenario_sha256: string; required_authority: string };
  inputs: {
    world_sha256: string;
    parent_ledger_sha256: string;
    branch_point: BranchPoint;
    horizon_t: Seconds;
    horizon_ts: string;
    workload: {
      source: 'historical_replay';
      from_branch: string;
      after_t: Seconds;
      until_t: Seconds;
      count: number;
      workload_sha256: string;
    };
    interventions: { id: string; kind: string; employee: string; from: string | null; to: string | null; at: string }[];
    config: { duration_model: 'nominal'; in_progress_rule: string; seed: number };
  };
  outputs: {
    events_generated: number;
    first_seq: number;
    last_seq: number;
    trace_sha256: string;
    trace_content_sha256: string;
    final_state_hash: string;
    window_metrics_sha256: string;
  };
  assumptions: string[];
  receipt_sha256: string;
}

export const RECEIPT_ASSUMPTIONS: string[] = [
  'durations are nominal (no variability)',
  'arrivals are the historical arrivals after the branch point, identical in every arm',
  'no lost demand (R09)',
  'no parent events after the branch point other than arrivals are replayed',
  'in-progress work at the branch point completes at max(branch_t, started_t + nominal)',
];

export interface ArmResult {
  arm: Arm;
  branch: `sim:${Arm}`;
  branchPoint: BranchPoint;
  events: AtlasEvent[]; // numbered, in reduction order
  windowMetrics: WindowMetrics;
  receipt: RunReceipt;
}

export interface SimulateInput {
  world: World;
  parentEvents: AtlasEvent[]; // reduction order
  parentBranch: string;
  parentLedgerSha256: string;
  worldSha256: string;
  scenario: Scenario;
  arm: Arm;
  baseState: WorldState; // reduceTo(parentEvents, tB)
}

/** Project the exogenous workload: parent ORDER_CREATED with tB < t <= tH. */
export function buildWorkload(
  parentEvents: AtlasEvent[],
  tB: Seconds,
  tH: Seconds,
): { t: Seconds; type: string; subject: string; data: Record<string, unknown> }[] {
  const arr = parentEvents
    .filter((e) => e.type === 'ORDER_CREATED' && e.t > tB && e.t <= tH)
    .map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data as Record<string, unknown> }));
  // reduction order (they already are, but be explicit)
  arr.sort((a, b) => a.t - b.t || compareKeys(reductionKey(a as any), reductionKey(b as any)));
  return arr;
}

/** Number branch events per D4/E6 after sorting into reduction order. */
export function numberBranchEvents(
  world: World,
  arm: Arm,
  eventsApplied: number,
  emitted: EmittedEvent[],
): AtlasEvent[] {
  const branch = branchId(arm);
  const sorted = sortByReductionOrder(
    emitted.map((e) => ({ ...e })),
  );
  // keys must be unique within a branch (E6 assert)
  const seen = new Set<string>();
  for (const e of sorted) {
    const k = JSON.stringify([e.t, e.type, e.subject, (e.data.work_id as string) ?? '']);
    if (seen.has(k)) throw new Error(`duplicate reduction key in branch ${branch}: ${k}`);
    seen.add(k);
  }
  return sorted.map((e, i) => {
    const n = i + 1;
    const ts = iso(world, e.t);
    return {
      seq: eventsApplied + n,
      event_id: `ev_${branch}_${String(n).padStart(6, '0')}`,
      branch,
      ts,
      t: e.t,
      type: e.type,
      subject: e.subject,
      data: e.data,
      provenance: {
        source: 'simulation',
        record_id: `${branch}:${n}`,
        record_ts: ts,
        claim_class: e.claim_class,
        adapter: ENGINE_VERSION,
        ...(e.note ? { note: e.note } : {}),
      },
    };
  });
}

export function runArm(input: SimulateInput): ArmResult {
  const { world, parentEvents, parentBranch, scenario, arm } = input;
  const tB = scenario.base.t_s;
  const tH = scenario.horizon_t;
  const branch = branchId(arm);

  // base snapshot for the branch-point hash (must equal s3)
  const baseSnap: any = buildSnapshot(world, {
    id: 'base', title: 'base', log: parentEvents, t: tB,
    branch: parentBranch, mode: 'RECONSTRUCT', claim_class: 'derived', narrative: '',
  });
  const branchPoint = buildBranchPoint(world, parentEvents, parentBranch as any, tB, baseSnap.state_hash as string);

  const workload = buildWorkload(parentEvents, tB, tH);
  const workload_sha256 = canonHash(workload);

  const interventions = arm === 'baseline' ? scenario.baseline_interventions : scenario.scenario_interventions;

  const procOrder = world.processes.find((p) => p.applies_to === 'order');
  const handoff_s = Number((procOrder as any)?.handoff_s ?? 60);

  const { events: emitted } = runScheduler({
    world,
    baseState: input.baseState,
    tB,
    tH,
    arrivals: workload,
    interventions,
    handoff_s,
  });

  const events = numberBranchEvents(world, arm, branchPoint.events_applied, emitted);
  const branchLog = buildBranchLog(parentEvents, tB, events);

  // final snapshot at the horizon over the branch log
  const finalSnap: any = buildSnapshot(world, {
    id: `${arm}-final`, title: `${arm} at horizon`, log: branchLog, t: tH,
    branch, mode: 'SIMULATE', claim_class: 'simulated', narrative: '',
  });

  const windowMetrics = computeWindowMetrics(world, parentEvents, branchLog, tB, tH, scenario.comparison_window);

  const cleanInterventions = interventions.map((iv) => ({
    id: iv.id, kind: iv.kind, employee: iv.employee, from: iv.from, to: iv.to, at: iv.at,
  }));

  const receiptInputs = {
    world_sha256: input.worldSha256,
    parent_ledger_sha256: input.parentLedgerSha256,
    branch_point: branchPoint,
    horizon_t: tH,
    horizon_ts: iso(world, tH),
    workload: {
      source: 'historical_replay' as const,
      from_branch: parentBranch,
      after_t: tB,
      until_t: tH,
      count: workload.length,
      workload_sha256,
    },
    interventions: cleanInterventions,
    config: {
      duration_model: 'nominal' as const,
      in_progress_rule: scenario.in_progress_rule,
      seed: scenario.seed,
    },
  };

  const trace_sha256 = canonHash(events);
  const trace_content_sha256 = canonHash(
    events.map((e) => {
      const { adapter: _a, ...prov } = e.provenance;
      return { ...e, provenance: prov };
    }),
  );

  const outputs = {
    events_generated: events.length,
    first_seq: events.length ? events[0].seq : 0,
    last_seq: events.length ? events[events.length - 1].seq : 0,
    trace_sha256,
    trace_content_sha256,
    final_state_hash: finalSnap.state_hash as string,
    window_metrics_sha256: canonHash(windowMetrics),
  };

  const run_id = 'run_' + canonHash({ engine_version: ENGINE_VERSION, arm, inputs: receiptInputs }).slice(0, 16);

  const receipt: RunReceipt = {
    atlas_schema: 'atlas-run/0.1',
    canon: 'XAS-CANON-1',
    run_id,
    engine_version: ENGINE_VERSION,
    arm,
    branch,
    source: {
      scenario_id: scenario.id,
      scenario_sha256: scenario.sha256,
      required_authority: scenario.required_authority,
    },
    inputs: receiptInputs,
    outputs,
    assumptions: RECEIPT_ASSUMPTIONS,
    receipt_sha256: '',
  };
  const { receipt_sha256: _r, ...rest } = receipt;
  receipt.receipt_sha256 = canonHash(rest);

  return { arm, branch, branchPoint, events, windowMetrics, receipt };
}

export async function sha256FileBytes(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}
