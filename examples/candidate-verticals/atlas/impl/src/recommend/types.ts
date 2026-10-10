// ATLAS M5 RECOMMEND + ECONOMICS: core types.
// Implements the object model of frozen contract 19 §C, shaped by
// schema/atlas-recommendation.schema.json. Domain-free; the only domain
// knowledge lives in pack capabilities and the world.

export type ClaimClass = 'derived' | 'simulated' | 'assumed' | 'inferred' | 'observed';
export type Support = 'deterministic' | 'bounded' | 'none';

export interface InterventionWindow {
  start_t: number;
  end_t: number;
  label: string;
}

export interface Candidate {
  id: string; // cand:reassign_resource:<resource>:<to>:<window label>
  kind: 'reassign_resource';
  capability: string; // cap:<name>
  origin_claim: string; // M4 capacity_limit claim id
  resource: string; // person id
  from: string | null; // assignment at window.start_t
  to: string; // destination station id
  window: InterventionWindow;
  eligibility: {
    eligible: boolean;
    reasons: EligibilityReason[];
    evidence: EvidenceRef[];
  };
  simulation: {
    run_id: string;
    interventions: CompiledIntervention[];
    sim_events: number;
    trace_content_sha256: string;
  } | null;
  metrics: WindowMetrics | null;
  delta: MetricDelta | null;
  trade_offs: TradeOff[];
  new_overload_stations: string[];
  dominated_by: string[];
  economics: CandidateEconomics | null;
  status: CandidateStatus;
  rank: number | null;
  assumptions: string[];
  claim_class: 'derived' | 'simulated';
  support: 'deterministic' | 'none';
  evidence: EvidenceRef[];
}

export type EligibilityReason =
  | 'NOT_ON_SHIFT'
  | 'ALREADY_AT_DESTINATION'
  | 'SKILL_MISSING'
  | 'DESTINATION_NOT_STATION'
  | 'FROM_MISMATCH'
  | 'WINDOW_INVALID'
  | 'OUTSIDE_BRANCH_INTERVAL'
  | 'RESOURCE_DOUBLE_BOOKED';

export type CandidateStatus =
  | 'recommended'
  | 'conditionally_recommended'
  | 'not_recommended'
  | 'dominated'
  | 'infeasible'
  | 'insufficient_evidence';

export interface CompiledIntervention {
  id: string; // iv_01 | iv_02
  kind: 'reassign';
  employee: string;
  from: string | null;
  to: string | null;
  at: string; // ISO ts
  at_t: number;
}

export interface StationMetrics {
  queue_burden_s: number;
  overload_s: number;
  max_queue: number;
  overload_last_t: number | null;
}

export interface WindowMetrics {
  order_time_in_system_s: number;
  orders_completed_in_window: number;
  orders_open_at_horizon: number;
  delay_s_over_target_censored: number;
  stations: Record<string, StationMetrics>;
}

// delta = candidate - baseline. Station entries carry only the two
// additive fields the reference computes; max_queue/overload_last_t
// are absolute and reported in metrics.
export interface MetricDelta {
  order_time_in_system_s: number;
  orders_completed_in_window: number;
  orders_open_at_horizon: number;
  delay_s_over_target_censored: number;
  stations: Record<string, { queue_burden_s: number; overload_s: number }>;
}

export interface TradeOff {
  station: string;
  metric: 'queue_burden_s' | 'overload_s';
  baseline: number;
  scenario: number;
}

export interface EconomicInput {
  name: string;
  value: number;
  claim_class: 'assumed' | 'configured';
  source: EvidenceRef;
}

export interface EconomicValue {
  baseline_cost: number;
  scenario_cost: number;
  net_effect: number;
}

export interface CandidateEconomics {
  inputs: EconomicInput[];
  by_value: { low: EconomicValue; base: EconomicValue; high: EconomicValue };
  claim_class: 'assumed';
  support: 'bounded';
}

export type EvidenceRef =
  | { kind: 'event'; event_id: string }
  | { kind: 'state'; path: string }
  | { kind: 'world'; path: string }
  | { kind: 'diagnosis_claim'; claim_id: string }
  | { kind: 'sim_event'; run_id: string; event_id: string }
  | { kind: 'config'; path: string };

export interface RecommendationObjective {
  id: 'operational' | 'economic';
  primary_metric: 'order_time_in_system_s' | 'net_economic_effect';
  direction: 'minimize' | 'maximize';
  tie_breakers: string[];
  conditional_on: 'new_overload_stations';
  economic_value_key?: 'low' | 'base' | 'high';
}

export interface RecommendationSet {
  atlas_schema: 'atlas-recommendation/0.1';
  set_id: string;
  recommend_version: string;
  authority: 'advisory_only';
  packs: { id: string; version: string; capabilities: string[] }[];
  world: { id: string };
  context: {
    branch: string;
    claim_class: 'derived';
    t: number;
    ts: string;
    horizon_t: number;
    diagnosis_id: string;
    diagnosis_hash: string;
    snapshot_state_hash: string;
  };
  objective: RecommendationObjective;
  config_sha256: string;
  baseline: { run_id: string; metrics: WindowMetrics };
  candidates: Candidate[];
  ranking: string[];
  top: {
    kind: 'candidate' | 'no_action';
    candidate_id: string | null;
    reason: 'RANKED_FIRST' | 'NO_CANDIDATE_BETTER_THAN_BASELINE' | 'NO_SUPPORTED_INTERVENTION' | 'NO_ELIGIBLE_CANDIDATE';
    claim_class: 'simulated' | 'assumed';
    support: 'deterministic' | 'bounded';
  };
  sensitivity: {
    parameter: string;
    values: { low: number; base: number; high: number };
    economic_top_by_value: { low: string; base: string; high: string };
    stable: boolean;
  };
  set_hash: string;
}

export interface M5Config {
  atlas_schema: 'atlas-m5-config/0.1';
  candidate_windows: { label: string; start_offset_s: number; end_offset_s?: number; end?: 'horizon' }[];
  economics: { reassignment_cost_per_move: number; claim_class: 'assumed' };
  sensitivity: { delay_cost_per_order_minute: { low: number; base: number; high: number } };
}

export class RecommendationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RecommendationError';
    this.code = code;
  }
}
