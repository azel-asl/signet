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

Contract-change requests live one level up in `../contract-changes/`.
Both were accepted by Fable on 2026-10-07 (reference `cd0db9e`):

- **CCR-001** (accepted with modification) — the frozen world file failed the
  frozen schema at 10 `id`-pattern pointers. The schema now has `$defs/world_id`
  (`metadata.id`) and `$defs/rule_id` (`rules[].id`); entity-id strictness kept.
  The loader is strict with no deviations.
- **CCR-002** (accepted with modification) — one-time XAS-CANON-1 re-stamp of all
  six stamped snapshots' `state_hash` values; `manifest.json` carries
  `hash_rule: "XAS-CANON-1"`. Runtime hashes equal the corrected stored values.

The `st_` station-to-skill mapping (D5) is a recommended follow-up contract
issue, not authorized work; the current mapping stands.

## Run

```bash
npm install
npm test          # 68 tests
npm run parity    # rebuilds the 4 canonical snapshots, writes reports/
```

## Status

Content parity (state, metrics, diagnosis, evidence_refs) and `state_hash`
parity **PASS** at all four canonical T (17:45, 18:08, 18:20, 19:00) against the
corrected reference (`cd0db9e`); runs are deterministic; checkpoint +
incremental replay equals full replay. See the parity report for exact hashes.
