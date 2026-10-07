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

## D10 — `state_hash` = sha256(XAS-CANON-1({state, metrics})); NO re-stamp needed
Source: spec 04 + handoff §2 + fixture README invariant 2. XAS-CANON-1 = recursively
sorted keys, no whitespace, numbers as shortest round-trip. The oracle's emitted
`JSON.stringify({state, metrics})` is byte-identical to the canonical form, so the
committed `state_hash` values already match XAS-CANON-1 output. Recorded here as the
"one recorded regeneration": verified, not changed. If any committed hash ever fails
to match, that is a CCR, not a silent edit.

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
