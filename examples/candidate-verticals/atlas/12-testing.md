# 12 — Testing strategy

The fixture set is the test oracle. Almost every test is "compute, hash, compare".

| Category | What | Fixture / method |
|---|---|---|
| Unit | reducer per event type; capacity formula; status rule; queue ordering; metric functions with hand-built states | table-driven, no fixtures |
| Schema validation | valid world loads; six invalid variants rejected with pointers; ledger lines validate; snapshots validate | `schema/`, invalid variants under `fixtures/invalid/` |
| Fixture lock | `oracle --check` | manifest hashes |
| Ingest equality | adapters over `raw/` → bytes equal `normalized/events.ndjson` | sha256 |
| Evidence lineage | every event has provenance; `derived` events have `derived_from`; history ledger has no `simulated`; sim ledgers have only `simulated` + replayed `observed` | ledger scan |
| Reject policy | one bad alias → zero events, one reject, exit code 2 | mutated copy of `staff_events.csv` |
| Replay accuracy | `reduceTo(T)` hashes equal s1–s4 hashes | snapshots |
| Checkpoint equivalence | hash with vs without checkpoints at 50 random T | property test, seeded |
| Determinism | scheduler twice → equal trace hashes; engine with oracle seeds reproduces the ledger | seeds in manifest |
| Scenario isolation | history hash before == after branching; shared prefix equal; identical arrivals in both branches | `expected/sim_*.ndjson` |
| Branch accuracy | sim ledgers and s4/s4b hashes reproduced | expected files |
| Metric correctness | window metrics in `comparison.json` reproduced; utilization integral tested against a hand-computed 3-event case | expected + hand case |
| Visual binding | DOM `data-*` round-trip equals snapshot; lint rule; engine-less bundle renders EMPTY | Playwright against the built viewer |
| Timeline equivalence | scrub to T == load snapshot T (DOM equality) | Playwright |
| Register separation | no frame contains both `historical` and `simulated` markers | Playwright |
| Regression scenarios | the whole README six-step script in CI, printing hashes | CLI e2e |
| Governance (V0.2) | gate denies viewer; approves manager; receipt hashes verify; approval never writes to history | unit + file assertions |
| Calibration (V0.2) | day-1 prediction vs day-2 observation reproduces the example records, including NOT COMPARABLE | expected/comparison.json |
| Performance | budgets in 10-technology.md measured in CI, failing on 3× regression | vitest bench |

## What is deliberately not tested with fixtures

Visual appearance (colours, layout). A screenshot per snapshot is stored as evidence for
humans, but tests read the DOM, not pixels.
