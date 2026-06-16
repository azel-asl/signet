# De-identified Imaging Transfer — Clinic A to Hospital B (sample, fictional)
#
# Intent: "Transfer a de-identified imaging study from Clinic A to Hospital B,
# keep raw PHI inside the local boundary, use tokenized metadata only, verify
# delivery, block if raw PHI leakage is detected, fall back to manual review if
# delivery fails twice, and create an audit receipt."
#
# This is a COMPLEX Tier 3 packet. It shows how conditional, IF/THEN-style
# governance is expressed in real ASL Lite + GCL — there is no IF/THEN DSL;
# instead:
#   - "block if raw PHI leaks"        -> LOCK with enforcement hard_block + AT
#   - "tokenized metadata only"       -> behavioral LOCK paired with an AT
#   - "verify delivery"               -> GATE + acceptance test
#   - "fall back after 2 failures"    -> TASK.retry_max = 2 + on_retry_exhausted
#   - "human review on failure"       -> ESCALATION + human GATE
#   - "pass only if verified + clean" -> COMPLETION.complete_only_if

asl::META
id = "phi-transfer-001"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 3
type = "deploy"
owner = "Erwin Layaoen"
status = "active"
::END

asl::ROLE
name = "De-identified Imaging Transfer Runner"
description = "Transfers a de-identified imaging study from Clinic A to Hospital B using tokenized metadata only, verifies delivery, blocks on any raw PHI leakage, and escalates to human review on repeated failure."
skills_required = ["DICOM handling", "de-identification", "tokenization", "secure transfer"]
::END

asl::SCOPE
included = [
  "de-identified imaging transfer",
  "tokenized metadata transmission",
  "delivery verification",
  "output/transfer-logs/"
]
excluded = [
  "raw PHI egress",
  "untokenized metadata",
  "patient identifiers",
  "auto-retry beyond 2 attempts",
  "secrets/",
  "credentials/"
]
::END

asl::PURPOSE
Safely transfer one de-identified imaging study from Clinic A to Hospital B:
1. Read the study and confirm de-identification
2. Tokenize metadata (no raw patient identifiers leave the local boundary)
3. Verify token integrity before any transmission
4. Require human approval before sending
5. Transmit tokenized study to Hospital B
6. Verify delivery and scan for raw PHI leakage
7. Write an audit report

No raw PHI ever leaves the local boundary. No transmission occurs before
GATE_002 human approval. Any detected leakage hard-blocks the run.
::END

asl::INPUTS
required = [
  "input/study-clinic-a.dcm",
  "scripts/tokenize-metadata.sh",
  "scripts/verify-delivery.sh",
  "Hospital B endpoint (env: HOSPITAL_B_ENDPOINT)"
]
optional = [
  "output/transfer-logs/ directory (created if missing)"
]
::END

asl::PROCESS
phase_01 = "Read study and confirm de-identification markers present"
phase_02 = "Tokenize metadata to output/transfer-logs/tokens.json"
phase_03 = "Verify token integrity — HALT on failure"
phase_04 = "Present transfer plan — HALT for human approval"
phase_05 = "Transmit tokenized study to Hospital B (only after approval)"
phase_06 = "Verify delivery and scan response for raw PHI leakage"
phase_07 = "Write audit report to output/transfer-logs/report.md"
::END

asl::OUTPUT_CONTRACT
required_outputs = [
  "output/transfer-logs/tokens.json",
  "output/transfer-logs/delivery.log",
  "output/transfer-logs/report.md"
]
forbidden_outputs = [
  "raw PHI",
  "patient identifiers",
  "secrets/",
  "credentials/",
  ".env"
]
completion_phrase = "Transfer complete. Delivery verified, no leakage. Report written."
::END

asl::FAILURE_MODES
failure_01 = "Study not de-identified — HALT before tokenize"
failure_02 = "Token integrity check fails — HALT, do not transmit"
failure_03 = "Human approval not granted — HALT, do not transmit"
failure_04 = "Delivery fails twice — stop auto-retry, escalate to human review"
failure_05 = "Raw PHI leakage detected — HALT, hard block, create denial record"
failure_06 = "Report write fails — non-critical, log warning and continue"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN
task_count = 7
task_count_justification = "Read+confirm -> tokenize -> verify tokens -> await approval -> transmit -> verify delivery+leak scan -> report. Each step gates the next; transmit retries at most twice then escalates."

TASK_001:
  description = "Read input/study-clinic-a.dcm and confirm de-identification markers are present"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "Study read; de-identification confirmed; no raw identifiers present."
  status = "PENDING"

TASK_002:
  description = "Run scripts/tokenize-metadata.sh — write tokens to output/transfer-logs/tokens.json"
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "linear"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "output/transfer-logs/tokens.json written; contains only tokenized metadata."
  status = "PENDING"

TASK_003:
  description = "Verify token integrity — confirm no raw patient identifiers remain in the tokenized payload"
  required = true
  depends_on = ["TASK_002"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "gate_check"
  evidence_template = "gate_check"
  expected_result = "Token integrity passes; zero raw identifiers detected."
  status = "PENDING"

TASK_004:
  description = "Transmit tokenized study to Hospital B endpoint (only after GATE_002 approval); retry at most twice then escalate"
  required = true
  depends_on = ["TASK_003"]
  on_dependency_fail = "HALT"
  retry_max = 2
  retry_backoff = "exponential"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Tokenized study transmitted; endpoint accepted the payload."
  status = "PENDING"

TASK_005:
  description = "Verify delivery via scripts/verify-delivery.sh — write output/transfer-logs/delivery.log"
  required = true
  depends_on = ["TASK_004"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "linear"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Delivery confirmed by Hospital B; delivery.log written."
  status = "PENDING"

TASK_006:
  description = "Scan delivery response for raw PHI leakage — confirm response contains no patient identifiers"
  required = true
  depends_on = ["TASK_005"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "gate_check"
  evidence_template = "gate_check"
  expected_result = "Leakage scan passes; zero raw identifiers in the response."
  status = "PENDING"

TASK_007:
  description = "Write audit report to output/transfer-logs/report.md"
  required = true
  depends_on = ["TASK_006"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "output/transfer-logs/report.md written with transfer summary and verification results."
  status = "PENDING"
::END

::AUTHORITY
runtime_mode = "governed_execution"
receipt_required = true
approval_required = true
::END

::PERMISSIONS
allow:
  - action = "read"
    scope = "input/study-clinic-a.dcm"
  - action = "execute"
    scope = "scripts/tokenize-metadata.sh"
  - action = "execute"
    scope = "scripts/verify-delivery.sh"
  - action = "execute"
    scope = "HOSPITAL_B_ENDPOINT (transmit, only after GATE_002 approval)"
  - action = "write"
    scope = "output/transfer-logs/"
deny:
  - action = "read"
    scope = "secrets/"
  - action = "read"
    scope = "credentials/"
  - action = "write"
    scope = ".env"
  - action = "transmit"
    scope = "raw PHI or patient identifiers"
  - action = "delete"
    scope = "all"
::END

::LOCKS
LOCK_001:
  rule = "No raw PHI or patient identifiers may leave the local boundary"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"

LOCK_002:
  rule = "Only tokenized metadata may be transmitted to Hospital B"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_001"]

LOCK_003:
  rule = "Do not transmit before GATE_002 human approval"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["GATE_002"]

LOCK_004:
  rule = "All outputs must be written to output/transfer-logs/ only"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_002"]
::END

::LOCK_CHECK_RULES
runtime_enforced:
  check_method = "pattern match on output_contract.forbidden_outputs + scope.excluded"
behavioral:
  check_method = "paired gate or acceptance test"
::END

::GATES
GATE_001:
  condition = "TASK_001, TASK_002, TASK_003 all COMPLETE before TASK_004 begins"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"

GATE_002:
  condition = "Human reviewer approves transmission of the tokenized study to Hospital B"
  evaluator = "human"
  approval_id = "APPROVAL_PHI_TRANSFER_001"
  evidence_type = "approval_token"
  on_fail = "HALT"

GATE_003:
  condition = "TASK_006 leakage scan passes before TASK_007 begins"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"
::END

::ACCEPTANCE_TESTS
count = 3

AT_001:
  name = "Tokenized payload only"
  check = "Transmitted payload contains tokenized metadata and no raw identifiers"
  pass_condition = "zero raw patient identifiers in the transmitted payload"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

AT_002:
  name = "Output scope containment"
  check = "All file writes land inside output/transfer-logs/ only"
  pass_condition = "no write targets outside output/transfer-logs/"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

AT_003:
  name = "No leakage in delivery response"
  check = "Delivery response scanned for raw PHI"
  pass_condition = "zero raw identifiers detected in the response"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"
::END

::EVIDENCE_POLICY
valid_evidence_types = [
  "file_read",
  "file_write",
  "command_output",
  "gate_check",
  "acceptance_test",
  "approval_token",
  "agent_assertion"
]
::END

::EVIDENCE_TEMPLATES
file_read:
  required_fields = ["path", "line_count", "checksum"]
file_write:
  required_fields = ["path", "diff_summary", "checksum", "size_bytes"]
command_output:
  required_fields = ["command", "exit_code", "stdout_lines", "duration_ms"]
  optional_fields = ["stderr_lines"]
agent_assertion:
  required_fields = ["assertion", "evidence_source", "result"]
approval_token:
  required_fields = ["approval_id", "approver", "signature"]
::END

::DRIFT
detection_mode = "marker_count_and_status_validation"
::END

::ESCALATION
on_hard_fail = "HALT immediately, preserve all output/transfer-logs/, escalate to human review"
on_lock_violation = "HALT, do not attempt workaround, create denial record, escalate to human review"
on_gate_fail = "HALT, await human instruction before any retry"
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
required_task_count = 7
required_gate_count = 3
required_lock_count = 4
required_acceptance_test_count = 3
required_receipt_count = 1
ledger_status = "PENDING"
::END
