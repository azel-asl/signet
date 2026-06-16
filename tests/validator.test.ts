import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parsePacket } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { validateDrift } from '../src/drift.js';
import { crossCheckLedger } from '../src/ledger.js';

function loadExample(name: string): string {
  return readFileSync(resolve(__dirname, `../examples/${name}`), 'utf-8');
}

function runAll(raw: string) {
  const packet = parsePacket(raw);
  const result = validate(packet);
  validateDrift(packet, result);
  crossCheckLedger(packet, result);
  result.valid = result.summary.errors === 0;
  return { packet, result };
}

// ── AT_004: Tier validation ──────────────────────────────────

describe('tier validation (AT_004)', () => {
  it('accepts valid tier 1 review packet', () => {
    const { result } = runAll(loadExample('tier1-valid-review.md'));
    const tierIssues = result.issues.filter(i => i.code.startsWith('TIER'));
    expect(tierIssues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects invalid packet_tier value', () => {
    const raw = `
asl::META
id = "bad-tier"
version = "v1"
packet_tier = 99
type = "review"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END
`;
    const { result } = runAll(raw);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'TIER_002')).toBe(true);
  });

  it('rejects type-tier mismatch (build at tier 1)', () => {
    const raw = `
asl::META
id = "mismatch-001"
version = "v1"
packet_tier = 1
type = "build"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END
`;
    const { result } = runAll(raw);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'TIER_004')).toBe(true);
  });
});

// ── AT_005: Task validation ──────────────────────────────────

describe('task validation (AT_005)', () => {
  const BASE_META = `
asl::META
id = "task-test"
version = "v1"
packet_tier = 2
type = "build"
owner = "Test"
status = "active"
::END
asl::ROLE
name = "R"
description = "D"
::END
asl::SCOPE
included = []
excluded = []
::END
asl::PURPOSE
Purpose.
::END
asl::INPUTS
required = []
optional = []
::END
asl::PROCESS
phase_01 = "Build"
::END
asl::OUTPUT_CONTRACT
required_outputs = []
forbidden_outputs = []
completion_phrase = "Done."
::END
asl::FAILURE_MODES
failure_01 = "Fail"
::END
asl::RECEIPT
enabled = true
receipt_required = true
ledger_required = true
::END
`;

  it('rejects task_count mismatch', () => {
    const raw = BASE_META + `
asl::EXECUTION_PLAN
task_count = 3
TASK_001:
  description = "Only one task."
  required = true
  depends_on = []
  on_dependency_fail = "HALT"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "Done."
  status = "PENDING"
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END
::LOCKS
LOCK_001:
  rule = "No APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
::END
::LOCK_CHECK_RULES
runtime_enforced:
  check_method = "agent confirms"
  evidence_type = "agent_assertion"
::END
::GATES
GATE_001:
  condition = "Done"
  evaluator = "agent"
  evidence_type = "file_write"
  on_fail = "HALT"
::END
::ACCEPTANCE_TESTS
count = 0
::END
::EVIDENCE_POLICY
valid_evidence_types = ["file_write"]
::END
::EVIDENCE_TEMPLATES
file_write:
  required_fields = ["path", "diff_summary", "checksum"]
::END
::DRIFT
detection_mode = "marker_count_and_status_validation"
on_fail = "DRIFT_EVENT"
::END
::ESCALATION
on_hard_fail = "HALT"
on_soft_fail = "log"
on_drift_event = "document"
on_scope_violation = "HALT"
::END
::COMPLETION
complete_only_if = ["all_required_tasks_COMPLETE","all_gates_passed","all_runtime_locks_verified","all_behavioral_locks_reported","all_acceptance_tests_passed","drift_check_passed","verification_ledger_exists","receipt_exists","receipt_seals_verification_ledger"]
completion_invalid_if = ["any_required_task_FAILED","any_required_task_SKIPPED","any_required_task_BLOCKED","any_task_RETRYING_at_completion","gate_failed","runtime_lock_violation","acceptance_test_failed","drift_event_unresolved","ledger_missing","receipt_missing"]
::END
::VERIFICATION_LEDGER
required_task_count = 3
required_gate_count = 1
required_lock_count = 1
required_acceptance_test_count = 0
required_receipt_count = 1
ledger_status = "PENDING"
::END
`;
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'TASK_002')).toBe(true);
  });

  it('rejects required task with on_dependency_fail=SKIP', () => {
    const raw = BASE_META + `
asl::EXECUTION_PLAN
task_count = 1
TASK_001:
  description = "Required but skippable."
  required = true
  depends_on = []
  on_dependency_fail = "SKIP"
  retry_max = 0
  retry_backoff = "none"
  on_retry_exhausted = "HALT"
  evidence_type = "file_write"
  evidence_template = "file_write"
  expected_result = "Done."
  status = "PENDING"
::END
::AUTHORITY
runtime_mode = "x"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "agent_receipt"
::END
::LOCKS
::END
::LOCK_CHECK_RULES
::END
::GATES
GATE_001:
  condition = "Done"
  evaluator = "agent"
  evidence_type = "file_write"
  on_fail = "HALT"
::END
::ACCEPTANCE_TESTS
count = 0
::END
::EVIDENCE_POLICY
valid_evidence_types = ["file_write"]
::END
::EVIDENCE_TEMPLATES
file_write:
  required_fields = ["path", "diff_summary", "checksum"]
::END
::DRIFT
detection_mode = "marker_count_and_status_validation"
on_fail = "DRIFT_EVENT"
::END
::ESCALATION
on_hard_fail = "HALT"
on_soft_fail = "log"
on_drift_event = "document"
on_scope_violation = "HALT"
::END
::COMPLETION
complete_only_if = ["all_required_tasks_COMPLETE","all_gates_passed","all_runtime_locks_verified","all_behavioral_locks_reported","all_acceptance_tests_passed","drift_check_passed","verification_ledger_exists","receipt_exists","receipt_seals_verification_ledger"]
completion_invalid_if = ["any_required_task_FAILED","any_required_task_SKIPPED","any_required_task_BLOCKED","any_task_RETRYING_at_completion","gate_failed","runtime_lock_violation","acceptance_test_failed","drift_event_unresolved","ledger_missing","receipt_missing"]
::END
::VERIFICATION_LEDGER
required_task_count = 1
required_gate_count = 1
required_lock_count = 0
required_acceptance_test_count = 0
required_receipt_count = 1
ledger_status = "PENDING"
::END
`;
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'TASK_005')).toBe(true);
  });
});

// ── AT_006: Behavioral lock pairing ─────────────────────────

describe('behavioral lock pairing (AT_006)', () => {
  it('rejects unpaired behavioral lock', () => {
    const { result } = runAll(loadExample('tier2-invalid-behavioral-lock-unpaired.md'));
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'LOCK_005')).toBe(true);
  });

  it('accepts paired behavioral lock', () => {
    const { result } = runAll(loadExample('tier2-valid-build.md'));
    const lockErrors = result.issues.filter(i =>
      (i.code === 'LOCK_005' || i.code === 'LOCK_006') && i.severity === 'error');
    expect(lockErrors).toHaveLength(0);
  });
});

// ── Required blocks missing ──────────────────────────────────

describe('required block validation', () => {
  it('rejects tier 1 packet missing AUTHORITY', () => {
    const { result } = runAll(loadExample('tier1-invalid-missing-authority.md'));
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'BLOCK_002')).toBe(true);
  });

  it('accepts tier 1 packet with all required blocks', () => {
    const { result } = runAll(loadExample('tier1-valid-review.md'));
    const blockErrors = result.issues.filter(i =>
      (i.code === 'BLOCK_001' || i.code === 'BLOCK_002') && i.severity === 'error');
    expect(blockErrors).toHaveLength(0);
  });
});

// ── Valid tier 2 packet passes ───────────────────────────────

describe('tier 2 valid build packet', () => {
  it('passes with zero errors', () => {
    const { result } = runAll(loadExample('tier2-valid-build.md'));
    const errors = result.issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });
});
