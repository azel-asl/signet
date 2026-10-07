# 11 — Build plan

PLAN → SPEC → BUILD → VERIFY. Every milestone has a PASS WHEN and produces an artifact
committed under `evidence/<milestone>/`. A milestone is not done until the artifact exists.
The brief's five foundations map to M1–M11. Milestones are small on purpose; most are a
day or less for one builder.

| # | Objective | Components | Inputs | Outputs | Depends on | PASS WHEN | Tests | Evidence |
|---|---|---|---|---|---|---|---|---|
| M0 | Workspace and fixture lock | repo, workspaces, lint, vitest, oracle copied in | this spec | `npm test` green with one test: `oracle --check` passes | — | `node oracle/generate.mjs --check` exits 0 in CI | fixture-lock | CI log |
| M1 | Schema and canonical JSON | `@atlas/schema` | world/event/snapshot JSON Schemas | zod schemas, JSON Schema export, `canonicalJson`, `sha256` | M0 | Exported JSON Schema equals the committed files byte-for-byte; `sha256(canonicalJson(s4.state+metrics)) == s4.state_hash` for all four fixtures | schema-roundtrip, canon-hash | diff output, hash table |
| M2 | World loader | `@atlas/schema` | `world.restaurant-v0.json` + 6 invalid variants | `loadWorld` | M1 | Valid file loads; each invalid variant (unknown rule kind, skill violation, dangling station, missing capacity rule, bad id pattern, object without entity) is rejected with a JSON pointer; no partial world object exists | world-load | rejection list |
| M3 | Ledger | `@atlas/ledger` | `normalized/events.ndjson` | read/append/ordering/checkpoints | M1 | Reading then writing the fixture reproduces its sha256; reduction order matches `(t, rank, subject, work_id)` for all 1,815 events | ledger-roundtrip, ordering | hash |
| M4 | Reducer | `@atlas/engine` | ledger | `createState`, `applyEvent`, `reduceTo` | M2, M3 | `reduceTo(T)` for T ∈ {17:45, 18:08, 18:20, 19:00} reproduces `state` of s1, s2, s3, s4_observed_reference exactly (facts only) | replay-facts | 4 diffs, empty |
| M5 | Derived views and metrics | `@atlas/engine` | state + ledger | `deriveViews` | M4 | `state_hash` equals the committed hash for all four historical snapshots (facts + views + metrics); utilization integral matches to 3 decimals | replay-hash, metric-defs | hash table |
| M6 | Checkpoints | `@atlas/ledger`, engine | ledger | checkpoint write/read | M5 | Hash at every snapshot T is identical with and without checkpoints; any T reduces in < 5 ms | checkpoint-equivalence | timing table |
| M7 | Adapters and ingestion | `@atlas/evidence` | `raw/*.csv` | five adapters, `ingest`, `IngestReport` | M3 | Ingesting `raw/` reproduces `normalized/events.ndjson` byte-for-byte (same sha256); provenance present on every line; a file with one bad alias yields zero events and one `unknown_alias` reject; `day2/raw` reproduces `day2/normalized` | ingest-equality, reject-policy | hashes, report |
| M8 | Scheduler (behaviour engine) | `@atlas/engine` | world, seeded arrivals | `run` | M5 | Running the scheduler with the oracle's seeds (20261006, jitter seed +1000) reproduces `normalized/events.ndjson` from scratch; running twice gives equal trace hashes | determinism, engine-vs-oracle | hash |
| M9 | Branching | `@atlas/engine` | ledger, `scenario.fry-rush.json` | `branch`, `SimulationRun` | M6, M8 | `sim_baseline.events.ndjson` and `sim_scenario.events.ndjson` reproduced exactly; history ledger hash unchanged; shared prefix equal; `s4_simulated_intervention.state_hash` and `s4b` reproduced | branch-isolation, branch-hash | hashes |
| M10 | Comparison | `@atlas/engine` | two branches | `compare` | M9 | `expected/comparison.json` baseline/scenario/delta blocks reproduced; honesty notes present | compare | diff |
| M11 | CLI | `@atlas/cli` | all | `atlas validate/ingest/state/replay/branch/compare/hash` | M7, M10 | A script runs the README's six steps and prints hashes that match the manifest | cli-e2e | terminal transcript |
| M12 | Viewer: floor plan from snapshot | `@atlas/viewer` | snapshots | SVG renderer, inspectors | M5 | Binding test 1 passes for all four snapshots; lint rule (binding test 2) passes; bundle without engine renders EMPTY (test 3) | binding-dom, no-logic-lint | screenshots of s1–s4 + DOM dumps |
| M13 | Viewer: timeline | viewer, engine | ledger | play/pause/scrub/jump | M6, M12 | Scrubbing to each snapshot T renders the same DOM as loading the snapshot file; registers never mix | timeline-equivalence | video + DOM dumps |
| M14 | Viewer: evidence inspector | viewer | ledger, raw files | inspector | M12 | Clicking Fry at 18:20 lists exactly the 17 records in `s3.evidence_refs` (assignment, three TEMP readings, the DEGRADED state record, the shift note, and the KDS tickets of the five queued and three in-progress fry jobs), each with its raw line | inspector-content | screenshot |

**V0 is complete at M14.** The five foundations: core world model (M1–M2), behaviour
engine (M8), evidence ingestion (M7), replay/timeline (M4–M6, M13), visual world (M12–M14).

## V0.2 (the full killer demo)

| # | Objective | PASS WHEN |
|---|---|---|
| M15 | Bottleneck detector and diagnosis | Diagnosis objects for s2 (none), s3, s4, s4b, s4_observed reproduced from snapshots |
| M16 | Structured explanation | Explanation for s3 lists R01, R05, R07, the six evidence refs, and the measurements; no prose |
| M17 | Economics module | Window economics in `comparison.json` reproduced; every number carries a claim class in the UI |
| M18 | Recommendation generator | Enumerates feasible reassignments at 18:20 (emp_04→fry, emp_01→fry, emp_06→fry), simulates each, ranks; "why not Dana" shows prep UNSTAFFED |
| M19 | Comparison view | Split view at any T in [18:20, 19:30]; honesty panel fixed |
| M20 | Authority gate and approval receipt | viewer is denied; manager approval writes a receipt with valid sha256/h10; approved branch labelled; history hash unchanged |
| M21 | Calibration | `calibration_records_example` reproduced from day-1 prediction and day-2 history, including the NOT COMPARABLE verdict |
| M22 | Process-graph representation | Same snapshots render as a graph; binding test passes for both representations |

## Later (V1, not planned in detail)

Script-to-world via `ModelClient`; LIVE ingestion with late-evidence invalidation; second
domain fixture (imaging department) to run the generalization test for real; Postgres-backed
ledger service; isometric or 3D representation; `execute:*` through Signet packets.
