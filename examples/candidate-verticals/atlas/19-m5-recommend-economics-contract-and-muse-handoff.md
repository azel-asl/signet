# 19 — ATLAS V0 Milestone 5 contract: RECOMMEND + ECONOMICS, and Muse handoff

**Status:** FROZEN as the Muse Milestone 5 contract on 2026-10-09. **Amended by CCR-006** (`contract-changes/CCR-006.md`) on 2026-10-10.
**Spec owner:** Opus. Fable on escalation only.
**Reference:** this file's commit on `claude/youthful-ride-3hx3o1` (parent `038549e`).
**Implementation base:** `muse/atlas-v0` @ `096cbf0` (M1–M4 PASS).
**Frozen artifacts:** this file; `schema/atlas-recommendation.schema.json`; `reference/m5/{derive-expectations.mjs,
config.json, answer-key.json, README.md}` (answer-key sha256 `7598f59378507ed3489b0eff32b97f93dc470d2ba8e561e08277321594012feb`).

M5 answers *what could we do, what would likely happen, what does it trade off, and which option is best under a
stated objective*. Output is advisory. **recommendation != authority.**

---

## A. Scope

**M5 owns:** the candidate-intervention model; candidate generation from pack capabilities over M4 diagnosis claims;
eligibility; compiling eligible candidates into M2 simulation inputs; baseline-vs-candidate comparison over a time
window; economics over operational deltas; trade-off, dominance and status rules; ranking under an explicit objective;
evidence; deterministic explanation; a single sensitivity sweep.

**M5 does not own:** execution of any kind, writes to live systems, staffing commands, monitoring, outcome learning,
policy or approval authority (the V0.2 gate), workflow composition, clinical decisions, new simulation semantics,
new intervention kinds the simulator cannot represent, LLM generation, nested branching (recommending from a simulated
state), multi-objective optimisation, persistence.

## B. Architecture

```
M4 diagnoseAtTime(observed, t)  ──► capacity_limit claims
        ▼
pack capability  cap:reassign_to_staff_bound_station   (station-flow pack; keyed on claim kind + class)
        ▼
enumerate candidates  (persons × frozen windows)        ── deterministic, bounded
        ▼
eligibility (pre-simulation)  ── infeasible candidates stop here, with reasons + evidence
        ▼
compile → M2 reassign interventions (iv_01 at start, iv_02 at end)
        ▼
M2 runArm via additive facade runScenarioSpec  ── same reducer, scheduler, semantics as M2
        ▼
window metrics (baseline and each candidate) ─► deltas ─► economics (assumed inputs) ─► trade-offs
        ▼
dominance ─► status ─► ranking under objective ─► top (candidate | no_action)
        ▼
atlas-recommendation/0.1  ─► template formatter ─► facade / service / inspector panel
```

Core (`impl/src/recommend/`) is domain-free. The only domain knowledge lives in the pack's capability definition
and the world. M5 reads M4 diagnoses and M2 runs; it changes neither.

## C. Object model (normative schema: `schema/atlas-recommendation.schema.json`)

| Concept | Representation |
|---|---|
| CandidateIntervention | `candidate` (kind `reassign_resource`) |
| InterventionTarget | `to` (destination station) and `origin_claim` (the M4 `capacity_limit` claim it answers) |
| InterventionResource | `resource` (person id) and `from` (its assignment at `window.start_t`, possibly null) |
| InterventionWindow | `window {start_t, end_t, label}` |
| EligibilityResult | `eligibility {eligible, reasons[], evidence[]}` |
| SimulationComparison | `simulation {run_id, interventions, sim_events, trace_content_sha256}` + `metrics` + `delta` |
| OperationalDelta | `delta` (candidate − baseline, every metric of §G) |
| EconomicInput / EconomicDelta | `economics.inputs[]` / `economics.by_value.{low,base,high}` |
| RecommendationScore | the objective's primary metric value and its tie-breakers (§J) |
| Recommendation | a candidate with status `recommended` or `conditionally_recommended` and a `rank` |
| RecommendationSet | the document |
| RecommendationEvidence | `evidence[]` refs per candidate (§M) |

**Identity.** `set_id = 'rs_' + h16(canonHash({context, objective, config_sha256, candidate ids}))`.
Candidate id: `cand:reassign_resource:<resource>:<to>:<window label>`. Simulation `run_id` comes from the M2 receipt.
Simulated-event evidence is addressed as `(run_id, event_id)` (`kind: sim_event`), because M2 event ids are unique
only within a run (M2 risk I2). Rule references resolve **by rule kind** (`world.rules[].kind`), never by literal
rule id (the M4 low gap is not repeated; see §Y).

## D. Intervention vocabulary

Exactly one kind in V0: **`reassign_resource`**. It is the only staffing change M2 can simulate. `add_capacity`,
`change_start_time`, `reroute_work`, `defer_work`, equipment changes and clock-ins are not representable and are out.

"Move one Prep worker to Fry from 18:20 to 18:50" is:
```json
{ "kind": "reassign_resource", "resource": "<person>", "from": "<station or null>", "to": "<station>",
  "window": { "start_t": 1791336000, "end_t": 1791337800, "label": "30m" } }
```
- **Preconditions:** §F.
- **World effect:** the resource's assignment is `to` during `[start_t, end_t)` and `from` again from `end_t`.
- **Simulation:** two M2 `reassign` interventions, ids fixed: `iv_01` (`from → to`, at `start_t`) and `iv_02`
  (`to → from`, at `end_t`), both with `at ∈ [tB, tH]`. With `start_t = tB`, `end_t = tH` and the frozen M2 inputs,
  this reproduces the frozen `sim_scenario` trace exactly (verified, §T).
- Nothing else, and no free text, is ever executable.

## E. Candidate generation

Pack capability `cap:reassign_to_staff_bound_station` (station-flow pack) fires for every M4 claim with
`kind = capacity_limit`, `values.class = STAFF`, on an **observed** diagnosis. For each firing claim with subject `s`:
1. Persons: every `person` entity in world order, excluding those already assigned to `s` at `t`.
2. Windows: the frozen `config.candidate_windows` (canonical: `30m` = `[t, t+1800]`, `to_horizon` = `[t, tH]`).
3. Candidates = persons × windows, ordered by (person world order, window order). Dedup by id.
4. Bound: at most 16 candidates per set; exceeding it is `BOUND_EXCEEDED`, never silent truncation.

Other limitation classes (`EQUIPMENT`, `CO_BINDING`, `DEMAND`) and `unknown` claims yield **no candidates**; the set's
`top` is `no_action` with reason `NO_SUPPORTED_INTERVENTION`. A simulated-register diagnosis is refused
(`RECOMMEND_REQUIRES_OBSERVED_BASE`).

## F. Eligibility (before any simulation)

Checked in this order; all failures are recorded:

| Reason | Rule |
|---|---|
| `NOT_ON_SHIFT` | resource not on shift at `start_t` in the observed state |
| `ALREADY_AT_DESTINATION` | assignment at `start_t` is `to` (normally removed at enumeration) |
| `SKILL_MISSING` | skill check fails, using the **same** single skills function as the world loader (CCR-003 convention) |
| `DESTINATION_NOT_STATION` | `to` is not a station entity |
| `FROM_MISMATCH` | `from` ≠ assignment at `start_t` |
| `WINDOW_INVALID` | `start_t < t`, `end_t > tH`, or `end_t ≤ start_t` |
| `OUTSIDE_BRANCH_INTERVAL` | any compiled intervention falls outside `[tB, tH]` |
| `RESOURCE_DOUBLE_BOOKED` | another intervention in the same candidate uses the same resource in an overlapping window (V0: never, one move per candidate) |

Eligibility evidence: state pointers to the resource's `on_shift` and `station`, the world pointer to its skills, and
the destination entity. Infeasible candidates are `status: infeasible`, `simulation/metrics/economics: null`,
`claim_class: derived`, and are never simulated.

## G. Comparison metrics (window `(tB, tH]`, sample points per CCR-004)

Sample points: the settled state at `tB`, then the settled state at the end of every instant in `(tB, tH]` with
events; a sampled value holds until the next sample point or `tH`. "Overloaded" means station status `OVERLOADED`
or `UNSTAFFED`.

| Metric | Formula |
|---|---|
| `order_time_in_system_s` | Σ over all orders of `|[created_t, completed_t ?? tH) ∩ (tB, tH]|` (WIP integral; includes carry-over and unfinished orders) |
| `orders_completed_in_window` | orders with `completed_t ∈ (tB, tH]` |
| `orders_open_at_horizon` | orders created in `(tB, tH]` not completed by `tH` |
| `delay_s_over_target_censored` | Σ over orders created in `(tB, tH]` of `max(0, (min(completed_t, tH) − created_t) − target)`, target = goal on `avg_kitchen_time_s` |
| station `queue_burden_s` | Σ `queue_len(τᵢ) × (τᵢ₊₁ − τᵢ)` |
| station `overload_s` | Σ of intervals whose sample status is overloaded |
| station `max_queue` | max queue length over sample points |
| station `overload_last_t` | last sample instant with overloaded status, or null |

`delta` = candidate − baseline for every field. All integers; no rounding.

## H. Temporal statements the metrics support

"overload ended X minutes earlier" = `(baseline.overload_last_t − candidate.overload_last_t)/60` at the destination;
"cumulative queue burden fell by Y" = `−delta.stations[s].queue_burden_s`; "N additional orders completed" =
`delta.orders_completed_in_window`; "bottleneck moved to P" = P ∈ `new_overload_stations`; nothing else is stated.

## I. Economics (separate layer; never inside the simulator)

| Input | Source | Class |
|---|---|---|
| `delay_cost_per_order_minute` | `world.economics.delay_cost_per_order_minute_over_target.value` (base); `config.sensitivity` (low/high) | assumed |
| `reassignment_cost_per_move` | `config.economics` (canonical 0) | assumed |
| incremental labor | 0 for `reassign_resource`: no paid hours change | configured |

`cost(run) = (delay_s_over_target_censored / 60) × rate + moves × reassignment_cost_per_move` (baseline has 0 moves;
a candidate has 2). `net_effect = cost(baseline) − cost(candidate)`, rounded to cents. **No revenue value is
assigned to completed orders:** `lost_demand_model` is null and R09 holds, so extra completions are a timing shift,
not new revenue (M2 honesty note). Economic results carry `claim_class: assumed`, `support: bounded`.

## J. Objective and ranking

Objective is an explicit input (`objective`), canonical **`operational`**:
- primary metric `order_time_in_system_s`, minimise (equivalently `improvement = −delta.order_time_in_system_s`);
- tie-breakers, in order: fewer `new_overload_stations`, larger `orders_completed_in_window`, candidate id;
- `economic` objective (opt-in): primary `net_effect` at a named value key, maximise; same tie-breakers.

No weights exist, so none are hidden. Ranking is computed only over `recommended` and `conditionally_recommended`
candidates, `recommended` before `conditionally_recommended`, then by the objective.

## K. Statuses, trade-offs, dominance

Evaluated in this order:
1. `infeasible`: eligibility failed (not simulated).
2. `insufficient_evidence`: simulation or metrics could not be produced (recorded by the status itself; no error field in V0, CCR-006 C7).
3. `not_recommended`: `improvement ≤ 0` under the objective (no better than baseline).
4. `dominated`: another simulated candidate is at least as good on all of
   (`order_time_in_system_s` ↓, `orders_completed_in_window` ↑, Σ `overload_s` over its `new_overload_stations` ↓)
   and strictly better on one.
5. `conditionally_recommended`: improves, not dominated, but `new_overload_stations` is non-empty.
6. `recommended`: improves, not dominated, no new overloaded station.

`new_overload_stations`: stations with `baseline.overload_s = 0` and `candidate.overload_s > 0`.
`trade_offs`: every station other than `to` whose `queue_burden_s` or `overload_s` is higher than baseline, listed with
both values. Trade-offs never change status unless they are new overloads.

## L. No action

The baseline is always option zero. `top = { kind: 'no_action', reason }` when no candidate is ranked:
`NO_CANDIDATE_BETTER_THAN_BASELINE`, `NO_SUPPORTED_INTERVENTION` or `NO_ELIGIBLE_CANDIDATE`. That is a valid,
complete result.

## M. Evidence

Per candidate, at least: the origin diagnosis claim (`diagnosis_claim`); eligibility evidence (§F); the world pointers
to the destination station's capacity attributes; the two compiled interventions' `sim_event` refs
(`ASSIGNMENT_CHANGED` with reason `intervention:iv_01|iv_02`); config pointers to the window and economic inputs used.
Every ref must resolve at construction (M4 E4 discipline): `evaluateRecommendations` throws
`RecommendationError('EVIDENCE_UNRESOLVED')` rather than return a set with a dangling ref.

## N. Epistemic model

Order of strength: `derived` > `simulated` > `assumed` > `inferred`. A value's class is the weakest class among its
inputs; no step may raise it.
- Eligibility: `derived` (observed state + world).
- Metrics, deltas, statuses, ranking under `operational`: `simulated`, `support: deterministic`.
- Economics, and any ranking or `top` under `economic`: `assumed`, `support: bounded`.
- `top` under `operational`: `simulated`/deterministic; under `economic`: `assumed`/bounded.
- No M5 output is ever `observed` or `derived` once a simulation is involved.

## O. Explanation (fixed templates; same post-checks as M4 §L)

| Template | Text |
|---|---|
| `R_CANDIDATE` | `{resource_name}: {from_name} → {to_name}, {start_hhmm}–{end_hhmm}.` |
| `R_ASSUMPTION` | `ASSUMED · Observed state: {resource_name} is on shift with no assigned station at {start_hhmm}. Duties outside the modeled stations are not represented in this simulation.` (CCR-006 C1) |
| `R_INFEASIBLE` | `{resource_name} cannot be moved to {to_name}: {reasons_text}.` |
| `R_DELTA` | `SIMULATED · Versus doing nothing: order time in system {tis_delta_text}, {completed_delta} more orders completed, {to_name} queue burden {qb_delta_text}.` |
| `R_OVERLOAD_END` | `SIMULATED · {to_name} overload ends {minutes_earlier} minutes earlier.` |
| `R_TRADEOFF` | `SIMULATED · Trade-off: {station_name} {metric_text} rises from {baseline} to {scenario}.` |
| `R_NEW_OVERLOAD` | `SIMULATED · New overload at {station_name} ({overload_s}s).` |
| `R_ECONOMICS` | `ASSUMED · At {rate_text} per order-minute over target, net effect {net_effect_text} (delay cost only; no revenue is assumed).` |
| `R_RANK` | `Ranked {rank}: lowest order time in system among non-dominated candidates without new overloads.` Exactly four objective- and status-specific variants: CCR-006 C3 |
| `R_DOMINATED` | `Dominated by {dominator_names}.` |
| `R_NO_ACTION` | `No evaluated intervention is better than doing nothing ({reason_text}).` |
| `R_AUTHORITY` | `Advisory only. ATLAS does not execute or authorise this change.` |

Every set's explanation ends with `R_AUTHORITY`. Forbidden words as in M4 §E plus `will`, `guarantee`, `profit`.
**CCR-006:** `R_ASSUMPTION` placement, emission rule and class (C1); forbidden-word post-check with the single
`R_ECONOMICS` negation exemption (C2); `R_RANK` variants and the `R_ECONOMICS` rate under `economic` (C3); the M5
numeral post-check and `R_OVERLOAD_END` rule (C4). Post-check failures throw `RecommendationError('FORMAT_VIOLATION')`.

## P. Sensitivity (narrow)

One parameter, `delay_cost_per_order_minute`, at `config.sensitivity` low/base/high. Report, per value, the candidate
with the largest positive `net_effect` (or `no_action`), and `stable` = all three equal. Operational ranking does not
depend on economics and is reported unchanged. Multi-parameter sweeps, distributions and stochastic durations are deferred.

## Q. API

Facade (additive; JSON in/out):
```ts
runScenarioSpec(input: { world; ledger; scenario: ScenarioObject }): { baseline; scenario }   // M2 runArm without a file path
generateCandidates(input: { world; ledger; diagnosis; config; horizon_t }): Candidate[]
evaluateRecommendations(input: { world; ledger; diagnosis; config; horizon_t; objective; candidate_ids?: string[] }): RecommendationSet
explainRecommendations(input: { set: RecommendationSet; candidate_id?: string }): { lines: { candidate_id: string|null; text: string; claim_class: string }[] }
resolveRecommendationEvidence(input: { world; ledger; set; candidate_id }): ResolvedRef[]
```
`horizon_t` is required; `t` comes from `diagnosis.context.t`; the M2 branch interval is `[t, horizon_t]`.

Service (GET only, 127.0.0.1):
- `GET /api/recommendations?register=observed&t=&horizon_t=&station=&objective=operational|economic&value=low|base|high&candidates=<ids>`
  → `{ set, lines }`. Non-observed register → `RECOMMEND_REQUIRES_OBSERVED_BASE`; bounds per §S.
- `GET /api/recommendations/evidence?…same params…&candidate_id=` → resolved refs.
- `station=` restricts the candidate pool before evaluation; a set is never filtered after construction (CCR-006 C5).

## R. Experience

Inspector, observed register only: when the selected station has a `capacity_limit` claim, a "Recommendations"
section lists the server's `lines` verbatim: candidates with status chips, the no-action line, economics lines with an
ASSUMED chip, trade-offs, and an evidence expander from the evidence route. `R_AUTHORITY` is always shown. The
browser computes nothing. **Deferred:** viewing a candidate's full world as frames. That needs new frame registers
(an `atlas-frame` change, a future CCR).
**CCR-006 C6:** horizon `min(t + 4200, range.max_t)`; lines inserted as text in server order; non-200 shows
`Recommendations unavailable: {error.code}` and no lines.

## S. Bounds

| Limit | Value |
|---|---|
| candidates per set | 16 |
| simulations per request | 12 (eligible candidates) + 1 baseline |
| `horizon_t − t` | ≤ 7200 s and ≤ `world.time.end` |
| request time | 15 s, else `BOUND_EXCEEDED` |
| sensitivity values | exactly 3 |

Exceeding any bound is an error, never truncation.

## T. Answer key and canonical cases

`reference/m5/derive-expectations.mjs` loads an **unmodified copy** of the frozen fixture oracle (only its root path and
final `main();` replaced by exports) and uses the oracle's scheduler and reducer. It computes §G–§P itself, with no ATLAS
runtime code. `--check` reproduces `answer-key.json` (sha256 `7598f59378507ed3489b0eff32b97f93dc470d2ba8e561e08277321594012feb`). Parity built in: the regenerated baseline and the
`emp_04 → st_fry to_horizon` candidate reproduce the frozen M2 `sim_baseline` and `sim_scenario` traces exactly.

| Case | Expectation |
|---|---|
| 1 | Observed 18:20 Fry `capacity_limit STAFF` → 10 candidates (5 persons × 2 windows); emp_03 excluded (already at Fry) |
| 2 | Primary staffing move `emp_04 to_horizon`: order time in system −26,498 s, +13 completed, Fry overload 4,200 → 210 s |
| 3 | `emp_04` creates a new Prep overload (46 s; Prep burden 310 → 6,960): surfaced; status `dominated` |
| 4 | `emp_01`, `emp_05`: `SKILL_MISSING` → `infeasible`, not simulated |
| 5 | Top candidate's net effect scales with rate: 44.19 / 154.68 / 441.95; with `reassignment_cost_per_move = 80`, economic top is no_action / no_action / emp_06 (unstable) |
| 6 | Restricted to `emp_02` candidates (Grill unstaffed, net worse) → `no_action` (`NO_CANDIDATE_BETTER_THAN_BASELINE`) |
| 7 | Every evidence ref in every set resolves |
| 8 | Eligibility `derived`; metrics/status/rank `simulated`; economics `assumed`; nothing escalates |
| 9 | **Top recommendation:** `emp_06` (unassigned manager) `→ st_fry to_horizon`, `recommended`, rank 1: order time in system 67,146 → 37,223 s, completed 50 → 64, Fry queue burden 56,649 → 4,324 s, Fry overload ends at 18:24:52 instead of 19:29:52, Pass burden 191 → 1,019 (trade-off), assumption "no modeled assignment at the source" |
| 10 | Scenario 19:00 diagnosis (`EQUIPMENT`) → 0 candidates, `NO_SUPPORTED_INTERVENTION` |

## U. Test plan

| Test | Content |
|---|---|
| T-CANDIDATE | case 1 exactly; ordering; dedup; bound at 17 → `BOUND_EXCEEDED`; non-STAFF and unknown claims → none |
| T-ELIGIBILITY | case 4; each reason in §F with a mini world; infeasible never reaches the simulator (spy) |
| T-SIMULATION | compiled interventions `iv_01/iv_02`; `emp_04 to_horizon` trace content equals frozen `sim_scenario`; parent ledger and base state deep-frozen and unchanged |
| T-COMPARISON | every §G metric for baseline and all six simulated candidates equals the answer key |
| T-TEMPORAL | sample-point rule incl. a state change exactly at `tB`; `overload_last_t` |
| T-ECONOMICS | case 5; zero labor; no revenue field anywhere |
| T-OBJECTIVE | operational and economic objectives; tie-breakers; explicit objective required |
| T-TRADEOFF | case 3; trade_offs list per §K |
| T-DOMINANCE | dominated_by lists equal the answer key |
| T-NOACTION | cases 6 and 10, and a mini world where every candidate is net worse |
| T-EVIDENCE | case 7; injected dangling refs of each kind make evaluation throw |
| T-EPISTEMIC | case 8; attempts to mark economics `simulated` or a ranking `derived` are rejected |
| T-EXPLANATION | templates verbatim; numeral and forbidden-word post-checks; `R_AUTHORITY` last |
| T-API | facade + service, bounds, observed-only, required `horizon_t` |
| T-CCR006 | the tests in `contract-changes/CCR-006.md` §5 |
| T-UI | Playwright: real click on Fry at observed 18:20 shows the server lines verbatim, ASSUMED chip on economics, authority line; poisoned server response displayed as given |
| T-PACK | pack has no entity ids, station names or rule-id literals; rule lookup by kind |
| T-GENERALITY | a renamed-ids mini world (persons, stations, rule ids) yields the same statuses as its original; scoped by CCR-006 C9 (rule-id renaming stays with CCR-003) |
| Regression | M1, M2 28/28, M3 Playwright 12/12, M4 suites, Signet, `oracle --check`, M4 and M5 reference `--check` |

## V. Safety and authority

Every set carries `authority: advisory_only` and ends with `R_AUTHORITY`. No route writes, no execution, no staffing
command, no policy override, no clinical use. Recommendations are not approvals; the V0.2 approval gate remains separate.

## W. Differentiation (tracking only; no patentability claim)

| Mechanism | Assessment |
|---|---|
| Diagnosis-constrained intervention enumeration (capability fires on a typed claim, not on prose) | UNCOMMON COMBINATION |
| Same-world counterfactual evaluation through the one reducer/scheduler used for history | POTENTIALLY DIFFERENTIATING |
| Evidence-backed recommendation with run-scoped simulated-event refs and construction-time resolution | UNCOMMON COMBINATION |
| Epistemically bounded economics (assumed class propagates to any ranking that uses it) | POTENTIALLY DIFFERENTIATING |
| Deterministic trade-off explanation from per-station deltas | COMMON |
| No-action as a first-class, reasoned result | UNCOMMON COMBINATION |
| Ranking over operational-world deltas with dominance before ranking | COMMON |

## X. Risks and deferred

1. The canonical top is the unassigned manager: the world models no manager duties. The assumption is attached and
   shown; a world that models duties would change it.
2. Nominal durations and historical-replay workload, as in M2.
3. Single-move candidates only; combinations, timing searches and add-capacity are deferred.
4. Candidate frames in the experience are deferred (frame-register CCR).
5. The M2 receipt-identity gate still applies; M5 uses one entry point and persists nothing.

## Y. CCRs

**CCR-006** (M5 closure, 2026-10-10): assumption line, explanation post-checks, objective-aware rank text, station
scope, inspector horizon, T-GENERALITY scope. No other frozen contract changes. M5 adds new artifacts and one additive facade function
(`runScenarioSpec`). **CCR-003 note:** skills mapping (`st_` convention), rule-id-by-kind resolution in the M4 station-flow pack,
and work-id minting remain bundled in the planned CCR-003 identity-conventions work, before any second domain or
script-to-world. M5 itself resolves rules by kind and calls the single skills function.

## Z. Muse handoff and delivery graph

**Build:** `impl/src/recommend/{types,core,candidates,eligibility,compile,metrics,economics,rank,format,resolve}.ts`,
`impl/src/recommend/packs/station-flow-capabilities.ts`, facade additions §Q, service routes §Q, inspector section §R,
tests `impl/test/m5-*.test.ts`, `impl/e2e/m5-*.spec.ts`. **Do not build** anything in §A "does not own".
**Accept when:** all §U tests pass from a clean checkout; the browser path works with real clicks; the M5 answer key
matches on every case; all regressions pass; `muse/atlas-v0` is a true descendant of this contract commit, delivered
by normal fast-forward or a lease-pinned replacement verified by bundle hash. **STOP** after delivery.

**Delivery graph (recorded for SignalWorks Relay Run; not implemented here):**

| Stage | Inputs | Outputs | Gate | Failure classes → routing |
|---|---|---|---|---|
| SPEC/FREEZE | accepted M4, frozen artifacts | 19 + schema + answer key | answer key `--check`, schema strict, parity | spec defect → spec owner |
| BUILD | contract | impl commits | builds clean | compile/packaging → builder |
| DETERMINISTIC TEST | impl, fixtures, answer key | test report | all §U + regressions | test failure → builder |
| INDEPENDENT REVIEW | remote branch, contract | verdict + findings | reviewer PASS | implementation → builder; contract → CCR by spec owner |
| REPAIR | findings | correction commits | lineage true descendant | lineage/packaging → builder |
| RE-TEST | repaired branch | report | as DETERMINISTIC TEST | as above |
| ACCEPT/FREEZE | PASS | accepted head | human approval | — |

Human escalation: any force-push (lease-pinned, run by the human), any CCR, any frozen-artifact change, any
architectural dispute (Fable).
