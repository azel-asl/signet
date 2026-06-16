# Tier 2 Invalid — Behavioral Lock Without Pairing

# EXPECTED VALIDATION RESULT: FAIL
# Expected errors:
#   LOCK_005 — LOCK_002: behavioral lock has no paired_with references

asl::META
id = "tier2-invalid-unpaired-lock-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 2
type = "build"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "MVP Builder"
description = "Build with an unpaired behavioral lock."
::END

asl::SCOPE
included = ["src files"]
excluded = ["database"]
::END

asl::PURPOSE
Demonstrates a behavioral lock without a paired_with reference.
::END

asl::INPUTS
required = ["Node.js"]
optional = []
::END

asl::PROCESS
phase_01 = "Implement"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["src/index.ts"]
forbidden_outputs = ["database setup"]
completion_phrase = "Done."
::END

asl::FAILURE_MODES
failure_01 = "Overbuild"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN

task_count = 1

TASK_001:
  description = "Implement."
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "File created."
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
  rule = "Do not overbuild"
  type = "behavioral"
  enforced_by = "agent_receipt"
  # NOTE: paired_with is intentionally absent — this should fail LOCK_005

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
  condition = "Implementation complete"
  evaluator = "agent"
  evidence_type = "file_write"
  on_fail = "HALT"

::END

::ACCEPTANCE_TESTS
count = 0

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

::END

::DRIFT

detection_mode = "marker_count_and_status_validation"
marker_format = "[TASK_NNN: STATUS | evidence_type: TYPE | evidence_ref: REF]"
valid_statuses = ["COMPLETE", "FAILED", "SKIPPED", "BLOCKED", "RETRYING"]
on_fail = "DRIFT_EVENT"

::END

::ESCALATION

on_hard_fail = "HALT"
on_soft_fail = "log warning"
on_drift_event = "document"
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

required_task_count = 1
required_gate_count = 1
required_lock_count = 2
required_acceptance_test_count = 0
required_receipt_count = 1

ledger_status = "PENDING"

::END
