# 02 — Architecture

## System context (V0)

```
                 ┌──────────────────────────────────────────────────────────┐
  world file ───▶│                        ATLAS V0                          │
  (JSON)         │                                                          │
                 │  ┌──────────┐   ┌──────────┐   ┌─────────────────────┐   │
  raw sources ──▶│  │ evidence │──▶│  ledger  │──▶│ engine              │   │──▶ snapshots (JSON)
  (CSV)          │  │ adapters │   │ (NDJSON) │   │ reducer + scheduler │   │──▶ branch ledgers
                 │  └──────────┘   └──────────┘   │ + derived views     │   │──▶ comparison
                 │                                └──────────┬──────────┘   │──▶ receipts
  scenario ─────▶│                                           │              │
  (JSON)         │                   ┌──────────────┐   ┌────▼─────────┐    │
                 │                   │ intelligence │◀──│  snapshots   │    │
  user ◀────────▶│  viewer (browser) │ (V0.2)       │   └──────────────┘    │
  (browser/CLI)  │  renders snapshots└──────────────┘                       │
                 └──────────────────────────────────────────────────────────┘
```

No network boundary exists inside V0. The CLI and the browser both import the same
packages. External systems appear only as files.

## Component architecture (packages in one TypeScript workspace)

| Package | Owns | Depends on | Must not |
|---|---|---|---|
| `@atlas/schema` | TypeScript types, zod schemas, JSON Schema export, semantic validators, canonical JSON + sha256 | nothing | contain behaviour |
| `@atlas/ledger` | Append-only event ledger (NDJSON read/write), ordering, checkpoints | schema | know about stations or orders |
| `@atlas/engine` | `createState`, `applyEvent` (reducer), derived views (capacity, status, metrics), scheduler, branch | schema, ledger | do I/O, call the network, read the clock |
| `@atlas/evidence` | Adapter interface, five CSV adapters, normalizer, alias resolution, ingestion report | schema, ledger | derive operational state |
| `@atlas/intelligence` (V0.2) | Bottleneck detector, explanation builder, economics, recommendation, calibration | engine | mutate state or ledger |
| `@atlas/authority` (V0.2) | Roles, authority gate, approval and action receipts | schema | be bypassable by intelligence |
| `@atlas/cli` | `load`, `validate`, `ingest`, `state`, `replay`, `branch`, `compare`, `hash` | all | contain logic not in a library |
| `@atlas/viewer` | React app: floor plan (SVG), timeline, inspectors, comparison | engine (read-only), schema | compute capacity, status, queue age, or any metric |

Rule of thumb enforced by tests: `@atlas/viewer` imports `@atlas/engine` only for types
and `deriveViews`; a lint rule forbids arithmetic on snapshot fields inside the viewer
beyond layout math.

## Five-domain mapping

| Domain (brief) | Packages | Concrete V0 content |
|---|---|---|
| WORLD | schema, engine (state) | entity types, entities, relationships, aliases, processes, visualization hints; WorldState facts |
| BEHAVIOUR | engine (scheduler, rules) | rule kinds R01–R09, scheduler, timers, branch adoption |
| EVIDENCE | evidence, ledger | adapters, normalization, provenance, claim classes, ingestion report, checkpoints |
| INTELLIGENCE | engine (derived views), intelligence | capacity/status/metrics (V0); bottleneck, explanation, economics, recommendation, calibration (V0.2) |
| CONTROL / EXPERIENCE | viewer, cli, authority | timeline, inspectors, comparison, authority gate, receipts |

## Data ownership boundaries

| Data | Single writer | Readers | Mutability |
|---|---|---|---|
| World definition | Human (file) | all | versioned file; changing it changes `world_sha256` in every artifact |
| Raw records | Source systems | adapters | immutable once in `raw/` |
| Ledger `history:*` | evidence package | engine, viewer | append-only |
| Ledger `sim:*` | engine (branch run) | viewer, intelligence | write-once per run |
| Checkpoints | ledger package | engine | derived cache, deletable |
| Snapshots | engine | viewer, tests | derived, deletable, hash-addressed |
| Receipts | authority package | all | append-only |
| Calibration records | intelligence | humans | append-only |

A simulation branch never writes to a history ledger. The history ledger never contains
`claim_class: simulated`. Both are asserted by schema and by tests.

## Runtime boundaries

- **V0:** one process. CLI (Node 22) and browser (Vite) both run the engine in-process.
  Files on disk (CLI) or in-memory/File API (browser).
- **V0.2:** same; receipts written as files.
- **V1 (not built):** a service hosting ledgers for LIVE ingestion and multi-user access;
  the engine stays a pure library used on both sides.

## API boundaries (TypeScript interfaces; no HTTP in V0)

```ts
// @atlas/schema
loadWorld(json: unknown): Result<World, ValidationError[]>      // never partial
canonicalJson(v: unknown): string; sha256(s: string): string

// @atlas/ledger
interface Ledger { branch: BranchId; append(events: Event[]): void; read(range?: {from?: number; to?: number}): Iterable<Event>; checkpoint(t: number): Checkpoint; nearestCheckpoint(t: number): Checkpoint | null }

// @atlas/engine
createState(world: World): WorldState
applyEvent(state: WorldState, e: Event): WorldState               // pure; returns new state
reduceTo(world: World, ledger: Ledger, t: number): WorldState
deriveViews(world: World, state: WorldState, t: number, ledger: Ledger): Views   // capacity, status, metrics
snapshot(world, ledger, t): Snapshot                              // {state, views, state_hash}
branch(world, ledger, scenario: Scenario): { baseline: Ledger; scenario: Ledger; run: SimulationRun[] }
compare(world, runA: Ledger, runB: Ledger, window): Comparison

// @atlas/evidence
interface Adapter { id: string; version: string; accepts(file: RawFile): boolean; parse(file: RawFile, world: World): { events: Event[]; rejects: Reject[] } }
ingest(world: World, files: RawFile[], adapters: Adapter[]): { ledger: Ledger; report: IngestReport }

// @atlas/intelligence (V0.2)
diagnose(world, snapshot): Diagnosis
explain(world, snapshot, diagnosis): Explanation                   // structured; prose optional
recommend(world, snapshot, diagnosis, scenarios: Scenario[]): Recommendation[]
calibrate(prediction: Comparison, observed: Comparison): CalibrationRecord[]

// @atlas/authority (V0.2)
gate(actor: Actor, action: ActionRequest): GateResult             // deterministic; outranks any recommendation
approve(actor, recommendation): ApprovalReceipt
```

Every function above is deterministic given its inputs. None reads the wall clock; the
only clock is `t` passed in. This is what makes the build plan's hash-equality tests possible.

## What is deliberately absent

No message bus, no job queue, no graph database, no ORM, no auth provider, no model
gateway. Each has a seam (`Ledger`, `Adapter`, `Representation`, `Gate`, `ModelClient`
interfaces) and no implementation beyond what the fixtures need.
