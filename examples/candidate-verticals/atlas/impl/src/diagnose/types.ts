// ATLAS M4 DIAGNOSE: type definitions per 18 §C.
// These are transport types; the frozen schema is authoritative.
export type ClaimKind =
  | 'overload' | 'backlog' | 'backlog_growth' | 'demand_vs_capacity'
  | 'at_capacity' | 'capacity_limit' | 'equipment_degradation'
  | 'assembly_blocking' | 'unknown';

export type ClaimRole =
  | 'symptom' | 'condition' | 'limitation' | 'non_limitation'
  | 'downstream_effect' | 'unknown';

export type ClaimBasis = 'state' | 'rule' | 'structure' | 'inference';
export type ClaimClass = 'derived' | 'simulated' | 'inferred';
export type ClaimSupport = 'deterministic' | 'bounded' | 'none';

export type RefKind = 'event' | 'state' | 'world' | 'world_rule';
export interface Ref {
  kind: RefKind;
  event_id?: string;
  path?: string;
  rule?: string;
}

export interface ClaimLink {
  rel: 'supports' | 'limited_by' | 'blocks';
  to: string;
}

export type UnknownReason =
  | 'MODEL_UNEXPLAINED_IDLE' | 'RULE_NOT_APPLICABLE'
  | 'MISSING_RELATIONSHIP' | 'INSUFFICIENT_WINDOW' | 'CONFLICTING_FACTS';

export interface Claim {
  id: string;
  kind: ClaimKind;
  role: ClaimRole;
  subject: string;
  template: string;
  values: Record<string, number | string | boolean | string[] | null>;
  basis: ClaimBasis;
  rule: { id: string; version: string; world_rules: string[] };
  claim_class: ClaimClass;
  support: ClaimSupport;
  confidence: { value: number; method: string } | null;
  assumptions: string[];
  evidence: Ref[];
  links: ClaimLink[];
  onset_t?: number | null;
  onset_in_parent?: boolean;
  reason?: UnknownReason;
}

export interface DiagnosisContext {
  branch: string;
  mode: 'RECONSTRUCT' | 'SIMULATE';
  claim_class: 'derived' | 'simulated';
  t: number;
  ts: string;
  window_s: 900;
  snapshot_state_hash: string;
  ledger_events_applied: number;
}

export interface Diagnosis {
  atlas_schema: 'atlas-diagnosis/0.1';
  diagnosis_id: string;
  diagnostics_version: 'atlas-diagnose/0.1.0';
  packs: { id: string; version: string; requires_rule_kinds: string[] }[];
  world: { id: string };
  context: DiagnosisContext;
  claims: Claim[];
  roots: string[];
  diagnosis_hash: string;
}

export interface ResolvedRef {
  ref: Ref;
  resolved: unknown;
  claim_class?: string;
}

export class DiagnosisError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'DiagnosisError';
    this.code = code;
  }
}
