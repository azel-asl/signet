# 01 — Product

## Problem statement

Operations run on systems that each see one slice: the POS sees orders, the kitchen
display sees tickets, the schedule sees people, telemetry sees machines. Nobody has an
executable model of the whole operation that can say what is happening, why, what happens
next, and what would happen if something changed. Dashboards summarize slices. Simulation
tools model hypotheticals disconnected from evidence. Neither can answer "why is this
station red, since when, which orders are affected, what evidence says so, and what should
we do" from a single, inspectable source of truth.

## ATLAS definition

ATLAS is an executable, evidence-derived, time-indexed model of an operation with four modes
over one state model:

| Mode | Question | V0 |
|---|---|---|
| RECONSTRUCT | What happened at time T? | Yes |
| LIVE | What is happening now? | Interface only |
| SIMULATE | What would happen if we changed X? | V0.2 (engine in V0) |
| COMPOSE | Make this described world exist | Hand-authored world file (the compile target) |

The operational model is the invention. The 2D floor plan in V0 is one representation of it.

## Target users

| Stage | User | What they need from ATLAS |
|---|---|---|
| V0 PROBE | The ATLAS builders and a technically sophisticated observer | Proof that the engine, not the renderer, owns truth; reproducible fixtures |
| V0.2 | A SignalWorks forward-deployed engineer running the demo | The full killer-demo loop with explanation and comparison |
| V1 | An operations manager (restaurant GM, imaging department lead, plant supervisor) | Live state, diagnosis, approved interventions, outcome tracking |
| V1 | A process engineer / analyst | World definition editing, scenario design, calibration review |

## Primary jobs-to-be-done

1. See the operation as it was at any moment, from evidence, not memory.
2. Know which constraint is binding right now and since when.
3. Trace any displayed state back to the source records that caused it.
4. Compare two futures that differ by one decision, with identical demand.
5. Approve an intervention with a record of who approved what, under which authority.
6. Learn whether the predicted effect happened.

## The killer demonstration (fixture-backed)

All figures below are produced by `fixtures/restaurant-v0/` and are demo parameters, not
business claims. Times are 2026-10-06, America/Los_Angeles.

| Beat | What the observer sees | Fixture |
|---|---|---|
| 1. Normal operation (17:45) | Every station NORMAL or BUSY. Fry has 3 in progress, 1 queued, 11 s oldest wait. Average kitchen time 7.8 min. | `s1_normal` |
| 2. Rush and a degraded fryer (18:02–18:08) | Fryer 2 oil temperature 351 → 338 → 306 °F, then DEGRADED at 18:02:14 (3 → 2 baskets). Priya's shift note at 18:04:30 corroborates. Fry queue 4, oldest wait 193 s, utilization 0.80. Status still BUSY, not OVERLOADED. | `s2_bottleneck_emerging` |
| 3. Bottleneck active (18:20) | Fry OVERLOADED since 18:15:00. Queue 5, oldest wait 300 s, utilization 1.0. Average kitchen time 9.8 min, p90 12.3 min. | `s3_bottleneck_active` |
| 4. Inspect Fry | Effective capacity 3 = min(equipment 5, staff 3). Binding constraint: **staffing**. Fryer 2 is degraded but not binding. Affected orders listed. Evidence panel shows the IoT state record, the three temperature readings, the shift note, and the KDS tickets in the queue. | `s3.diagnosis`, `s3.evidence_refs` |
| 5. Recommendation | Move Marcus (emp_04, skills prep/fry/pass) from Prep to Fry, 18:20–19:30. Prep retains Dana. Required authority: `approve:staff_reassignment`. | `scenario.fry-rush.json` |
| 6. Simulate | Baseline and scenario branch from the 18:20 state with identical replayed arrivals (65 orders to 19:30). | `expected/sim_*.events.ndjson` |
| 7. Compare (18:20–19:30) | Completed 43 → 56 of 65. Avg kitchen time 18.2 → 10.1 min. p90 25.6 → 11.7 min. Max fry queue 26 → 6. Fry overloaded 70 min → 3.5 min. **Trade-off:** prep max queue 3 → 7, prep utilization 0.47 → 0.91. Revenue completed in window +$264 (timing shift). Assumed delay cost $126.55 → $13.53. Labor cost unchanged. | `expected/comparison.json` |
| 8. Approve | The manager approves. An approval receipt is written. In V0.2 the approved intervention becomes a `human_corrected` assignment event on a new branch, clearly labelled. | `09-governance.md` |
| 9. Learn | Day 2 (Wednesday) history has the move actually made at 18:20. Observed kitchen time 18.8 → 10.4 min vs predicted 18.2 → 10.1. Throughput is flagged NOT COMPARABLE because day-2 demand was 50 arrivals vs 65. | `comparison.calibration_records_example` |

At 19:00 the three states that must never be confused:

| 19:00 | Fry status | Fry queue | Oldest wait | Avg kitchen time | Open orders |
|---|---|---|---|---|---|
| Observed (history, day 1) | OVERLOADED | 16 | 857 s | 933 s | 21 |
| Simulated baseline | OVERLOADED | 15 | 788 s | 955 s | 20 |
| Simulated scenario | BUSY (capacity 5, now equipment-bound) | 0 | 0 s | 648 s | 11 |

## User workflows

**W1 Load and validate a world.** Open world file → schema validation → semantic validation
(station ids exist, skills cover initial assignments, processes reference stations) → World
loaded, or a list of errors with JSON pointers. No partial load.

**W2 Ingest evidence.** Choose raw files → adapter per file → normalized events with
provenance → entity resolution via aliases → validation → ledger written → report:
records read, events produced, records rejected (with reason), unresolved identifiers.

**W3 Reconstruct.** Pick a time on the timeline → ATLAS reduces to the nearest earlier
checkpoint and applies events up to T → snapshot → floor plan, metrics, station cards.
Play/pause/scrub/speed/jump-to-event.

**W4 Inspect.** Click a station, employee, equipment, or order → inspector shows state at T,
derived views, and the evidence records (source, record id, record time, claim class) that
produced that state. "Why does ATLAS believe this?" is answered by listing records.

**W5 Branch and simulate (V0.2).** From T, choose an intervention → baseline and scenario run
to a horizon → side-by-side world, metric table with deltas, trade-offs, honesty notes.

**W6 Approve (V0.2).** A user with the required authority approves a recommendation →
approval receipt → the intervention is applied as a labelled branch. No external system is
touched in V0.2.

**W7 Learn (V0.2).** Load a later history → calibration record per metric → stored. No model
parameter changes without an explicit, separate approval.

## UX states

| State | Trigger | What is shown |
|---|---|---|
| EMPTY | No world loaded | Load world / load fixture |
| INVALID_WORLD | Validation failed | Error list with pointers; nothing renders |
| LOADED_NO_LEDGER | World ok, no events | Floor plan at initial state, timeline disabled |
| INGESTING | Adapters running | Per-file progress, rejects so far |
| INGEST_REPORT | Done | Counts, rejects, unresolved ids; "continue" only if zero fatal errors |
| RECONSTRUCT | Ledger present | Timeline enabled, register = HISTORICAL (solid) |
| INSPECT | Object selected | Side panel: state, views, evidence |
| BRANCHING | Scenario defined | Intervention form, horizon, "run" |
| COMPARE | Two branches done | Split world view, register = SIMULATED (hatched, labelled), delta table |
| APPROVAL_REQUIRED | Recommendation needs authority the user lacks | Who can approve, what would be recorded |
| APPROVED | Receipt written | Receipt id, hash, applied branch |
| CALIBRATION | Later history loaded | Prediction vs observed per metric, comparability verdict |

## Scope (V0)

The five foundations from the brief, in this order, each with a PASS WHEN in
[11-build-plan.md](11-build-plan.md): core world model, behaviour engine, evidence
ingestion, replay/timeline, visual world. Plus the fixtures and the replay contract.

## Non-goals (V0)

Everything in brief section 35, plus explicitly: no server, no database, no LLM calls, no
3D, no live connectors, no balking/lost-demand model, no probabilistic entity resolution,
no tables/seating model (dining is an area, not a resource), no multi-user.
