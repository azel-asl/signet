# 13 — Risks and decisions

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Architectural:** the renderer grows logic because it is convenient | High | Defeats the category claim | Lint rule, binding tests, engine-less bundle test, code review rule "no arithmetic on snapshot fields" |
| **Architectural:** reducer and scheduler diverge into two state models | Medium | Branches no longer start from reconstructed state | Single `WorldState` type; scheduler holds only timers; M8/M9 hash tests |
| **Data quality:** real sources lack KDS-grade granularity | High (V1) | Queues become inferred, not observed | Claim class `inferred` with `derived_from`; utilization `null` when no evidence; inspector says so |
| **Simulation validity:** nominal durations and no balking make the twin optimistic | Certain | Over-promising deltas | Honesty notes on every comparison; calibration records; R09 explicit; ranges once a stochastic duration model exists |
| **AI hallucination:** prose explanations invent numbers | Medium (V1) | Trust loss | Prose only from the structured object; numeral post-check; model receipts |
| **3D complexity:** stakeholders expect the mock-ups | High | Schedule slip, engine unproven | 2D first, explicit in product doc; representation adapter means 3D is a V1 add, not a rewrite |
| **Performance:** large ledgers make scrubbing slow in the browser | Low (V0) / Medium (V1) | UX | Checkpoints; budgets in CI |
| **Generality:** restaurant assumptions leak into the schema | Medium | Second domain needs a redesign | Generalization table in 03; rule-kind enum; second-domain fixture planned in V1 before any schema freeze |
| **User trust:** three states at the same instant confuse users | Medium | Misreading simulation as fact | Registers, labels, no mixed frames, `mode` and `claim_class` on every snapshot |
| **Over-building:** a server or database appears "because we'll need it" | Medium | Loses the PROBE's clarity | Section 36 questions applied in review; non-goals list |
| **Fixture drift:** engine changes silently change hashes | High | Tests become meaningless | Engine version in every artifact; regenerating fixtures requires a recorded reason in `fixtures/CHANGELOG.md` |

## Decisions needed before a builder starts

| # | Decision | Recommendation | Default if no answer |
|---|---|---|---|
| D1 | Repository: new `atlas` repo or a directory in Signet | New repo; copy this directory as its first commit | New repo |
| D2 | Single language | TypeScript end to end | Yes |
| D3 | Renderer for V0 | SVG floor plan | Yes |
| D4 | Keep the oracle after M9 | Keep as an independent cross-check (it is not the engine) until a second domain exists, then delete | Keep |
| D5 | Fixture numbers vs mock-up numbers | Use fixture numbers everywhere; retire the mock-up figures | Fixture numbers |
| D6 | Time resolution | Integer seconds | Seconds |
| D7 | Lost-demand model in V0.2 | No; add in V1 as an explicitly assumed rule kind | No |
| D8 | Roles for V0.2 | viewer / analyst / manager, `--as` flag | Yes |
| D9 | Receipt canonicalization | Port XAS-CANON-1 (40 lines) rather than depend on Signet | Port |
| D10 | Second domain for the generalization test | Imaging department (matches SignalWorks interest) | Imaging |
| D11 | Who owns `fixtures/CHANGELOG.md` entries when hashes change | The builder, reviewed by the spec owner | Builder |
| D12 | Process-graph view in V0 or V0.2 | V0.2 (M22) | V0.2 |
