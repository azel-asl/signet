# 07 — Visualization

## Decision: 2D floor plan in SVG first

| Option | Verdict | Reason |
|---|---|---|
| Interactive 3D (Three.js / R3F) | Defer to V1 | Weeks of asset, camera and picking work that prove nothing about the model. The mock-ups are the vision; they are not the V0 test. |
| 2.5D isometric sprites | Defer | Same binding contract as 2D with more art. Worth it once the 2D viewer is proven and a buyer-facing demo needs it. |
| **2D floor plan, SVG in React** | **Build** | Areas, stations, equipment as rectangles from `visualization.objects`; employees and orders as tokens placed by lookup. DOM is inspectable, which makes the binding test trivial: read attributes back and compare to the snapshot. |
| Process graph | Build as second view in V0.2 | Same snapshot, different layout: nodes = stations, edges = `visualization.flows`, node colour = status. Proves adaptive representation cheaply. |

Operational legibility over sophistication: six rectangles, four colours, tokens, and a
timeline are enough to see a queue grow and a reassignment relieve it.

## Representation adapter interface

```ts
interface Representation {
  id: 'floorplan_2d' | 'process_graph' | ...;
  render(snapshot: Snapshot, world: World, register: 'historical'|'simulated', selection?: Id): VNode;
  // No other inputs. No access to the ledger, the engine, or the previous frame.
}
```

The viewer is a pure function of a snapshot. Animation between frames is cosmetic
interpolation of token positions and is disabled in binding tests.

## Entity-to-visual binding

- `visualization.objects[entity_id]` → rectangle. Missing → "unplaced" tray with the id.
- Employee token: inside the rectangle of `state.employees[id].station`; off-shift → not drawn; unassigned → manager tray.
- Work token: inside its `station_id` rectangle; QUEUED in a left column ordered as the snapshot's `queue` array, IN_PROGRESS in a right column.
- Order chips in `area_pickup` when state = READY.
- Equipment badge: `OPERATIONAL` none, `DEGRADED` amber with `capacity/nominal_capacity`, `DOWN` red.
- Station fill by `views.stations[id].status`: NORMAL neutral, BUSY blue, OVERLOADED red, UNSTAFFED grey hatched. Colour is looked up, never computed from queue length in the viewer.
- Every rendered element carries `data-entity`, `data-state`, and `data-t` attributes. The binding test reads them.

## State overlays

Station card (always visible, small): status, `in_progress/effective`, queue length,
oldest wait. Values are copied from `views`. The card has no arithmetic.

## Flow visualization

`visualization.flows` draws static arrows. Motion along an arrow is shown only when the
snapshot sequence contains a `WORK_QUEUED` at the arrow's head whose previous step
completed at its tail, that is, from state transitions between consecutive snapshots.
No "flow intensity" is invented from counts.

## Timeline

Play, pause, scrub, speed (1×, 10×, 60×), jump to next/previous event of a selected
type, jump to a snapshot. Scrubbing calls `snapshot(world, ledger, T)` with checkpoints,
locally. Two registers (historical solid, simulated hatched) and two labels, never mixed
in one frame. In COMPARE, two frames, same T, same scale, baseline left, scenario right.

## Object inspector

For the selected entity at T: facts from `state`, views from `views`, and the list of
events with `subject = id` or touching it (`data.work_id`, `data.station_id`) up to T,
newest first, each with `claim_class` chip and `record_id`. For a station it also lists
the queue with each work item's order, age, and the record that queued it.

## Evidence inspector

Opened from any provenance chip: `source, record_id, record_ts, ingested_at, adapter,
claim_class, derived_from`, and the raw line from the source file (the viewer keeps raw
files by `sha256` for this purpose). This is the "why does ATLAS believe this" answer:
a list of records, not a sentence.

## Scenario comparison view (V0.2)

Split floor plan, shared timeline from `base.t` to `horizon`, delta table from
`Comparison`, trade-offs list, honesty notes rendered as a fixed panel that cannot be
collapsed. Each metric row shows baseline, scenario, delta, and the `claim_class` chip
(`simulated`; `assumed` on the delay-cost row).

## Binding tests

1. Render each of the four fixture snapshots; read `data-*` attributes; rebuild
   `{employees, equipment, stations.status, queues}`; compare to the snapshot. Must be equal.
2. Static analysis: the viewer package contains no references to `per_staff_concurrency`,
   `overload_queue`, `duration_s`, or `queued_t` arithmetic.
3. Remove `@atlas/engine` from the viewer bundle: the app renders the EMPTY state and nothing else.
