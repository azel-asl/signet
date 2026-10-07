# 03 — Canonical data model

Types are given in TypeScript. JSON Schemas for the three on-disk documents are in
[schema/](schema/). Everything is JSON, versioned by an `atlas_schema` string, and loadable
without a database.

## Identity

```ts
type Id = string;            // ^[a-z][a-z0-9_]*$ ; stable, canonical, never a source identifier
type BranchId = `history:${string}` | `sim:${string}`;
type Seconds = number;       // integer unix seconds; the only time the engine orders on
```

## World (static structure)

```ts
interface World {
  atlas_schema: 'atlas-world/0.1';
  metadata: { id: Id; name: string; version: string; domain: string; status?: 'synthetic'|'reconstructed'|'live' };
  time: { unit: 'second'; timezone: string; origin: ISODate; end?: ISODate };
  entity_types: EntityType[];
  entities: Entity[];
  relationships: Relationship[];
  aliases?: Record<SourceId, Record<string, Id>>;    // deterministic entity resolution
  processes: Process[];
  rules: Rule[];
  initial_state: InitialState;
  scheduled_events?: EventCore[];                    // COMPOSE-mode inputs; empty for evidence-driven worlds
  arrival_model?: ArrivalModel;                      // used only when a run generates arrivals
  metrics: MetricDef[]; goals: Goal[];
  economics?: Economics;
  visualization?: Visualization;                     // hints; never semantics
}
interface EntityType { id: Id; attributes?: string[]; dynamic?: boolean }   // dynamic: instantiated by events (order, work_item)
interface Entity { id: Id; type: Id; name?: string; attrs?: Record<string, unknown> }
interface Relationship { type: 'located_in'|'attached_to'|'reports_to'|'depends_on'|'contains'|'feeds'; from: Id; to: Id; attrs?: object }
interface Process { id: Id; applies_to: Id | 'order'; steps: Step[]; handoff_s?: number }
interface Step { id: Id; station: Id; duration_s: number; requires?: 'all_items_complete' }
interface Rule { id: Id; kind: RuleKind; description: string; params?: object }
type RuleKind = 'station_capacity'|'queue_discipline'|'no_preemption'|'single_assignment'|'assembly_barrier'|'handoff'|'station_status'|'skills_required'|'no_balking';
```

**Semantic validation** (after schema validation; any failure rejects the whole file):
every `relationship.from/to`, `step.station`, `initial_state` key, and alias target is a
declared entity; every station in `initial_state.assignments` is in the employee's
`skills`; every product with a process has every step station of type `station`; `rules`
contains at least `station_capacity`, `queue_discipline`, `station_status`; no unknown
`RuleKind`; `visualization.objects` keys are entity ids.

## Events (the ledger)

```ts
type ClaimClass = 'observed'|'derived'|'inferred'|'assumed'|'simulated'|'human_reported'|'human_corrected';
interface Provenance {
  source: string; record_id: string; record_ts: ISODate; ingested_at?: ISODate;
  claim_class: ClaimClass; adapter: string;          // adapter id/version, or engine version for sim
  derived_from?: string[]; confidence?: number | null; note?: string; correction_of?: string;
}
interface Event {
  seq: number; event_id: string; branch: BranchId; ts: ISODate; t: Seconds;
  type: EventType; subject: Id; data: Record<string, unknown>; provenance: Provenance;
}
type EventType = 'EMPLOYEE_CLOCKED_IN'|'ASSIGNMENT_CHANGED'|'EQUIPMENT_STATE_CHANGED'|'MEASUREMENT_RECORDED'|'HUMAN_REPORT'
               | 'ORDER_CREATED'|'WORK_QUEUED'|'WORK_STARTED'|'WORK_COMPLETED'|'ORDER_READY'|'ORDER_COMPLETED';
```

Payloads (`data`) per type:

| Type | data | Changes state? |
|---|---|---|
| EMPLOYEE_CLOCKED_IN | `{employee_id}` | yes |
| ASSIGNMENT_CHANGED | `{employee_id, station_id \| null, reason}` | yes |
| EQUIPMENT_STATE_CHANGED | `{equipment_id, status, capacity, detail?}` | yes |
| MEASUREMENT_RECORDED | `{metric, value}` | no (recorded for evidence/inspection) |
| HUMAN_REPORT | `{about, reporter, text}` | no (recorded; corroborating evidence) |
| ORDER_CREATED | `{order_id, channel, items:[{seq, product_id}], total}` | yes |
| WORK_QUEUED | `{work_id, order_id, item_seq, station_id, step, step_index}` | yes |
| WORK_STARTED | `{work_id, station_id}` | yes |
| WORK_COMPLETED | `{work_id, station_id}` | yes |
| ORDER_READY | `{order_id}` | yes |
| ORDER_COMPLETED | `{order_id}` | yes |

Adding an event type is a schema version bump. The reducer throws on unknown types.

## WorldState (facts only)

```ts
interface WorldState {
  t: Seconds;
  on_shift: Record<Id, boolean>;
  assignments: Record<Id, Id | null>;                 // employee -> station
  equipment: Record<Id, { status: 'OPERATIONAL'|'DEGRADED'|'DOWN'; capacity: number; nominal_capacity: number }>;
  stations: Record<Id, { queue: Id[]; in_progress: Id[] }>;   // queue kept sorted by R02
  orders: Record<Id, { state: 'OPEN'|'READY'|'COMPLETED'; created_t: Seconds; ready_t: Seconds|null; completed_t: Seconds|null; channel: string; items: Item[]; total: number }>;
  work: Record<Id, { order_id: Id; item_seq: number; station_id: Id; step: Id; step_index: number; state: 'QUEUED'|'IN_PROGRESS'|'DONE'; queued_t: Seconds; started_t: Seconds|null; completed_t: Seconds|null }>;
  reports: { t: Seconds; about: Id; reporter: Id; text: string }[];
  measurements: { t: Seconds; subject: Id; metric: string; value: number }[];
}
```

Nothing in WorldState is a judgement. Status, capacity, utilization, age, bottleneck are
**views**:

```ts
interface Views {
  stations: Record<Id, { capacity: { equipment: number; staff: number; effective: number }; staff: Id[];
                         status: 'NORMAL'|'BUSY'|'OVERLOADED'|'UNSTAFFED'; queue_len: number; in_progress: number; oldest_wait_s: number; utilization: number|null }>;
  metrics: Metrics;                                    // defined in 06
  claim_class: 'derived';
}
```

## Snapshot (what the renderer consumes)

`Snapshot = { atlas_schema:'atlas-snapshot/0.1', id, world, branch, mode, claim_class:'derived'|'simulated', t, ts, engine, state: StateView, metrics, diagnosis?, evidence_refs?, state_hash }`
where `state_hash = sha256(canonicalJson({state, metrics}))`. See [schema/atlas-snapshot.schema.json](schema/atlas-snapshot.schema.json).
A snapshot is never `observed`: it is always a derivation.

## Scenario, intervention, simulation run, comparison

```ts
interface Scenario {
  atlas_schema: 'atlas-scenario/0.1'; id: Id; world: Id;
  base: { branch: BranchId; t: ISODate }; horizon: ISODate;
  arrivals: { source: 'historical_replay' } | { source: 'arrival_model'; seed: number };
  duration_model: 'nominal' | { kind: 'jitter'; seed: number; spread: number };
  in_progress_rule: string;                           // documented, single allowed value in V0
  seed: number;
  baseline: { interventions: Intervention[] }; scenario: { interventions: Intervention[] };
  comparison_window: { from: ISODate; to: ISODate };
  required_authority: AuthorityId;
}
type Intervention =
  | { id: Id; kind: 'reassign'; employee: Id; from: Id|null; to: Id|null; at: ISODate }
  | { id: Id; kind: 'equipment_state'; equipment: Id; status: 'OPERATIONAL'|'DEGRADED'|'DOWN'; capacity: number; at: ISODate }   // V0.2
  | { id: Id; kind: 'add_staff'; employee: Id; station: Id; at: ISODate; until: ISODate };                                        // V0.2
interface SimulationRun {
  run_id: string; scenario_id: Id; branch: BranchId; base_state_hash: string; base_t: Seconds; horizon_t: Seconds;
  engine_version: string; world_sha256: string; scenario_sha256: string; seed: number;
  assumptions: string[]; events_generated: number; trace_sha256: string; final_state_hash: string; metrics: WindowMetrics;
}
interface Comparison { atlas_schema:'atlas-comparison/0.1'; claim_class:'simulated'; baseline: WindowMetrics; scenario: WindowMetrics; delta: Record<string, number|null>; trade_offs: string[]; honesty_notes: string[] }
```

## Diagnosis, explanation, recommendation (V0.2)

```ts
interface Diagnosis { claim_class:'derived'; bottleneck: Id|null; since_t: Seconds|null; queue_len; oldest_wait_s; utilization_15m;
  capacity; binding_constraint: 'staffing'|'equipment'|'both'; affected_orders: Id[]; degraded_equipment: {id; status; capacity; nominal_capacity; binding: boolean}[]; downstream: {...}[]; summary: string }
interface Explanation { diagnosis: Diagnosis; rules_applied: Id[]; evidence: ProvenanceRef[]; measurements: {...}[]; counterfactual?: Comparison; prose?: { text: string; model_receipt: ModelReceipt } }
interface Recommendation { id; problem: Diagnosis; intervention: Intervention[]; reason: string; affected_entities: Id[]; expected_effect: Comparison; expected_economics: EconomicDelta;
  confidence: null | number; risks: string[]; trade_offs: string[]; alternatives: Id[]; simulation_runs: string[]; required_authority: AuthorityId; valid_from: ISODate; valid_until: ISODate }
```

## Authority, action, receipt (V0.2)

```ts
type AuthorityId = 'observe'|'explain'|'simulate'|'recommend'|'approve:staff_reassignment'|'execute:staff_reassignment';
interface Actor { id: Id; role: 'viewer'|'analyst'|'manager'; authorities: AuthorityId[] }
interface ActionRequest { kind: Intervention['kind']; intervention: Intervention; recommendation_id?: Id; requested_by: Id; t: Seconds }
interface ApprovalReceipt { receipt_version:'atlas-receipt-v1'; receipt_id; action: 'approval'; actor; authority_used: AuthorityId; recommendation_id; intervention; world_sha256; scenario_sha256; simulation_runs: string[]; timestamps; canon:'XAS-CANON-1'; hashes:{sha256; h10}; signature: null }
interface CalibrationRecord { metric: string; prediction: {baseline; scenario; predicted_delta}; observed: {before; after; observed_delta}; comparable: boolean; verdict: string; conditions: object; recorded_at: ISODate }
```

## Representation binding

`Visualization.objects` maps **entity id → rectangle**. The renderer looks up each entity
of the snapshot by id. An entity without a rectangle renders in a "unplaced" tray; a
rectangle without an entity is a validation error. Dynamic entities (orders, work) are
rendered inside the rectangle of the station in their state, by lookup, never by
computation.

## Versioning strategy

| Artifact | Version field | Rule |
|---|---|---|
| World definition | `atlas_schema: atlas-world/MAJOR.MINOR` + `metadata.version` semver | Loader supports exactly one MAJOR; MINOR adds optional fields only |
| Event | `atlas_schema` implied by ledger header line `{"atlas_schema":"atlas-ledger/0.1","world_sha256":...}` | Event type additions bump MINOR; payload changes bump MAJOR; reducer refuses mismatched MAJOR |
| Snapshot | `atlas_schema` + `engine` | A snapshot is reproducible only by the same engine version; tests pin both |
| Rules | `RuleKind` enum | Adding a kind bumps world MINOR; changing semantics of a kind bumps MAJOR |
| Engine | semver in every run and snapshot | Any change to reducer, scheduler, metric definitions, or ordering bumps PATCH at least, and must regenerate fixture hashes with a recorded reason |

## Domain generalization test

The same primitives, no restaurant-specific field in the schema:

| Primitive | Restaurant | Hospital imaging | Factory | Warehouse | Data centre |
|---|---|---|---|---|---|
| person | cook, expo | technologist, radiologist | operator | picker | on-call engineer |
| station | prep, grill, fry, pass | check-in, modality room, reading station | machine station | pick zone, pack, dock | service tier, deploy queue |
| equipment | fryer, grill | CT scanner, PACS node | CNC machine | forklift | server rack |
| order (dynamic) | ticket | imaging order / study | production order | shipment | incident / change request |
| work_item | item step at a station | protocol step, read | operation | pick line | runbook step |
| process | per product | per modality / exam type | per part routing | per order type | per incident class |
| capacity rule | min(equipment, staff × k) | min(rooms, techs × 1) | min(machines, operators × k) | min(forklifts, pickers) | min(replicas, engineers × k) |
| arrival | customer orders | referrals, STAT orders | demand orders | inbound orders | alerts |
| failure | fryer degraded | scanner down | machine fault | forklift down | node loss |
| intervention | reassign cook | add reader, reroute to modality | reroute part | add picker | scale replicas |

Restaurant-specific words appear only in the fixture (`st_fry`, `prod_burger`), never in
the schema or engine. The "pass" step is a generic `requires: all_items_complete` barrier.
