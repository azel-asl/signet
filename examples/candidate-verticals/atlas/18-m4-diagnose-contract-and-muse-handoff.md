# 18 — ATLAS V0 Milestone 4 contract: DIAGNOSE, and Muse handoff

**Status:** FROZEN as the Muse Milestone 4 contract on 2026-10-08; amended by CCR-005 (2026-10-08).
**Spec owner:** Opus. Fable on escalation only.
**Reference:** this file's commit on `claude/youthful-ride-3hx3o1` (parent `40ab1fc`).
**Implementation base:** `muse/atlas-v0` @ `5758738` (M1, M2, M3 PASS).
**Frozen artifacts:** this file; `schema/atlas-diagnosis.schema.json`;
`reference/m4/derive-expectations.mjs`; `reference/m4/diagnosis-expectations.json`
(sha256 `4d7809ae65af68bbb881b236fe91a30a5f1ef8ca8c36c0254de13309dd6d5e67`).

M4 answers what is wrong, where, since when, under which operational condition, what limits it,
what it holds up downstream, what supports each statement, and what ATLAS cannot tell. It does
not answer what to do. It refines 08 §"Bottleneck detection" and §"Explanation"; the frozen
snapshot `diagnosis` block (M1) is unchanged and stays a frozen artifact.

---

## A. Architecture decision

```
getStateAtTime(world, branch log, t)          (M1/M2, unchanged; classifies branch)
        │ snapshot (state + views) + branch log + world
        ▼
diagnostics core  ── context, claim model, link validation, epistemic rules, temporal scan,
        │             formatter, hashing. Knows no domain words.
        ▼
rule pack "station-flow/0.1"  ── pure functions keyed on world RULE KINDS
        │                       (station_capacity, assembly_barrier, station_status),
        │                       never on entity ids or restaurant words
        ▼
atlas-diagnosis/0.1  (claims DAG)  ──► explanation formatter (templates) ──► facade / service
```

Decisions:
1. **Deterministic only in V0.** The restaurant fixture is diagnosed with zero model calls (08).
2. **Diagnosis is a projection.** It reads the snapshot, branch log and world; it never writes
   state, ledger, checkpoints or snapshots, and it never reruns the scheduler.
3. **Evidence-linked claim DAG, simplified (adopted, §H).** One diagnosis is a small DAG of claims
   for one (branch, t) with three link types. No global or persistent knowledge graph.
4. **Domain methodology lives in packs.** The core is pack-agnostic. A pack declares the world rule
   kinds it requires and is skipped (with an `unknown: RULE_NOT_APPLICABLE` claim) when they are absent.
5. **Separate document from the snapshot.** The M1 snapshot `diagnosis` stays as frozen; M4 adds
   `atlas-diagnosis/0.1` and must agree with it (§N, T-LEGACY).

## B. Scope and non-goals

In scope: the claim model and validator; the station-flow pack; temporal onset; observed and
simulated branches; the deterministic explanation formatter; three facade functions; one service
endpoint and a read-only diagnosis section in the M3 inspector; the answer key and tests.

Not in scope: recommendations, intervention choice, economics, execution, any LLM or specialist
implementation, root-cause narrative beyond the three link types, predicted resolution, contradiction
objects, persistence or supersession of diagnoses, new rule kinds, new event types, CCR-003, M5.

## C. Data contract — `atlas-diagnosis/0.1`

Normative JSON Schema: `schema/atlas-diagnosis.schema.json`.

```ts
interface Diagnosis {
  atlas_schema: 'atlas-diagnosis/0.1';
  diagnosis_id: string;                 // 'dx_' + first 16 hex of canonHash({context, claims})
  diagnostics_version: string;          // 'atlas-diagnose/0.1.0'
  packs: { id: string; version: string; requires_rule_kinds: string[] }[];   // V0: station-flow/0.1
  world: { id: string };
  context: { branch; mode; claim_class: 'derived'|'simulated'; t; ts; window_s: 900;
             snapshot_state_hash; ledger_events_applied };                   // copied from the snapshot
  claims: Claim[];                       // sorted by (subject in world order, kind order §C.2)
  roots: string[];                       // claim ids with role symptom, plus unknowns
  diagnosis_hash: string;                // canonHash(minus diagnosis_hash), computed last
}
interface Claim {
  id: string;                            // 'c:<kind>:<subject>'; unknowns 'c:unknown_<reason>:<subject>' (CCR-005 C1); unique
  kind: ClaimKind; role: Role; subject: Id;
  template: string;                      // formatter template id, §L
  values: Record<string, number|string|boolean|string[]|null>;   // every number the template may print
  basis: 'state'|'rule'|'structure'|'inference';
  rule: { id: string; version: string; world_rules: RuleId[] };
  claim_class: 'derived'|'simulated'|'inferred';
  support: 'deterministic'|'bounded'|'none';
  confidence: null | { value: number; method: string };          // non-null only for basis inference
  assumptions: string[];
  evidence: Ref[];                       // at least one unless kind = unknown
  links: { rel: 'supports'|'limited_by'|'blocks'; to: string }[];
  onset_t?: number|null; onset_in_parent?: boolean;              // §G
  reason?: UnknownReason;                // kind unknown only
}
type Ref = { kind: 'event'; event_id } | { kind: 'state'; path } | { kind: 'world'; path } | { kind: 'world_rule'; rule };
```
`state` paths are JSON pointers into the snapshot (`/metrics/stations/st_fry/queue_len`),
`world` paths into the world file (`/relationships/7`), events by `event_id`. Refs are never
expanded inside the claim; resolution is a separate call (§K).

### C.1 V0 fields deliberately absent

Supersession, validity windows, contradiction objects, specialist identity on claims (only the
`rule` field and `basis: inference` shape exist), severity scores, priority ranking.

### C.2 Claim kinds (station-flow/0.1) and their exact conditions

For each station `s` at `t`, facts are taken from the snapshot: `capacity {equipment, staff, effective}`,
`queue_len`, `in_progress`, `staff`, `status`; `has_equipment` = `s` has an `attached_to`
relationship in the world.

| kind | role | emitted when | values | world rules |
|---|---|---|---|---|
| `overload` | symptom | `status = OVERLOADED` or `UNSTAFFED` | status, queue_len, oldest_wait_s, overload_queue, overload_wait_s | R07 |
| `backlog` | condition | `queue_len > 0` | queue_len, oldest_wait_s | — |
| `backlog_growth` | condition | `queue_len(t) > queue_len(t − 900)` | queue_at_window_start, queue_at_t, window_minutes (15) | — |
| `demand_vs_capacity` | condition | station had any work queued in `(t−900, t]` | demand_work_s, capacity_work_s, ratio, exceeds, window_minutes (15) | R01 |
| `at_capacity` | condition | `effective > 0 ∧ in_progress ≥ effective` | in_progress, effective | R01, R03 |
| `capacity_limit` | limitation | `at_capacity`, or `effective = 0 ∧ queue_len > 0` | class, equipment, staff, effective, add_one_staff, add_one_equipment_slot | R01 |
| `equipment_degradation` | limitation or non_limitation | attached equipment not OPERATIONAL | equipment_id, status, capacity, nominal_capacity, restoring_raises_effective | R01 |
| `assembly_blocking` | downstream_effect | `backlog` ∧ at least one OPEN order whose only remaining item work is at `s` (item work: CCR-005 C4) | count_sole, sole_remaining_blocker_for (ids), orders_with_pending_work (ids) | R05 |
| `unknown` | unknown | §J | reason, detail | — |

`demand_work_s` = Σ nominal `duration_s` (world processes) of `WORK_QUEUED` events at `s` with
`t_e ∈ (t−900, t]` in the branch log. `capacity_work_s` = ∫ effective(τ) dτ over the same window
(the 06 utilization denominator). `ratio` = demand/capacity rounded to 2 decimals, null if capacity 0.
`exceeds` = `demand > capacity` strictly. Assumption string, verbatim:
`"demand uses nominal step durations from world.processes"`.

Kind order for sorting: overload, backlog, backlog_growth, demand_vs_capacity, at_capacity,
capacity_limit, equipment_degradation, assembly_blocking, unknown.

### C.3 Links (the whole DAG)

- `overload —supports←` from `backlog`, `backlog_growth`, and `demand_vs_capacity` only if `exceeds`.
- `overload —limited_by→ capacity_limit` when both exist for the station.
- `backlog —limited_by→ capacity_limit` when no overload but both exist.
- `capacity_limit —supports←` from `at_capacity`; from each `equipment_degradation` with role limitation.
- `overload —blocks→ assembly_blocking` (else `backlog —blocks→ assembly_blocking`).
- Nothing else. Every `to` resolves within the diagnosis; the graph is acyclic (validated).

## D. Epistemic taxonomy and non-escalation rules

| Statement type | ATLAS basis | claim_class on observed branch | on simulated branch |
|---|---|---|---|
| State fact copied from the snapshot (queue 5) | `state` | derived | simulated |
| Deterministic rule over facts (overloaded, staff-limited) | `rule` | derived | simulated |
| World-structure consequence (order blocked by R05) | `structure` | derived | simulated |
| Specialist or model judgement (none in V0) | `inference` | inferred | inferred |

There is no `observed` claim: a diagnosis is always a derivation over a WorldState, which 03 already
says is never observed. Event evidence keeps its own provenance class when resolved (§I).

Enforced by the core validator; any violation throws `DiagnosisError('EPISTEMIC_VIOLATION')`:
- **E1** `claim_class` of a non-inference claim equals `context.claim_class`.
- **E2** `basis = inference` ⇒ `claim_class = inferred`, `support = bounded`, `confidence` present. No V0 pack emits it; the core accepts it for future packs.
- **E3** (CCR-005 C2) For every link, `rank(dependent.support) ≤ rank(dependency.support)`, `deterministic 2 > bounded 1 > none 0`.
  Dependent/dependency: `supports` A→B: B depends on A; `limited_by` A→B: A depends on B; `blocks` A→B: B depends on A.
- **E4** `deterministic` requires at least one evidence ref and every ref to resolve (§I).
- **E5** Only the three link types exist. No claim, template or value expresses cause (§E).
- **E6** A claim's `values` contain every number its template prints (names and id lists excepted); the formatter post-check (§L) enforces it.

## E. Dependency versus causality

ATLAS V0 asserts only:
- **Structural dependency:** a step or barrier in `world.processes` (R05) or an `attached_to` relationship.
- **Deterministic blocking (`blocks`):** an OPEN order whose only remaining item work sits at `s` cannot
  reach its order step until that work completes. This is a consequence of R05, not an estimate.
- **Capacity limitation (`limited_by`):** `effective = min(equipment, staff)` (R01), and a marginal test
  shows which term moves it (§F).
- **Support (`supports`):** a condition that is part of the rule definition or the evidence for a claim.

ATLAS V0 never asserts causation, temporal-precedence-as-cause, correlation, customer sentiment,
revenue impact, or "would have" statements; counterfactual effect sizes belong to M2 comparisons.
Forbidden words in templates and formatted text: `cause`, `caused`, `causes`, `because of`, `due to`,
`resulted in`, `led to`, `unhappy`, `revenue`, `should`, `recommend`.

## F. Binding-constraint methodology (station-flow/0.1, R01)

Per station, from snapshot facts only:
1. If `effective = 0 ∧ queue_len > 0`: class `STAFF` if staffing is required and no staff is assigned
   while equipment capacity (if any) is positive; `EQUIPMENT` if staff is present and equipment capacity is 0;
   else `CO_BINDING`.
2. Else if not at capacity: class `DEMAND` when `queue_len = 0`; when `queue_len > 0` emit
   `unknown: MODEL_UNEXPLAINED_IDLE` instead of a class (backlog while modelled capacity is idle).
3. Else (at capacity), **marginal capacity test** by re-applying R01 to hypothetical inputs, no simulation:
   `add_one_staff = R01(staff + 1) − effective`; `add_one_equipment_slot = R01(equipment + 1) − effective`,
   or null when the station has no attached equipment.
   `STAFF` if only `add_one_staff > 0`; `EQUIPMENT` if only `add_one_equipment_slot > 0`;
   `CO_BINDING` if neither is positive.
4. `equipment_degradation.restoring_raises_effective` = R01 with that unit at `nominal_capacity` exceeds
   `effective`. Role `limitation` if true, `non_limitation` if false.

Categories offered by the model: `STAFF`, `EQUIPMENT`, `CO_BINDING`, `DEMAND`, plus `unknown`.
Dependency blocking is an order-level `assembly_blocking` claim, not a station class. Generic
`RESOURCE_BOUND` is not offered: the model has no other resource.

Note: M1's `capacity()` reports `equipment = staff` for stations with no attached equipment. The pack
must use `has_equipment` from world relationships, not that number.

## G. Temporal and branch semantics

- A diagnosis exists only for one `(branch, t)` and copies `snapshot_state_hash`. It has no validity
  beyond that instant. Ranges: observed `[time.origin, time.end]`, simulated `[tB, tH]`; else `T_OUT_OF_RANGE`.
  Simulated diagnosis requires `branch_interval` (CCR-005 C3); pre-branch history is never relabelled simulated.
- **Onset** (`overload`, `capacity_limit`): scan sample points over the branch log up to `t`, using the
  settled state at the end of each instant with events (the CCR-004 rule), and take the last instant
  the condition (overload status, or the limitation class) became true without an exit since. For
  `overload` this must equal M1 `snapshot.diagnosis.since_t` for the bottleneck station.
- **Persistence** is `t − onset_t`, shown only as values. **Resolution** is never predicted; it is
  observed by diagnosing a later `t`.
- On a simulated branch, onset may fall in the parent prefix; then `onset_in_parent = true` (boundary rule: CCR-005 C5).
- Branch classification comes from `getStateAtTime` (C1 of M2); the diagnosis copies `mode` and
  `claim_class`. The same pack runs on all branches.

## H. Evaluation of the "evidence-linked diagnostic claim graph"

**Adopted in simplified form.** Useful because it makes every assertion individually inspectable,
lets the experience expand "why" by following `supports` and `limited_by`, carries the epistemic class
per node, and makes non-escalation checkable by graph traversal (E3). Rejected parts: global or
persistent graphs, open relation vocabularies, `CONTRADICTS` edges and cross-time edges. Those can come
when a second pack or a specialist produces conflicting claims.

**Potentially differentiating mechanisms, flagged for tracking (no patentability claim):**
1. Per-claim epistemic class inherited from the branch, with a validator that forbids escalation along links.
2. The marginal capacity test: classifying the binding constraint by re-applying the world's own
   capacity rule to one-unit hypothetical inputs, distinct from simulation.
3. Sole-remaining-blocker analysis from a process barrier, giving deterministic downstream impact
   without causal language.
4. One diagnosis pack over observed and simulated branches, with the class carried per claim.
5. A template formatter whose output is checked against the structured values (numerals and forbidden words).

## I. Evidence and provenance

`resolveDiagnosticEvidence({ world, ledger, diagnosis, claim_id })` returns, for each ref:
event → the event's `{event_id, t, ts, type, branch, claim_class, source, record_id}`; state → the
value at the pointer in the snapshot at the diagnosis context; world → the value at the pointer;
world_rule → the rule entry. Unresolvable refs are a defect (E4).

Evidence a pack must attach (minimum):
| kind | evidence |
|---|---|
| overload | state pointers to status, queue_len, oldest_wait_s; world pointers to the station's overload attrs; R07 |
| backlog, backlog_growth | state pointer to queue_len; for growth, the `WORK_QUEUED` and `WORK_STARTED` events at the station in the window |
| demand_vs_capacity | the window's `WORK_QUEUED` events at the station (all, CCR-005 C6); world pointers to step durations; R01 |
| at_capacity, capacity_limit | state pointers to capacity and in_progress; the `ASSIGNMENT_CHANGED` events of staff currently assigned; `attached_to` relationships; R01 |
| equipment_degradation | the equipment's last `EQUIPMENT_STATE_CHANGED` event; state pointer; R01 |
| assembly_blocking | state pointers to the blocked orders' open work; the order process barrier in the world; R05 |

On a simulated branch, refs to branch events resolve with `claim_class: simulated`, and the inspector keeps
the three M3 headings.

## J. UNKNOWN and degraded behaviour

| Situation | Output |
|---|---|
| Backlog while modelled capacity is idle | `unknown: MODEL_UNEXPLAINED_IDLE` for the station; no `capacity_limit` |
| World lacks a pack's required rule kinds | one `unknown: RULE_NOT_APPLICABLE` claim with subject = world id; pack skipped |
| A station has no relationships needed for a check | `unknown: MISSING_RELATIONSHIP` for that check |
| Window extends before the branch log | `unknown: INSUFFICIENT_WINDOW` instead of `backlog_growth`/`demand_vs_capacity` |
| Facts disagree (snapshot status OVERLOADED with queue 0 and wait below threshold) | `unknown: CONFLICTING_FACTS`; no symptom claim |
| No condition at all | zero claims, `roots: []`; this is a valid diagnosis ("nothing to report") |
| Multiple overloaded stations | one overload claim each; `roots` ordered by world order; no ranking field |
| Unsupported causal question | not representable; the API has no such query |
| `t` out of range, unknown branch | errors `T_OUT_OF_RANGE`, `BAD_REGISTER`; no diagnosis |

## K. Capability facade (additive)

```ts
diagnoseAtTime(input: { world: World; ledger: AtlasEvent[]; t: number; branch?: string;
                         branch_interval?: { tB: number; tH: number } }): Diagnosis   // required on simulated ledgers (CCR-005 C3)
explainDiagnosis(input: { diagnosis: Diagnosis; claim_id?: string }): { lines: { claim_id: string; text: string; claim_class: string }[] }
resolveDiagnosticEvidence(input: { world: World; ledger: AtlasEvent[]; diagnosis: Diagnosis; claim_id: string }): ResolvedRef[]
```
JSON in and out. Existing capabilities unchanged. No engine type crosses the facade.

## L. Explanation formatter

Pure function of a claim: `template` + `values` → one line. Fixed templates, verbatim:

| template | text |
|---|---|
| `T_OVERLOAD` | `{subject_name} is {status}: queue {queue_len}, oldest wait {oldest_wait_s}s (thresholds: queue {overload_queue}, wait {overload_wait_s}s).` |
| `T_BACKLOG` | `{subject_name} has {queue_len} waiting; oldest {oldest_wait_s}s.` |
| `T_BACKLOG_GROWTH` | `{subject_name} queue grew from {queue_at_window_start} to {queue_at_t} in the last {window_minutes} minutes.` |
| `T_DEMAND_VS_CAPACITY` | `{subject_name} received {demand_work_s}s of required work against {capacity_work_s}s of capacity in the last {window_minutes} minutes (ratio {ratio}, using nominal durations).` |
| `T_AT_CAPACITY` | `{subject_name} is at capacity: {in_progress} in progress of {effective}.` |
| `T_CAPACITY_LIMIT` | `{subject_name} capacity {effective} is limited by {class_text}: one more staff member adds {add_one_staff}; one more equipment slot adds {add_one_equipment_slot_text}.` |
| `T_EQUIPMENT_DEGRADATION` | `{equipment_name} is {status} ({capacity}/{nominal_capacity}); restoring it {raises_text} {subject_name} capacity.` |
| `T_ASSEMBLY_BLOCKING` | `{count_sole} open orders are held only by work at {subject_name}: {order_list}.` |
| `T_UNKNOWN` | `ATLAS cannot determine {detail} for {subject_name} ({reason}).` |

`class_text`: STAFF → `staffing`, EQUIPMENT → `equipment`, CO_BINDING → `staffing and equipment together`,
DEMAND → `incoming work, not capacity`. `raises_text`: `would raise` / `would not raise`.
`add_one_equipment_slot_text`: the number, or `nothing (no equipment)`. Names come from world entities.
On a simulated branch every line is prefixed `SIMULATED · `.
Post-check (throws `FORMAT_VIOLATION`): after removing the text substituted from `*_name` fields and
`order_list`, every numeral in the line equals a number in `values`; and no forbidden word from §E appears.

## M. Minimal experience integration

- Service route `GET /api/diagnosis?register=&t=[&entity=]` → `{ diagnosis, lines }`, with claims and
  lines filtered to `subject = entity` server-side when `entity` is given.
- Inspector: a "Diagnosis" section listing `lines` verbatim, each with its `claim_class` chip and an
  expandable evidence list from `resolveDiagnosticEvidence`. The register label still heads the panel.
- The renderer computes nothing; T10/T11 scans extend to the new code. No other UI change.

## N. Oracle and acceptance tests

**Answer key.** `reference/m4/diagnosis-expectations.json`, produced by the independent
`reference/m4/derive-expectations.mjs` (reads only frozen artifacts; `--check` reproduces it). It fixes
semantics, not JSON shape: per canonical (branch, t) and station, `overloaded`, `at_capacity`,
`backlogged`, `limitation`, marginal deltas, degraded-equipment `restoring_raises_effective`,
`demand_vs_capacity`, `backlog_growth`, `assembly_blocking`, and overload onset. Key facts it records:

| Case | Fry | Other |
|---|---|---|
| observed 17:45 | backlog 1, at capacity, STAFF, ratio 1.00 not exceeding, not overloaded | — |
| observed 18:08 | STAFF, ratio 1.44, fryer 2 degraded and not limiting, not overloaded | — |
| observed 18:20 | OVERLOADED since 18:15:00, STAFF, ratio 1.56, queue 2→5, sole blocker for 4 orders, fryer 2 not limiting | — |
| observed 19:00 | OVERLOADED, STAFF, ratio 1.89, queue 9→16, sole blocker for 14 | — |
| baseline 19:00 | as observed but simulated: STAFF, queue 10→15, 14 orders | — |
| scenario 19:00 | at capacity, no backlog, EQUIPMENT, fryer 2 now limiting, ratio 1.13 with no overload | Prep STAFF with backlog 2, not overloaded |

| # | Test |
|---|---|
| T-KEY | For all six cases and four stations, the diagnosis agrees with every answer-key field |
| T-LEGACY | Where `snapshot.diagnosis.bottleneck` is set: an overload claim exists for it, `capacity_limit.class` maps to its `binding_constraint`, onset equals `since_t`, degraded-equipment flags agree; where null, no overload claim |
| T-SCHEMA | Every diagnosis at the six cases and 60 seeded T per register validates against the frozen schema |
| T-EPISTEMIC | E1–E6 hold on every produced diagnosis; injected violations (an observed-labelled claim on a sim branch, an inferred claim marked deterministic, a cycle, a dangling link) are rejected |
| T-RESOLVE | Every evidence ref in every produced diagnosis resolves; event refs on sim branches resolve to `simulated` or replayed `observed` |
| T-DET | Same (branch, t) → byte-equal diagnosis and `diagnosis_hash`, across calls, processes and visit order |
| T-PURE | Diagnosing never mutates world, ledger or snapshot (deep-freeze); M1/M2/M3 outputs unchanged afterwards |
| T-FORMAT | Every line equals its template rendering; numeral and forbidden-word post-checks pass; sim lines carry the prefix |
| T-PACK | The pack source contains no entity ids, station names or restaurant words (`fry`, `grill`, `prep`, `pass`, `burger`, `st_`, `o_0`) |
| A1 | Mini world: large queue but `in_progress < effective` → `unknown: MODEL_UNEXPLAINED_IDLE`, no class |
| A2 | Mini world without an `assembly_barrier` rule kind → pack skipped with `RULE_NOT_APPLICABLE`; no `assembly_blocking` |
| A3 | Degraded equipment with staffing binding → `equipment_degradation` role `non_limitation` |
| A4 | `staff_cap = equipment_cap` at capacity → `CO_BINDING`, both deltas 0 |
| A5 | Station without attached equipment at capacity → STAFF, `add_one_equipment_slot` null |
| A6 | Demand ratio > 1 with no backlog and normal status → no overload claim (scenario 19:00 Fry) |
| A7 | Ratio exactly 1.00 → `exceeds = false` (observed 17:45 Fry) |
| A8 | Two overloaded stations → two overload claims, no ranking field |
| A9 | Poisoned snapshot (OVERLOADED, queue 0, wait under threshold) → `CONFLICTING_FACTS`, no symptom |
| A10 | Simulated diagnosis requested with `branch: 'history:day1'` on a sim log → `GETSTATE_BRANCH_MISMATCH`; no claim ever carries `derived` on a sim branch |
| A11 | `t` outside range → `T_OUT_OF_RANGE`, including simulated `t < tB` or `t > tH` at facade and service (CCR-005 C3) |
| CCR-005 | T-UNKNOWN-IDS, T-E3-LINKS, T-INTERVAL, T-ITEMWORK, T-ONSET-PARENT as listed in `contract-changes/CCR-005.md` §6 |
| A12 | Browser: inspecting Fry at observed 18:20 shows the T_OVERLOAD and T_CAPACITY_LIMIT lines verbatim from `/api/diagnosis`; the scenario register prefixes `SIMULATED · ` |

## O. Regression requirements

ATLAS suite, M1 parity, M2 parity 28/28 with unchanged hashes, M3 Playwright, Signet suite,
`oracle --check`, `derive-expectations.mjs --check`, all green. No change to reducer, views, scheduler,
simulate, window, compare, checkpoints, canon, ledger, branch, scenario, world, schema, or to any
existing facade signature, schema or fixture.

## P. Muse handoff

1. **Pre-M4 hygiene (separate commit, test-only):** the T8/T12 sequencing fix. Wait for
   `#floorplan[data-t]` of the initial frame before calling any test hook. UTC banner stays tracked, not fixed here.
2. Rebase onto this contract commit (true ancestor).
3. Build `impl/src/diagnose/{types,core,validate,temporal,format}.ts` (pack-agnostic) and
   `impl/src/diagnose/packs/station-flow.ts`; facade functions §K in `capabilities.ts`; route and
   inspector section §M.
4. Tests in `impl/test/m4-*.test.ts` and `impl/e2e/m4-*.spec.ts` covering §N.
5. Log ambiguities in `DECISIONS.md`; contract defects via `contract-changes/CCR-<nnn>.md`.
6. **STOP** at §O. Report test counts, the six case diagnoses' `diagnosis_hash` values, formatted lines
   for observed 18:20 and scenario 19:00, and any CCRs.

## Q. Risks and deferred decisions

1. **Nominal-duration demand.** The ratio uses model durations; history uses jittered ones. Labelled
   as an assumption on the claim and in its line.
2. **Event-sampled onset.** Same approximation as CCR-004 metrics.
3. **Snapshot inconsistency risk.** If a future engine change altered views, T-LEGACY and the answer key catch it.
4. **Specialists and models.** The `inference` shape exists but no producer; a future CCR defines specialist
   provenance (`specialist_id`, version, model receipt per 08).
5. **Contradictions** across packs are deferred; V0 has one pack.
6. **Receipt identity gate** from M2 still applies; diagnoses carry no receipts and need none.

## R. Contract change requests

CCR-005 (accepted 2026-10-08): unknown claim ids, link-wide E3, `branch_interval`, item-work definition,
`onset_in_parent` boundary, evidence completeness. See `contract-changes/CCR-005.md`.

## S. Frozen files

`18-m4-diagnose-contract-and-muse-handoff.md`, `schema/atlas-diagnosis.schema.json`,
`reference/m4/derive-expectations.mjs`, `reference/m4/diagnosis-expectations.json`, `contract-changes/CCR-005.md`.
The fixtures manifest is unchanged (21 files).

## T. Reference commit procedure

Spec owner commits these four files on `claude/youthful-ride-3hx3o1` with parent `40ab1fc`; verifies
`oracle --check`, the Signet suite, `derive-expectations.mjs --check` twice, and that the schema compiles
strictly; pushes only after Erwin approves.
