# Parser Rules (human-readable)

What the parser checks — structure, not governance judgment. These mirror the
open-source parser in `src/parser.ts`. The deterministic source of truth is
the CLI (`signet validate`); this doc lets an LLM apply the same checks
logically in ZIP mode.

## Block syntax
- A block opens with `asl::NAME` or `::NAME` and closes with `::END`.
- Inside a block: `key = value` lines. Values are strings (`"..."`),
  numbers, booleans, or arrays (`["a", "b"]`).
- Lines starting with `#` are comments.
- Strings are NFC-normalized; key order does not matter.

## Required blocks by tier
- **Tier 1 (review / read-only):** META, ROLE, SCOPE, AUTHORITY, PERMISSIONS.
- **Tier 2 (build):** Tier 1 + PURPOSE, INPUTS, PROCESS, OUTPUT_CONTRACT,
  FAILURE_MODES, RECEIPT, EXECUTION_PLAN, LOCKS, LOCK_CHECK_RULES, GATES,
  ACCEPTANCE_TESTS, EVIDENCE_POLICY, EVIDENCE_TEMPLATES, DRIFT, ESCALATION,
  COMPLETION, VERIFICATION_LEDGER.
- **Tier 3 (deploy / risky):** Tier 2 + at least one human GATE
  (`evaluator = "human"` with an `approval_id`) and `approval_required = true`
  in AUTHORITY.

## META
- Required keys: `id`, `packet_tier` (1–3), `type`, `owner`, `status`.
- `id` is kebab/alphanumeric. `type` ∈ {review, build, deploy, …}.

## EXECUTION_PLAN
- `task_count` must equal the number of `TASK_NNN` blocks.
- Each task: `description`, `required`, `depends_on` (array),
  `on_dependency_fail`, `retry_max`, `retry_backoff`, `on_retry_exhausted`,
  `evidence_type`, `evidence_template`, `expected_result`, `status`.
- `depends_on` must reference task ids that exist.

## VERIFICATION_LEDGER cross-checks (counts must match)
- `required_task_count` = number of TASK blocks.
- `required_gate_count` = number of GATE blocks.
- `required_lock_count` = number of LOCK blocks.
- `required_acceptance_test_count` = number of AT blocks.
- `required_receipt_count` = 1 when RECEIPT.receipt_required = true.

## Parser result
- `PASS` — all required blocks present, counts consistent, references resolve.
- `FAIL` — list each missing block, count mismatch, or dangling reference.
