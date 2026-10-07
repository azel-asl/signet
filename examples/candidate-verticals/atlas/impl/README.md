# ATLAS V0 implementation (Muse, Milestone 1: world + replay parity)

Independent TypeScript runtime implementing the frozen ATLAS V0 contract
(`../15-v0-contract-and-muse-handoff.md`) against the frozen fixtures in
`../fixtures/restaurant-v0/`. Written from the specification (03–06); the Fable
oracle was read only to resolve ambiguities (see `DECISIONS.md`). No oracle code
is imported, copied, or transplanted — a regression test enforces this.

## Layout

- `src/canon.ts` — XAS-CANON-1 canonical JSON + sha256 (`state_hash`).
- `src/schema.ts` — strict JSON Schema validator (subset used by the V0 schemas).
- `src/world.ts` — `loadWorld`: schema + 03 semantic checks, JSON-pointer errors.
- `src/ledger.ts` — `loadLedger`: NDJSON parse, per-line validation, reduction order.
- `src/reducer.ts` — `createState`, `applyEvent`, `reduceTo` (pure, deterministic).
- `src/views.ts` — capacity (R01), status (R07), utilization, metrics, diagnosis,
  evidence refs, snapshot assembly.
- `src/checkpoints.ts` — checkpoint write/resume (pure cache, 04).
- `src/parity.ts` — expected-vs-actual comparison with first-differing-path diffs.
- `scripts/parity.ts` — parity runner; writes `reports/parity-report.{json,md}`.
- `test/` — 68 tests: canon, schema, reducer, views, replay, provenance,
  checkpoints, regression.
- `fixtures/invalid/` — the six invalid world variants (M2).
- `reports/` — generated parity reports.

Contract-change requests live one level up in `../contract-changes/`:

- **CCR-001** — the frozen world file fails the frozen schema at 10 `id`-pattern
  pointers (`/metadata/id`, `/rules/0–8/id`); proposes a targeted schema fix.
- **CCR-002** — the one-time XAS-CANON-1 re-stamp of the four historical
  snapshots' `state_hash` values (values fully determined by frozen content).

Until Fable accepts them, the loader stays strict by default; the parity runner
proceeds downstream of the disputed world-validation check only through the
explicit, logged `allowDeviations: ['CCR-001']` affordance.

## Run

```bash
npm install
npm test          # 68 tests
npm run parity    # rebuilds the 4 canonical snapshots, writes reports/
```

## Status

Content parity (state, metrics, diagnosis, evidence_refs) **PASSES** at all four
canonical T (17:45, 18:08, 18:20, 19:00); runs are deterministic; checkpoint +
incremental replay equals full replay. `state_hash` equality and strict world
validation are blocked on CCR-002 and CCR-001 respectively — see the parity
report for the exact values and pointers.
