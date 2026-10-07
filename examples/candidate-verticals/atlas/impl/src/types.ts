// ATLAS V0 core types (from 03-data-model.md). JSON-native; no methods.

export type Id = string;
export type BranchId = string;
export type Seconds = number;

export interface World {
  atlas_schema: 'atlas-world/0.1';
  metadata: { id: Id; name: string; version: string; domain: string; status?: string };
  time: { unit: 'second'; timezone: string; origin: string; end?: string };
  entity_types: EntityType[];
  entities: Entity[];
  relationships: Relationship[];
  aliases?: Record<string, Record<string, Id>>;
  processes: Process[];
  rules: Rule[];
  initial_state: InitialState;
  scheduled_events?: unknown[];
  arrival_model?: unknown;
  metrics: { id: string; unit?: string; definition?: string }[];
  goals: Goal[];
  economics?: {
    currency: string;
    labor_cost_per_hour?: Record<string, number>;
    delay_cost_per_order_minute_over_target?: { value: number; claim_class: string };
  };
  visualization?: { representation: string; objects?: Record<string, unknown> };
}

export interface EntityType { id: Id; attributes?: string[]; dynamic?: boolean }
export interface Entity { id: Id; type: Id; name?: string; attrs?: Record<string, unknown> }
export interface Relationship { type: string; from: Id; to: Id; attrs?: object }
export interface Step { id: Id; station: Id; duration_s: number; requires?: string }
export interface Process { id: Id; applies_to: Id | 'order'; steps: Step[]; handoff_s?: number }
export interface Rule { id: Id; kind: string; description: string; params?: object }
export interface InitialState {
  clock_in?: Id[];
  assignments: Record<Id, Id | null>;
  equipment: Record<Id, string>;
}
export interface Goal { id: string; metric: string; op: string; target: number; station?: Id; description?: string }

export type ClaimClass =
  | 'observed' | 'derived' | 'inferred' | 'assumed'
  | 'simulated' | 'human_reported' | 'human_corrected';

export interface Provenance {
  source: string;
  record_id: string;
  record_ts: string;
  ingested_at?: string;
  claim_class: ClaimClass;
  adapter: string;
  derived_from?: string[];
  confidence?: number | null;
  note?: string;
  correction_of?: string;
}

export interface AtlasEvent {
  seq: number;
  event_id: string;
  branch: BranchId;
  ts: string;
  t: Seconds;
  type: string;
  subject: Id;
  data: Record<string, unknown>;
  provenance: Provenance;
}

export type OrderState = 'OPEN' | 'READY' | 'COMPLETED';
export type WorkState = 'QUEUED' | 'IN_PROGRESS' | 'DONE';
export type EquipmentStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
export type StationStatus = 'NORMAL' | 'BUSY' | 'OVERLOADED' | 'UNSTAFFED';

export interface OrderFact {
  state: OrderState;
  created_t: Seconds; ready_t: Seconds | null; completed_t: Seconds | null;
  channel: string;
  items: { seq: number; product_id: Id }[];
  total: number;
}

export interface WorkFact {
  order_id: Id; item_seq: number; station_id: Id; step: Id; step_index: number;
  state: WorkState;
  queued_t: Seconds; started_t: Seconds | null; completed_t: Seconds | null;
}

/** WorldState: facts only (03). Views are derived, never stored here. */
export interface WorldState {
  t: Seconds;
  on_shift: Record<Id, boolean>;
  assignments: Record<Id, Id | null>;
  equipment: Record<Id, { status: EquipmentStatus; capacity: number; nominal_capacity: number }>;
  stations: Record<Id, { queue: Id[]; in_progress: Id[] }>;
  orders: Record<Id, OrderFact>;
  work: Record<Id, WorkFact>;
  reports: { t: Seconds; about: Id; reporter: Id; text: string }[];
  measurements: { t: Seconds; subject: Id; metric: string; value: number }[];
}

export interface Capacity { equipment: number; staff: number; effective: number }

export interface StationView {
  queue_len: number;
  in_progress: number;
  oldest_wait_s: number;
  capacity: Capacity;
  staff: Id[];
  status: StationStatus;
  utilization: number | null;
}

export interface Metrics {
  orders_open: number;
  orders_completed: number;
  throughput_per_hour: number;
  avg_kitchen_time_s: number | null;
  p90_kitchen_time_s: number | null;
  over_target_share: number | null;
  revenue_completed: number;
  stations: Record<Id, StationView>;
}

export interface Diagnosis {
  bottleneck: Id | null;
  claim_class: 'derived';
  summary: string;
  since_t?: Seconds | null;
  since?: string | null;
  queue_len?: number;
  oldest_wait_s?: number;
  utilization_15m?: number | null;
  capacity?: Capacity;
  binding_constraint?: 'staffing' | 'equipment' | 'both';
  affected_orders?: Id[];
  degraded_equipment?: { id: Id; status: EquipmentStatus; capacity: number; nominal_capacity: number; binding: boolean }[];
  downstream?: { station: Id; queue_len: number; status: StationStatus }[];
}

export interface EvidenceRef {
  event_id: string;
  type: string;
  ts: string;
  source: string;
  record_id: string;
  record_ts?: string;
  claim_class: ClaimClass;
  adapter: string;
  derived_from?: string[];
  note?: string;
}

export interface Checkpoint {
  t: Seconds;
  state: WorldState;
  ledger_seq: number;
  state_hash: string;
}
