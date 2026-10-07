// Counterfactual comparison (D7) and calibration (D8) — 16 §D7, §D8.
//
// Comparison: simulated baseline vs simulated intervention = estimated effect.
// Calibration: observed history vs simulated baseline = model error.
// They are different document types; the builders refuse each other's inputs.
import { iso } from './views.js';
import type { Seconds, World } from './types.js';
import type { WindowMetrics } from './window.js';
import type { ArmResult, RunReceipt } from './simulate.js';

export class ComparisonError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ComparisonError';
    this.code = code;
  }
}

export const HONESTY_NOTES: string[] = [
  'Both arms receive identical historical arrivals as exogenous inputs; outcomes are simulated, not observed.',
  'Durations are nominal; the baseline differs from observed history. See the calibration document for model error.',
  'No economic quantities are reported in M2.',
];

export interface Comparison {
  atlas_schema: 'atlas-comparison/0.1';
  kind: 'counterfactual';
  claim_class: 'simulated';
  scenario_id: string;
  engine: string;
  branch_point: string;
  horizon: string;
  baseline_run: string;
  scenario_run: string;
  workload_sha256: string;
  baseline: WindowMetrics;
  scenario: WindowMetrics;
  delta: {
    orders_arrived: number | null;
    orders_completed: number | null;
    orders_open_at_horizon: number | null;
    throughput_per_hour: number | null;
    avg_kitchen_time_s: number | null;
    p90_kitchen_time_s: number | null;
    max_kitchen_time_s: number | null;
    over_target_share: number | null;
    delay_minutes_over_target: number | null;
    max_queue: Record<string, number>;
    overloaded_seconds: Record<string, number>;
    utilization_at_horizon_15m: Record<string, number | null>;
  };
  trade_offs: { station: string; metric: 'max_queue' | 'overloaded_seconds'; baseline: number; scenario: number }[];
  honesty_notes: string[];
}

function scalarDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return +(b - a).toFixed(2);
}

/**
 * Build the counterfactual comparison. Refuses unless both receipts are sim:*,
 * one baseline and one scenario arm, with equal workload, branch point,
 * horizon, world and engine version.
 */
export function compareScenarios(
  world: World,
  baseline: ArmResult,
  scenario: ArmResult,
  scenarioId: string,
): Comparison {
  const rb: RunReceipt = baseline.receipt;
  const rs: RunReceipt = scenario.receipt;
  if (!rb.branch.startsWith('sim:') || !rs.branch.startsWith('sim:')) {
    throw new ComparisonError('COMPARE_OBSERVED_INPUT', 'comparison requires two simulated arms');
  }
  if (rb.arm !== 'baseline' || rs.arm !== 'scenario') {
    throw new ComparisonError('COMPARE_ARM_MISMATCH', 'need one baseline arm and one scenario arm');
  }
  const eq = (a: unknown, b: unknown, code: string, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new ComparisonError(code, `${what} differs between arms`);
  };
  eq(rb.inputs.workload.workload_sha256, rs.inputs.workload.workload_sha256, 'COMPARE_WORKLOAD_MISMATCH', 'workload_sha256');
  eq(rb.inputs.branch_point.t, rs.inputs.branch_point.t, 'COMPARE_BRANCH_POINT_MISMATCH', 'branch_point');
  eq(rb.inputs.horizon_t, rs.inputs.horizon_t, 'COMPARE_HORIZON_MISMATCH', 'horizon_t');
  eq(rb.inputs.world_sha256, rs.inputs.world_sha256, 'COMPARE_WORLD_MISMATCH', 'world_sha256');
  eq(rb.engine_version, rs.engine_version, 'COMPARE_ENGINE_MISMATCH', 'engine_version');

  const b = baseline.windowMetrics;
  const s = scenario.windowMetrics;
  const stations = Object.keys(b.max_queue);

  const deltaMaxQueue: Record<string, number> = {};
  const deltaOverloaded: Record<string, number> = {};
  const deltaUtil: Record<string, number | null> = {};
  for (const st of stations) {
    deltaMaxQueue[st] = s.max_queue[st] - b.max_queue[st];
    deltaOverloaded[st] = s.overloaded_seconds[st] - b.overloaded_seconds[st];
    deltaUtil[st] = scalarDelta(b.utilization_at_horizon_15m[st], s.utilization_at_horizon_15m[st]);
  }

  const trade_offs: Comparison['trade_offs'] = [];
  for (const st of stations) {
    if (s.max_queue[st] > b.max_queue[st]) {
      trade_offs.push({ station: st, metric: 'max_queue', baseline: b.max_queue[st], scenario: s.max_queue[st] });
    }
    if (s.overloaded_seconds[st] > b.overloaded_seconds[st]) {
      trade_offs.push({ station: st, metric: 'overloaded_seconds', baseline: b.overloaded_seconds[st], scenario: s.overloaded_seconds[st] });
    }
  }

  return {
    atlas_schema: 'atlas-comparison/0.1',
    kind: 'counterfactual',
    claim_class: 'simulated',
    scenario_id: scenarioId,
    engine: rb.engine_version,
    branch_point: iso(world, rb.inputs.branch_point.t),
    horizon: iso(world, rb.inputs.horizon_t),
    baseline_run: rb.run_id,
    scenario_run: rs.run_id,
    workload_sha256: rb.inputs.workload.workload_sha256,
    baseline: b,
    scenario: s,
    delta: {
      orders_arrived: scalarDelta(b.orders_arrived, s.orders_arrived),
      orders_completed: scalarDelta(b.orders_completed, s.orders_completed),
      orders_open_at_horizon: scalarDelta(b.orders_open_at_horizon, s.orders_open_at_horizon),
      throughput_per_hour: scalarDelta(b.throughput_per_hour, s.throughput_per_hour),
      avg_kitchen_time_s: scalarDelta(b.avg_kitchen_time_s, s.avg_kitchen_time_s),
      p90_kitchen_time_s: scalarDelta(b.p90_kitchen_time_s, s.p90_kitchen_time_s),
      max_kitchen_time_s: scalarDelta(b.max_kitchen_time_s, s.max_kitchen_time_s),
      over_target_share: scalarDelta(b.over_target_share, s.over_target_share),
      delay_minutes_over_target: scalarDelta(b.delay_minutes_over_target, s.delay_minutes_over_target),
      max_queue: deltaMaxQueue,
      overloaded_seconds: deltaOverloaded,
      utilization_at_horizon_15m: deltaUtil,
    },
    trade_offs,
    honesty_notes: HONESTY_NOTES,
  };
}

export interface Calibration {
  atlas_schema: 'atlas-calibration/0.1';
  kind: 'calibration';
  window: { from: string; to: string; minutes: number };
  predicted: { branch: string; run_id: string; claim_class: 'simulated'; metrics: WindowMetrics };
  observed: { branch: string; ledger_sha256: string; claim_class: 'derived'; metrics: WindowMetrics };
  conditions: { same_arrivals: boolean; predicted_workload_sha256: string; observed_workload_sha256: string };
  comparable: boolean;
  residual: Comparison['delta'];
  note: string;
}

/**
 * Build the calibration (observed history vs simulated baseline).
 * Refuses a scenario arm and a non-history:* observed side.
 */
export function calibrate(
  baseline: ArmResult,
  observedMetrics: WindowMetrics,
  observedBranch: string,
  observedLedgerSha256: string,
  observedWorkloadSha256: string,
): Calibration {
  if (baseline.receipt.arm !== 'baseline') {
    throw new ComparisonError('CALIBRATION_REQUIRES_BASELINE', 'calibration requires the baseline arm, not a scenario arm');
  }
  if (!observedBranch.startsWith('history:')) {
    throw new ComparisonError('CALIBRATION_OBSERVED_BRANCH', 'observed side must be a history:* branch');
  }
  const predictedW = baseline.receipt.inputs.workload.workload_sha256;
  const same_arrivals = predictedW === observedWorkloadSha256;
  const p = baseline.windowMetrics;
  const o = observedMetrics;
  const stations = Object.keys(p.max_queue);
  const residual: Comparison['delta'] = {
    orders_arrived: scalarDelta(p.orders_arrived, o.orders_arrived),
    orders_completed: scalarDelta(p.orders_completed, o.orders_completed),
    orders_open_at_horizon: scalarDelta(p.orders_open_at_horizon, o.orders_open_at_horizon),
    throughput_per_hour: scalarDelta(p.throughput_per_hour, o.throughput_per_hour),
    avg_kitchen_time_s: scalarDelta(p.avg_kitchen_time_s, o.avg_kitchen_time_s),
    p90_kitchen_time_s: scalarDelta(p.p90_kitchen_time_s, o.p90_kitchen_time_s),
    max_kitchen_time_s: scalarDelta(p.max_kitchen_time_s, o.max_kitchen_time_s),
    over_target_share: scalarDelta(p.over_target_share, o.over_target_share),
    delay_minutes_over_target: scalarDelta(p.delay_minutes_over_target, o.delay_minutes_over_target),
    max_queue: {},
    overloaded_seconds: {},
    utilization_at_horizon_15m: {},
  };
  for (const st of stations) {
    residual.max_queue[st] = o.max_queue[st] - p.max_queue[st];
    residual.overloaded_seconds[st] = o.overloaded_seconds[st] - p.overloaded_seconds[st];
    residual.utilization_at_horizon_15m[st] = scalarDelta(p.utilization_at_horizon_15m[st], o.utilization_at_horizon_15m[st]);
  }
  return {
    atlas_schema: 'atlas-calibration/0.1',
    kind: 'calibration',
    window: p.window,
    predicted: { branch: baseline.branch, run_id: baseline.receipt.run_id, claim_class: 'simulated', metrics: p },
    observed: { branch: observedBranch, ledger_sha256: observedLedgerSha256, claim_class: 'derived', metrics: o },
    conditions: { same_arrivals, predicted_workload_sha256: predictedW, observed_workload_sha256: observedWorkloadSha256 },
    comparable: same_arrivals,
    residual,
    note: 'Observed vs simulated baseline measures model error. It is not an intervention effect.',
  };
}

export type { Seconds };
