# 14 — Mechanisms to track

No patentability claims. These are combinations worth documenting with implementation
evidence as it accumulates. Each entry is to be filled in at the milestone named.

| Mechanism | What it is | How it works here | Why it was necessary | What conventional systems do | Evidence (milestone) |
|---|---|---|---|---|---|
| Evidence-derived visual reconstruction | Source records → ledger → state at any T → rendered world | Adapters, reducer, checkpoints, representation adapter | Replay must come from operational state, not saved frames | BI dashboards aggregate; replay tools store frames | M7, M13 DOM equality |
| Unified historical/simulated world | A reconstructed state is the branch point for counterfactuals | `branch()` clones `reduceTo(T)`; scheduler continues it | Simulation disconnected from evidence is a toy | DES tools start from modelled initial conditions | M9 shared-prefix test |
| Evidence-linked visual objects | Any rendered state traces to records | `data-entity` → inspector → provenance → raw line | "Why does ATLAS believe this" must be a list of records | Tooltips show values, not sources | M14 |
| Script-to-executable world | Text compiles to the world definition, not to code | `DraftWorld` with inferred/assumed tags → validate → World | Natural language must not control rendering or runtime directly | Prompt-to-dashboard generators | V1 |
| Visual counterfactual operations | Two futures rendered side by side from identical demand | Replayed arrivals, split view, registers | Comparing against a guessed future is theatre | Scenario planners show charts, not worlds | M19 |
| Closed-loop calibration | Prediction vs later observation, with comparability verdicts | Calibration records, append-only, no auto-change | Twins drift; silent self-tuning hides it | Model tuning by hand or by opaque retraining | M21 |
| Adaptive representation | One snapshot, several representations | `Representation` interface; floor plan and process graph | Spatial is not always the right view | One view per product | M22 |
| Binding-constraint honesty | Diagnosis names what binds and what merely looks broken | R01 decomposition into equipment vs staff capacity | A degraded fryer that is not binding would otherwise be blamed | Alerts on the loudest symptom | M15 |
