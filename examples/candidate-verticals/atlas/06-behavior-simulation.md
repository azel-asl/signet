# 06 — Behaviour and simulation

This is the normative description of the engine. The fixture oracle implements exactly
this; the real engine must reproduce the oracle's hashes (milestone M9).

## Model

Discrete-event, integer seconds, no randomness in the engine itself. Randomness lives
only in inputs (arrival generation and duration jitter, both seeded and both outside the
reducer and scheduler). Work flows through stations; stations have slots; slots are
bounded by equipment and by staff.

## Rules (normative)

| Rule | Statement |
|---|---|
| **R01 station_capacity** | `equipment_cap = Σ capacity of attached equipment with status ≠ DOWN` (DEGRADED equipment contributes its reduced `capacity`). `staff_cap = (number of on-shift employees assigned) × per_staff_concurrency`. If the station has attached equipment: `effective = min(equipment_cap, staff_cap)`; else `effective = staff_cap`. If `staffing = required` and no staff: `effective = 0`. |
| **R02 queue_discipline** | Queue order is `(queued_t, order.created_t, work_id)` ascending. No priorities. |
| **R03 no_preemption** | In-progress work always finishes. When capacity drops below `in_progress`, nothing starts until `in_progress < effective`. |
| **R04 single_assignment** | One station per employee. `ASSIGNMENT_CHANGED` takes effect at its `t`; the old station's in-progress work continues (R03). |
| **R05 assembly_barrier** | The order's `pass` step is queued at the instant the last item's last kitchen step completes; immediately at creation if no item has a process. |
| **R06 handoff** | `ORDER_COMPLETED` at `ready_t + handoff_s` (60 s). No station, no staff. |
| **R07 station_status** | `UNSTAFFED` if `effective = 0 ∧ queue > 0`; else `OVERLOADED` if `queue_len ≥ overload_queue ∨ oldest_wait ≥ overload_wait_s`; else `BUSY` if `effective > 0 ∧ in_progress ≥ effective`; else `NORMAL`. Evaluated at event times and at any requested T. |
| **R08 skills_required** | Assignment to a station not in the employee's skills is a validation error (world load, scenario load, approval gate). |
| **R09 no_balking** | Every created order is eventually served. No lost demand. |

## State transitions

```
Order:   (ORDER_CREATED) → OPEN ─(ORDER_READY)→ READY ─(ORDER_COMPLETED)→ COMPLETED
Work:    (WORK_QUEUED) → QUEUED ─(WORK_STARTED)→ IN_PROGRESS ─(WORK_COMPLETED)→ DONE
Equip:   OPERATIONAL ⇄ DEGRADED ⇄ DOWN      (EQUIPMENT_STATE_CHANGED carries the new capacity)
Employee: off ─(EMPLOYEE_CLOCKED_IN)→ on_shift ; station ─(ASSIGNMENT_CHANGED)→ station'
Station status (derived): NORMAL | BUSY | OVERLOADED | UNSTAFFED
```
The reducer accepts any order of these events (history can be messy) and records a
`Conflict` view when a transition is out of sequence; it never refuses an observed event.

## Scheduler (simulation = reducer + this)

```
run(state, from, until, arrivals, scheduled, durationOf):
  timers = adoptInProgress(state, from)              // see 04-time.md branch semantics
  external = sort(arrivals ∪ scheduled, reduction order)
  dispatch(from)
  loop:
    t = min(next timer.t, next external.t); stop if none or t > until
    for each timer at t (sorted by t, kind, id):      // completions first
        complete: emit WORK_COMPLETED; then onWorkCompleted
        handoff:  emit ORDER_COMPLETED
    for each external at t in reduction order:        // capacity changes, assignments, arrivals
        emit; if ORDER_CREATED: onOrderCreated
    dispatch(t)

onOrderCreated(t, order): for each item with a process: emit WORK_QUEUED(step 0) ; if none: emit WORK_QUEUED(pass)
onWorkCompleted(t, work):
    if work.step = pass: emit ORDER_READY; timer handoff at t + handoff_s
    else if next step exists: emit WORK_QUEUED(next)
    else mark item done; if all items done: emit WORK_QUEUED(pass)              // R05
dispatch(t): for each station in world order:
    while queue non-empty and in_progress < effective(t):                       // R01, R03
        w = queue head (R02); emit WORK_STARTED; timer complete at t + durationOf(nominal(w), w)
```

`durationOf` is `nominal` for simulation branches, and a seeded jitter function only
when generating synthetic history (the oracle uses `nominal × U[0.8, 1.25)`, minimum 15 s).

## Processing times (fixture)

| Product | Steps |
|---|---|
| Burger | prep 90 s → grill 240 s |
| Chicken sandwich | prep 90 s → fry 300 s |
| Salad | prep 150 s |
| Fries | fry 210 s |
| Drink | none |
| Order | pass 90 s after all items; handoff 60 s |

Station parameters: prep (2 per cook, table 4), grill (4 per cook, grill 8), fry
(3 per cook, 2 fryers × 3 baskets), pass (2 per expo, no equipment). Overload: queue ≥ 6
or oldest wait ≥ 240 s.

## Metrics (normative definitions)

| Metric | Definition at time t |
|---|---|
| `orders_open` | count of orders with state ≠ COMPLETED |
| `orders_completed` | count with state = COMPLETED (cumulative) |
| `throughput_per_hour` | count of orders with `completed_t ∈ (t−3600, t]` |
| `avg_kitchen_time_s` | mean of `completed_t − created_t` over orders with `completed_t ∈ (t−900, t]`; `null` if none |
| `p90_kitchen_time_s` | nearest-rank 90th percentile of the same set; `null` if none |
| `over_target_share` | share of that set with kitchen time > goal target (600 s); `null` if none |
| `revenue_completed` | Σ `total` over COMPLETED orders |
| `station.queue_len`, `in_progress` | sizes at t |
| `station.oldest_wait_s` | `t − queued_t` of queue head; 0 if empty |
| `station.utilization` | Σ over work at the station of `|[started_t, completed_t ?? t] ∩ (t−900, t]|` ÷ `∫_{t−900}^{t} effective(τ) dτ`; `null` if the integral is 0 |

Window metrics for a comparison window `(tB, tH]`: membership is orders **created**
inside the window; `orders_completed` counts those also completed by `tH`;
`throughput_per_hour = completed / hours`; kitchen-time statistics over the completed
subset; `max_queue` and `overloaded_seconds` per station integrated over the window;
`revenue_completed_in_window`, `revenue_open_at_horizon`, `delay_minutes_over_target`,
`delay_cost_assumed`, `labor_cost_in_window`.

## Baseline, branch, intervention

See [04-time.md](04-time.md) for branch semantics. V0 supports one intervention kind,
`reassign`, because it is the one the killer demo needs and it exercises R01, R03, R04
and R08 together. `equipment_state` and `add_staff` are specified (03) and deferred.

## Reproducibility

Every `SimulationRun` records `engine_version, world_sha256, scenario_sha256, seed,
base_state_hash, trace_sha256, final_state_hash`. Two runs with equal inputs must have
equal `trace_sha256`; this is the determinism test. Where a future duration model is
stochastic, runs carry the seed and the UI shows ranges from N seeds, never a single
number as if certain.

## Fixture results (window 18:20–19:30, 65 arrivals, identical in both branches)

| Metric | Baseline (sim) | Scenario (sim) | Δ |
|---|---|---|---|
| Orders completed | 43 | 56 | +13 |
| Throughput (orders/h) | 36.9 | 48.0 | +11.1 |
| Avg kitchen time | 1,090 s | 608 s | −482 s |
| p90 kitchen time | 1,537 s | 704 s | −833 s |
| Share over 10-min target | 0.84 | 0.61 | −0.23 |
| Max fry queue | 26 | 6 | −20 |
| Fry overloaded | 4,200 s | 210 s | −3,990 s |
| Max prep queue | 3 | 7 | +4 |
| Prep overloaded | 0 s | 46 s | +46 s |
| Prep utilization (15 min at horizon) | 0.47 | 0.91 | +0.44 |
| Revenue of orders completed in window | $794.50 | $1,058.50 | +$264.00 (timing shift) |
| Delay cost (ASSUMED $0.35/order-min over target) | $126.55 | $13.53 | −$113.02 |
| Labor cost in window | $161.00 | $161.00 | $0 |

Honesty notes travel with the comparison object and must be rendered next to it.
