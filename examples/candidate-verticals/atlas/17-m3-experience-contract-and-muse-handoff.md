# 17 — ATLAS V0 Milestone 3 contract: EXPERIENCE, and Muse handoff

**Status:** FROZEN as the Muse Milestone 3 contract on 2026-10-08.
**Spec owner:** Opus. Fable on escalation only.
**Reference:** this file's commit on `claude/youthful-ride-3hx3o1` (parent `cae5adf`).
**Implementation base:** `muse/atlas-v0` @ `b49dbb7` (M1 PASS, M2 PASS).
**Schema artifacts:** `schema/atlas-frame.schema.json` (`atlas-frame/0.1`, `atlas-inspection/0.1`).

Muse Milestone 3 = build-plan M12 (floor plan), M13 (timeline) and M14 (evidence inspector),
plus a read-only view of the frozen M2 arms and comparison. It refines 07 where this
document says so; everywhere else 07 stands.

---

## 1. Objective

Make the existing operational world visible, scrubbable and inspectable, for history and
for both simulated arms, while proving structurally that every operational value on screen
came from ATLAS and not from the renderer.

## 2. Non-goals

Diagnosis or root cause, recommendations, economics, new interventions or scenario
authoring, side-by-side comparison (build-plan M19), 3D, VR, training mode, raw-source-line
display, calibration view, live data, persistence, multi-user access. See §17.

## 3. Architecture

```
ATLAS engine (M1/M2, unchanged)
      │  imports only
      ▼
capabilities.ts  (facade; three additive functions, §4)
      │  imports only
      ▼
experience/project.ts ── projectFrame, inspectEntity  (copy-only projection, §5)
      │
experience/server.ts ── node:http on 127.0.0.1, read-only GET JSON + static files
      │  HTTP JSON (atlas-frame/0.1, atlas-inspection/0.1)
      ▼
web/ renderer ── vanilla TypeScript + SVG in the browser, no framework, no engine code
```

Decisions, each final for M3:

| Decision | Choice | Reason |
|---|---|---|
| Runtime | Local Node service, zero runtime dependencies, bound to `127.0.0.1` | The engine uses `node:crypto` and `node:fs`. Running it in the browser would mean porting the canonicalizer and loaders, which puts frozen M1/M2 hashes at risk. The service boundary is also the future capability boundary. Supersedes 10's "static site with fixture bundled" for M3. |
| Renderer | Vanilla TypeScript compiled by `tsc` with DOM lib, SVG floor plan from `world.visualization` | Keeps zero runtime dependencies. React/Vite (10) adds tooling without proving anything. Revisit for the 3D renderer. |
| Projection | `ExperienceFrame` exists | The snapshot is the operational truth, but the renderer also needs register identity, layout, containers and time range. Putting those in a copy-only frame keeps all derivation upstream and gives every future renderer one contract. |
| Comparison | Toggle among three registers at a shared T, plus a read-only comparison panel | Side-by-side is M19. Toggle plus persistent labels is the smallest experience that makes the counterfactual legible. |
| Browser tests | Playwright as the only new **dev** dependency | Required for the binding test. No runtime dependency is added. |

## 4. Experience boundary

The renderer's only inputs are the HTTP responses in §11. It never reads files, never imports
from `impl/src/` except `experience/types.ts` (types only, erased at compile), and never
computes an operational value.

The service's only engine-facing import is `capabilities.ts`. Fixture paths live in one
module, `experience/source.ts`, which returns `{ world, ledger, scenarioPath }`. Swapping it
for a database, replay service or live source must not change the projection, server routes
or renderer (future Data Plane, §18).

Three **additive** facade functions, no change to existing signatures or M2 outputs:

```ts
buildBranchLedger(input: { ledger: AtlasEvent[]; branchEvents: AtlasEvent[]; tB: number }): AtlasEvent[]  // E3 order
getSupportingEvidence(input: { world: World; ledger: AtlasEvent[]; t: number; entity: Id }): EvidenceRef[]
listInstants(input: { ledger: AtlasEvent[]; from: number; to: number }): number[]                          // distinct event t, ascending
```
`getSupportingEvidence`: for a station, exactly the M1 `evidenceRefs(world, state(t), t, ledger, station)`;
for any other entity, every event with `t ≤ T` whose `subject` equals the id or whose `data`
has `work_id`, `order_id`, `employee_id`, `equipment_id` or `station_id` equal to the id,
in ledger order.

`ENGINE_VERSION` stays `atlas-impl/0.2.0`; the engine does not change. The experience
layer carries its own `EXPERIENCE_VERSION = 'atlas-experience/0.1.0'`.

## 5. ExperienceFrame — `atlas-frame/0.1`

Built by `projectFrame({ register, t })` from `getStateAtTime` on the register's ledger.
**Every operational value is copied from the snapshot by the path in §5.2. Nothing is
recomputed.** The projection may look up world structure (names, layout, relationships)
and copy facts into containers; it may not apply any rule.

### 5.1 Shape (normative; JSON Schema in `schema/atlas-frame.schema.json`)

```ts
interface ExperienceFrame {
  atlas_schema: 'atlas-frame/0.1';
  experience_version: string;                 // 'atlas-experience/0.1.0'
  world: { id: string; name: string };
  register: Register;
  t: number; ts: string;                      // requested T (integer seconds) and ISO form
  range: { min_t: number; max_t: number };    // §6
  snapshot_state_hash: string;                // == getStateAtTime(register ledger, t).state_hash
  ledger_events_applied: number;
  layout: { canvas: {w: number; h: number}; areas: Record<string, Rect>; flows: [string, string][] };
  entities: FrameEntity[];                    // sorted by (kind order §5.3, id)
  open_orders: { id: string; state: string; created: string; age_s: number; items: string[]; total: number }[];
  metrics: { orders_open: number; orders_completed: number; throughput_per_hour: number;
             avg_kitchen_time_s: number|null; p90_kitchen_time_s: number|null; over_target_share: number|null };
  frame_hash: string;                         // canonHash(frame minus frame_hash), computed last
}
interface Register {
  kind: 'observed' | 'baseline' | 'scenario';
  branch: string;                             // 'history:day1' | 'sim:baseline' | 'sim:scenario'
  mode: 'RECONSTRUCT' | 'SIMULATE';           // copied from the snapshot
  claim_class: 'derived' | 'simulated';       // copied from the snapshot
  label: string;                              // fixed strings, §7
  run_id: string | null;                      // display only, §16
  branch_point_t: number | null; horizon_t: number | null;
  interventions: { id: string; employee: string; from: string|null; to: string|null; at_t: number }[];
}
interface FrameEntity {
  id: string; kind: 'station' | 'equipment' | 'person' | 'work';
  name: string;
  rect: Rect | null;                          // world.visualization.objects[id] or null
  container: string | null;                   // §5.3
  state: Record<string, unknown>;             // copied fields, §5.2
}
type Rect = { x: number; y: number; w: number; h: number };
```

Forbidden in the frame: diagnosis, bottleneck, any field not listed in §5.2, any value
computed from other frame values, wall-clock time, file paths.

### 5.2 Copy map (frame field ← snapshot path; exact)

| Entity kind | `state` field | Snapshot source |
|---|---|---|
| station | `status`, `staff`, `capacity`, `queue`, `in_progress` | `state.stations[id].*` |
| station | `queue_len`, `in_progress_count`, `oldest_wait_s`, `utilization` | `metrics.stations[id].queue_len`, `.in_progress`, `.oldest_wait_s`, `.utilization` |
| equipment | `status`, `capacity`, `nominal_capacity` | `state.equipment[id].*` |
| person | `on_shift`, `station` | `state.employees[id].*` |
| work | `order_id`, `station_id`, `step`, `state`, `queued`, `started` | `state.work_open[i]` with `id` |
| — | `open_orders` | `state.orders_open` |
| — | `metrics.*` | `metrics.*` scalars of the same name |

### 5.3 Containers and order (lookups of facts, not rules)

- station, equipment: `container = null` (placed by `rect`).
- person: `state.station` if on shift and assigned; `'tray:unassigned'` if on shift and
  unassigned; `'tray:off_shift'` otherwise.
- work: `state.station_id`.
- Entity order: stations, equipment, persons in world entity order; then work in the order
  it appears in its station's `queue` followed by `in_progress`.

## 6. Timeline semantics

- **Source of truth:** the requested `t`. The renderer asks for a frame at `t`; the frame's
  `t` and `data-t` equal it. There is no client-side state between frames.
- **Precision:** integer seconds. Non-integer → `T_NOT_INTEGER`.
- **Range:** observed `[time.origin, time.end]` of the world. Simulated arms `[tB, tH]`.
  Outside → `T_OUT_OF_RANGE`. The renderer clamps when switching registers and shows the
  notice "time moved to the branch's range".
- **Event boundary:** the state at `t` includes every event with `t_event ≤ t` (M1). The
  frame shows `ledger_events_applied`.
- **Snapping:** none. "Previous/next event" buttons use `listInstants`.
- **Play:** advances `t` by a speed step and requests a new frame per step. Each painted
  frame is an ATLAS frame. A request still in flight is superseded, never painted after a
  newer one (§12).
- **Interpolation:** none in M3. Frames replace each other; no token moves between positions
  and no number tweens. The timeline marks the branch point and each intervention `at_t`
  from `register`.

## 7. Registers (observed, baseline, scenario)

| Kind | Ledger | `label` (verbatim) |
|---|---|---|
| observed | history | `OBSERVED HISTORY · reconstructed from evidence · claim: derived` |
| baseline | history prefix ++ baseline arm events | `SIMULATION · BASELINE (no intervention) · not observed · claim: simulated` |
| scenario | history prefix ++ scenario arm events | `SIMULATION · SCENARIO: <scenario name> · not observed · claim: simulated` |

`register.mode` and `register.claim_class` are copied from the snapshot, which C1 of M2
derives from the ledger. The projection asserts they agree with `kind` and fails otherwise.

Rendering requirements, not by colour alone:
1. A banner with `label`, branch, and for simulated arms "branched at <ts> · horizon <ts>",
   present in every view and not dismissible.
2. Simulated arms draw a repeated diagonal `SIMULATED` text watermark across the whole SVG
   canvas, so a cropped screenshot of the floor plan still says so.
3. Simulated arms use hatched station fills; observed uses solid fills.
4. The inspector header repeats the register label.
5. The comparison panel (§11) is labelled `COUNTERFACTUAL COMPARISON · baseline vs scenario ·
   simulated` and shows the three M2 honesty notes in a block that cannot be collapsed.
   Observed history is never shown in that panel.

## 8. Entity inspection — `atlas-inspection/0.1`

One generic contract for every entity kind, from `inspectEntity({ register, t, entity })`:

```ts
interface Inspection {
  atlas_schema: 'atlas-inspection/0.1';
  register: Register; t: number; ts: string;
  entity: FrameEntity;                        // identical to the frame's entry at the same (register, t)
  relationships: { type: string; from: string; to: string }[];   // world relationships touching the id
  evidence: EvidenceItem[];                   // getSupportingEvidence, §9
  evidence_total: number;
  related_events: EventItem[];                // touching events, t ≤ T, newest first, at most 50
  related_events_total: number;
  inspection_hash: string;                    // canonHash(minus inspection_hash)
}
interface EventItem { event_id: string; t: number; ts: string; type: string; branch: string;
                      claim_class: string; source: string; record_id: string }
interface EvidenceItem extends EventItem { record_ts: string; adapter: string;
                      derived_from?: string[]; note?: string }
```
An entity absent at `t` (for example completed work) → `ENTITY_NOT_PRESENT`. Unknown id →
`UNKNOWN_ENTITY`. The renderer keeps the selection across `t` changes and shows the
not-present message when applicable.

## 9. Evidence and provenance

The question M3 answers is "what records support what I am looking at", not "why did this
happen".
- On the observed register, items are history ledger events with their provenance as
  recorded.
- On a simulated register, items may be history-prefix events (as recorded), replayed arrivals
  (`observed`, with the replay note) or simulated trace events (`simulated`). The inspector
  groups them under three fixed headings: "Evidence (history)", "Replayed arrivals (input)",
  "Simulation output (not evidence)".
- Every displayed item carries its `claim_class` as text.
- Raw source lines (07) are deferred: they need the M7 adapters.

## 10. Renderer rules (enforced, §14)

May: lay out from `layout` and `rect`, place tokens by `container`, map `status`/`claim_class`
strings to styles through fixed lookup tables, sort or filter already-delivered lists, format
numbers and times for display, request frames, inspections, instants and the comparison.

Must not: compute any number from frame values except layout geometry, compare a frame number
to a threshold, change a frame value, infer or rename a register, hard-code entity ids, times
or values, read files or fixtures, import engine code, cache frames across registers, or
animate state.

## 11. Interaction model and service API

Local service, `GET` only, JSON bodies, `127.0.0.1`:

| Route | Returns |
|---|---|
| `/api/world` | `{ world: {id, name}, registers: Register[] with range, scenario_name }` |
| `/api/frame?register=&t=` | `atlas-frame/0.1` |
| `/api/inspect?register=&t=&entity=` | `atlas-inspection/0.1` |
| `/api/instants?register=&from=&to=` | `{ instants: number[] }` |
| `/api/comparison` | the M2 `atlas-comparison/0.1` from `compareScenariosFacade` |
| `/` | static renderer |

Errors: HTTP 400 `{ error: { code, message } }` with codes `BAD_REGISTER`, `T_NOT_INTEGER`,
`T_OUT_OF_RANGE`, `UNKNOWN_ENTITY`, `ENTITY_NOT_PRESENT`; 500 `INTERNAL`. Any other method → 405.

Screen: register toggle (three buttons), banner, timeline with time readout, play/pause,
speed, previous/next event, branch-point and intervention markers; SVG floor plan with station
cards copying `status`, `in_progress_count/capacity.effective` as two separate copied numbers,
`queue_len`, `oldest_wait_s`; equipment badges; person and work tokens; open-orders list;
inspector panel; comparison panel. At start: observed register at 18:20.

The service runs both M2 arms once at start-up through `runScenario` and deep-freezes the
results. It needs no database and no write route.

## 12. Error and failure behaviour

- Service start-up fails loudly if world, ledger or scenario fail validation; it never serves
  a partial world.
- The renderer shows an explicit error card with the code; it never shows a stale frame as
  current. On error the floor plan is replaced by "No frame for this time".
- Out-of-order responses: each request carries a sequence number; a response older than the
  last painted one is discarded.
- Loading: the previous frame stays visible with a "loading" overlay and its own `t` shown.

## 13. Deterministic invariants

1. `projectFrame(r, t)` is a pure function of (source, r, t): equal inputs give byte-equal JSON
   and `frame_hash`, across calls, processes and register visit order.
2. `frame.snapshot_state_hash == getStateAtTime(ledger(r), t).state_hash`.
3. Every frame value listed in §5.2 equals its snapshot source.
4. `inspection.entity` equals the frame's entity at the same (r, t).
5. Every `evidence` and `related_events` `event_id` exists in `ledger(r)` with matching
   `claim_class`.
6. No request mutates the history ledger, an arm, or another register's frames.

## 14. Test plan

| # | Test |
|---|---|
| T1 | Canonical frames: for (observed 17:45, 18:08, 18:20, 19:00), (baseline 19:00), (scenario 19:00), `snapshot_state_hash` equals s1, s2, s3, s4_observed_reference, s4b, s4 stored hashes, and every §5.2 field equals the frozen snapshot field |
| T2 | Arbitrary T: 60 seeded T per register; frame §5.2 fields equal `getStateAtTime` at the same T |
| T3 | Register semantics: mode, claim_class, branch, label per §7 for all three; projection throws if a ledger's derived classification disagrees with `kind` |
| T4 | Inspection: Fry, observed, 18:20 → `evidence` event ids equal the 17 ids of `s3.evidence_refs`, same order (build-plan M14); every item resolves (invariant 5) |
| T5 | Inspection on a simulated arm: items fall under the three §9 headings by claim_class and branch; none of the simulated items is labelled evidence |
| T6 | Round trip: frames at T1 → T2 → T1 have identical `frame_hash` (server) and identical DOM (browser) |
| T7 | Isolation: frames for all registers at 20 T, before and after visiting every other register, are identical; history ledger file hash unchanged |
| T8 | Poisoned frame: serve a hand-made frame with inconsistent values (status `OVERLOADED` with `queue_len` 0, `capacity.effective` 99, `in_progress_count` 7); the DOM shows exactly those values. Proves the renderer does not recompute |
| T9 | Binding to ATLAS, not fixtures: start the service with a `source` whose ledger has one Fry `WORK_QUEUED` event removed before 18:20; the displayed Fry queue length equals the new `getStateAtTime` value, not the frozen one |
| T10 | Renderer static scan: `web/` sources import nothing from `impl/src/` except `experience/types.ts` as `import type`; contain none of `per_staff_concurrency`, `overload_queue`, `overload_wait_s`, `duration_s`, `queued_t`, `started_t`, `handoff_s`, `st_`, `emp_`, `o_0`, `fixtures`, `.ndjson`, `Math.min(`, `Math.max(` outside one named layout file, and no comparison of a frame number against a literal |
| T11 | Engine-less bundle: the served static directory contains no engine module (scan for `applyEvent`, `reduceTo`, `runScheduler`, `createHash`) |
| T12 | Browser binding (Playwright, Chromium): for the six T1 pairs, read `data-entity`, `data-kind`, `data-state`, `data-t`, `data-register` attributes, rebuild station status/queue/in_progress, equipment status/capacity, person container; equal the frame |
| T13 | Browser register safety: banner text equals `label`; simulated arms show the canvas watermark and hatched fills; the comparison panel shows the three honesty notes and has no collapse control |
| T14 | Browser timeline: scrub to 18:20 then 19:00 then 18:20 (T6); previous/next event lands on `listInstants` values; switching to baseline at 17:45 clamps to 18:20 with the notice |
| T15 | Errors: each §11 code returned for a crafted request; renderer shows the error card and no floor plan |
| T16 | Out-of-order responses: an artificially delayed older response is not painted after a newer one |
| T17 | Service boundary scan: `experience/` imports only `capabilities.ts`, `experience/*`, and `node:*` |
| T18 | Regression: ATLAS suite, M1 parity 4/4, M2 parity 28/28, Signet suite, `oracle --check`, all green; M2 receipts and trace hashes unchanged |

**Oracle.** No new experience oracle and no frozen frame hashes: freezing frames would freeze
presentation choices. The oracle is the frozen M1/M2 snapshots via the §5.2 copy map (T1),
`s3.evidence_refs` (T4), and the poisoned-frame and mutated-ledger tests (T8, T9), which
prove binding without duplicating the projection. Screenshots of the six T1 views are kept
as human evidence only; they are never a pass condition.

## 15. Acceptance criteria — PASS WHEN

1. T1–T18 pass on `muse/atlas-v0` rebased (an ancestor, not a content sync) onto this
   contract commit.
2. `npm run experience` starts the service and renderer locally with no network access and no
   runtime dependency beyond Node.
3. The six canonical views are reachable in the browser and their DOM binds per T12.
4. No change to the engine modules (`reducer`, `views`, `scheduler`, `simulate`, `window`,
   `compare`, `checkpoints`, `canon`, `ledger`, `branch`, `scenario`, `world`, `schema`),
   to existing facade signatures, or to any reference artifact.
5. The only new dependency is Playwright as a dev dependency.

## 16. Regression requirements and the receipt-identity gate

All M1 and M2 checks stay green with unchanged hashes. M3 does **not** depend on receipt
identity across entry points: the service uses the facade path only, so its arms are mutually
consistent, and `run_id` is shown as a local label, not as a verified identity.

**Hard gate (carried from the M2 closure review):** before any of external receipt
verification, receipt persistence, comparing arms produced through different entry points, or
Signet integration, ATLAS must adopt a single definition of `world_sha256` and
`parent_ledger_sha256` through a CCR. That CCR will change M2 receipts and `run_id` values
but no trace, state or metric hash. M3 does not file it.

## 17. Prohibited scope

Market world or any market concept, temporal layers, temporal ghosts, state echoes, 3D, VR/AR,
training mode, diagnosis or bottleneck display, root cause, recommendations, economics,
autonomous action, Signet gate or signing, SignalWorks integration, Jev, LLM calls, live
connectors, a data plane, a database or event bus, script-to-world, a second domain,
stochastic simulation, new intervention types or scenario editing, CCR-003, a generic
dashboard or visualization framework, any write route, any engine change.

## 18. Known risks

1. **Service versus static site.** The local service departs from 10's static-site plan. Cost:
   the demo needs Node running. Benefit: no engine port and a real capability boundary.
   A static export of selected frames can be added later without touching the boundary.
2. **Copy-map drift.** If the snapshot shape changes, §5.2 must change with it; T1 and T2 catch
   drift.
3. **Static-scan evasion.** A determined author can hide arithmetic past a token scan. T8 and T9
   are the behavioural backstop.
4. **Playwright availability.** If Chromium cannot be installed in Muse's environment, T12–T16
   cannot run and M3 cannot pass. Install it before starting.
5. **Evidence breadth.** Non-station evidence is "every touching event". That is honest but noisy;
   a narrower lineage is a later refinement.

## 19. Deferred, with the requirement each must keep open

| Deferred | Kept open by |
|---|---|
| Side-by-side comparison (M19) | Frames are per register and self-labelled; two frames at one T compose without change |
| 3D, VR/AR, training | `ExperienceFrame` is renderer-neutral; rects are hints, not semantics |
| Future derived objects (specialist outputs, market structures, echoes) | A later frame MINOR version may add a `derived_objects` array with their own provenance; nothing in §5 forbids it, nothing in M3 builds it |
| Data plane, remote ATLAS service | `experience/source.ts` is the only place that knows storage |
| Raw source lines in evidence | Needs M7 adapters |
| Calibration view | The calibration document already exists; showing it needs its own register rules |
| Receipt identity | §16 hard gate |
| CCR-003 | Unchanged; the renderer must not depend on `st_` ids (T10) |

## 20. Muse handoff

1. **Objective:** §1.
2. **Order:** rebase onto this commit; add the three facade functions with unit tests; build
   `experience/project.ts` with T1–T5, T7; build `experience/server.ts` with T15–T17; build
   `web/` with T8, T10, T11; then Playwright T6, T12–T14, T16; then T18.
3. **Files:** `impl/src/capabilities.ts` (additive), `impl/src/experience/{types,project,source,server}.ts`,
   `impl/web/{index.html,app.ts,layout.ts,styles.css}`, `impl/tsconfig.web.json` (DOM lib, output to
   `web/dist`), `impl/scripts/experience.ts`, `impl/test/m3-*.test.ts`, `impl/e2e/m3-*.spec.ts`,
   `package.json` scripts `experience` and `test:e2e`.
4. **Contracts:** §5, §8, §11, exactly, validated against `schema/atlas-frame.schema.json` in tests.
5. **Log** every ambiguity in `DECISIONS.md`; a genuine contract defect goes to
   `contract-changes/CCR-<nnn>.md`.
6. **STOP** at §15. Report test counts, the six canonical frame hashes, screenshots of the six
   views, and any CCRs. Do not start M4.

## 21. PASS/FAIL gate

PASS requires every §15 item with independent reproduction by the reviewer. FAIL on any
operational value computed in `web/`, any register ambiguity in T13, any engine or reference
change, or any new runtime dependency.
