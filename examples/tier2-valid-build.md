# Tier 2 Valid — Minimal Build Packet

asl::META
id = "tier2-valid-build-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 2
type = "build"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "MVP Builder"
description = "Build a minimal TypeScript utility."
::END

asl::SCOPE
included = ["src files", "tests", "README"]
excluded = ["database", "cloud deployment", "external APIs"]
::END

asl::PURPOSE
Build a minimal TypeScript utility with tests.
::END

asl::INPUTS
required = ["Node.js", "TypeScript"]
optional = ["example inputs"]
::END

asl::PROCESS
phase_01 = "Create structure"
phase_02 = "Implement logic"
phase_03 = "Add tests"
phase_04 = "Emit receipt"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["src/index.ts", "tests/index.test.ts", "README.md"]
forbidden_outputs = ["external API integration", "database setup"]
completion_phrase = "MVP complete."
::END

asl::FAILURE_MODES
failure_01 = "Tests missing"
failure_02 = "Overbuild beyond scope"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN

task_count = 3
task_count_justification = "Minimal tier 2 build with 3 tasks."

TASK_001:
  description = "Create project structure."
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "Structure created."
  status = "PENDING"

TASK_002:
  description = "Implement logic."
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "linear"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "src/index.ts exists."
  status = "PENDING"

TASK_003:
  description = "Run tests and emit receipt."
  required = true
  depends_on = ["TASK_002"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Tests pass."
  status = "PENDING"

::END

::AUTHORITY
runtime_mode = "governed_build"
receipt_required = true
::END

::PERMISSIONS

allow:
  - action = "create_project_files"
    scope = "declared project structure"
    enforced_by = "agent_receipt"

deny:
  - action = "external_api_call"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"

::END

::LOCKS

LOCK_001:
  rule = "Do not call external APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"

LOCK_002:
  rule = "Do not overbuild beyond declared scope"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["AT_001"]

::END

::LOCK_CHECK_RULES

runtime_enforced:
  check_method = "agent confirms no prohibited actions used"
  evidence_type = "agent_assertion"

behavioral:
  check_method = "paired acceptance test must verify compliance"
  evidence_type = "acceptance_test"

::END

::GATES

GATE_001:
  condition = "Project structure created"
  evaluator = "agent"
  evidence_type = "file_write"
  on_fail = "HALT"

GATE_002:
  condition = "Tests run and pass"
  evaluator = "agent"
  evidence_type = "command_output"
  on_fail = "HALT"

::END

::ACCEPTANCE_TESTS
count = 1

AT_001:
  name = "No overbuild"
  check = "Only declared outputs exist"
  pass_condition = "no extra modules added"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

::END

::EVIDENCE_POLICY
valid_evidence_types = ["file_read", "file_write", "command_output", "gate_check", "acceptance_test", "human_confirmation", "agent_assertion"]

agent_assertion:
  severity = "warning"
  required_in_drift_report = true
  allowed_for_gate_pass = false
  allowed_for_acceptance_test = false
::END

::EVIDENCE_TEMPLATES

file_write:
  required_fields = ["path", "diff_summary", "checksum"]

command_output:
  required_fields = ["command", "exit_code", "key_result"]

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
required_gate_count = 2
required_lock_count = 2
required_acceptance_test_count = 1
required_receipt_count = 1

ledger_status = "PENDING"

::END
