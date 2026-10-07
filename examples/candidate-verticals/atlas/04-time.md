# 04 — Time

## Time semantics

| Clock | Field | Meaning | Who sets it |
|---|---|---|---|
| Event time | `t` (integer unix seconds), `ts` (ISO with the world's offset) | When the thing happened in the operation | Source record, via adapter |
| Record time | `provenance.record_ts` | What the source wrote; usually equals `ts`; kept separately so a corrected `t` stays traceable | Source |
| Ingestion time | `provenance.ingested_at` | When ATLAS saw the record | Ledger |
| Ledger order | `seq` | Position in the append-only file | Ledger |
| Simulation clock | `t` on `sim:*` branches | Same unit and epoch as event time; starts at `base.t` | Engine |
| Wall clock | none | The engine never reads it | — |

Integer seconds are the resolution. Sub-second ordering is settled by the tie-break
below, never by milliseconds that sources do not reliably provide.

## Total order within a branch

Reduction order is `(t, rank(type), subject, data.work_id ?? '')` with
`rank = EQUIPMENT_STATE_CHANGED/MEASUREMENT_RECORDED 0 < EMPLOYEE_CLOCKED_IN/ASSIGNMENT_CHANGED 1 < HUMAN_REPORT 2 < WORK_COMPLETED 3 < ORDER_READY 4 < ORDER_COMPLETED 5 < ORDER_CREATED 6 < WORK_QUEUED 7 < WORK_STARTED 8`.
Capacity changes apply first, completions before starts so freed slots are usable at the
same instant, creations before the queuing they cause. Two implementations that agree on
this order and on the reducer produce identical states, which is what the fixture hashes test.

Within a `history:*` ledger, `seq` equals this order after a batch ingest. In LIVE mode
(V1) it will not, and the reducer must sort by the key, not by `seq`.

## Historical reconstruction

```
reduceTo(world, ledger, T):
  cp = ledger.nearestCheckpoint(T)           // checkpoint.t <= T, or null
  state = cp ? cp.state : createState(world)
  for e in ledger.read({from: cp?.t, to: T}) in reduction order, skipping e.t <= cp.t:
      state = applyEvent(state, e)
  state.t = T
  return state
```

`applyEvent` is pure: same state and event in, same state out, no clock, no randomness,
no I/O. Reconstruction never consults a rendered frame or a previous snapshot's views.

## Checkpoints

A checkpoint is `{t, state, ledger_seq, state_hash}` written every N events (N = 500 in V0)
and at every `EQUIPMENT_STATE_CHANGED` or `ASSIGNMENT_CHANGED`. Checkpoints are a cache:
deleting them changes nothing but speed, and a test asserts `reduceTo` with and without
checkpoints gives the same hash. Snapshots are checkpoints plus views, kept only when a
user or a test asks for them.

## Replay contract

```
state_hash(T) = sha256(canonicalJson({ state: StateView(T), metrics: Metrics(T) }))
```
with `canonicalJson` = XAS-CANON-1 canonicalization (sorted keys, no whitespace, numbers
as shortest round-trip). The four fixture snapshots carry their hashes. A replay test is
"reduce to T, hash, compare". A binding test is "render snapshot, read back the DOM, map to
state, compare". A determinism test is "run twice, compare trace hashes".

## Late and out-of-order evidence (interface only in V0)

Appending an event with `t` earlier than the latest checkpoint invalidates every
checkpoint and snapshot with `t >= event.t`. The ledger records the append with its own
`ingested_at`; the reducer re-sorts. Nothing is ever edited in place. A human correction is
a new event with `claim_class: human_corrected` and `provenance.correction_of = <event_id>`;
the reducer applies the correction's effect and the inspector shows both.

## Scenario branch semantics

```
branch(world, history, scenario):
  tB = scenario.base.t
  base_state = reduceTo(world, history, tB)            // shared prefix, never copied or modified
  for each of {baseline, scenario}:
      s = clone(base_state)
      timers = adopt(s, tB)                             // in-progress work: completes at max(tB, started_t + nominal); READY orders: handoff at max(tB, ready_t + handoff_s)
      arrivals = history ORDER_CREATED with tB < t <= horizon   (claim_class observed, note 'replayed')
      scheduled = interventions -> ASSIGNMENT_CHANGED events (claim_class simulated, reason 'intervention:<id>')
      run scheduler from tB to horizon; emitted events -> ledger sim:<name>, each with claim_class simulated
```

Properties, each with a test:

- **Isolation.** The history ledger's hash is unchanged after any number of branch runs.
- **Shared prefix.** `reduceTo(sim:x, tB)` equals `reduceTo(history, tB)`.
- **Same demand.** Both branches contain identical `ORDER_CREATED` events.
- **Reproducibility.** Running the same scenario twice yields identical `trace_sha256`.
- **Distinguishability.** Every event on a `sim:*` branch that is not a replayed arrival has `claim_class: simulated`; snapshots on it have `claim_class: simulated` and `mode: SIMULATE`.

## Historical vs simulated, visually

Same timeline widget, different register. Historical: solid fills, label "WHAT HAPPENED",
timeline scrubs the history ledger. Simulated: hatched fills, label "WHAT MIGHT HAPPEN",
branch name and base time printed in the frame, and the timeline cannot be scrubbed before
`base.t` (that part is the shared prefix and is shown in the historical register).
