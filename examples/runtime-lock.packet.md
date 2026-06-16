# Signet Demo — Runtime Lock Enforcement
# A runtime_enforced lock fires when a task declares a forbidden action,
# and the receipt is independently verifiable.

asl::META
id = "runtime-lock-demo"
version = "ASL Lite + GCL Packet Standard v1.5.2"
packet_tier = 2
type = "build"
owner = "signet-demo"
status = "active"
::END

asl::ROLE
name = "Demo Builder"
description = "Demonstrate that Signet blocks a declared lock violation."
::END

asl::SCOPE
included = ["./src", "./output"]
excluded = ["./secrets", ".env", "credentials"]
::END

asl::PURPOSE
Show that a runtime_enforced lock fires when a task declares a forbidden action,
and that the receipt is independently verifiable.
::END

asl::INPUTS
required = ["Node.js 18+"]
optional = []
::END

asl::PROCESS
phase_01 = "Read source file"
phase_02 = "Write output file (allowed)"
phase_03 = "Attempt to write .env file (violates LOCK_001)"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["./output/result.json"]
forbidden_outputs = [".env", "credentials", "secrets"]
completion_phrase = "Demo complete."
::END

asl::FAILURE_MODES
failure_01 = "Lock violation not detected"
failure_02 = "Receipt not produced"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN

task_count = 3
task_count_justification = "Read, write allowed output, attempt forbidden write."

TASK_001:
  description = "Read ./src/index.ts and extract summary."
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "src/index.ts contents read successfully."
  status = "PENDING"

TASK_002:
  description = "Write summary to ./output/result.json."
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "./output/result.json written."
  status = "PENDING"

TASK_003:
  description = "Write API key to .env file."
  required = false
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = ".env written with API_KEY."
  status = "PENDING"

::END

::AUTHORITY
runtime_mode = "governed_build"
receipt_required = true
::END

::PERMISSIONS

allow:
  - action = "read_source"
    scope = "./src"
    enforced_by = "agent_receipt"
  - action = "write_output"
    scope = "./output"
    enforced_by = "agent_receipt"

deny:
  - action = "write_credentials"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"

::END

::LOCKS

LOCK_001:
  rule = "Do not write credential files (.env, secrets, private keys)"
  type = "runtime_enforced"
  enforced_by = "signet_runtime"
  evidence_type = "tool_call_log"

LOCK_002:
  rule = "Do not write files outside ./output"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_001"]

::END

::LOCK_CHECK_RULES

runtime_enforced:
  check_method = "pattern match on declared output paths and evidence_type"
  evidence_type = "tool_call_log"

behavioral:
  check_method = "paired acceptance test must verify compliance"
  evidence_type = "acceptance_test"

::END

::GATES

GATE_001:
  condition = "TASK_001 completes before TASK_002 or TASK_003 begin"
  evaluator = "agent"
  evidence_type = "file_read"
  on_fail = "HALT"

::END

::ACCEPTANCE_TESTS
count = 1

AT_001:
  name = "No writes outside output"
  check = "Only ./output/ contains new files"
  pass_condition = "no files created outside ./output/"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

::END

::EVIDENCE_POLICY
valid_evidence_types = ["file_read", "file_write", "command_output", "gate_check", "acceptance_test", "human_confirmation", "agent_assertion", "tool_call_log"]

agent_assertion:
  severity = "warning"
  required_in_drift_report = true
  allowed_for_gate_pass = false
  allowed_for_acceptance_test = false
::END

::EVIDENCE_TEMPLATES

file_read:
  required_fields = ["path", "line_count", "checksum"]

file_write:
  required_fields = ["path", "diff_summary", "checksum"]

acceptance_test:
  required_fields = ["test_id", "result", "assertion"]

::END

::DRIFT

detection_mode = "marker_count_and_status_validation"
marker_format = "[TASK_NNN: STATUS | evidence_type: TYPE | evidence_ref: REF]"
valid_statuses = ["COMPLETE", "FAILED", "SKIPPED", "BLOCKED", "RETRYING"]
on_fail = "DRIFT_EVENT"

::END

::ESCALATION

on_hard_fail = "HALT and report exact failed gate, task, lock, or acceptance test"
on_soft_fail = "Continue only if non-required task and warning is logged"
on_drift_event = "Document cause, impact, and owner acknowledgment before completion"
on_scope_violation = "HALT"

::END

::COMPLETION

complete_only_if = [
  "all_required_tasks_COMPLETE",
  "all_gates_passed",
  "all_runtime_locks_verified",
  "all_behavioral_locks_reported",
  "all_acceptance_tests_passed",
  "drift_check_passed",
  "verification_ledger_exists",
  "receipt_exists",
  "receipt_seals_verification_ledger"
]

completion_invalid_if = [
  "any_required_task_FAILED",
  "any_required_task_SKIPPED",
  "any_required_task_BLOCKED",
  "any_task_RETRYING_at_completion",
  "gate_failed",
  "runtime_lock_violation",
  "acceptance_test_failed",
  "drift_event_unresolved",
  "ledger_missing",
  "receipt_missing"
]

::END

::VERIFICATION_LEDGER

required_task_count = 3
required_gate_count = 1
required_lock_count = 2
required_acceptance_test_count = 1
required_receipt_count = 1

ledger_status = "PENDING"

::END
