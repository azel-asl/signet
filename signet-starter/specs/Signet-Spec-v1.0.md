# Signet Packet Specification v1.0

**Version:** 1.0 | **Author:** ASL Labs | **Based on:** ASL Lite + GCL v1.5.2

---

## Overview

A Signet Packet is a structured Markdown document defining governed AI work: scope, tasks, locks, gates, evidence, and receipts.

```
Write packet → validate → run → receipt → verify
```

---

## Tiers

| Tier | Use Case | Strictness |
|---|---|---|
| 1 | Lightweight review tasks | Minimal blocks required |
| 2 | Standard build/analyze work | Full lock + gate set |
| 3 | High-stakes or regulated work | Strict, human gates mandatory |

---

## Required Sections (in order)

### `asl::META`
```
id = "my-packet"
packet_tier = 1|2|3
type = "review"|"build"|"analyze"|"integrate"|"report"
owner = "you@example.com"
status = "active"|"draft"|"archived"
```

### `asl::ROLE`
```
name = "Role Name"
description = "What this agent does."
```

### `asl::SCOPE`
```
included = ["src/", "tests/"]
excluded = ["node_modules/", ".git/", "secrets/", ".env"]
```
`excluded` feeds lock enforcement — any write target matching an excluded pattern is blocked.

### `asl::PURPOSE`
Free-form statement of intent.

### `asl::INPUTS`
```
required = ["Node.js 18+"]
optional = []
```

### `asl::PROCESS`
```
phase_01 = "Read files"
phase_02 = "Analyze"
phase_03 = "Write output"
```

### `asl::OUTPUT_CONTRACT`
```
required_outputs = ["output/result.json"]
forbidden_outputs = [".env", "credentials.json", "secrets"]
completion_phrase = "Task complete."
```
`forbidden_outputs` also feeds lock enforcement.

### `asl::FAILURE_MODES`
```
failure_01 = "Unable to read input"
failure_02 = "Output not produced"
```

### `asl::RECEIPT`
```
enabled = true
receipt_required = true
ledger_required = false
receipt_seals = "VERIFICATION_LEDGER"
```

### `asl::EXECUTION_PLAN`
```
task_count = 2
task_count_justification = "Read then write."

TASK_001:
  description = "Read ./src/index.ts"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "File contents read."
  status = "PENDING"

TASK_002:
  description = "Write result to ./output/result.json"
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "result.json written."
  status = "PENDING"
```

Task fields:

| Field | Values | Description |
|---|---|---|
| `required` | true/false | Packet fails if this task fails |
| `depends_on` | task ID list | Prerequisites (no cycles) |
| `on_dependency_fail` | HALT, SKIP | What to do if a dep fails |
| `retry_max` | 0–10 | Max retries |
| `retry_backoff` | none, linear, exponential | Retry spacing |
| `evidence_type` | file_read, file_write, command_output, gate_check, acceptance_test, agent_assertion | Type of evidence |
| `status` | PENDING, IN_PROGRESS, COMPLETE, FAILED, BLOCKED, SKIPPED | Current state |

### `::AUTHORITY`
```
runtime_mode = "governed_execution"
receipt_required = true
```

### `::PERMISSIONS`
Declarative allow/deny (informational in v0.1):
```
allow:
  - action = "read"
    scope = "src/"
deny:
  - action = "write"
    scope = "node_modules/"
```

### `::LOCKS`
```
LOCK_001:
  rule = "Do not write credential files"
  type = "runtime_enforced"
  enforced_by = "signet_runtime"

LOCK_002:
  rule = "Do not read outside scope"
  type = "behavioral"
  enforced_by = "attested_by acceptance_test"
```

Lock types:
- **`runtime_enforced`**: Mechanical pattern matching against `scope.excluded` + `forbidden_outputs`. Enforced by Signet.
- **`behavioral`**: Policy enforced via paired acceptance test. Signet reports via `BehavioralLockReport`.

⚠️ **`enforced_by` vocabulary matters.** Use `signet_runtime` for mechanical enforcement. Use `attested_by <id>` for behavioral. Using `agent_receipt` (self-report) triggers a GOV_001 warning.

### `::LOCK_CHECK_RULES`
```
runtime_enforced:
  check_method = "pattern match on declared output paths"
behavioral:
  check_method = "paired acceptance test or gate"
```

### `::GATES`
```
GATE_001:
  condition = "TASK_001 completes before TASK_002"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"
```

Evaluators:
- `agent`: Checked via dependency ordering (v0.1)
- `human`: Requires approval record (v0.1: always FAIL → HALT; v0.2: approval workflow)

### `::ACCEPTANCE_TESTS`
```
count = 1
AT_001:
  name = "Scope containment"
  check = "No writes outside ./output/"
  pass_condition = "all write targets within output/"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"
```

Built-in checker: `scope_containment` — validates unblocked writes stay within declared scope root.

### `::EVIDENCE_POLICY`
```
valid_evidence_types = ["file_read","file_write","command_output","gate_check","acceptance_test","agent_assertion"]
```

### `::EVIDENCE_TEMPLATES`
```
file_read:
  required_fields = ["path","line_count","checksum"]
file_write:
  required_fields = ["path","diff_summary","checksum"]
```

### `::DRIFT`
```
detection_mode = "marker_count_and_status_validation"
```

### `::ESCALATION`
```
on_hard_fail = "HALT and report"
```

### `::COMPLETION`
```
complete_only_if = ["all_required_tasks_COMPLETE","all_gates_passed","all_acceptance_tests_passed"]
completion_invalid_if = ["any_required_task_FAILED","gate_failed","acceptance_test_failed"]
```

### `::VERIFICATION_LEDGER`
```
required_task_count = 2
required_gate_count = 1
required_lock_count = 2
required_acceptance_test_count = 1
required_receipt_count = 1
ledger_status = "PENDING"
```

Declared counts must match actual counts. Mismatch fails validation.

---

## Validation Rules

A valid packet MUST:

1. Contain all required sections in order
2. Have `task_count` match actual task definitions
3. Have no circular `depends_on` chains
4. Reference only declared lock/gate/AT IDs
5. Match `VERIFICATION_LEDGER` declared counts
6. Use only valid enum vocabulary

```bash
signet validate my-packet.md
```

---

## Execution Flow (v0.1 Simulation)

1. Parse packet
2. Validate structure
3. Derive actions from task descriptions (regex target extraction)
4. For each task (topological order):
   - Check dependencies → SKIP or HALT if failed
   - Match targets against forbidden patterns → BLOCK if matched
   - Otherwise → COMPLETE
5. Evaluate gates (dependency order heuristic; human gates → FAIL)
6. Run acceptance tests (`scope_containment` built-in; others → UNEVALUATED)
7. Compute behavioral lock reports (inherit from paired AT/gate)
8. Determine verdict:
   - FAIL if: any required task blocked, gate HALT, AT FAIL, ledger mismatch
   - PASS otherwise
9. Assemble receipt with XAS-CANON-1 hashes

---

## See Also

- [XAS-CANON-1.md](./XAS-CANON-1.md) — Hash specification
- [../examples/runtime-lock.packet.md](../examples/runtime-lock.packet.md) — Full Tier 2 example
- [../tests/](../tests/) — Executable spec scenarios
