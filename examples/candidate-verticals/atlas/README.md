# ATLAS — V0 Product & Technical Specification

**Status:** Design specification, FROZEN as the V0 reference contract on 2026-10-07 (see 15). BUILD not started.
**Execution:** Not implemented. The only code here is a fixture oracle.
**Scope:** A standalone PROBE that may later join SignalWorks. It has its own architecture.
**Produced:** 2026-10-07 from the "ATLAS — Master Product & Architecture Brief"

ATLAS is a **living process twin**: an executable, continuously updateable model of how an
operation actually works. The operational model owns truth. Every representation (3D, 2D,
graph, table) renders that truth and never decides it.

This specification does not repeat the brief. It challenges it where needed
(see [00-brief-review.md](00-brief-review.md)), fixes the semantics the brief leaves open,
and reduces V0 to the smallest architecture that proves the category while keeping the
foundations the larger vision needs.

---

## The answer to the brief's final question

> What is the smallest version of ATLAS that would make a technically sophisticated observer
> say, "This is not a dashboard. This is an executable model of an operation"?

**One world file, one ledger, one reducer, one scheduler, one renderer with no logic, and a hash.**

Concretely, the observer sits at a terminal and a browser:

1. `atlas load world.restaurant-v0.json` validates and loads the world. Change a rule kind
   to an unknown value and the loader refuses the file instead of improvising.
2. `atlas ingest raw/*.csv` turns five source-shaped files (POS, KDS, staff hub, IoT, shift
   notes) into one normalized ledger of 1,815 events, each carrying provenance.
   The ledger's hash matches the committed fixture.
3. `atlas state --at 18:20` reduces the ledger to a WorldState. Its `state_hash` matches
   `snapshots/s3_bottleneck_active.json`. Fry is OVERLOADED, queue 5, oldest wait 300 s,
   and the diagnosis says the degraded fryer is *not* the binding constraint, staffing is.
4. In the browser, scrubbing the timeline re-renders the floor plan from those same
   snapshots. The renderer's source contains no queue, capacity, or status logic.
   Delete the engine package and the viewer renders nothing.
5. `atlas branch --at 18:20 --intervene reassign:emp_04:st_fry` runs baseline and
   scenario with identical replayed arrivals. Two traces, two hashes, reproducible on
   any machine. Kitchen time 18.2 min → 10.1 min; fry queue peaks at 26 → 6; prep
   utilization rises to 91 %: the trade-off is visible, and no LLM was called.
6. Click any station at any time and ATLAS shows the exact source records that produced
   its state.

If each step reproduces the committed hashes, the system is an executable model.
If step 4 fails, it is a dashboard. V0 is built to make step 4 impossible to fake.

---

## Reading order

| File | What it settles |
|---|---|
| [00-brief-review.md](00-brief-review.md) | Where the brief is wrong, under-specified, or over-built, and what this spec decides instead |
| [01-product.md](01-product.md) | Problem, definition, users, jobs-to-be-done, the killer demo (with fixture numbers), workflows, UX states, scope, non-goals |
| [02-architecture.md](02-architecture.md) | System context, components, five-domain mapping, ownership, runtime and API boundaries |
| [03-data-model.md](03-data-model.md) | Canonical model, every schema, versioning, the domain-generalization test |
| [04-time.md](04-time.md) | Time semantics, reconstruction, snapshots, replay contract, branch semantics |
| [05-evidence.md](05-evidence.md) | Adapters, normalization, provenance, claim classes, entity resolution, error handling |
| [06-behavior-simulation.md](06-behavior-simulation.md) | The discrete-event model, exact rules, scheduler, baseline/branch/intervention, reproducibility, comparison |
| [07-visualization.md](07-visualization.md) | 2D-first decision, entity-to-visual binding, overlays, timeline, inspectors, comparison view |
| [08-intelligence-economics.md](08-intelligence-economics.md) | What stays deterministic, what an LLM may do, bottleneck detection, explanation, economics, recommendations, calibration |
| [09-governance.md](09-governance.md) | Observe → Explain → Simulate → Recommend → Approve → Execute, permissions, receipts, Signet relationship |
| [10-technology.md](10-technology.md) | Stack with reasons, alternatives rejected, deployment, observability |
| [11-build-plan.md](11-build-plan.md) | Milestones with PASS WHEN, tests, and evidence artifacts |
| [12-testing.md](12-testing.md) | Test strategy by category |
| [13-risks-decisions.md](13-risks-decisions.md) | Risks with mitigations; decisions needed before a builder starts |
| [14-novel-mechanisms.md](14-novel-mechanisms.md) | Mechanisms to document as implementation evidence accumulates |
| [15-v0-contract-and-muse-handoff.md](15-v0-contract-and-muse-handoff.md) | **Frozen V0 contract**, contract-change process, oracle independence, SignalWorks boundary, Muse Milestone 1 |
| [schema/](schema/) | JSON Schemas: world definition, event, snapshot |
| [fixtures/restaurant-v0/](fixtures/restaurant-v0/README.md) | The synthetic restaurant: world, scenario, raw sources, ledger, four canonical snapshots, expected simulation results, calibration day |

## Fixtures are generated, not drawn

Every number in this specification comes from `fixtures/restaurant-v0/oracle/generate.mjs`,
a dependency-free reference that implements the rules in
[06-behavior-simulation.md](06-behavior-simulation.md) and writes the fixtures with a
manifest of hashes. It is **not** the ATLAS engine and must be replaced by it
(milestone M9 in the build plan makes the real engine reproduce the oracle's hashes).

```bash
cd fixtures/restaurant-v0
node oracle/generate.mjs          # regenerate
node oracle/generate.mjs --check  # verify committed fixtures match (exit 1 on drift)
```

## Relationship to Signet

ATLAS's authority model (section 09) separates observe / explain / simulate / recommend /
approve / execute, and its approval and action receipts are designed to be canonicalized
with XAS-CANON-1 so they can later be verified by Signet without a format change.
Nothing in V0 depends on Signet, and nothing in ATLAS enters Signet's closed layer.
Per Signet's rules: simulation in ATLAS is never described as enforcement of a live system.
