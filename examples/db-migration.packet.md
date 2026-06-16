asl::META
id = "db-migration-v2"
packet_tier = 3
type = "deploy"
owner = "eng-lead@example.com"
status = "active"
::END

asl::ROLE
name = "Database Migration Runner"
description = "Applies a versioned schema migration to a production database with backup, dry-run, human approval, rollback readiness, and post-migration verification."
skills_required = ["PostgreSQL", "SQL migrations", "backup/restore", "production operations"]
::END

asl::SCOPE
included = ["migrations/", "scripts/", "output/migration-logs/"]
excluded = [
  ".env",
  "secrets/",
  "credentials/",
  ".aws/",
  "config/prod.json",
  "src/",
  "node_modules/",
  "backups/prod-live"
]
::END

asl::PURPOSE
Safely apply database migration v2 to production:
1. Back up the current schema
2. Run a dry-run to catch errors before touching live data
3. Require human approval before applying
4. Apply the migration
5. Verify the schema matches expectations
6. Write a migration report
7. If anything fails after apply, generate a rollback script

No step that writes to the live database runs without human approval in GATE_002.
::END

asl::INPUTS
required = [
  "migrations/v2_add_user_roles.sql",
  "scripts/verify-schema.sql",
  "Database connection string (env: DATABASE_URL)",
  "scripts/backup-schema.sh"
]
optional = [
  "scripts/rollback-v2.sql (auto-generated if missing)",
  "output/migration-logs/ directory (created if missing)"
]
::END

asl::PROCESS
phase_01 = "Read and validate migration file"
phase_02 = "Back up current schema to output/migration-logs/"
phase_03 = "Run dry-run (--dry-run flag, no data changes)"
phase_04 = "Present dry-run results — HALT for human approval"
phase_05 = "Apply migration to live database (only after approval)"
phase_06 = "Verify schema matches post-migration expectations"
phase_07 = "Write migration report to output/migration-logs/report.md"
phase_08 = "Generate rollback script if not already present"
::END

asl::OUTPUT_CONTRACT
required_outputs = [
  "output/migration-logs/schema-backup.sql",
  "output/migration-logs/dry-run.log",
  "output/migration-logs/report.md"
]
forbidden_outputs = [
  ".env",
  "secrets/",
  "credentials/",
  "config/prod.json",
  "backups/prod-live",
  ".aws/"
]
completion_phrase = "Migration v2 complete. Report written."
::END

asl::FAILURE_MODES
failure_01 = "Migration file missing or unparseable — HALT before backup"
failure_02 = "Schema backup fails — HALT, do not proceed to dry-run"
failure_03 = "Dry-run returns errors — HALT, surface errors for human review"
failure_04 = "Human approval not granted — HALT, do not apply"
failure_05 = "Migration apply fails mid-run — HALT, preserve state for rollback"
failure_06 = "Post-migration schema verify fails — report mismatch, flag for rollback"
failure_07 = "Report write fails — non-critical, log warning and continue"
::END

asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
receipt_seals = "VERIFICATION_LEDGER"
::END

asl::EXECUTION_PLAN
task_count = 8
task_count_justification = "Validate → backup → dry-run → await approval → apply → verify → report → rollback-prep. Each step gates the next. Rollback-prep is non-required and skips if verify passes."

TASK_001:
  description = "Read and validate migrations/v2_add_user_roles.sql"
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_read"
  evidence_template = "file_read"
  expected_result = "Migration SQL parsed, no syntax errors detected."
  status = "PENDING"

TASK_002:
  description = "Run scripts/backup-schema.sh — write backup to output/migration-logs/schema-backup.sql"
  required = true
  depends_on = ["TASK_001"]
  on_dependency_fail = "HALT"
  retry_max = 2
  retry_backoff = "exponential"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "output/migration-logs/schema-backup.sql written, non-empty."
  status = "PENDING"

TASK_003:
  description = "Execute migration dry-run against DATABASE_URL with --dry-run flag — write output to output/migration-logs/dry-run.log"
  required = true
  depends_on = ["TASK_002"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "linear"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Dry-run completes with 0 errors. output/migration-logs/dry-run.log written."
  status = "PENDING"

TASK_004:
  description = "Assert dry-run log shows no errors and migration is safe to apply"
  required = true
  depends_on = ["TASK_003"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "gate_check"
  evidence_template = "gate_check"
  expected_result = "Dry-run log contains no ERROR lines. Safe to proceed."
  status = "PENDING"

TASK_005:
  description = "Apply migration to live database — execute migrations/v2_add_user_roles.sql against DATABASE_URL"
  required = true
  depends_on = ["TASK_004"]
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Migration applied. Database reports 0 errors. All statements committed."
  status = "PENDING"

TASK_006:
  description = "Verify schema against scripts/verify-schema.sql — confirm expected tables and columns exist"
  required = true
  depends_on = ["TASK_005"]
  on_dependency_fail = "HALT"
  retry_max = 2
  retry_backoff = "linear"
  on_retry_exhausted = "HALT"
  evidence_type = "command_output"
  evidence_template = "command_output"
  expected_result = "Schema verification passes. All expected tables and columns present."
  status = "PENDING"

TASK_007:
  description = "Write migration report to output/migration-logs/report.md"
  required = true
  depends_on = ["TASK_006"]
  on_dependency_fail = "HALT"
  retry_max = 1
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "output/migration-logs/report.md written with summary, timing, and schema diff."
  status = "PENDING"

TASK_008:
  description = "Generate rollback script to output/migration-logs/rollback-v2.sql if not already present"
  required = false
  depends_on = ["TASK_006"]
  on_dependency_fail = "SKIP"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "output/migration-logs/rollback-v2.sql written. Rollback ready if needed."
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
    scope = "migrations/"
  - action = "read"
    scope = "scripts/"
  - action = "execute"
    scope = "scripts/backup-schema.sh"
  - action = "execute"
    scope = "DATABASE_URL (dry-run only, until GATE_002 passes)"
  - action = "execute"
    scope = "DATABASE_URL (live write, only after GATE_002 approval)"
  - action = "write"
    scope = "output/migration-logs/"
deny:
  - action = "read"
    scope = "secrets/"
  - action = "read"
    scope = "credentials/"
  - action = "write"
    scope = "src/"
  - action = "write"
    scope = "config/"
  - action = "write"
    scope = ".env"
  - action = "write"
    scope = "backups/prod-live"
  - action = "delete"
    scope = "all"
::END

::LOCKS
LOCK_001:
  rule = "Do not write to credential files, production config, or live backup directory"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"

LOCK_002:
  rule = "Do not execute live database writes before GATE_002 human approval"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["GATE_002"]

LOCK_003:
  rule = "Do not read secrets/, credentials/, or .aws/ directories"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"

LOCK_004:
  rule = "All outputs must be written to output/migration-logs/ only"
  type = "behavioral"
  enforced_by = "attested_by"
  paired_with = ["AT_001"]
::END

::LOCK_CHECK_RULES
runtime_enforced:
  check_method = "pattern match on output_contract.forbidden_outputs + scope.excluded"
behavioral:
  check_method = "paired gate or acceptance test"
::END

::GATES
GATE_001:
  condition = "TASK_001, TASK_002, TASK_003, TASK_004 all COMPLETE before TASK_005 begins"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"

GATE_002:
  condition = "Human engineer reviews dry-run log and approves live migration"
  evaluator = "human"
  approval_id = "APPROVAL_DB_MIG_V2"
  evidence_type = "approval_token"
  on_fail = "HALT"

GATE_003:
  condition = "TASK_006 schema verify passes before TASK_007 and TASK_008 begin"
  evaluator = "agent"
  evidence_type = "gate_check"
  on_fail = "HALT"
::END

::ACCEPTANCE_TESTS
count = 3

AT_001:
  name = "Output scope containment"
  check = "All file writes land inside output/migration-logs/ only"
  pass_condition = "no write targets outside output/migration-logs/"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

AT_002:
  name = "No credential access"
  check = "No reads from secrets/, credentials/, .aws/, or .env"
  pass_condition = "zero reads from forbidden read paths"
  evaluator = "agent"
  evidence_type = "acceptance_test"
  on_fail = "HALT"

AT_003:
  name = "Backup exists before apply"
  check = "output/migration-logs/schema-backup.sql is non-empty before TASK_005 executes"
  pass_condition = "TASK_002 COMPLETE and backup file non-empty"
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
on_hard_fail = "HALT immediately, preserve all output/migration-logs/, notify eng-lead@example.com"
on_lock_violation = "HALT, do not attempt workaround, escalate to eng-lead@example.com"
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
required_task_count = 8
required_gate_count = 3
required_lock_count = 4
required_acceptance_test_count = 3
required_receipt_count = 1
ledger_status = "PENDING"
::END
