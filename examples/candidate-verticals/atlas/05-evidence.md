# 05 — Evidence

## Pipeline

```
RawFile ─▶ Adapter.parse ─▶ RawRecord ─▶ map ─▶ resolve aliases ─▶ validate ─▶ Event + Provenance ─▶ Ledger.append ─▶ (reducer)
                          └─▶ Reject (reason, record, pointer)                         └─▶ IngestReport
```

Everything up to `Ledger.append` is in `@atlas/evidence`. It knows the schema and the
aliases, and nothing about capacity or queues. The reducer is the only consumer.

## Adapter interface

```ts
interface RawFile { source_id: string; name: string; text: string; sha256: string }
interface Adapter {
  id: string; version: string;                      // written into provenance.adapter
  accepts(file: RawFile): boolean;                  // by source_id and header line
  parse(file: RawFile, world: World): { events: EventCore[]; rejects: Reject[] }
}
interface Reject { file: string; line: number; reason: RejectReason; record: string }
type RejectReason = 'malformed_row'|'unknown_alias'|'unknown_product'|'bad_timestamp'|'duplicate_record'|'orphan_ticket'|'out_of_world_window';
```

An adapter emits `EventCore` (`t, type, subject, data, provenance without seq/event_id`).
The ledger assigns `seq`, `event_id`, `branch`, `ingested_at`.

## The five V0 adapters

| Adapter | File | Record → events | Claim class |
|---|---|---|---|
| `adapter.pos-csv/0.1` | `pos_orders.csv` (`order_no, opened_at, channel, items, total, closed_at`) | `ORDER_CREATED` from `opened_at`; `ORDER_COMPLETED` from `closed_at` if present | observed |
| `adapter.kds-csv/0.1` | `kds_tickets.csv` (`ticket_id, order_no, item_seq, station, event, ts`) | `FIRED → WORK_QUEUED`, `STARTED → WORK_STARTED`, `BUMPED → WORK_COMPLETED`; a PASS bump also emits `ORDER_READY` | observed; `ORDER_READY` is **derived** with `derived_from = [bump record]` |
| `adapter.staffhub-csv/0.1` | `staff_events.csv` (`badge, event, station, ts`) | `CLOCK_IN → EMPLOYEE_CLOCKED_IN`, `ASSIGN → ASSIGNMENT_CHANGED` | observed |
| `adapter.iot-csv/0.1` | `equipment_events.csv` (`device, ts, event, detail`) | `TEMP → MEASUREMENT_RECORDED`, `STATE → EQUIPMENT_STATE_CHANGED` (status, capacity, detail parsed from `detail`) | observed |
| `adapter.shift-notes-csv/0.1` | `shift_notes.csv` (`ts, reporter, about, text`) | `HUMAN_REPORT` | human_reported |

The KDS adapter needs the order's product per item to name the step (`w_0022_1_fry`),
so ingestion is two-pass: POS first, then everything else. An item with no POS order is an
`orphan_ticket` reject.

## Normalization rules

- Timestamps: parse ISO with offset; `t = floor(epoch seconds)`; a record outside
  `[world.time.origin, world.time.end]` is rejected `out_of_world_window`.
- Identifiers: every source identifier goes through `world.aliases[source_id]`; a miss is
  `unknown_alias`, never a guess, never a new entity.
- Work ids are deterministic: `w_<order_no>_<item_seq>_<step>` and `w_<order_no>_0_pass`.
- Duplicate `(source, record_id)` within a ledger is `duplicate_record`.
- Record ids are stable and human-readable: `pos:0884:opened`, `kds:0884-2-FRY:BUMPED`,
  `iot:FRY-02:2026-10-06T18:02:14-07:00:STATE`. They are the keys the inspector shows.

## Provenance

Every event has exactly one `Provenance`. Fields and policy are in
[03-data-model.md](03-data-model.md). Three rules:

1. `claim_class` is set by the adapter from a fixed table, not inferred per record.
2. `confidence` is `null` unless a documented computation produced it. V0 produces none.
3. `derived_from` is required when `claim_class` is `derived` or `inferred`.

## Claim classes and where they may appear

| Class | May appear in | Produced by |
|---|---|---|
| observed | history ledger; replayed arrivals on sim branches | adapters |
| derived | history ledger (`ORDER_READY`); all views and snapshots | adapters, engine views |
| inferred | V1 only (e.g., location inferred from schedule) | intelligence |
| assumed | economics parameters, scenario `duration_model: nominal` | world file, scenario file |
| simulated | sim branches only | engine scheduler |
| human_reported | history ledger (`HUMAN_REPORT`) | notes adapter |
| human_corrected | history ledger, correction events | authority package (V0.2) |

A `history:*` ledger containing `simulated` or a `sim:*` ledger containing an
un-replayed `observed` event fails validation.

## Entity resolution

V0: `world.aliases` is the resolution table, hand-maintained, deterministic, reversible by
editing the file. The ingestion report lists every alias used and every miss.

Interface reserved for V1 (not built):

```ts
interface ResolutionRecord { source: string; local_id: string; canonical: Id | null; method: 'alias_table'|'rule'|'model'|'human'; confidence: number|null; decided_at: ISODate; decided_by: string; superseded_by?: string }
```
Resolutions are append-only records; a merge or split is a new record that supersedes,
so no probabilistic decision is irreversible.

## Error handling

- A file with any fatal reject (`bad_timestamp`, `unknown_alias`, `orphan_ticket`) is
  **not** partially ingested. The report shows every reject; the user fixes the alias
  table or the file and re-runs. Rationale: a half-ingested day silently distorts queues.
- `duplicate_record` is non-fatal: the duplicate is dropped and counted.
- Rejects are written to `ingest-report.json` with line numbers; nothing is logged to
  stdout only.

## Contradictory and unknown evidence

- **Contradiction** (POS says an order closed at 18:10, KDS shows its pass bumped at 18:12):
  both events are kept with their provenance. The reducer applies the state machine;
  an `ORDER_COMPLETED` before `ORDER_READY` is applied (state becomes COMPLETED) and
  the engine emits a `Conflict` view entry `{order_id, events:[...], rule:'completed_before_ready'}`
  that the inspector shows in red. Nothing is dropped, nothing is averaged.
- **Unknown state values** (`STATE,FOO` from IoT): reject `malformed_row`.
- **Unknown event type in a ledger**: reducer throws; the ledger is from a newer schema.
- **Missing evidence** (no KDS for a station): the station's queue is empty and its
  utilization is `null`, never 0. The inspector shows "no evidence source for this station".

## What ingestion proves in V0

That five differently shaped sources become one ledger whose hash is stable, whose every
line has provenance, and from which the engine reconstructs the four canonical snapshots.
The oracle asserts that normalizing the raw files reproduces the engine's own event log
exactly, which is the definition of a lossless adapter set for this world.
