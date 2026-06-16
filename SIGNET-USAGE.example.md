# SIGNET-USAGE.example.md — Sample Dogfood Log (fictional)

> This is an **example** usage log with **invented** entries. It shows how
> `signet run` records every governed run. Your real log
> (`SIGNET-USAGE.md`) is generated locally as you use Signet and is **not**
> part of this package.

Every `signet run` appends an entry here automatically and writes a row to a
local SQLite database (`data/xas_mem.db`, via the Node built-in `node:sqlite`).
Two fields — **Significance** and **Time spent** — are filled in by a human
afterward.

---

## Entry template (9 fields)

| Field | Meaning |
|---|---|
| Date | ISO date of the run |
| Packet name | `META.id` of the packet |
| Action | Kind of run (governed run, validate-only, re-run) |
| Result | Receipt verdict: `allowed` / `warned` / `blocked` |
| Alignment score | 0–10, auto-calculated: (gates passed + ATs passed) ÷ (total gates + ATs) × 10. UNEVALUATED checks count against the score — a low score honestly signals the packet's conditions could not be mechanically checked in simulation. |
| Significance | Why the run mattered (human fills in) |
| Time spent | Wall-clock time on the work (human fills in; the governance pass itself is <1s) |
| Receipt path | Path to the receipt JSON, or `none` |
| Notes / drift / blockers | Blocks fired, drift, friction — auto-filled from receipt lessons |

---

## Entries

### 2026-01-15 — contract-review-001
| Field | Value |
|---|---|
| Date | 2026-01-15 |
| Packet name | contract-review-001 |
| Action | validate-only (Tier 1 review) |
| Result | allowed |
| Alignment score | n/a (validate-only) |
| Significance | Sample: validated a vendor-contract review packet. "Do not give legal advice" is enforced as a deny-permission with `hard_block`, not a prose reminder. |
| Time spent | ~2 min |
| Receipt path | none (review packets are validate-only) |
| Notes / drift / blockers | VALID — Tier 1, review. Demonstrates the simplest packet shape. |

### 2026-01-16 — phi-transfer-001
| Field | Value |
|---|---|
| Date | 2026-01-16 |
| Packet name | phi-transfer-001 |
| Action | governed run (simulation) |
| Result | blocked |
| Alignment score | 3.3/10 |
| Significance | Sample: a de-identified imaging transfer. The run **stopped at the human-approval gate** (GATE_002) because no approval token was present — exactly the intended behavior. Nothing transmits until a human approves. |
| Time spent | ~5 min |
| Receipt path | examples/demo-phi-transfer.receipt.json |
| Notes / drift / blockers | GATE_002 (human) FAIL: no approval record — correct halt. Two acceptance tests UNEVALUATED in simulation (no mechanical checker in v0.x). The receipt itself verifies PASS (intact); the verdict is `blocked` because the human gate was not satisfied. |

### 2026-01-17 — runtime-lock-demo
| Field | Value |
|---|---|
| Date | 2026-01-17 |
| Packet name | runtime-lock-demo |
| Action | governed run (simulation) |
| Result | blocked |
| Alignment score | 8.5/10 |
| Significance | Sample: a task attempted to write a credential file (`.env`). LOCK_001 blocked it before the action. Demonstrates the forbidden-output path. |
| Time spent | ~2 min |
| Receipt path | examples/receipt.verified.json |
| Notes / drift / blockers | 1 block fired (LOCK_001). Expected — this packet exists to demonstrate enforcement. |
