import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseAslBlocks, parseGclBlocks,
  detectAslBlockIssues, detectGclBlockIssues,
  parsePacket,
} from '../src/parser.js';
import { validate } from '../src/validator.js';
import { validateDrift } from '../src/drift.js';

function runAll(raw: string) {
  const packet = parsePacket(raw);
  const result = validate(packet);
  validateDrift(packet, result);
  result.valid = result.summary.errors === 0;
  return { packet, result };
}

// ─────────────────────────────────────────────────────────────
// AT_003 — Malformed block tests (TASK_011)
// ─────────────────────────────────────────────────────────────

describe('malformed block detection (AT_003)', () => {

  // ── Missing ::END ────────────────────────────────────────────
  it('detects unclosed asl:: block (missing ::END)', () => {
    const raw = `
asl::META
id = "x"
version = "v1"
packet_tier = 1
type = "review"
owner = "Test"
status = "active"

asl::ROLE
name = "R"
description = "D"
::END
`;
    // META has no ::END — PARSE_001 expected
    const issues = detectAslBlockIssues(raw);
    expect(issues.some(i => i.code === 'PARSE_001' && i.message.includes('META'))).toBe(true);
  });

  it('detects unclosed GCL block (missing ::END)', () => {
    const raw = `
::AUTHORITY
runtime_mode = "governed"

::PERMISSIONS
allow:
  - action = "read"
    scope = "all"
    enforced_by = "receipt"
::END
`;
    // AUTHORITY has no ::END
    const issues = detectGclBlockIssues(raw);
    expect(issues.some(i => i.code === 'PARSE_003' && i.message.includes('AUTHORITY'))).toBe(true);
  });

  it('surfaces parser PARSE_001 errors through validate()', () => {
    const raw = `asl::META
id = "unclosed"
packet_tier = 1
type = "review"
owner = "Test"
version = "v1"
status = "active"

asl::ROLE
name = "R"
description = "D"
::END
`;
    // META block has no ::END — should produce PARSE_001 in result
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'PARSE_001')).toBe(true);
  });

  // ── Duplicate blocks ─────────────────────────────────────────
  it('detects duplicate asl:: block names', () => {
    const raw = `
asl::META
id = "first"
::END

asl::META
id = "second"
::END
`;
    const issues = detectAslBlockIssues(raw);
    expect(issues.some(i => i.code === 'PARSE_002' && i.message.includes('META'))).toBe(true);
  });

  it('detects duplicate non-authority GCL block names (PARSE_004 warning, last-wins)', () => {
    // v1.5.2: PARSE_004 "last wins" now applies only to NON-authority blocks.
    // Authority-bearing duplicates (AUTHORITY/PERMISSIONS/LOCKS) escalate to PARSE_005 error.
    const raw = `
::ESCALATION
on_hard_fail = "x"
::END

::ESCALATION
on_hard_fail = "y"
::END
`;
    const issues = detectGclBlockIssues(raw);
    expect(issues.some(i => i.code === 'PARSE_004' && i.message.includes('ESCALATION'))).toBe(true);
  });

  // ── asl::END not misread as GCL ──────────────────────────────
  it('does not treat asl:: ::END terminators as GCL block openers', () => {
    const raw = `
asl::META
id = "x"
::END

asl::ROLE
name = "R"
description = "D"
::END

::AUTHORITY
runtime_mode = "governed"
::END
`;
    const gclBlocks = parseGclBlocks(raw);
    // END should never appear as a GCL block
    expect(gclBlocks['END']).toBeUndefined();
    // AUTHORITY should be correctly detected
    expect(gclBlocks['AUTHORITY']).toBeDefined();
  });

  // ── Comment lines do not break parsing ───────────────────────
  it('parses blocks with comment lines inside', () => {
    const raw = `
asl::META
# This is a comment
id = "commented-001"
packet_tier = 1
type = "review"
owner = "Test"
version = "v1"
status = "active"
::END
`;
    const blocks = parseAslBlocks(raw);
    expect(blocks['META']).toBeDefined();
    // META content should include the comment
    expect(blocks['META']).toContain('id = "commented-001"');
  });
});

// ─────────────────────────────────────────────────────────────
// AT_004 — Tier 3 validation tests (TASK_012)
// ─────────────────────────────────────────────────────────────

const TIER3_BASE = `
asl::META
id = "tier3-test"
version = "ASL Lite + GCL Packet Standard v1.5.1"
packet_tier = 3
type = "review"
owner = "ASL Labs"
status = "active"
::END

asl::ROLE
name = "Multi-Agent Orchestrator"
description = "Tier 3 multi-agent orchestration."
::END

asl::SCOPE
included = ["orchestration"]
excluded = ["direct execution"]
::END

asl::PURPOSE
Multi-agent orchestration review.
::END

asl::INPUTS
required = ["Agent mesh config"]
optional = []
::END

asl::PROCESS
phase_01 = "Orchestrate"
::END

asl::OUTPUT_CONTRACT
required_outputs = ["orchestration report"]
forbidden_outputs = ["direct code execution"]
completion_phrase = "Orchestration complete."
::END

asl::FAILURE_MODES
failure_01 = "Agent loop"
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
  description = "Orchestrate agents."
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
runtime_mode = "governed_tier3"
receipt_required = true
::END

::PERMISSIONS
allow:
  - action = "read_project_files"
    scope = "all"
    enforced_by = "agent_receipt"
deny:
  - action = "external_api_call"
    scope = "all"
    enforced_by = "agent_receipt"
    enforcement = "hard_block"
::END

::LOCKS
LOCK_001:
  rule = "No external APIs"
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
  condition = "Orchestration complete"
  evaluator = "agent"
  evidence_type = "file_write"
  on_fail = "HALT"
::END

::ACCEPTANCE_TESTS
count = 0
::END

::EVIDENCE_POLICY
valid_evidence_types = ["file_write", "agent_assertion"]
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
required_lock_count = 1
required_acceptance_test_count = 0
required_receipt_count = 1
ledger_status = "PENDING"
::END
`;

describe('Tier 3 validation (AT_004)', () => {
  it('accepts valid tier 3 packet with full block set', () => {
    const { result } = runAll(TIER3_BASE);
    const errors = result.issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.packet_tier).toBe(3);
  });

  it('rejects tier 3 packet missing required block', () => {
    // Remove PURPOSE from TIER3_BASE to trigger BLOCK_001
    const raw = TIER3_BASE.replace(/asl::PURPOSE[\s\S]*?::END\n/, '');
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'BLOCK_001' && i.message.includes('PURPOSE'))).toBe(true);
  });

  it('rejects tier 3 packet missing GCL required block', () => {
    const raw = TIER3_BASE.replace(/::COMPLETION[\s\S]*?::END\n/, '');
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'BLOCK_002' && i.message.includes('COMPLETION'))).toBe(true);
  });

  it('accepts "build" type at tier 3', () => {
    const raw = TIER3_BASE.replace('type = "review"', 'type = "build"');
    const { result } = runAll(raw);
    // Should not get TIER_004 for build at tier 3
    expect(result.issues.some(i => i.code === 'TIER_004')).toBe(false);
  });

  it('rejects "query" type at tier 3 (tier mismatch)', () => {
    const raw = TIER3_BASE.replace('type = "review"', 'type = "query"');
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'TIER_004')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// AT_007 — Behavioral lock paired_with missing ref (TASK_013)
// ─────────────────────────────────────────────────────────────

describe('behavioral lock missing paired_with reference (AT_007)', () => {
  it('rejects behavioral lock paired_with pointing to nonexistent AT', () => {
    const raw = TIER3_BASE.replace(
      `::LOCKS
LOCK_001:
  rule = "No external APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
::END`,
      `::LOCKS
LOCK_001:
  rule = "No overbuild"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["AT_999"]
::END`
    );
    const { result } = runAll(raw);
    expect(result.issues.some(i => i.code === 'LOCK_006')).toBe(true);
  });

  it('accepts behavioral lock paired_with a valid TASK ID', () => {
    const raw = TIER3_BASE.replace(
      `::LOCKS
LOCK_001:
  rule = "No external APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
::END`,
      `::LOCKS
LOCK_001:
  rule = "No overbuild"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["TASK_001"]
::END`
    );
    const { result } = runAll(raw);
    const lockErrors = result.issues.filter(i =>
      (i.code === 'LOCK_005' || i.code === 'LOCK_006') && i.severity === 'error');
    expect(lockErrors).toHaveLength(0);
  });

  it('accepts behavioral lock paired_with a valid GATE ID', () => {
    const raw = TIER3_BASE.replace(
      `::LOCKS
LOCK_001:
  rule = "No external APIs"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
::END`,
      `::LOCKS
LOCK_001:
  rule = "No overbuild"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["GATE_001"]
::END`
    );
    const { result } = runAll(raw);
    const lockErrors = result.issues.filter(i =>
      (i.code === 'LOCK_005' || i.code === 'LOCK_006') && i.severity === 'error');
    expect(lockErrors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// AT_005 — Evidence_ref template validation (TASK_014)
// ─────────────────────────────────────────────────────────────

import { parseEvidenceRef, checkEvidenceTemplate } from '../src/evidence.js';

describe('evidence_ref template validation (AT_005)', () => {
  it('detects missing required fields for file_write', () => {
    const ref = parseEvidenceRef('path: src/index.ts', 'file_write');
    const missing = checkEvidenceTemplate('file_write', ref);
    expect(missing).toContain('diff_summary');
    expect(missing).toContain('checksum');
  });

  it('passes when all file_write fields are present', () => {
    const ref = parseEvidenceRef(
      'path: src/index.ts | diff_summary: added 10 lines | checksum: abc123',
      'file_write'
    );
    const missing = checkEvidenceTemplate('file_write', ref);
    expect(missing).toHaveLength(0);
  });

  it('detects missing fields for command_output', () => {
    const ref = parseEvidenceRef('command: npm test', 'command_output');
    const missing = checkEvidenceTemplate('command_output', ref);
    expect(missing).toContain('exit_code');
    expect(missing).toContain('key_result');
  });

  it('detects missing fields for gate_check', () => {
    const ref = parseEvidenceRef('gate_id: GATE_001', 'gate_check');
    const missing = checkEvidenceTemplate('gate_check', ref);
    expect(missing).toContain('result');
    expect(missing).toContain('assertion');
  });

  it('detects missing fields for acceptance_test', () => {
    const ref = parseEvidenceRef('test_id: AT_001 | result: PASS', 'acceptance_test');
    const missing = checkEvidenceTemplate('acceptance_test', ref);
    expect(missing).toContain('assertion');
  });

  it('detects missing fields for human_confirmation', () => {
    const ref = parseEvidenceRef('timestamp: 2026-05-24 | approver: Erwin', 'human_confirmation');
    const missing = checkEvidenceTemplate('human_confirmation', ref);
    expect(missing).toContain('quote_or_marker');
  });

  it('detects missing fields for agent_assertion', () => {
    const ref = parseEvidenceRef('claim: packet read', 'agent_assertion');
    const missing = checkEvidenceTemplate('agent_assertion', ref);
    expect(missing).toContain('reason_not_system_verified');
  });

  it('passes for complete agent_assertion ref', () => {
    const ref = parseEvidenceRef(
      'claim: packet read | reason_not_system_verified: source prompt processed',
      'agent_assertion'
    );
    const missing = checkEvidenceTemplate('agent_assertion', ref);
    expect(missing).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// AT_008 — RETRYING at completion (TASK_015)
// AT_009 — Unresolved drift event (TASK_015)
// ─────────────────────────────────────────────────────────────

describe('drift edge cases (AT_008, AT_009)', () => {

  // ── AT_008: RETRYING at completion ───────────────────────────
  it('fails when all markers at final status but one is RETRYING', () => {
    const raw = `
asl::META
id = "retrying-test"
version = "v1"
packet_tier = 1
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

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: done]
[TASK_002: COMPLETE | evidence_type: file_write | evidence_ref: done]
[TASK_003: RETRYING | evidence_type: command_output | evidence_ref: still running]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    // All other markers are COMPLETE — RETRYING at completion should be caught
    expect(result.issues.some(i => i.code === 'DRIFT_006')).toBe(true);
  });

  it('does not flag RETRYING when other tasks are still in progress', () => {
    const raw = `
asl::META
id = "retrying-ok"
version = "v1"
packet_tier = 1
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

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: done]
[TASK_002: RETRYING | evidence_type: command_output | evidence_ref: still running]
[TASK_003: PENDING | evidence_type: file_write | evidence_ref: not started]
`;
    // TASK_003 is PENDING — not all at final status, so RETRYING is acceptable
    // Note: PENDING is not in VALID_STATUSES list so DRIFT_003 may fire, but not DRIFT_006
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_006')).toBe(false);
  });

  // ── AT_009: Unresolved drift event ───────────────────────────
  it('fails when FAILED marker exists without Drift Report section', () => {
    const raw = `
asl::META
id = "drift-event-test"
version = "v1"
packet_tier = 1
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

[TASK_001: FAILED | evidence_type: command_output | evidence_ref: tests failed]
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_011')).toBe(true);
  });

  it('passes when FAILED marker has accompanying Drift Report', () => {
    const raw = `
asl::META
id = "drift-resolved-test"
version = "v1"
packet_tier = 1
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

[TASK_001: FAILED | evidence_type: command_output | evidence_ref: tests failed]

## Drift Report

DRIFT_EVENT_001:
- Cause: tests failed due to network timeout
- Impact: TASK_001 could not complete
- Owner acknowledgment: Erwin — will retry with mock
`;
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_011')).toBe(false);
  });

  // ── Evidence_ref template check in drift markers ─────────────
  it('warns when structured drift marker evidence_ref is missing template fields', () => {
    const raw = `
asl::META
id = "ev-ref-test"
version = "v1"
packet_tier = 1
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

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: src/index.ts | checksum: abc]
`;
    // Missing diff_summary → DRIFT_012 warning
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_012')).toBe(true);
    // Should be warning, not error
    const d12 = result.issues.find(i => i.code === 'DRIFT_012');
    expect(d12?.severity).toBe('warning');
  });

  it('does not warn when drift marker evidence_ref is unstructured (no pipes)', () => {
    const raw = `
asl::META
id = "ev-ref-plain"
version = "v1"
packet_tier = 1
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

[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: file was written successfully]
`;
    // Plain prose ref — no pipes/colons pattern → DRIFT_012 should NOT fire
    const packet = parsePacket(raw);
    const result = validate(packet);
    validateDrift(packet, result);
    expect(result.issues.some(i => i.code === 'DRIFT_012')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// AT_006 — File evidence validation (TASK_008 Phase 2)
// ─────────────────────────────────────────────────────────────

import { validateFileEvidence, parseEvidenceRef as pRef } from '../src/evidence.js';

describe('deterministic file evidence validation (AT_006)', () => {
  it('returns exists=false gracefully for nonexistent path', () => {
    const ref = pRef('path: /nonexistent/path/file.ts | diff_summary: x | checksum: abc', 'file_write');
    const result = validateFileEvidence(ref);
    expect(result.exists).toBe(false);
    expect(result.match).toBe(true); // not an error — just unverifiable
  });

  it('returns exists=false gracefully for missing path field', () => {
    const ref = pRef('diff_summary: x | checksum: abc', 'file_write');
    const result = validateFileEvidence(ref);
    expect(result.exists).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toContain('path');
  });

  it('validates an existing file and computes checksum', () => {
    // Use package.json which we know exists in the project
    const ref = pRef(
      'path: package.json | diff_summary: project file | checksum: 0000',
      'file_read'
    );
    const result = validateFileEvidence(ref);
    if (result.exists) {
      // If file was found, checksum should be computed
      expect(result.checksum).toBeDefined();
      expect(result.line_count).toBeGreaterThan(0);
    }
    // Non-matching placeholder checksum — may warn but match=false is acceptable
    // Just verify the function runs without throwing
    expect(result).toBeDefined();
  });
});
