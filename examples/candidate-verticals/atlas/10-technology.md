# 10 — Technology

Boring, inspectable, one language, no server.

| Concern | Choice | Why | Rejected |
|---|---|---|---|
| Language | TypeScript everywhere (Node ≥ 22, ES modules) | The engine must run in the browser (local scrubbing) and in the CLI (tests, hashes) without a second implementation. Signet is already TS. | Python backend: two engines or a server round trip per scrub |
| Workspace | npm workspaces, one repo (`atlas/`), packages per 02 | Smallest thing with package boundaries a lint rule can enforce | Separate repos, monorepo tooling |
| Schema | zod for runtime validation; JSON Schema (2020-12) emitted from zod for the published contracts | One source of truth for types and validation; JSON Schema for non-TS consumers | hand-written JSON Schema only (drifts from types) |
| Canonical JSON and hashes | XAS-CANON-1 port (sorted keys, no whitespace), Node `crypto` / WebCrypto sha256 | Stable hashes across CLI and browser; Signet compatibility | `JSON.stringify` (key order unstable) |
| Ledger | NDJSON files, one per branch, header line with `world_sha256` | Append-only by construction, diffable, greppable | SQLite (fine later; not needed with one writer), Postgres, Kafka |
| Engine | Custom reducer + scheduler (~600 lines, proven by the oracle) | Pure functions, cloneable state, branch from any T | SimPy (not cloneable, Python), commercial DES |
| Determinism | Integer seconds, stable sorts, mulberry32 for seeded inputs | Hash equality tests | `Math.random`, floating time |
| Viewer | React 18 + Vite, SVG rendering, no state library | Pure function of a snapshot; DOM attributes for binding tests | Three.js/R3F (V1), canvas (harder to test) |
| Charts | Minimal inline SVG sparklines for metric history | A dozen lines each; no library in V0 | Recharts/d3 (fine in V0.2 if needed) |
| CLI | `tsx` scripts, `commander`-free hand-rolled argv | Match Signet's CLI style | oclif |
| Tests | vitest (unit, determinism, replay, schema), Playwright (binding tests against the SVG DOM) | Already in the repo family; Playwright preinstalled in the environment | jest |
| Lint | eslint with a custom rule: no arithmetic on snapshot fields in `@atlas/viewer` | Enforces "renderer has no logic" | — |
| Storage | Files under `fixtures/`, `runs/`, `receipts/` | One user, one world | Object storage (V1 for raw artifacts) |
| Background jobs | none | Nothing runs longer than a second | — |
| Deployment | Static site build of the viewer with the fixture bundled; CLI runs from the repo | A PROBE is a repo someone clones | Containers, cloud (V1) |
| Observability | Structured JSON logs from CLI; every run writes a `SimulationRun` record; trace files are the debugger | Reproducibility is the observability | APM |
| AI | `ModelClient` interface, no implementation shipped in V0 | Zero calls in the killer demo | vendor SDK in core |

## Performance budget (V0)

- Load + validate world: < 50 ms.
- Ingest 2,000 records: < 200 ms.
- Reduce 1,815 events from scratch: < 20 ms; with checkpoints, any T: < 5 ms.
- Branch run of 70 minutes with 65 arrivals: < 50 ms (the oracle does both branches in well under a second including I/O).
- Viewer frame from snapshot: < 16 ms.

These are generous; if any is missed, the architecture is wrong, not the hardware.

## Where ATLAS lives

Recommended: a new repository `atlas` (standalone PROBE). Until it exists, this
specification and its fixtures live in Signet under `examples/candidate-verticals/atlas/`
as a design exploration, matching the existing convention for not-yet-built verticals.
