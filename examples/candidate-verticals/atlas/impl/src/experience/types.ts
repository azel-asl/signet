// Experience types (17 §5.1, §8). Types only — the renderer imports these as
// `import type` and they are erased at compile. No engine code here.
export type Rect = { x: number; y: number; w: number; h: number };

export type RegisterKind = 'observed' | 'baseline' | 'scenario';

export interface Register {
  kind: RegisterKind;
  branch: string;
  mode: 'RECONSTRUCT' | 'SIMULATE';
  claim_class: 'derived' | 'simulated';
  label: string;
  run_id: string | null;
  branch_point_t: number | null;
  horizon_t: number | null;
  range: { min_t: number; max_t: number };
  interventions: { id: string; employee: string; from: string | null; to: string | null; at_t: number }[];
}

export type FrameEntityKind = 'station' | 'equipment' | 'person' | 'work';

export interface FrameEntity {
  id: string;
  kind: FrameEntityKind;
  name: string;
  rect: Rect | null;
  container: string | null;
  state: Record<string, unknown>;
}

export interface ExperienceFrame {
  atlas_schema: 'atlas-frame/0.1';
  experience_version: string;
  world: { id: string; name: string };
  register: Register;
  t: number;
  ts: string;
  range: { min_t: number; max_t: number };
  snapshot_state_hash: string;
  ledger_events_applied: number;
  layout: { canvas: { w: number; h: number }; areas: Record<string, Rect>; flows: [string, string][] };
  entities: FrameEntity[];
  open_orders: { id: string; state: string; created: string; age_s: number; items: string[]; total: number }[];
  metrics: {
    orders_open: number;
    orders_completed: number;
    throughput_per_hour: number;
    avg_kitchen_time_s: number | null;
    p90_kitchen_time_s: number | null;
    over_target_share: number | null;
  };
  frame_hash: string;
}

export interface EventItem {
  event_id: string;
  t: number;
  ts: string;
  type: string;
  branch: string;
  claim_class: string;
  source: string;
  record_id: string;
  record_ts?: string;
  adapter?: string;
  derived_from?: string[];
  note?: string;
}

export interface Inspection {
  atlas_schema: 'atlas-inspection/0.1';
  register: Register;
  t: number;
  ts: string;
  entity: FrameEntity;
  relationships: { type: string; from: string; to: string }[];
  evidence: EventItem[];
  evidence_total: number;
  related_events: EventItem[];
  related_events_total: number;
  inspection_hash: string;
}

export const EXPERIENCE_VERSION = 'atlas-experience/0.1.0';
