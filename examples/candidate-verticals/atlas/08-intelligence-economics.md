# 08 — Intelligence, AI boundary, economics

## Division of responsibility

| Must be deterministic (V0/V0.2 code) | May use an LLM (V1, behind `ModelClient`) |
|---|---|
| identity and aliases, state transitions, rules, time, capacity, queues, metrics | natural-language description → draft world definition (COMPOSE) |
| simulation execution, branch isolation, comparison | SOP/document parsing into candidate entities and processes |
| bottleneck detection, binding-constraint analysis | mapping assistance when a new source's columns are unknown |
| explanation **content** (structured) | explanation **prose** rendered from the structured object |
| economics arithmetic, assumption labelling | hypothesis and scenario proposal (which interventions to try) |
| authority gate, receipts, audit | summarizing a day for a human |

The V0.2 killer demo makes **zero** model calls. Every recommendation in V0.2 is a
simulated scenario with a comparison object; the recommendation text is a template over
that object.

## Bottleneck detection (deterministic, V0.2)

```
candidates = stations with status OVERLOADED or UNSTAFFED at T
if none: no bottleneck
bottleneck = candidate with the largest oldest_wait_s (tie: largest queue_len, then world order)
since_t = t of the last transition into OVERLOADED without an intervening exit, scanning the ledger
binding = 'staffing' if staff_cap < equipment_cap, 'equipment' if >, 'both' if equal; 'staffing' if effective = 0
affected_orders = distinct orders of queued work at the station
degraded_equipment = attached equipment with status ≠ OPERATIONAL, each flagged binding or not
downstream = other stations' queue and status
```
Fixture at 18:20: Fry, since 18:15:00, queue 5, wait 300 s, capacity {equipment 5, staff 3,
effective 3}, binding staffing, fryer 2 DEGRADED and **not** binding. After the move at
19:00: capacity {5, 6, 5}, binding equipment; status BUSY.

Propagation is reported, not asserted as causation: downstream queues are listed with
the dependency edge that connects them (fry → pass via R05). ATLAS says "orders waiting
on fry hold the pass" because R05 is a known deterministic relationship; it does not say
"fry caused revenue loss" because no such rule exists.

## Explanation (structured first)

```ts
Explanation = { diagnosis, rules_applied: ['R01','R05','R07'], evidence: ProvenanceRef[], measurements: [...oil temps...], counterfactual?: Comparison, prose?: { text, model_receipt } }
```
The UI renders the structured object. Prose, when a model is attached, is generated from
the object and shown with a `ModelReceipt`:
`{ provider, model, prompt_sha256, input_object_sha256, output_sha256, created_at, temperature, tokens }`.
The prose can never introduce a number absent from the object; a post-check rejects any
numeral not present in the input.

## Script-to-world interface (V1, specified now)

```
text/SOP ─▶ ModelClient.extract ─▶ DraftWorld (JSON, same schema, every field tagged {claim_class:'inferred', span})
         ─▶ validate (schema + semantic) ─▶ MissingList (what the validator needs)
         ─▶ clarification loop (human answers, or model proposes with 'assumed' tag)
         ─▶ World (every assumed value listed in metadata.assumptions)
```
The draft is a world definition, so it is inspectable and editable before anything runs.
V0 proves the target: the fixture world file loads, validates, runs.

## Provider abstraction

```ts
interface ModelClient { complete(req: { system: string; input: object; schema: JSONSchema; temperature: number }): Promise<{ output: object; receipt: ModelReceipt }> }
```
One interface, no SDK dependency in core packages. Adapters per vendor live outside the
engine. Nothing in `@atlas/engine` or `@atlas/evidence` imports a model client.

## Economics (V0 minimum)

| Quantity | Computation | Claim class |
|---|---|---|
| Revenue of completed orders | Σ `order.total` over COMPLETED (cumulative or in-window) | derived (from observed POS totals) |
| Revenue open at horizon | Σ totals of in-window orders not completed by `tH` | derived |
| Labor cost in window | Σ over on-shift staff of `labor_cost_per_hour[role] × hours` | derived from world parameters |
| Delay minutes over target | Σ max(0, kitchen_time − 600 s)/60 over completed in-window orders | derived |
| Delay cost | delay minutes × `delay_cost_per_order_minute_over_target.value` | **assumed** (parameter is tagged assumed in the world file) |
| Lost demand | not modelled (`lost_demand_model: null`, rule R09) | — |

Every economic number is rendered with its claim class. A reassignment has zero labor
delta; an `add_staff` intervention (V0.2) would show the delta. The economics module has
no access to anything but the comparison object and the world's economics block.

## Recommendation (V0.2)

A recommendation is a scenario that has been simulated plus the comparison. The
generator enumerates feasible `reassign` interventions (skills, on-shift, not the
bottleneck's own staff), simulates each, and ranks by `Δ avg_kitchen_time_s` subject to
no other station becoming OVERLOADED for more than a threshold. Alternatives are listed
with their own comparisons ("why not move Dana: prep would be UNSTAFFED"). Confidence is
`null` in V0.2 because no uncertainty model exists; it is not a made-up 0.8.

## Calibration (V0.2)

`calibrate(prediction, observed)` emits one record per metric with a `comparable`
verdict based on declared conditions (arrivals within ±10 %, same staffing before the
intervention, same equipment state). Records are append-only. No parameter changes.
A model change is a new world version with a reason that cites calibration records,
approved like any other change. This mirrors SEP's learning invariant: observation →
calibration → explicitly approved change.
