asl::META
id = "readme-writer"
packet_tier = 2
type = "build"
owner = "team@example.com"
status = "active"
::END

asl::ROLE
name = "README Writer"
description = "Reads source files and package.json, then writes a README.md."
::END

asl::SCOPE
included = ["src/", "package.json"]
excluded = ["node_modules/", ".git/", ".env", "secrets/", "dist/"]
::END

asl::PURPOSE
Read the project source and package.json to produce a clear, accurate README.md.
::END

asl::INPUTS
required = ["src/ directory", "package.json"]
optional = ["existing README.md (for reference)"]
::END

asl::PROCESS
phase_01 = "Read package.json for project name, description, and scripts"
phase_02 = "Read source files to understand what the project does"
phase_03 = "Write README.md to project root"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["README.md"]
forbidden_outputs = [".env", "secrets.json", "credentials", "node_modules/"]
completion_phrase = "README.md written."
::END

asl::FAILURE_MODES
failure_01 = "package.json not found or unreadable"
failure_02 = "src/ directory empty or missing"
failure_03 = "README.md could not be written"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = false
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN
task_count = 3
task_count_justification = "Read config, read source, write output."

TASK_001:
  description = "Read package.json"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "package.json contents available."
  status = "PENDING"

TASK_002:
  description = "Read source files from src/"
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "Source files read."
  status = "PENDING"

TASK_003:
  description = "Write README.md to project root"
  required = true
  depends_on = ["TASK_001", "TASK_002"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "README.md written with name, description, usage, and scripts."
  status = "PENDING"
::END

::AUTHORITY
runtime_mode = "governed_execution"
receipt_required = true
::END

::PERMISSIONS
allow:
  - action = "read"
    scope = "src/"
  - action = "read"
    scope = "package.json"
  - action = "write"
    scope = "README.md"
deny:
  - action = "write"
    scope = "src/"
  - action = "write"
    scope = "node_modules/"
  - action = "delete"
    scope = "all"
::END

::LOCKS
LOCK_001:
  rule = "Do not write to source, dependencies, or credential files"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"

LOCK_002:
  rule = "Do not read outside declared scope"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_001"]
::END

::LOCK_CHECK_RULES
runtime_enforced:
  check_method = "pattern match on output_contract.forbidden_outputs + scope.excluded"
behavioral:
  check_method = "paired acceptance test"
::END

::GATES
GATE_001:
  condition = "TASK_001 and TASK_002 complete before TASK_003 begins"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"
::END

::ACCEPTANCE_TESTS
count = 1

AT_001:
  name = "Scope containment"
  check = "README.md written to root only — no writes to src/ or node_modules/"
  pass_condition = "all write targets match README.md at project root"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"
::END

::EVIDENCE_POLICY
valid_evidence_types = ["file_read", "file_write", "gate_check", "acceptance_test"]
::END

::EVIDENCE_TEMPLATES
file_read:
  required_fields = ["path", "line_count", "checksum"]
file_write:
  required_fields = ["path", "diff_summary", "checksum"]
::END

::DRIFT
detection_mode = "marker_count_and_status_validation"
::END

::ESCALATION
on_hard_fail = "HALT and report"
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
