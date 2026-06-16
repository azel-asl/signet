import { describe, it, expect } from 'vitest';
import { parsePacket, parseApprovalRecords } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { validateReceipt } from '../src/receipt-validator.js';
import { scanForbiddenOutputs, checkHumanGateApprovals } from '../src/governance.js';
import { writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ─────────────────────────────────────────────────────────────
// v1.5.2 Phase 1 — Critical Governance Hardening
// ─────────────────────────────────────────────────────────────

// Minimal tier-1 packet scaffold with injectable GCL blocks.
function tier1(gcl: string): string {
  return `asl::META
id = "h152"
version = "v1.5.2"
packet_tier = 1
type = "review"
owner = "test"
status = "active"
::END

asl::ROLE
name = "Reviewer"
description = "x"
::END

asl::SCOPE
included = ["./a"]
excluded = ["./b"]
::END

::AUTHORITY
runtime_mode = "governed_review"
::END

::PERMISSIONS
allow:
  - action = "read"
    scope = "./a"
::END
${gcl}`;
}

// ── Item 1: Terminology cleanup (GOV_001) ────────────────────

describe('GOV_001 — honest enforcement terminology', () => {
  it('flags enforced_by = "agent_receipt" as attestation (warning)', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "No network"
  type = "behavioral"
  enforced_by = "agent_receipt"
  paired_with = ["AT_001"]
::END
`);
    const result = validate(parsePacket(raw));
    expect(result.issues.some(i => i.code === 'GOV_001')).toBe(true);
    expect(result.checks.enforcement_terminology_honest).toBe(false);
  });

  it('accepts honest term "requires_external_evidence" without GOV_001', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "No network"
  type = "behavioral"
  enforced_by = "requires_external_evidence"
  paired_with = ["AT_001"]
::END
`);
    const result = validate(parsePacket(raw));
    expect(result.issues.some(i => i.code === 'GOV_001')).toBe(false);
    expect(result.checks.enforcement_terminology_honest).toBe(true);
  });
});

// ── Item 2: Duplicate authority blocks (PARSE_005) ───────────

describe('PARSE_005 — duplicate authority blocks are hard errors', () => {
  it('fails on duplicate ::PERMISSIONS (no last-wins)', () => {
    const raw = tier1(`
::PERMISSIONS
allow:
  - action = "write"
    scope = "all"
::END
`);
    const result = validate(parsePacket(raw));
    const p5 = result.issues.filter(i => i.code === 'PARSE_005');
    expect(p5.length).toBeGreaterThan(0);
    expect(p5[0].severity).toBe('error');
    expect(result.checks.authority_blocks_unique).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails on duplicate ::LOCKS', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "a"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"
  evidence_type = "command_output"
::END

::LOCKS
LOCK_001:
  rule = "looser"
  type = "behavioral"
  enforced_by = "agent_receipt"
::END
`);
    const result = validate(parsePacket(raw));
    expect(result.issues.some(i => i.code === 'PARSE_005' && i.message.includes('LOCKS'))).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('still allows a single authority block', () => {
    const result = validate(parsePacket(tier1('')));
    expect(result.issues.some(i => i.code === 'PARSE_005')).toBe(false);
    expect(result.checks.authority_blocks_unique).toBe(true);
  });
});

// ── Item 3: Runtime lock evidence (LOCK_007 / LOCK_008) ───────

describe('LOCK_007 — runtime_enforced lock forbids agent_assertion', () => {
  it('fails when a runtime_enforced lock uses agent_assertion evidence', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "No external calls"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"
  evidence_type = "agent_assertion"
::END
`);
    const result = validate(parsePacket(raw));
    expect(result.issues.some(i => i.code === 'LOCK_007')).toBe(true);
    expect(result.checks.runtime_locks_externally_evidenced).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('passes when a runtime_enforced lock uses command_output evidence', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "No external calls"
  type = "runtime_enforced"
  enforced_by = "runtime_enforced_external"
  evidence_type = "command_output"
::END
`);
    const result = validate(parsePacket(raw));
    expect(result.issues.some(i => i.code === 'LOCK_007')).toBe(false);
    expect(result.checks.runtime_locks_externally_evidenced).toBe(true);
  });

  it('warns (LOCK_008, not error) when runtime lock declares no external evidence', () => {
    const raw = tier1(`
::LOCKS
LOCK_001:
  rule = "No external calls"
  type = "runtime_enforced"
  enforced_by = "agent_receipt"
::END
`);
    const result = validate(parsePacket(raw));
    const l8 = result.issues.filter(i => i.code === 'LOCK_008');
    expect(l8.length).toBe(1);
    expect(l8[0].severity).toBe('warning');
    // backwards compatible: no new error
    expect(result.issues.some(i => i.code === 'LOCK_007')).toBe(false);
  });
});

// ── Item 4: Human gate approval (GATE_005 / REC_019) ─────────

describe('GATE_005 / REC_019 — human gate approval enforcement', () => {
  const humanGateGcl = (approvalLine: string) => tier1(`
::GATES
GATE_001:
  condition = "Human sign-off"
  evaluator = "human"
  evidence_type = "human_confirmation"
  on_fail = "HALT"${approvalLine}
::END
`);

  it('fails when a human gate has no approval_id (GATE_005)', () => {
    const result = validate(parsePacket(humanGateGcl('')));
    expect(result.issues.some(i => i.code === 'GATE_005')).toBe(true);
    expect(result.checks.human_gates_have_approval_id).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('passes packet validation when a human gate declares approval_id', () => {
    const result = validate(parsePacket(humanGateGcl('\n  approval_id = "APR_001"')));
    expect(result.issues.some(i => i.code === 'GATE_005')).toBe(false);
    expect(result.checks.human_gates_have_approval_id).toBe(true);
  });

  it('REC_019 rejects a fake free-text approval (no signed record)', () => {
    const packet = parsePacket(humanGateGcl('\n  approval_id = "APR_001"'));
    const receipt = `# Receipt
Approved by Erwin in Slack yesterday. Looks good!
[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: ./out.txt | diff_summary: new | checksum: none]
`;
    const res = validateReceipt(packet, receipt, 'receipt.md');
    expect(res.issues.some(i => i.code === 'REC_019')).toBe(true);
    expect(res.checks.human_gate_approvals_present).toBe(false);
  });

  it('REC_019 passes with a valid signed approval record matching approval_id', () => {
    const packet = parsePacket(humanGateGcl('\n  approval_id = "APR_001"'));
    const receipt = `# Receipt
[APPROVAL: APR_001 | approver: Erwin Layaoen | timestamp: 2026-06-09T10:00:00Z | signature: ed25519:9af3c1]
[TASK_001: COMPLETE | evidence_type: file_write | evidence_ref: path: ./out.txt | diff_summary: new | checksum: none]
`;
    const res = validateReceipt(packet, receipt, 'receipt.md');
    expect(res.issues.some(i => i.code === 'REC_019')).toBe(false);
    expect(res.checks.human_gate_approvals_present).toBe(true);
  });

  it('parseApprovalRecords extracts a signed record', () => {
    const recs = parseApprovalRecords(
      '[APPROVAL: APR_007 | approver: Jane | timestamp: 2026-01-01 | signature: sig123]'
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].approval_id).toBe('APR_007');
    expect(recs[0].signature).toBe('sig123');
  });
});

// ── Item 5: Forbidden outputs (REC_018) ──────────────────────

describe('REC_018 — forbidden output enforcement', () => {
  let dir: string;
  function makePacket(forbidden: string[]): ReturnType<typeof parsePacket> {
    const raw = `asl::META
id = "fo"
version = "v1.5.2"
packet_tier = 1
type = "review"
owner = "t"
status = "active"
::END
asl::ROLE
name = "R"
description = "d"
::END
asl::SCOPE
included = ["./a"]
excluded = ["./b"]
::END
asl::OUTPUT_CONTRACT
required_outputs = ["./out.txt"]
forbidden_outputs = [${forbidden.map(f => `"${f}"`).join(', ')}]
completion_phrase = "done"
::END
::AUTHORITY
runtime_mode = "governed_review"
::END
::PERMISSIONS
allow:
  - action = "read"
    scope = "./a"
::END`;
    return parsePacket(raw);
  }

  it('flags a produced file containing a secret (AWS key)', () => {
    dir = mkdtempSync(join(tmpdir(), 'asl-fo-'));
    const secretFile = join(dir, 'leak.txt');
    writeFileSync(secretFile, 'config\nAKIAIOSFODNN7EXAMPLE\nmore', 'utf-8');

    const packet = makePacket(['credentials']);
    const marker = {
      task_id: 'TASK_001', status: 'COMPLETE' as const,
      evidence_type: 'file_write' as const,
      evidence_ref: `path: ${secretFile} | diff_summary: new | checksum: none`,
      raw: '', line_number: 1,
    };
    const issues: any[] = [];
    const clean = scanForbiddenOutputs(packet, [marker], issues);
    rmSync(dir, { recursive: true, force: true });

    expect(clean).toBe(false);
    expect(issues.some(i => i.code === 'REC_018' && /AWS/i.test(i.message))).toBe(true);
  });

  it('flags writing to a forbidden path fragment ("secrets")', () => {
    const packet = makePacket(['secrets']);
    const marker = {
      task_id: 'TASK_001', status: 'COMPLETE' as const,
      evidence_type: 'file_write' as const,
      evidence_ref: 'path: ./config/secrets/key.pem | diff_summary: new | checksum: none',
      raw: '', line_number: 1,
    };
    const issues: any[] = [];
    const clean = scanForbiddenOutputs(packet, [marker], issues);
    expect(clean).toBe(false);
    expect(issues.some(i => i.code === 'REC_018')).toBe(true);
  });

  it('passes a clean produced file with no secrets', () => {
    dir = mkdtempSync(join(tmpdir(), 'asl-fo-'));
    const cleanFile = join(dir, 'ok.txt');
    writeFileSync(cleanFile, 'hello world\nno secrets here', 'utf-8');

    const packet = makePacket(['credentials']);
    const marker = {
      task_id: 'TASK_001', status: 'COMPLETE' as const,
      evidence_type: 'file_write' as const,
      evidence_ref: `path: ${cleanFile} | diff_summary: new | checksum: none`,
      raw: '', line_number: 1,
    };
    const issues: any[] = [];
    const clean = scanForbiddenOutputs(packet, [marker], issues);
    rmSync(dir, { recursive: true, force: true });

    expect(clean).toBe(true);
    expect(issues.some(i => i.code === 'REC_018')).toBe(false);
  });
});

// ── checkHumanGateApprovals unit (no human gates = trivially ok) ──

describe('checkHumanGateApprovals — no human gates', () => {
  it('returns true when packet has no human gates', () => {
    const packet = parsePacket(tier1(''));
    const issues: any[] = [];
    expect(checkHumanGateApprovals(packet, [], issues)).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
