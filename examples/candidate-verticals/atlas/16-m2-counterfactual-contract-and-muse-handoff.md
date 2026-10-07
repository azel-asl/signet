# 16 — ATLAS V0 Milestone 2 contract: counterfactual simulation, and Muse handoff

**Status:** FROZEN as the Muse Milestone 2 contract on 2026-10-07.
**Spec owner:** Opus (architecture/specification), Fable on escalation only.
**Reference:** this file's commit on `claude/youthful-ride-3hx3o1` (parent `cd0db9e`).
**Implementation base:** `muse/atlas-v0` @ `199d245` (Milestone 1 PASS).

Muse Milestone 2 = build-plan M8 (scheduler, branch scope only) + M9 (branching) + M10
(comparison, operational subset), preceded by two M1 corrections. It is not build-plan "M2".

---

## A. Milestone 1 foundation — sufficient for M2

Evidence gathered for this contract (all reproducible from the frozen files):

| Check | Result |
|---|---|
| Muse's M1 reducer applied to the frozen history prefix (`t ≤ 18:20`, 544 events) followed by the **oracle's** `sim_scenario` trace | state, metrics, diagnosis and `state_hash` of `s4_simulated_intervention` reproduced exactly |
| Same for the `sim_baseline` trace | `s4b_simulated_baseline` reproduced exactly |
| Base state at 18:20 | equals `s3_bottleneck_active` (`state_hash 67f66b29…`) |

So the reducer, views and metrics already consume simulated events with the same semantics as
history. M2 adds a scheduler that **emits** events and a thin branch/comparison layer; it must
not touch reducer semantics. The only foundation defects are the two in §B.

---

## B. Pre-M2 corrections (land first, separately committed)

### B1. Checkpoint cursor

**Defect.** `reduceTo` resumes by skipping `e.seq <= checkpoint.ledger_seq` while iterating events
in reduction order. `seq` is file position, so on any ledger whose file order differs from
reduction order the skip removes the wrong events. Demonstrated: one event moved to the end of
the file → checkpoint replay diverged at 9 of 54 timestamps while full replay stayed correct.

**Corrected semantics.**
- `Checkpoint = { t, ledger_pos, last_event_id, state, state_hash }`.
- `ledger_pos` = count of events already applied, counted in the **ordered event array** the
  checkpoint was built from (history: reduction order; branch: §E3 order). Resume starts at
  index `ledger_pos`. `seq` plays no role in replay.
- `reduceTo(world, events, T, cp?)`: if `cp` is given, require
  `cp.ledger_pos ≤ events.length` and `events[cp.ledger_pos − 1].event_id === cp.last_event_id`;
  otherwise throw `StaleCheckpointError`. Never fall back silently.
- `reduceTo` asserts non-decreasing `t` over the array it walks and throws
  `UnorderedLedgerError` otherwise (the `e.t > T` early exit is only correct on ordered input).
- `eventsApplied` = `cp.ledger_pos` + events applied after it.
- `nearestCheckpoint(T)` = the checkpoint with greatest `ledger_pos` among those with `t ≤ T`.

**Ordering invariant.** Every array passed to `reduceTo` is in canonical order: reduction order
for a history ledger (the loader sorts by key and never by `seq`), parent-prefix-then-branch for
a branch log (§E3).

**Invalidation assumption (V0).** Ledgers are immutable after load; checkpoints live with the
loaded array and are rebuilt on reload. The V1 rule from 04 (a late event at reduction position
`p` invalidates every checkpoint with `ledger_pos > p`) is exact under this cursor and is **not**
implemented now; the `last_event_id` guard detects any insertion or removal before a checkpoint.

**Tests.**
1. Moved-event ledger (event at file line 901 moved to the end, `seq` renumbered): checkpoint vs
   full replay equal at 54 T (4 canonical + 50 seeded); 0 mismatches.
2. Seeded full shuffle of the 1,815 lines with `seq` renumbered: full replay hashes equal
   s1–s4 stored hashes; checkpoint equivalence at the same 54 T.
3. Stale checkpoint: build on ledger L, insert one event early, resume → `StaleCheckpointError`.
4. Unordered array to `reduceTo` → `UnorderedLedgerError`.
5. Branch log (prefix ++ oracle `sim_scenario` trace): checkpoint equivalence at 54 T in
   `[18:20, 19:30]`.

**PASS WHEN** tests 1–5 pass and all M1 tests stay green with unchanged snapshot hashes.

### B2. XAS-CANON-1 conformance

**Defect.** ATLAS `canon.ts` matches Signet on every fixture but diverges on non-NFC strings
(no normalization), non-finite numbers (emits `null`; Signet throws) and `undefined` in arrays
(emits `null`; Signet throws).

**Source of truth.** Signet `src/canon.ts` (`canonicalize`, `canonHash`): its eight normative
rules and its observable behaviour. Where its comment and behaviour differ, behaviour wins:
keys are ordered by JavaScript's default string sort (UTF-16 code units), which differs from
code-point order only for astral-plane keys versus U+E000–U+FFFF keys.

**Fix.** Keep the ATLAS port (decision D9 in 13: no runtime dependency on Signet), but make it a
faithful port of Signet's `canonValue`:
- strings and keys NFC-normalized; keys sorted on the raw key, then emitted normalized (as Signet);
- numbers via `JSON.stringify`, non-finite → throw;
- `null`, booleans literal; object fields whose value is `undefined` omitted;
- top-level `undefined`, `undefined` inside an array, `bigint`, `function`, `symbol` → throw;
- thrown errors carry the `XAS-CANON-1:` message prefix;
- `sha256` over the UTF-8 bytes of the canonical string.

**Conformance tests.**
1. Vector table in `test/canon-conformance.test.ts`: at least NFC/NFD value and key, `NaN`,
   `±Infinity`, `-0`, `1e21`, `0.1+0.2`, `undefined` field, `undefined` in array, nested mixed
   arrays, astral vs private-use key ordering, empty object/array. Each row records Signet's
   literal output string or "throws".
2. Differential test, **test-only** import of `signet/src/canon.ts` by relative path: every vector
   plus 1,000 seeded random JSON-like values produce identical strings, or both throw.
3. Source scan: nothing under `impl/src/` imports from Signet.
4. All six fixture `state_hash` values reproduce.

**PASS WHEN** 1–4 pass.

### CCR-003 — **A: remains deferred through M2**

M2 adds exactly one new use of the skills rule: R08 at scenario load ("employee lacks the skill
for the target station"). That is the same rule at a second call site, not a new ambiguity, and
the scheduler never consults skills. Constraint: scenario validation must call the **same**
`stationShortName` function the world loader uses; a test asserts there is one implementation.
CCR-003's scope is widened to cover the second implicit convention M2 depends on: simulated work
ids are minted as `w_<order_id without "o_">_<item_seq>_<step>` (the adapter's convention in the
history ledger). Both are resolved together before a second domain or script-to-world.

---

## C. M2 architecture

```
history ledger ──reduceTo(tB)──► base state at tB  (== s3, shared, read-only)
                                     │
                    ┌────────────────┴────────────────┐
              arm "baseline"                     arm "scenario"
              interventions = []                 interventions = [iv_01, iv_02]
                    │                                  │
   same exogenous workload: history ORDER_CREATED with tB < t ≤ tH (65 arrivals)
                    │                                  │
              scheduler (pure, deterministic) — emits events only
                    │                                  │
         branch ledger sim:baseline            branch ledger sim:scenario
                    │                                  │
         SAME reducer: reduceTo(prefix ++ branch events, T)
                    │                                  │
           snapshots, window metrics            snapshots, window metrics
                    └──────────► counterfactual comparison ◄──────────┘
   observed window metrics (history) ──► calibration vs baseline only
```

Rules:
1. The scheduler's only output is events. It keeps a private scratch state, advanced **only**
   by `applyEvent` from `reducer.ts`, to make dispatch decisions. That scratch state is never
   published.
2. Every published simulated state, snapshot, metric and hash is computed by `reduceTo` over the
   branch log (§E3). This is what "same reducer" means and it is tested both ways (§F7).
3. Simulation never writes to, appends to, or reorders the history ledger or base state.
4. A comparison is between two simulated arms with identical workload. A calibration is between
   observed history and the **baseline** arm. They are different document types and the
   functions that build them refuse each other's inputs.

---

## D. Data contracts

All documents are plain JSON, hashed with XAS-CANON-1, containing no wall-clock time.

### D1. Scenario (existing `atlas-scenario/0.1`, file `scenario.fry-rush.json`, unchanged)

V0 accepts exactly: `arrivals.source = "historical_replay"`, `duration_model = "nominal"`,
`in_progress_rule` equal to the fixture string, `comparison_window = {base.t, horizon}`,
interventions of kind `reassign` only. `required_authority` is recorded in the run receipt and
not enforced (the approval gate is V0.2).

### D2. Intervention (existing shape)

```ts
{ id: Id; kind: 'reassign'; employee: Id; from: Id | null; to: Id | null; at: ISODate }
```
It becomes one `ASSIGNMENT_CHANGED` input event at `at`:
`{ type:'ASSIGNMENT_CHANGED', subject: employee, data: { employee_id, station_id: to, reason: 'intervention:<id>' } }`, `claim_class: simulated`.
Authority/source: the scenario file (by `scenario_sha256`) and `required_authority`, both on the
receipt. Executable or free-form interventions are not accepted.

**Validation** (all before any event is emitted; first failure throws `ScenarioError {code, pointer, message}`; no ledger and no receipt on failure). Interventions are folded per employee in `at` order over the base-state assignment:

| Code | Rejects |
|---|---|
| `SCN_SCHEMA` | missing/mistyped scenario field (pointer to it) |
| `SCN_WORLD_MISMATCH` | `scenario.world ≠ world.metadata.id` |
| `SCN_BASE_BRANCH_MISMATCH` | `base.branch` ≠ the loaded history ledger's branch, or not `history:*` |
| `SCN_HORIZON_INVALID` | `horizon ≤ base.t`, or `horizon > world.time.end` |
| `SCN_WINDOW_MISMATCH` | `comparison_window ≠ {base.t, horizon}` |
| `SCN_UNSUPPORTED` | arrival source, duration model or in-progress rule other than the V0 values |
| `IV_DUPLICATE_ID` | two interventions share an id within an arm |
| `IV_UNSUPPORTED_KIND` | any kind other than `reassign` (`equipment_state`, `add_staff` are V0.2) |
| `IV_UNKNOWN_EMPLOYEE` | `employee` missing or not a `person` entity |
| `IV_UNKNOWN_STATION` | `to`/`from` non-null and not a `station` entity |
| `IV_BEFORE_BRANCH_POINT` | `at < base.t` |
| `IV_AFTER_HORIZON` | `at > horizon` (`at = horizon` is allowed; fixture `iv_02`) |
| `IV_EMPLOYEE_UNAVAILABLE` | employee not on shift at `at` (base on-shift; M2 branches have no clock events) |
| `IV_SKILL_VIOLATION` | `to` non-null and `stationShortName(to) ∉ skills` (R08, same function as world load) |
| `IV_FROM_MISMATCH` | `from` ≠ the employee's folded assignment at `at` |
| `IV_CONFLICT` | two interventions for one employee at the same `at` |
| `IV_NO_OP` | `from = to` |

### D3. Branch identity

```ts
interface BranchPoint {
  parent_branch: BranchId;        // 'history:day1'
  t: Seconds; ts: ISODate;        // tB
  events_applied: number;         // events of the parent with t ≤ tB (544)
  base_state_hash: string;        // stateHash({state, metrics}) at tB on the parent == s3.state_hash
}
type Arm = 'baseline' | 'scenario';
// branch id = `sim:${arm}`; run-scoped in V0 (see I2). Globally unique key = (run_id, event_id).
```

### D4. Simulated event identity and provenance

Branch events are numbered after sorting the run's emitted events into reduction order
(`i = 1..n`):

| Field | Value |
|---|---|
| `seq` | `branch_point.events_applied + i` (545…) |
| `event_id` | `ev_<branch>_<i zero-padded to 6>`, e.g. `ev_sim:baseline_000001`; never collides with `ev_history:*` |
| `branch` | `sim:<arm>` |
| `t`, `ts` | instant; `ts` = ISO with the world offset |
| `provenance.source` | `"simulation"` |
| `provenance.record_id` | `<branch>:<i>` |
| `provenance.record_ts` | `= ts` |
| `provenance.adapter` | engine version, `atlas-impl/0.2.0` |
| `provenance.claim_class` | `simulated` for every generated event and intervention; `observed` for replayed arrivals only |
| `provenance.note` | replayed arrivals only: `"historical arrival replayed into the branch"` |

Replayed arrivals keep `claim_class: observed` because the arrival itself is evidenced fact
(04, 12). Their **role** as exogenous input is carried by the note and by the receipt's
`workload` block; the original history event is found by `(type, subject)` in the parent
ledger. Run-level facts (scenario, base state, seed, config) live on the receipt, not on events.

### D5. Simulation run receipt — `atlas-run/0.1`

```ts
interface RunReceipt {
  atlas_schema: 'atlas-run/0.1';
  canon: 'XAS-CANON-1';
  run_id: string;               // 'run_' + first 16 hex of canonHash({engine_version, arm, inputs})
  engine_version: string;       // 'atlas-impl/0.2.0'
  arm: Arm; branch: `sim:${Arm}`;
  source: { scenario_id: Id; scenario_sha256: string; required_authority: string };  // not in run_id
  inputs: {
    world_sha256: string;                 // sha256 of world file bytes (manifest.world_sha256)
    parent_ledger_sha256: string;         // sha256 of history ledger file bytes
    branch_point: BranchPoint;
    horizon_t: Seconds; horizon_ts: ISODate;
    workload: { source: 'historical_replay'; from_branch: BranchId; after_t: Seconds; until_t: Seconds;
                count: number; workload_sha256: string };   // canonHash of [{t,type,subject,data}] in reduction order
    interventions: Intervention[];        // this arm's, as validated
    config: { duration_model: 'nominal'; in_progress_rule: string; seed: number };
  };
  outputs: {
    events_generated: number; first_seq: number; last_seq: number;
    trace_sha256: string;                 // canonHash(branch events as emitted)
    trace_content_sha256: string;         // canonHash(branch events with provenance.adapter removed); engine-independent
    final_state_hash: string;             // snapshot-form stateHash({state, metrics}) at horizon over the branch log
    window_metrics_sha256: string;        // canonHash(WindowMetrics)
  };
  assumptions: string[];                  // fixed list, see §G
  receipt_sha256: string;                 // canonHash(receipt minus receipt_sha256), computed last
}
```
`run_id` excludes the scenario file, so a baseline arm with the same branch point, horizon and
workload has the same `run_id` under any scenario. Shape follows 09 (computed-last hash, XAS-CANON-1),
so Signet can verify it later without a format change. No signature, no `created_at`.

### D6. Window metrics (operational only)

```ts
interface WindowMetrics {
  window: { from: ISODate; to: ISODate; minutes: number };
  orders_arrived: number;            // created_t ∈ (tB, tH]
  orders_completed: number;          // of those, completed_t ≤ tH
  orders_open_at_horizon: number;
  throughput_per_hour: number;       // +(completed / hours).toFixed(1)
  avg_kitchen_time_s: number | null; // Math.round(mean)
  p90_kitchen_time_s: number | null; // nearest rank
  max_kitchen_time_s: number | null;
  over_target_share: number | null;  // +(share > goal target).toFixed(2)
  delay_minutes_over_target: number; // +(Σ max(0, kt − target)/60).toFixed(1)
  max_queue: Record<StationId, number>;          // all stations, over sample points (06, CCR-004)
  overloaded_seconds: Record<StationId, number>; // all stations, over sample points
  utilization_at_horizon_15m: Record<StationId, number | null>;  // M1 utilization at tH over the branch log
}
```
Excluded from M2: `revenue_completed_in_window`, `revenue_open_at_horizon`,
`delay_cost_assumed`, `labor_cost_in_window`. They belong to the economics milestone; the
oracle's labor-cost formula is not yet sound (I5).

### D7. Counterfactual comparison — `atlas-comparison/0.1`

```ts
{ atlas_schema: 'atlas-comparison/0.1'; kind: 'counterfactual'; claim_class: 'simulated';
  scenario_id: Id; engine: string; branch_point: ISODate; horizon: ISODate;
  baseline_run: string; scenario_run: string; workload_sha256: string;
  baseline: WindowMetrics; scenario: WindowMetrics;
  delta: { <each scalar>: number | null;                          // +(scenario − baseline).toFixed(2), null if either null
           max_queue: Record<StationId, number>; overloaded_seconds: Record<StationId, number>;
           utilization_at_horizon_15m: Record<StationId, number | null> };
  trade_offs: { station: StationId; metric: 'max_queue' | 'overloaded_seconds'; baseline: number; scenario: number }[];  // every station worse in scenario
  honesty_notes: string[] }   // exactly the three in §G, in that order
```
`compareScenarios` refuses (`COMPARE_*`) unless: both receipts are `sim:*`, one baseline arm and
one scenario arm, equal `workload_sha256`, `branch_point`, `horizon_t`, `world_sha256`,
`engine_version`.

### D8. Calibration — `atlas-calibration/0.1`

```ts
{ atlas_schema: 'atlas-calibration/0.1'; kind: 'calibration';
  window: { from: ISODate; to: ISODate; minutes: number };
  predicted: { branch: 'sim:baseline'; run_id: string; claim_class: 'simulated'; metrics: WindowMetrics };
  observed:  { branch: BranchId /* history:* */; ledger_sha256: string; claim_class: 'derived'; metrics: WindowMetrics };
  conditions: { same_arrivals: boolean; predicted_workload_sha256: string; observed_workload_sha256: string };
  comparable: boolean;            // = same_arrivals
  residual: <same shape as delta>; // observed − predicted
  note: 'Observed vs simulated baseline measures model error. It is not an intervention effect.' }
```
`calibrate` refuses a scenario arm (`CALIBRATION_REQUIRES_BASELINE`) and a non-`history:*`
observed side. A comparison never contains observed metrics; a calibration never contains a
scenario arm. Day-2 calibration and the prose verdicts in `comparison.json` are V0.2.

### D9. Capability facade (future SignalWorks boundary, no transport)

`src/capabilities.ts` exports JSON-in/JSON-out functions only:
`getStateAtTime({world, ledger, t, branch?})` → snapshot · `runScenario({world, ledger, scenario})`
→ `{ baseline: {receipt, events}, scenario: {receipt, events} }` · `compareScenarios({baseline, scenario})`
→ comparison · `calibrate({baseline, observedLedger})` → calibration ·
`getEvidence({ledger, subject?, work_id?})` → evidence refs. Inputs and outputs survive
`JSON.parse(JSON.stringify(x))` unchanged; no reducer, scheduler or checkpoint type crosses it.

---

## E. Deterministic semantics

**E1. Branch point.** `tB = parse(scenario.base.t)`. Base state = `reduceTo(history, tB)` with
M1 semantics: every parent event with `t ≤ tB` is applied. Nothing at `tB` belongs to a branch
unless the branch emits it.

**E2. Adoption at tB** (`in_progress_rule`): each IN_PROGRESS work item gets a completion timer
at `max(tB, started_t + nominal(step))`; each READY order gets a handoff timer at
`max(tB, ready_t + handoff_s)`; for each non-COMPLETED order, items whose last step is DONE are
marked done. An OPEN order whose items are all done but whose pass work does not exist is
`BRANCH_STATE_INCONSISTENT` (fail, do not improvise).

**E3. Branch log order.** `branchLog = parentEventsInReductionOrder.filter(t ≤ tB) ++ branchEventsInReductionOrder`.
The branch point is a barrier: parent events precede branch events even at equal `t`. This
array is what `reduceTo`, checkpoints, metrics and snapshots read.

**E4. Inputs.** Workload = parent `ORDER_CREATED` events with `tB < t ≤ tH`, projected to
`{t, type, subject, data}`, identical for every arm. Intervention inputs per D2. Inputs are
merged and sorted in reduction order. Nothing else from the parent after `tB` is replayed
(the fixture has no non-arrival parent events in the window; a parent with them is out of M2 scope).

**E5. Instant procedure (uniform).** Instants are processed in increasing `t`. The first instant
is always `tB`, even if nothing is due then. Each following instant is the earliest due timer or
input; stop when it would exceed `tH`. At each instant `τ`:
1. Due timers at `τ`. Completion: emit `WORK_COMPLETED`; if the step is the order step, emit
   `ORDER_READY` and set a handoff timer at `τ + handoff_s`; else if a next step exists, emit
   `WORK_QUEUED` for it; else mark the item done and, when every item with a process is done,
   emit `WORK_QUEUED` for the order step (R05). Handoff: emit `ORDER_COMPLETED` (R06).
   Timer processing order within `τ` is not observable in the output; implementations use
   `(t, kind: complete < handoff, id)`.
2. Inputs at `τ` in reduction order. `ORDER_CREATED`: emit it, then `WORK_QUEUED` for step 0 of
   every item with a process, or for the order step if none has one.
3. Dispatch: stations in world entity order; for each, while the queue is non-empty and
   `in_progress < effective(τ)` (R01, R03), start the queue head (R02): emit `WORK_STARTED` and
   set a completion timer at `τ + nominal(step)`.

Every emitted event is applied to the scratch state immediately via `applyEvent`. Decisions read
only queue order (key-sorted, order-independent), in-progress **counts**, assignments, on-shift
flags and equipment, never in-progress list order. Events at exactly `tH` are emitted; timers
after `tH` are dropped and their work stays IN_PROGRESS. Work ids are minted per §B/CCR-003.

**E6. Ledger form.** After the run, the emitted events are sorted by reduction order
`(t, rank, subject, work_id)`; keys must be unique within a branch (assert), then numbered per D4.

**E7. Seed.** M2 has no randomness: `duration_model = nominal`, `seed` is recorded (0) and unused.
The engine never reads the wall clock.

**E8. Determinism contract.** Equal `(world bytes, parent ledger bytes, scenario arm inputs,
engine_version)` ⇒ byte-equal branch events, receipt, window metrics and hashes, regardless of
arm execution order, process, or prior runs.

---

## F. Test plan

| # | Area | Test |
|---|---|---|
| F1 | Pre-M2 | §B1 tests 1–5, §B2 tests 1–4 |
| F2 | Branching | base state hash == `67f66b29…` (s3); `events_applied == 544`; branch ids `sim:baseline` ≠ `sim:scenario`; `reduceTo(branchLog, tB)` equals `reduceTo(history, tB)` for both arms (shared prefix) |
| F3 | Intervention | fixture interventions accepted; one test per code in D2 (17 cases) asserting code and pointer, and that no events/receipt are produced |
| F4 | Scheduler units (hand-built mini world, no fixtures) | capacity respected (3 items, effective 2 → third starts at first completion); completion frees slot at same instant; two-step dependency (step 2 queued and started at step-1 completion); order-step barrier waits for all items; process-less order queues the order step at creation; handoff at +60; reassignment at `τ` changes capacity before dispatch at `τ`; R03: capacity drop leaves in-progress running and blocks starts; DEGRADED/DOWN equipment bounds capacity; adoption timers at `max(tB, …)`; intervention at `tB` moving a cook **off** a station with queued work applies before dispatch at `tB` (uniform rule) |
| F5 | Events | all branch events validate against `atlas-event.schema.json`; `event_id` unique, `seq` contiguous from 545; `claim_class` simulated except replayed arrivals (observed + note); history ledger contains no `sim:` event after runs |
| F6 | Parity (§H mapping) | branch events equal the oracle traces field-for-field except `provenance.adapter`; `trace_content_sha256` equals the expected values; s4/s4b `state`, `metrics`, `diagnosis`, `state_hash` equal (not `evidence_refs`, see I6); comparison and calibration operational subsets equal |
| F7 | Reducer reuse | (a) M1 reducer over prefix ++ **oracle** trace reproduces s4/s4b hashes (already true); (b) scheduler takes `apply` injected (default `applyEvent`); a spy sees every emitted event exactly once in emission order; (c) source scan: `scheduler.ts` has no direct writes to state collections (`.queue`, `.in_progress`, `.orders[`, `.work[`, `.assignments[`, `.on_shift[`, `.equipment[`); (d) published snapshots come only from `reduceTo` over the branch log |
| F8 | Determinism | run twice → equal `trace_sha256`, receipt bytes; scenario-then-baseline vs baseline-then-scenario → identical; run in a child process → identical receipts |
| F9 | Isolation | history file sha256 unchanged; history events and base state deep-frozen during both runs (any mutation throws); baseline receipt identical whether or not a scenario ran before it; `getStateAtTime` on history after runs still reproduces s1–s4 |
| F10 | Workload | both receipts' `workload_sha256` equal and == `ae7ad2b2…`; ORDER_CREATED projections equal across arms and equal the 65 history arrivals |
| F11 | Comparison/calibration separation | `compareScenarios` refuses a history input, two baselines, mismatched workload/branch point/horizon; `calibrate` refuses a scenario arm and a `sim:` observed side; comparison JSON has no `observed` key; calibration has no `scenario` key |
| F12 | Receipt | `receipt_sha256` recomputes; re-running from `receipt.inputs` reproduces `outputs`; changing any input field changes `run_id`; baseline `run_id` unchanged when only the scenario arm's interventions change |
| F13 | Facade | each capability's output round-trips through JSON unchanged |
| F14 | Regression | ATLAS M1 suite, Signet suite, `oracle --check`, M1 parity report all green |

Adversarial cases beyond the fixture (F3, F4, F8, F9, F11) are judged by this contract, not by
the oracle.

---

## G. Muse handoff

1. **Objective.** Prove ATLAS can branch from a reconstructed state, generate deterministic
   alternate futures under different interventions, reduce them through the same state model,
   and compare outcomes without confusing prediction with observation.
2. **Authorized scope.** §B fixes; scenario loading/validation; branch point; scheduler for
   reassign interventions with historical-replay workload and nominal durations; branch
   ledgers; window metrics; comparison; calibration (day 1 only); run receipts; capability
   facade; M2 parity runner and reports; tests in §F.
3. **Prohibited.** UI, 3D, LLM calls, recommendations, autonomous action, live connectors,
   databases, event buses, SignalWorks integration, Signet gate/signing, economics (revenue,
   delay cost, labor cost), arrival models or jitter, `equipment_state`/`add_staff`
   interventions, script-to-world, second domain, generic simulation framework, CCR-003,
   any change to reducer semantics, schemas, fixtures or the oracle. Reading the oracle to
   resolve an ambiguity is allowed and must be logged in `DECISIONS.md`; transplanting it is not.
4. **Modules** under `impl/src/`: `canon.ts` (B2), `reducer.ts` + `checkpoints.ts` (B1),
   `scenario.ts` (load, validate, `ScenarioError`), `branch.ts` (`BranchPoint`, branch log),
   `scheduler.ts` (E2, E5; emits events; `apply` injectable), `simulate.ts` (arms, numbering E6,
   receipts D5), `window.ts` (D6), `compare.ts` (D7, D8), `capabilities.ts` (D9),
   `scripts/m2-parity.ts` → `reports/m2-parity-report.{json,md}`. `ENGINE_VERSION = 'atlas-impl/0.2.0'`.
   Branch ledgers load with a branch-ledger loader that requires `seq` to start at
   `events_applied + 1` and enforces the D4 claim-class rule.
5. **Contracts.** §D, exactly.
6. **Order of work.** B1 and B2 first, as their own commits with tests green, then M2.
7. **Fixed `assumptions` list** on every receipt, in this order:
   `"durations are nominal (no variability)"`, `"arrivals are the historical arrivals after the branch point, identical in every arm"`,
   `"no lost demand (R09)"`, `"no parent events after the branch point other than arrivals are replayed"`,
   `"in-progress work at the branch point completes at max(branch_t, started_t + nominal)"`.
8. **Fixed `honesty_notes`** on every comparison, in this order:
   `"Both arms receive identical historical arrivals as exogenous inputs; outcomes are simulated, not observed."`,
   `"Durations are nominal; the baseline differs from observed history. See the calibration document for model error."`,
   `"No economic quantities are reported in M2."`.
9. **STOP** when §H passes. Report the parity table, test counts, receipts for both arms and
   any `DECISIONS.md` entries. Do not start the next milestone.

---

## H. Milestone 2 PASS WHEN

All of the following, on `muse/atlas-v0` rebased onto this contract commit:

1. §B1 and §B2 PASS WHEN met.
2. Both arms run from `scenario.fry-rush.json`; scenario validation rejects all 17 D2 cases with
   the right code and pointer.
3. Branch events reproduce the oracle traces field-for-field except `provenance.adapter`:

   | Arm | events | first seq | `trace_content_sha256` |
   |---|---|---|---|
   | baseline | 872 | 545 | `9c4089b7e6682ea7df701856e31cf593c423f14f3e7642ccc6927daa8c684f9b` |
   | scenario | 994 | 545 | `97e0d1fbb4e329df31f7dee08d09b2f945b217f6c5ecfa30f0ce10009b710ede` |

4. Snapshots at 19:00 on each arm reproduce `s4b_simulated_baseline` / `s4_simulated_intervention`
   `state`, `metrics`, `diagnosis` and `state_hash` exactly.
5. Receipts: `base_state_hash = 67f66b29b3f98237825b633f095ea1da56b4c4dbdf5e072c80b1b9faf4fefa84`,
   `workload_sha256 = ae7ad2b264fc003cd70413c2e0ad96baa726861ace6f85d6aab9258880bd471d` on both;
   `final_state_hash` baseline `176e0d643322b0d15fbb3fb28a19c3d9bdb5c18d1d185d0c67c4399092b43b42`,
   scenario `e11f66e8eb0389b57427da2515ff7f5f0d41c7708b9073a1a3e874de0ec9d279`.
6. Comparison and calibration match `expected/comparison.json` on this mapping, exact:

   | Muse | `comparison.json` |
   |---|---|
   | `comparison.baseline` / `.scenario`: `orders_arrived, orders_completed, orders_open_at_horizon, throughput_per_hour, avg_kitchen_time_s, p90_kitchen_time_s, max_kitchen_time_s, over_target_share, delay_minutes_over_target` | same keys in `baseline` / `scenario` |
   | `max_queue.st_fry`, `max_queue.st_prep`, `overloaded_seconds.st_fry`, `overloaded_seconds.st_prep` | same paths |
   | `utilization_at_horizon_15m.st_fry` / `.st_prep` | `fry_utilization_at_horizon_15m` / `prep_utilization_at_horizon_15m` |
   | `delta.{orders_completed, throughput_per_hour, avg_kitchen_time_s, p90_kitchen_time_s, over_target_share}` | same |
   | `delta.max_queue.st_fry` / `.st_prep`, `delta.overloaded_seconds.st_fry` / `.st_prep` | `max_fry_queue` / `max_prep_queue`, `fry_overloaded_seconds` / `prep_overloaded_seconds` |
   | `calibration.observed.metrics` (same operational keys and mapping) | `calibration_inputs.observed_day1_same_window` |
   | `calibration.predicted.metrics` | `baseline` |

   Not compared: revenue, delay cost, labor cost, prose (trade-off text, honesty text,
   calibration verdicts), day-2 block.
7. `calibration.comparable = true`; comparison and calibration refuse each other's inputs (F11).
8. RUN A == RUN B and order/process independence (F8); isolation (F9); workload identity (F10);
   reducer reuse (F7 a–d); receipt reproduction (F12); facade round-trip (F13).
9. Every test in §F passes; ATLAS M1 suite, Signet 237/237, `oracle --check` OK.
10. No change under `schema/`, `fixtures/`, `oracle/`, or any reference document; new `contract-changes/CCR-<nnn>.md` files are the only permitted addition outside `impl/`.

---

## I. Risks and deferred issues

1. **Event-sampled overload time.** Status is sampled at event instants; a queue wait crossing
   240 s between events is counted from the next event. Events are seconds apart in this window,
   so the error is small, but `overloaded_seconds` is not a continuous integral. Documented, not fixed.
2. **Run-scoped branch ids.** `event_id` is unique within a run only; the global key is
   `(run_id, event_id)`. Must become `sim:<run_id>` before any store holds many runs.
3. **Historical-replay workload** works only where evidence covers the horizon. Live or
   forward-looking branch points need an arrival model (deferred).
4. **Nominal durations** make the baseline optimistic versus observed (calibration shows the
   residual). This limits interpretation, not correctness.
5. **Economics.** The oracle's `labor_cost_in_window` sums every person's rate regardless of
   shift. It must be corrected before economics is specified; it is excluded from M2.
6. **Sim snapshot evidence.** `s4_simulated_intervention.evidence_refs` is anchored to Fry by
   oracle convention while Muse's generalized rule anchors to the longest wait (prep at 19:00).
   Evidence selection is presentation (Fable's earlier ruling), so it is excluded from parity.
7. **Signet canon comment vs behaviour** on key order (UTF-16 units vs code points). ATLAS follows
   behaviour; raise separately with Signet. Affects only astral-plane keys.
8. **Day-2 ledger** carries day-1 timestamps. Any cross-day calibration must not assume distinct dates.

---

## J. Escalation

Every design question in this contract was settled from the frozen artifacts with executed
evidence (the reducer-reuse result in §A, the sampling comparison behind CCR-004, the
output-invariance of the scheduler alignment under `oracle --check`). No architectural
ambiguity remains that needs Fable. **FABLE ESCALATION: NOT NEEDED.**
