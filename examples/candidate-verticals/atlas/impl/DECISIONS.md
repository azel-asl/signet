# ATLAS V0 implementation — decisions log

Every entry records what was decided, why, and whether it came from the frozen
spec (03–06, schemas, fixtures) or from reading the oracle to resolve an ambiguity.
The runtime is written from the specification; the oracle was read only to settle
points the spec leaves open. No oracle code was transplanted, imported, or copied.

## D1 — Toolchain: TypeScript + vitest, zero runtime dependencies
Source: judgement. The repo is TS/vitest; the spec names `@atlas/*` npm packages.
PROBE discipline: boring, inspectable, testable. `node:crypto` only.

## D2 — `createState(world)` initializes from entity attrs
Source: spec 04 (`createState(world)`) + fixture behaviour. Persons start off-shift
and unassigned; equipment starts at `attrs.status`/`attrs.capacity` (nominal =
`attrs.capacity`); stations start empty. The ledger's 17:00 shift-start events then
produce the initial assignments. Verified equivalent to the frozen snapshots at all
canonical T (hash equality in tests).

## D3 — Capacity (R01): DEGRADED equipment contributes its reduced capacity
Source: spec 06 R01. `equipment_cap = Σ capacity` of attached equipment with
`status != DOWN`. A station with no attached equipment reports `equipment = staffCap`
and `effective = staffCap` (this is what makes `st_pass` show `equipment: 2` in s1).

## D4 — Reduction order `(t, rank, subject, work_id)`
Source: spec 04. Ranks: EQUIPMENT_STATE_CHANGED/MEASUREMENT_RECORDED 0,
EMPLOYEE_CLOCKED_IN/ASSIGNMENT_CHANGED 1, HUMAN_REPORT 2, WORK_COMPLETED 3,
ORDER_READY 4, ORDER_COMPLETED 5, ORDER_CREATED 6, WORK_QUEUED 7, WORK_STARTED 8.

## D5 — Skills check: station short name = id minus `st_` prefix
Source: spec 03 semantic checks + judgement. Skills are `prep|grill|fry|pass`
(step/station short names); station ids are `st_prep` etc. The check compares the
short name against the employee's skills. Documented here because the spec does not
name the mapping; it is the only mapping that accepts the frozen world.

## D6 — Utilization: busy slot-seconds / capacity integral, 3 decimals
Source: spec 06 + oracle read (the spec names the integral; the replay procedure
for it is the ambiguity). Capacity integral replays only capacity-affecting events
(EMPLOYEE_CLOCKED_IN, ASSIGNMENT_CHANGED, EQUIPMENT_STATE_CHANGED) over the
window `(t-900, t]` from a fresh state; busy time sums `|[started_t, completed_t ?? t]
∩ (t-900, t]|` per work item at the station. Result rounded to 3 decimals, `null`
when the integral is 0.

## D7 — Metric rounding
Source: spec 06 + oracle read. `avg_kitchen_time_s` = round to integer of the mean;
`over_target_share` = 2 decimals; `revenue_completed` = 2 decimals; `p90` =
nearest-rank (integer input ⇒ integer output). Kitchen-time windows are
`(t-900, t]`; throughput window `(t-3600, t]`. Kitchen-time goal target comes from
the world goal with id `g_kitchen_time`.

## D8 — Diagnosis
Source: spec 03 Diagnosis interface + oracle read (field computation). Bottleneck =
station with max `oldest_wait_s` among OVERLOADED/UNSTAFFED stations, `null` when
none. `since_t` = last transition into OVERLOADED found by scanning the ledger from
a fresh state (an UNSTAFFED→OVERLOADED transition counts). `binding_constraint`:
`staffing` when `effective == 0`, else `staffing`/`equipment`/`both` by comparing
`staff` and `equipment` capacity. `affected_orders` = queue work ids → order ids,
deduped in queue order. `degraded_equipment[].binding = (equipment <= staff)`.
Summary follows the frozen template.

## D9 — `evidence_refs` selection
Source: oracle read (the spec requires provenance but the per-snapshot selection
rule is fixture-defined). For the V0 restaurant world the snapshot carries the
evidence behind the Fry station's state at T: ledger events with `t <= T` whose
subject is Fry-attached equipment, ASSIGNMENT_CHANGED events for currently
assigned Fry staff or targeting Fry, and WORK_QUEUED/WORK_STARTED events for work
currently queued or in progress at Fry — in ledger order, mapped to
`{event_id, type, ts, ...provenance}`.

## D10 — `state_hash` = sha256(XAS-CANON-1({state, metrics})); re-stamp COMPLETE
Source: spec 04 + handoff §2 + fixture README invariant 2. XAS-CANON-1 = recursively
sorted keys, no whitespace, numbers as shortest round-trip. Fable accepted CCR-002
(2026-10-07, reference cd0db9e): the oracle now hashes canonical JSON and all six
stamped snapshots were re-stamped once; `manifest.json` carries
`hash_rule: "XAS-CANON-1"`. The runtime's independently computed hashes equal the
corrected stored values exactly. The temporary "re-stamp prediction" concept is removed.

## D11 — Checkpoints: every 500 events + at capacity/assignment events
Source: spec 04. Checkpoint = `{t, state, ledger_seq, state_hash}`. Resume skips
events with `seq <= checkpoint.ledger_seq` (the `e.t <= cp.t` phrasing in 04 is
unsafe across same-t ties; `ledger_seq` is the authoritative cursor). Deleting
checkpoints changes nothing but speed (tested).

## D12 — Snapshot envelope
Source: frozen snapshot schema + fixtures. Snapshot state shape follows
`atlas-snapshot/0.1` (`employees`, `equipment`, `stations`, `orders_open`,
`work_open`, `reports`, `last_measurements`, `ledger_events_applied`), not the
internal WorldState fact shape of 03. `state_hash` covers `{state, metrics}` only.

## D13 — Ledger has no header line in the frozen fixture
Source: fixture observation. Spec 03 mentions an optional
`{"atlas_schema":"atlas-ledger/0.1",...}` header line; the frozen
`normalized/events.ndjson` starts directly with `seq: 1`. The loader accepts an
optional header line and requires `seq` to start at 1.

## Oracle-read log (ambiguity resolution only)
Read `fixtures/restaurant-v0/oracle/generate.mjs` (549 lines) on 2026-10-07 for:
capacity/state/metric/diagnosis/snapshot/evidence formulas (D3, D6, D7, D8, D9),
hash emission (D10), event ordering ranks (D4), and `createState` initialization (D2).
Also read `15-v0-contract-and-muse-handoff.md` §2/§8 and the fixture README for the
PASS WHEN criteria. No oracle code appears in `src/`; a lint test asserts no
`/oracle/` import path exists in the implementation or tests.

## D14 — M2: scheduler emits events; reducer publishes state (16 §C, §E)
Source: 16-m2-counterfactual-contract-and-muse-handoff.md §C/E. The scheduler keeps a
private scratch WorldState advanced ONLY by the injected `apply` (default: `applyEvent`
from reducer.ts). It never writes state collections directly (a test scans
scheduler.ts for write patterns). Every published snapshot, metric and hash is
computed by `reduceTo` over the branch log. The oracle traces were inspected as
fixtures (expected/sim_*.events.ndjson) to confirm the E5 instant procedure;
no oracle scheduler code was transplanted.

## D15 — M2: branch-log tB sample includes branch tB events
Source: 06-behavior-simulation.md window-metrics text (CCR-004). Sample points are
the settled state at tB then each instant in (tB, tH]. For a branch log,
`reduceTo(branchLog, tB)` naturally includes the branch's tB-instant events
(adoption completions, interventions at tB, tB dispatch). Verified: the observed
calibration reproduces the expected 4200s Fry overloaded time, and both arms'
window metrics match expected/comparison.json exactly.

## D16 — M2: F2 "shared prefix" reads as the parent prefix
Source: 16 §F2. The literal `reduceTo(branchLog, tB) == reduceTo(history, tB)` cannot
hold because E5 emits branch events at tB (first instant is always tB). The test
verifies the intent: the branch log's first 544 entries are exactly the parent
prefix, and reducing the prefix equals reducing history. Not filed as a CCR:
the semantics are unambiguous, only the test phrasing is loose.

## D17 — M2: work-id minting follows the adapter convention
Source: 16 §B/CCR-003. Simulated work ids are `w_<order without "o_">_<item_seq>_<step>`
(e.g. `w_0039_1_prep`, `w_0031_0_pass`). Same convention the history adapter uses.
CCR-003 remains deferred; scenario validation calls the same `stationShortName`
the world loader uses (one implementation, asserted by test).

## D18 — M2: no economics, no second domain, no SignalWorks
Source: 16 §13, §15, §18. WindowMetrics excludes revenue/cost fields. The capability
facade (capabilities.ts) is JSON-in/JSON-out only; SignalWorks is not integrated.
ENGINE_VERSION = 'atlas-impl/0.2.0'.

## Oracle-read log (M2)
Read `fixtures/restaurant-v0/expected/sim_baseline.events.ndjson` and
`sim_scenario.events.ndjson` (fixtures, not oracle code) to confirm: the E5 instant
procedure (timers → inputs → dispatch), the tB-first-instant rule, work-id
minting, intervention event shape (`reason: 'intervention:<id>'`), replayed-arrival
provenance (`claim_class: observed` + note), and the reduction-order sort for E6
numbering. The frozen `comparison.json` confirmed the window-metrics sampling
(CCR-004) and the §H comparison mapping. No oracle code appears in `src/`.

## D19 — M2 conditional-pass corrections (Opus review, 2026-10-07)
Source: Opus independent M2 review (CONDITIONAL PASS). Four conditions only;
no engine redesign, no M3, no frozen-artifact changes, no reducer/scheduler
semantic changes.

- C1: `getStateAtTime` now derives mode/claim_class/arm from the ledger itself
  (`classifyLedger` scans `provenance.claim_class`; simulated events carry the
  `sim:<arm>` branch id). Caller-supplied `branch` is verified against the
  derived classification; mismatch throws `GetStateError`. A simulated ledger
  can never silently appear historical. Output adds `arm` for simulated.
- C2: `compareScenarios`/`calibrate` now call `verifyArmResult` before use:
  receipt_sha256 recomputes, `canonHash(windowMetrics)` matches the receipt's
  `window_metrics_sha256` commitment, arm identity matches, branch is
  `sim:<arm>` with matching arm. Tampered/mismatched/forged metrics are
  rejected (COMPARE_RECEIPT_TAMPERED / COMPARE_METRICS_MISMATCH /
  COMPARE_ARM_MISMATCH / COMPARE_BRANCH_NOT_SIMULATED).
- C3: `runScenario` computes authoritative XAS-CANON-1 hashes from the actual
  world object and ledger array used in the run (`canonHash(world)`,
  `canonHash(ledger)`); the scenario file hash comes from `loadScenario`
  itself. Optional `expected*` inputs are assertions only; mismatch throws
  `RunScenarioError`. The receipt records computed hashes, never caller-supplied.
- C4: child-process determinism test derives `dist/` and repo paths from
  `import.meta.url` via env vars; no `/home/hatch` hardcode.

## D20 — M3 experience implementation (2026-10-08)
Source: 17-m3-experience-contract-and-muse-handoff.md (frozen 40ab1fc).

- Architecture: ATLAS engine → capabilities.ts (3 additive M3 functions:
  buildBranchLedger, getSupportingEvidence, listInstants) → experience/
  (project.ts: projectFrame/inspectEntity copy-only projection; source.ts:
  fixture paths isolated; server.ts: node:http on 127.0.0.1) → web/ (vanilla
  TS + SVG, no framework).
- ExperienceFrame is copy-only per §5.2; frame_hash = canonHash(frame minus
  frame_hash). Register labels verbatim from §7. Simulated arms get the
  diagonal SIMULATED watermark and hatched station fills.
- The renderer owns no operational truth: status strings map via fixed lookup
  tables; all values copied verbatim. T10 static scan enforced; Math.min/max
  only in web/layout.ts.
- T17: experience/ imports only capabilities.ts, experience/*, node:* (added
  loadWorldFile/loadLedgerFile and re-exported canonHash/iso via capabilities
  to satisfy the boundary).
- Playwright is a devDependency only; zero runtime dependencies added.
- ENGINE_VERSION unchanged (atlas-impl/0.2.0); EXPERIENCE_VERSION =
  atlas-experience/0.1.0.
- No engine, fixture, oracle, or M1/M2 reference changes. Receipt-identity hard
  gate (§16) preserved; M3 does not file the CCR.

## D21 — M3 correction pass (Opus FAIL review, 2026-10-08)
Source: Opus independent M3 review (FAIL; architecture passed).

- Item 0: Remote branch was missing frozen M3 contract/schema due to API
  content-sync not preserving history. Restored both files byte-identical
  from 40ab1fc via API push. Local branch has 40ab1fc as ancestor.
- Item 1: Added scripts/build-web.ts; `npm run build:web` produces
  web/dist/{index.html,styles.css,app.js,layout.js} with no manual copying.
  `npm run experience` = build:web + start service.
- Item 2: Initial time now comes from /api/world `initial_t` (server-derived
  from world origin date at 18:20), not from timeToSec("18:20") string.
- Item 3: Added <input type="range" data-testid="scrub"> bound to the
  register's integer-second range; change requests a real ATLAS frame.
- Item 4: Fixed ledger_events_applied to copy from snap.state (not snap).
  Added T4b schema validation against frozen atlas-frame.schema.json.
- Item 5: Banner now uses ISO strings (new Date(t*1000).toISOString()) for
  branch_point/horizon/interventions; time readout uses frame.ts.
- Item 7: Inspector has inspectSeqNum/lastPaintedInspectSeq stale-response
  protection.
- Item 8: ENTITY_NOT_PRESENT vs UNKNOWN_ENTITY: work_ids in ledger count as
  "known" (not just world.entities).
- Item 9: STATUS_CLASS uses NORMAL (not OK); evidence branch looked up from
  ledger; missing t param returns T_NOT_INTEGER; removed committed
  types.js and test-results artifacts.
- Item 10 (flows): The contract §5.1 requires `flows` in the frame layout
  (copied from world.visualization.flows — implemented). Visual flow-arrow
  rendering is not explicitly required for M3 PASS; the renderer includes
  the data but does not draw arrows. Presentational, not correctness.
