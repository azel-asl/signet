asl::META
id = "PKT-ASL-VALIDATOR-PHASE2"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 2
type = "build"
policy_profile = "asl-validator-hardening"
owner = "erwin@asllabs.io"
status = "active"
::END

asl::ROLE
name = "ASL Validator Hardening Engineer"
description = "Hardens the ASL Packet Validator CLI without adding execution behavior — line-by-line block detection, Tier 3 support, deterministic file evidence, and expanded test coverage."
::END

asl::SCOPE
included = ["src/parser.ts", "src/schemas.ts", "src/validator.ts", "src/drift.ts", "src/evidence.ts", "src/types.ts", "tests/hardening.test.ts"]
excluded = ["Any file outside ~/asl-packet-validator", ".env", "credentials", "tokens", "external network calls", "packet execution logic"]
::END

asl::PURPOSE
Harden the ASL Packet Validator (Phase 1 MVP) without adding execution behavior.
Add structural detection improvements, evidence validation, expanded tests.
::END

asl::INPUTS
required = ["Node.js 20+", "TypeScript 5+", "Phase 1 source in ~/asl-packet-validator/src/"]
optional = ["ASL Lite + GCL Packet Standard v1.5.1 reference"]
::END

asl::PROCESS
phase_01 = "Extend types with ParserIssue interface"
phase_02 = "Replace regex block detection with line-by-line LIFO stack scanner"
phase_03 = "Add Tier 3 to valid tiers and required block maps"
phase_04 = "Update validator for Tier 3 and TASK ID paired_with support"
phase_05 = "Add DRIFT_011 and DRIFT_012 to drift.ts"
phase_06 = "Add SHA256 file evidence validation to evidence.ts"
phase_07 = "Write 32-test hardening suite"
phase_08 = "Run full test suite — all tests must pass"
::END

asl::FAILURE_MODES
failure_01 = "Test failures — stop, report, fix before continuing"
failure_02 = "Parser regression — roll back to Phase 1 regex if stack scanner breaks existing tests"
failure_03 = "Evidence SHA256 mismatch — warning if file changed since ledger written; error on fake placeholders"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["src/types.ts (ParserIssue)", "src/parser.ts (LIFO scanner)", "src/schemas.ts (Tier 3)", "src/validator.ts (Tier 3 + TASK ID)", "src/drift.ts (DRIFT_011, DRIFT_012)", "src/evidence.ts (SHA256)", "tests/hardening.test.ts (32 tests)"]
forbidden_outputs = ["packet execution engine", "external API calls", "credential or secret files"]
completion_phrase = "Phase 2 hardening complete — all tests passing"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "sha256"
::END

asl::EXECUTION_PLAN
task_count = 8
task_count_justification = "One task per major hardening area plus test suite run"

TASK_001:
  description = "Add ParserIssue interface to types.ts and parserIssues field to ParsedPacket"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/types.ts | checksum: <sha256>"
  expected_result = "ParserIssue interface exported; ParsedPacket.parserIssues array present"
  status = "PENDING"

TASK_002:
  description = "Replace regex block detection with line-by-line LIFO stack scanner for PARSE_001-004"
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "immediate"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/parser.ts | checksum: <sha256>"
  expected_result = "detectAslBlockIssues and detectGclBlockIssues functions exported; PARSE_001-004 codes generated"
  status = "PENDING"

TASK_003:
  description = "Extend schemas.ts with VALID_TIERS=[1,2,3] and REQUIRED blocks for Tier 3"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/schemas.ts | checksum: <sha256>"
  expected_result = "Tier 3 in type-tier map; REQUIRED_ASL_BLOCKS_TIER3 and REQUIRED_GCL_BLOCKS_TIER3 defined"
  status = "PENDING"

TASK_004:
  description = "Update validator.ts — surface parser issues, Tier 3 block checks, TASK ID in behavioral lock paired_with"
  required = true
  depends_on = ["TASK_001", "TASK_003"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/validator.ts | checksum: <sha256>"
  expected_result = "PARSE_001-004 surfaced; Tier 3 branches present; LOCK_006 checks TASK IDs"
  status = "PENDING"

TASK_005:
  description = "Add DRIFT_011 unresolved drift event and DRIFT_012 evidence_ref template warnings to drift.ts"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/drift.ts | checksum: <sha256>"
  expected_result = "DRIFT_011 error when FAILED/BLOCKED/RETRYING markers exist without Drift Report section; DRIFT_012 warning for missing template fields"
  status = "PENDING"

TASK_006:
  description = "Add validateFileEvidence() with SHA256 computation and fake checksum detection to evidence.ts"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: src/evidence.ts | checksum: <sha256>"
  expected_result = "validateFileEvidence returns FileEvidenceResult with checksum, exists, match fields; fake placeholders produce is_fake=true"
  status = "PENDING"

TASK_007:
  description = "Write tests/hardening.test.ts covering PARSE_001-004, Tier 3, LOCK_006, DRIFT_006, DRIFT_011, DRIFT_012, all 7 evidence_ref template types"
  required = true
  depends_on = ["TASK_002", "TASK_003", "TASK_004", "TASK_005", "TASK_006"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "immediate"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "path: tests/hardening.test.ts | checksum: <sha256>"
  expected_result = "32 tests written targeting all Phase 2 behaviors"
  status = "PENDING"

TASK_008:
  description = "Run npm test — all tests must pass (Phase 1 + Phase 2 hardening suite)"
  required = true
  depends_on = ["TASK_007"]
  on_dependency_fail = "HALT"
  retry_max = 2
  retry_backoff = "30s"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command: npm test | exit_code: 0 | summary: all tests passing"
  expected_result = "0 failing tests, all Phase 1 and Phase 2 tests green"
  status = "PENDING"

::END

::AUTHORITY
runtime_mode = "governed_build"
receipt_required = true
::END

::PERMISSIONS

allow:
  - action = "edit_source_files"
    scope = "src/ and tests/ directories only"
    enforced_by = "agent_receipt"

deny:
  - action = "external_api_call"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"

  - action = "write_credentials"
    scope = "all"
    enforced_by = "GCL permissions block"
    enforcement = "hard_block"

::END

::LOCKS

LOCK_001:
  rule = "Do not build a packet execution engine"
  type = "behavioral"
  enforced_by = "code review + asl-validate"
  paired_with = ["AT_001"]

LOCK_002:
  rule = "Do not call external APIs"
  type = "behavioral"
  enforced_by = "network audit"
  paired_with = ["AT_002"]

LOCK_003:
  rule = "Do not write credential or secret files"
  type = "runtime_enforced"
  enforced_by = "GCL permissions block"
  paired_with = ["AT_003"]

LOCK_004:
  rule = "Do not invent ASL/GCL rules outside v1.5.1"
  type = "behavioral"
  enforced_by = "spec review"
  paired_with = ["AT_004"]

LOCK_005:
  rule = "Do not accept fake checksum placeholders when actual file evidence can be computed"
  type = "behavioral"
  enforced_by = "validateFileEvidence() + isFakeChecksum()"
  paired_with = ["AT_005"]

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
  condition = "All Phase 1 tests still passing after parser changes"
  evaluator = "npm test"
  evidence_type = "command_output"
  on_fail = "HALT"

GATE_002:
  condition = "No regression in existing example packet validations"
  evaluator = "npx tsx src/index.ts examples/tier1-valid-review.md"
  evidence_type = "command_output"
  on_fail = "HALT"

GATE_003:
  condition = "PARSE_001 fires on a packet with an unclosed asl:: block"
  evaluator = "hardening.test.ts AT_003"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

GATE_004:
  condition = "Tier 3 packet with valid blocks passes validation"
  evaluator = "hardening.test.ts AT_006"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

GATE_005:
  condition = "Behavioral lock with TASK ID in paired_with passes LOCK_006 check"
  evaluator = "hardening.test.ts AT_007"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

GATE_006:
  condition = "SHA256 checksum mismatch detected when file content differs"
  evaluator = "hardening.test.ts AT_009"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

::END

::ACCEPTANCE_TESTS
count = 5

AT_001:
  name = "No execution engine code"
  check = "grep -r execPacket src/ returns empty"
  pass_condition = "No execution engine functions present"
  evaluator = "grep + code review"
  evidence_type = "command_output"
  on_fail = "HALT"

AT_002:
  name = "No external API calls"
  check = "grep -r fetch src/ returns no network calls"
  pass_condition = "No outbound network calls in source"
  evaluator = "grep"
  evidence_type = "command_output"
  on_fail = "HALT"

AT_003:
  name = "PARSE_001 unclosed block detection"
  check = "packet with unclosed asl::META block generates PARSE_001 error"
  pass_condition = "result.issues includes code PARSE_001"
  evaluator = "hardening.test.ts"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

AT_004:
  name = "No invented ASL rules"
  check = "all error codes in validator.ts match spec v1.5.1 error table"
  pass_condition = "no codes outside spec table"
  evaluator = "code review"
  evidence_type = "human_confirmation"
  on_fail = "WARN"

AT_005:
  name = "Fake checksum placeholder rejection"
  check = "evidence ref with checksum: reviewed when file exists triggers LED_008 error"
  pass_condition = "isFakeChecksum returns true; error issued"
  evaluator = "hardening.test.ts"
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

file_read:
  required_fields = ["path", "line_count", "checksum"]

gate_check:
  required_fields = ["gate_id", "result", "assertion"]

human_confirmation:
  required_fields = ["timestamp", "approver", "quote_or_marker"]

agent_assertion:
  required_fields = ["claim", "reason_not_system_verified"]

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

complete_only_if = ["all_required_tasks_COMPLETE", "all_gates_passed", "all_locks_verified", "all_acceptance_tests_passed", "drift_check_passed", "verification_ledger_exists", "receipt_exists"]
completion_invalid_if = ["any_required_task_FAILED", "any_required_task_SKIPPED", "any_required_task_BLOCKED", "any_task_RETRYING_at_completion", "gate_failed", "acceptance_test_failed", "drift_event_unresolved", "ledger_missing", "receipt_missing"]

::END

::VERIFICATION_LEDGER

required_task_count = 8
required_gate_count = 6
required_lock_count = 5
required_acceptance_test_count = 5
required_receipt_count = 1
ledger_status = "PENDING"

::END
