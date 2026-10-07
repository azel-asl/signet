# 00 — Review of the brief

The brief is unusually clear about invariants. This document records where following it
literally would produce the wrong V0, and what this specification decides instead. Each
item names the decision so a builder does not re-litigate it.

## A. Contradictions and under-specifications

### A1. "Baseline continues" is not what happens at a branch point
The brief describes SIMULATE as "Baseline continues vs scenario." At the branch time the
observed future does not exist yet. The baseline is a **simulation too**, run with the same
engine and the same replayed arrivals as the scenario. There are therefore three distinct
states at any compared instant: observed (history), simulated baseline, simulated scenario.
The fixtures encode all three at 19:00 (`snapshots/s4_simulated_intervention.json`,
`expected/s4b_simulated_baseline.json`, `expected/s4_observed_reference.json`). The gap
between simulated baseline and observed history is the calibration signal, not a bug.
**Decision:** comparisons are always sim-vs-sim. Sim-vs-observed is reported separately as calibration.

### A2. "+$620 revenue" needs a lost-demand model the brief forbids inventing
With fixed arrivals and no balking, faster service does not create revenue; it moves when
orders complete. Claiming revenue gain requires a model of customers who leave or do not
return, which is an assumption. **Decision:** V0 reports (a) revenue of orders completed
inside the comparison window, labelled a *timing shift*, and (b) a delay cost computed from
one explicit `assumed` parameter. Rule `R09 no_balking` is in the world definition so the
limitation is machine-visible. The mock-up figures (14.2 → 10.8 min, 47 → 55 orders/h,
+$620) are replaced by whatever the fixtures produce (18.2 → 10.1 min, 36.9 → 48 orders/h
within the window, +$264 timing shift, −$113 assumed delay cost).

### A3. A fryer failure that staffing fixes is incoherent unless the fryer is not binding
If equipment capacity is the constraint, moving an employee changes nothing. The brief's
story (fryer fails, bottleneck forms, move an employee) only works when staffing is binding.
**Decision:** the fixture degrades fryer 2 (3 → 2 baskets) at 18:02:14 and the diagnosis
must state that it is *not* the binding constraint; staffing is. After the move, the
binding constraint flips to equipment (capacity 5, bound by the degraded fryer). This is a
better demonstration of causal honesty than the naive story.

### A4. "Approve changes the demo; Learn compares predicted vs observed" is theater in a synthetic world
If the outcome after approval is itself simulated, the calibration record compares a
simulation with a simulation. **Decision:** the fixture set includes a second day
(`day2/`) where the manager actually made the move at 18:20. LEARN compares the day-1
prediction with the day-2 observation. The example calibration record shows a case where
the metric is *not comparable* (throughput, because day-2 demand was lower) and one where
it is (kitchen time). Honesty about confounding is part of the fixture.

### A5. LIVE mode and deterministic replay conflict unless ledger order and event order are separated
Evidence arrives late and out of order. **Decision:** the ledger is append-only in
ingestion order; the reducer orders by event time `t` with a total tie-break
(type rank, subject, work id). A late event invalidates snapshots with `t` later than its
own. V0 is batch-only; the append interface is the only LIVE-ready surface built now.

### A6. Numeric confidence everywhere is fake precision
Nobody can honestly give "0.83" for a badge scan. **Decision:** every claim carries an
ordinal `claim_class` (observed, derived, inferred, assumed, simulated, human_reported,
human_corrected) and a `confidence` that is `null` unless computed. This matches the
Signet Evidence Pipeline rule that null is distinct from zero.

### A7. "WorldState contains flows, anomalies, metrics" mixes fact with derivation
If metrics are state, the reducer is no longer pure and two implementations will drift.
**Decision:** WorldState holds facts only (assignments, equipment status, order and work
states). Capacity, station status, queues' ages, utilization, bottlenecks, flows are
*derived views* computed from state and never stored as truth. Snapshots carry both, with
`claim_class: derived` on the views.

### A8. Rules as free text need an interpreter nobody should build in V0
**Decision:** rules are a closed enum of kinds with parameters (`station_capacity`,
`queue_discipline`, `no_preemption`, ...). The engine implements the kinds; an unknown kind
is a load error. A rule DSL or editor is deferred until a second domain needs a kind the
enum lacks.

### A9. The brief under-specifies exactly the places where two implementations disagree
Tie ordering at the same second, what happens when capacity drops below work in progress,
how in-progress work behaves at a branch point, what window a metric uses. Section 06
fixes each one, and the fixtures encode them so that disagreement shows up as a hash
mismatch rather than an argument.

### A10. Missing: a replay contract
The brief asks for replay tests but gives no primitive. **Decision:** `state_hash` =
sha256 of the canonical JSON of `{state, metrics}`. Replay, binding, branching and
determinism tests all reduce to hash equality.

## B. Over-building to refuse in V0

| Brief suggests | V0 decision | Why |
|---|---|---|
| PostgreSQL, JSONB, event tables | Files (JSON, NDJSON, CSV) and an in-memory engine | V0 has one user, one world, no concurrent writers. A database adds migrations and a server before the model exists. Postgres enters with LIVE/multi-user (V1). |
| FastAPI or TS service | No server | The engine must run in the browser so timeline scrubbing is local. A server would make every scrub a round trip and split the engine across two languages. |
| Python + SimPy for simulation | Custom TypeScript engine = reducer + scheduler | SimPy processes are generators and cannot be cloned, so a branch cannot start from a reduced WorldState. The oracle proves the engine fits in ~600 lines. |
| Three.js / React Three Fiber | SVG floor plan bound by entity id | Operational legibility is the goal. The binding contract (snapshot in, pixels out, no logic) is what must be proven; the renderer is swappable. |
| Containers, cloud deployment | Static site + CLI | A PROBE is a repo someone can clone and run with `npm test`. |
| LLM gateway, provider abstraction | Interface only, zero calls in V0 | The killer demo runs without a model. That is the strongest evidence that the model owns truth. The interface is specified so V1 can plug in. |
| Entity resolution with probabilities | Deterministic alias tables in the world definition | An unresolvable identifier is an ingestion error, not a guess. Probabilistic resolution keeps a reversible `ResolutionRecord` interface for later. |
| Adapter framework, dozens of connectors | Five CSV adapters with one shared interface | Enough to prove source-neutral normalization. |
| RBAC platform | Three roles and one deterministic gate | Enough to prove confidence ≠ authority. |

## C. Hidden complexity the brief underestimates

1. **Metric windows.** "Throughput" and "average kitchen time" are undefined without a window and a membership rule. Section 06 defines each metric with window, membership, and null behaviour.
2. **Capacity semantics under change.** Reassignment and equipment degradation change capacity mid-work. Section 06 rule R03 (no preemption) decides it.
3. **Pass/assembly barrier.** An order's pass step depends on all item chains; the oracle shows it is a per-order barrier, not a station rule.
4. **Branch adoption of in-progress work.** Work in progress at the branch time has no known remaining duration. The adoption rule (`max(branch_t, started_t + nominal)`) is in the scenario file so it is reproducible.
5. **Derived events from observed records.** `ORDER_READY` is derived from the KDS pass bump. Provenance must say so; the normalizer does.
6. **Timezones.** All times are integer unix seconds; ISO strings carry the world's fixed offset for display only.

## D. What the brief gets right and this spec keeps verbatim

All twelve invariants in brief section 38. The five-domain decomposition. The
representation rule (section 27). "AI may propose and interpret; deterministic systems
establish state." The insistence on PASS WHEN criteria. The domain-generalization test.

## E. The smallest architecture that proves ATLAS

```
world.json ──load──▶ World (validated)
raw/*.csv ──adapters──▶ Ledger (events + provenance)
Ledger ──reducer──▶ WorldState(t)  ──derive──▶ Views (capacity, status, metrics, diagnosis)
WorldState(t) ──scheduler+reducer──▶ Branch ledger (simulated)
Snapshot ──renderer──▶ pixels (no logic)
hash(state, metrics) ──▶ the test primitive for everything above
```

Six boxes. Everything else in the brief is either a view over these, or V1.
