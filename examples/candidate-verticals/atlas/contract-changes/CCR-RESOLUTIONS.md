# ATLAS V0 contract-change resolutions (Fable-owned)

Muse files CCRs on its implementation branch (`contract-changes/CCR-<nnn>.md`). Fable records
each decision here and applies accepted changes on the reference branch with a new reference
commit. Decisions are independent of the implementation branch: every check below was run
against the frozen reference commit `b8c899c` only.

## CCR-001 — world-definition schema rejects the frozen world at 10 id pointers

**Decision: ACCEPT WITH MODIFICATION.**

- Verified independently (ajv 8, JSON Schema 2020-12, frozen schema vs frozen world): exactly
  10 errors, `/metadata/id` (`restaurant-v0`) and `/rules/0..8/id` (`R01`..`R09`), all against
  the shared `$defs/id` pattern `^[a-z][a-z0-9_]*$`. The oracle never validated the world
  against the schema, which is why the freeze did not catch it. Genuine contract defect.
- Modification: do **not** relax the shared `$defs/id`. Entity, type, step, station, employee
  and goal ids stay strict (they are state keys and the `Id` type of `03-data-model.md`).
  Instead add two identifier types: `$defs/world_id` for `metadata.id` and `$defs/rule_id`
  for `rules[].id`. Checked: the corrected schema accepts the frozen world; still rejects a
  hyphenated/upper-case entity id, a rule id outside `R##`, and a world id with spaces.
- No schema-version increment: the change only widens validation; no conforming document
  changes meaning; bumping `atlas-world/0.1` would force the world file (and `world_sha256`)
  to change for no semantic reason.
- Affected: `schema/atlas-world-definition.schema.json`, `03-data-model.md` (two type lines).
  Fixtures: none. Muse's `allowDeviations: ['CCR-001']` path is to be removed.

## CCR-002 — `state_hash` re-stamp with XAS-CANON-1

**Decision: ACCEPT WITH MODIFICATION.**

- `04-time.md` has always defined `state_hash = sha256(canonicalJson({state, metrics}))` with
  XAS-CANON-1; `15 §2` and `README` invariant 2 pre-authorised one recorded re-stamp. The
  frozen oracle hashed `JSON.stringify` output (insertion key order): self-consistent, but
  not the contract rule. Genuine, contract-anticipated correction.
- Independently recomputed with Signet's own `src/canon.ts` (`canonHash({state, metrics})` of
  each frozen file): s1 `7d713924…`, s2 `765d5cb5…`, s3 `67f66b29…`, s4 observed `8de373a7…`.
  All four equal Muse's reported values exactly. Muse's XAS-CANON-1 is correct.
- Modification: the oracle stamps six snapshots with one rule, so the re-stamp covers all six
  (`s4_simulated_intervention` → `32938d58…`, `s4b_simulated_baseline` → `312746ac…` as well).
  Remedy is the oracle change plus regeneration, not a hand edit; `manifest.json` regenerated
  and gains `hash_rule: "XAS-CANON-1"`.
- Only derived hash metadata moved: six `state_hash` lines, six manifest entries, one new
  manifest field. State, metrics, diagnosis, evidence refs, ledgers, sim traces, comparison,
  world and scenario are byte-identical. Hash contract and schema versions unchanged.
- Oracle version label kept at `oracle-0.1.0` (a bump would rewrite `provenance.adapter` in
  1,866 simulated events, which is content churn unrelated to the defect).

## CCR-004 — window metrics skip the branch-point state (raised by spec owner during M2 design)

**Decision: ACCEPT.** `windowMetrics` sampled station status only after events with `t ≥ tB`,
so when no event falls exactly on `tB` the interval from `tB` to the first later event was never
counted. Observed day 1 has no event at 18:20:00 and Fry was already OVERLOADED there, so
`overloaded_seconds.st_fry` read 4,197 instead of 4,200. Simulated branches always have events at
`tB` and were unaffected. Fix: sample the settled state at `tB`, then the settled state at the end
of every instant in `(tB, tH]`. Verified that per-event and end-of-instant sampling give identical
values on all three fixture logs, so end-of-instant is adopted as the cleaner definition with no
other value moving. One expected value changed (calibration only). No schema change.
