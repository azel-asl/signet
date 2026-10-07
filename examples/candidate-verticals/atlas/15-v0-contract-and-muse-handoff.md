# 15 — ATLAS V0 frozen contract and Muse handoff

**Status:** FROZEN as the ATLAS V0 reference contract on 2026-10-07.
**Reference commit:** the commit that adds this file on branch `claude/youthful-ride-3hx3o1` of `azel-asl/signet`.
**Roles:** Fable owns the specification and the oracle. Muse implements the ATLAS runtime and experience against this contract.

## 1. Frozen artifacts

Muse must treat the following as authoritative inputs. "Frozen" means: not changed
silently, not changed to make implementation easier. It does not mean immutable forever
(see section 3).

| # | Artifact | Path | Verification key |
|---|---|---|---|
| 1 | World-definition schema | `schema/atlas-world-definition.schema.json` | file sha256 at the reference commit |
| 2 | Ledger-event schema | `schema/atlas-event.schema.json` | same |
| 3 | Snapshot schema | `schema/atlas-snapshot.schema.json` | same |
| 4 | Restaurant world definition | `fixtures/restaurant-v0/world.restaurant-v0.json` | `manifest.json → world_sha256` |
| 5 | Raw fixture sources | `fixtures/restaurant-v0/raw/*.csv` (+ `day2/raw/`) | `manifest.json → files` |
| 6 | Normalized canonical ledger | `fixtures/restaurant-v0/normalized/events.ndjson` (+ `day2/normalized/`) | manifest |
| 7 | Canonical world-state snapshots | `fixtures/restaurant-v0/snapshots/s1..s4*.json`, `expected/s4b_simulated_baseline.json`, `expected/s4_observed_reference.json` | manifest + each file's `state_hash` |
| 8 | Baseline simulation trace | `fixtures/restaurant-v0/expected/sim_baseline.events.ndjson` | manifest |
| 9 | Intervention/scenario trace | `fixtures/restaurant-v0/expected/sim_scenario.events.ndjson` (scenario: `scenario.fry-rush.json`) | manifest + `scenario_sha256` |
| 10 | Expected comparison metrics | `fixtures/restaurant-v0/expected/comparison.json` | manifest |
| 11 | Calibration example | `expected/comparison.json → calibration_records_example` | manifest |
| 12 | PASS/FAIL criteria | `11-build-plan.md` (PASS WHEN per milestone), `12-testing.md` | reviewed text |
| 13 | Fixture oracle behaviour | `fixtures/restaurant-v0/oracle/generate.mjs` and its `--check` mode | `node oracle/generate.mjs --check` exits 0 |

Normative semantics behind the artifacts: rules R01–R09, the scheduler, the ordering
key and the metric definitions in `06-behavior-simulation.md` and `04-time.md`.

## 2. Exact and tolerance rules

| Check | Rule |
|---|---|
| Ledger reproduction from raw sources | exact (byte-equal NDJSON, same sha256) |
| WorldState facts at each canonical T | exact (employees, equipment, station queues and in-progress lists, open orders, open work) |
| Derived views: status, capacity, queue length, oldest wait | exact |
| Metrics: counts, revenue | exact |
| Metrics: utilization | exact to 3 decimals as emitted by the oracle |
| Simulation traces (baseline, scenario) | exact event sequence and payloads |
| Comparison | exact |
| `state_hash` | exact once M1 re-stamps hashes with XAS-CANON-1 canonical JSON (one recorded regeneration; see `fixtures/restaurant-v0/README.md` invariant 2) |

There are no other tolerances in V0. A mismatch is a defect in the runtime or a
contract-change request, never a reason to edit an expected file.

## 3. Contract-change process

During V0 implementation Muse must not change any frozen artifact to make implementation
easier. If Muse finds a genuine defect or an architectural contradiction, it raises a
**contract-change request** as a file `contract-changes/CCR-<nnn>.md` on its branch, containing:

1. **Problem**: what is wrong, with the failing check and the observed vs expected values.
2. **Proposed change**: to which artifact(s), exactly what changes.
3. **Affected fixtures and tests**: every file whose hash would move; every PASS WHEN affected.
4. **Migration impact**: what already-built runtime code changes; whether the oracle changes.
5. **Alternatives considered** and why the change is needed rather than a runtime fix.

Fable reviews, and on acceptance regenerates fixtures through the oracle with an entry in
`fixtures/restaurant-v0/CHANGELOG.md` and a new reference commit. Until then the old
contract stands and the affected check is reported as failing, not skipped.

## 4. The oracle stays independent

```
FABLE ORACLE  (fixtures/restaurant-v0/oracle/generate.mjs)  →  expected behaviour (fixtures)
MUSE ATLAS RUNTIME  (independently written)                  →  actual behaviour
EXPECTED vs ACTUAL                                             →  verification
```

Muse must not copy the oracle into the runtime and call the result parity. Rules:

- The runtime is written from the specification (sections 03–06), not from `generate.mjs`.
  Reading the oracle to understand an ambiguity is allowed; transplanting its code is not.
- The oracle is never imported by runtime packages. A lint rule forbids any import path
  containing `/oracle/`.
- Muse does not modify the oracle. Any oracle change goes through section 3.
- Parity is claimed only by running the runtime against the fixtures and reporting
  hash equality per section 2.

## 5. Core invariants (restated for the handoff)

1. **Operational truth.** The operational model owns truth. The renderer contains no independent business logic; it looks up state and views by entity id.
2. **Historical reconstruction.** Evidence → normalized events → reducer → WorldState. Nothing else produces historical state.
3. **Simulation.** WorldState at the branch point + scenario/intervention + scheduler → simulated events → the same reducer → simulated WorldState. One reducer, one state type.
4. **State classification.** Observed evidence stays distinguishable from derived, inferred, assumed, baseline-simulated and scenario-simulated state, via `claim_class`, `branch` and `mode` on every event and snapshot.
5. **Counterfactual comparison.** Simulated baseline vs simulated intervention is the valid comparison. Observed vs simulated baseline is calibration. An observed future and a simulated future are never presented as equivalent comparison branches.
6. **Evidence.** Important claims trace to provenance; the inspector answers "why" with records.
7. **Authority.** Observation, explanation, simulation, recommendation, approval and execution are distinct authorities. V0 has no autonomous real-world execution.

## 6. SignalWorks boundary (future, not built now)

ATLAS stays at `examples/candidate-verticals/atlas/` and standalone for V0. The V0 API
surface in `02-architecture.md` already partitions into the capabilities SignalWorks will
later call through explicit contracts rather than internals:

| Future capability | V0 function(s) it wraps |
|---|---|
| `load_world` | `loadWorld` |
| `ingest_evidence` | `ingest` |
| `get_state_at_time` | `snapshot` |
| `replay` | `reduceTo` over a time range with checkpoints |
| `explain_state` | `explain` (V0.2) |
| `diagnose` | `diagnose` (V0.2) |
| `run_scenario` | `branch` |
| `compare_scenarios` | `compare` |
| `get_evidence` | ledger read filtered by subject/work id + provenance |
| `recommend_intervention` | `recommend` (V0.2) |

Rule: every capability takes and returns only schema-defined JSON (world, event, snapshot,
scenario, comparison, receipt). Future chain: user or agent → SignalWorks orchestrator →
ATLAS capability → structured result + receipts → Signet governance → optional approved
action. Nothing in V0 may expose engine internals as the integration point.

## 7. Muse handoff boundary

Muse builds the ATLAS V0 runtime and experience against this contract, initially only
enough to demonstrate:

```
World definition → Ledger → Reducer → WorldState → logic-free representation
WorldState + intervention → Scheduler → future events → same Reducer → simulated WorldState
```

The first usable experience, reached across milestones M11–M14 and then M19 of
`11-build-plan.md`: load restaurant → play → pause → scrub timeline → inspect an object →
inspect its evidence → watch the Fry constraint emerge → select the 18:20 branch point →
run baseline → apply the employee reassignment → run scenario → compare outcomes.
No 3D is required. Operational correctness precedes visual sophistication.

## 8. Muse Milestone 1 — WORLD + REPLAY PARITY

**Objective.** An ATLAS runtime that loads the frozen restaurant world and canonical ledger
and reconstructs the expected historical WorldState snapshots.

**Scope.** Build-plan milestones M0–M6 (`@atlas/schema`, `@atlas/ledger`, reducer, derived
views and metrics, checkpoints). No simulation UI, recommendation engine, LLM, database,
external connector, or 3D.

**PASS WHEN**, against `fixtures/restaurant-v0/`:

- `world.restaurant-v0.json` validates against the schema and the semantic checks in `03-data-model.md`, and loads; the six invalid variants are rejected with JSON pointers.
- `normalized/events.ndjson` validates line by line against the event schema and loads in the reduction order of `04-time.md`.
- At each canonical T (17:45, 18:08, 18:20, 19:00 observed), the reducer's state equals the snapshot's `state`: employee on-shift flags and assignments, equipment status and capacity, station queues and in-progress lists in order, open orders, open work.
- Derived views equal the snapshots: station status, capacity triple, queue length, oldest wait, utilization (3 decimals).
- Required metrics equal the snapshots' `metrics` blocks.
- Provenance is accessible for any event, and every `evidence_refs` entry in the snapshots resolves to a ledger event.
- Two runs produce identical state hashes at every canonical T; results are identical with and without checkpoints.
- The parity report lists, per snapshot, expected and actual hashes and the first differing path if any.

## 9. Verification record at freeze (2026-10-07)

- `node oracle/generate.mjs --check`: OK, 21 files match manifest (1,815 day-1 events, 121 orders), run twice with identical results.
- Normalizing `raw/` and `day2/raw/` reproduces the engine's event logs exactly (asserted inside the oracle).
- Provenance scan: every ledger event has a claim class; no `simulated` events in `history:day1`; all `derived_from` references resolve; all snapshot `evidence_refs` resolve to ledger event ids.
- Branch invariants: both simulation branches carry the identical 65 replayed arrivals; every non-arrival branch event is `simulated`.
- Signet test suite: 12 files, 237 tests passed. No Signet source touched.
