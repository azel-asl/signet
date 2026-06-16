import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { parsePacket, parseDriftMarkers } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { validateDrift } from '../src/drift.js';
import { crossCheckLedger } from '../src/ledger.js';
import { validateLedger, isFakeChecksum, parseLedgerVerificationBlock, checkLedgerCountCrossCheck } from '../src/ledger-validator.js';
import { formatJson } from '../src/reporter.js';
import type { DriftMarker, ParsedPacket } from '../src/types.js';

// ─────────────────────────────────────────────────────────────
// Helper: build a minimal parsed packet with executionPlan
// ─────────────────────────────────────────────────────────────

function makePacket(taskCount: number, required: boolean[] = []): ParsedPacket {
  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    id: `TASK_${String(i + 1).padStart(3, '0')}`,
    description: `Task ${i + 1}`,
    required: required[i] ?? true,
    depends_on: [],
    on_dependency_fail: 'HALT' as const,
    retry_max: 0,
    retry_backoff: 'none',
    on_retry_exhausted: 'HALT',
    evidence_type: 'file_write' as const,
    evidence_template: 'path: src/out.ts | checksum: abc',
    expected_result: 'done',
    status: 'PENDING' as const,
  }));

  return {
    raw: '',
    aslBlocks: {},
    gclBlocks: {},
    parserIssues: [],
    locks: [],
    gates: [],
    acceptanceTests: null,
    driftMarkers: [],
    executionPlan: {
      task_count: taskCount,
      tasks,
    },
  };
}

function makeMarker(
  taskId: string,
  status: string = 'COMPLETE',
  evidenceType: string = 'file_write',
  evidenceRef: string = 'path: src/out.ts'
): DriftMarker {
  return {
    task_id: taskId,
    status: status as any,
    evidence_type: evidenceType as any,
    evidence_ref: evidenceRef,
    raw: `[${taskId}: ${status} | evidence_type: ${evidenceType} | evidence_ref: ${evidenceRef}]`,
    line_number: 1,
  };
}

// ─────────────────────────────────────────────────────────────
// AT_010 — Dogfood: Phase 2 packet + Phase 2 ledger
// TASK_013
// ─────────────────────────────────────────────────────────────

describe('dogfood: Phase 2 packet + ledger (AT_010)', () => {

  it('validates phase2-hardening-packet.md with phase2-hardening-ledger.md — expect PASS', () => {
    const packetPath = resolve('examples/ledger-pair-valid.packet.md');
    const ledgerPath = resolve('examples/ledger-pair-valid.ledger.md');

    const rawPacket = readFileSync(packetPath, 'utf-8');
    const rawLedger = readFileSync(ledgerPath, 'utf-8');

    const packet  = parsePacket(rawPacket);
    const markers = parseDriftMarkers(rawLedger);
    const result  = validateLedger(packet, markers, ledgerPath);

    expect(result.ledger_marker_count).toBe(8);
    expect(result.packet_task_count).toBe(8);
    expect(result.checks.task_count_matches).toBe(true);
    expect(result.checks.no_duplicate_markers).toBe(true);
    expect(result.checks.marker_ids_contiguous).toBe(true);
    expect(result.checks.required_tasks_complete).toBe(true);
    expect(result.summary.errors).toBe(0);
    expect(result.valid).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// TASK_014 — Ledger structural checks
// ─────────────────────────────────────────────────────────────

describe('ledger structural checks (TASK_014)', () => {

  it('LED_001: task count mismatch — ledger has fewer markers than packet declares', () => {
    const packet  = makePacket(3);
    const markers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_002'),
      // TASK_003 missing
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.checks.task_count_matches).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_001')).toBe(true);
  });

  it('LED_001: task count mismatch — ledger has more markers than packet declares', () => {
    const packet  = makePacket(2);
    const markers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_002'),
      makeMarker('TASK_003'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.checks.task_count_matches).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_001')).toBe(true);
  });

  it('LED_002: duplicate marker IDs flagged', () => {
    const packet  = makePacket(2);
    const markers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_001'), // duplicate
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.checks.no_duplicate_markers).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_002')).toBe(true);
  });

  it('LED_003: non-contiguous marker IDs flagged', () => {
    const packet  = makePacket(3);
    const markers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_003'), // TASK_002 missing → gap
      makeMarker('TASK_002'), // even if present later, gap detected in sorted order check
    ];
    // Replace with a true gap: 001, 003 (002 missing entirely)
    const gapMarkers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_003'),
      makeMarker('TASK_004'),
    ];
    const gapPacket = makePacket(3);
    // Force task_count to match marker count so LED_001 doesn't fire
    gapPacket.executionPlan!.task_count = 3;

    const result = validateLedger(gapPacket, gapMarkers, 'test-ledger.md');

    expect(result.checks.marker_ids_contiguous).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_003')).toBe(true);
  });

  it('passes when count matches and all IDs are contiguous', () => {
    const packet  = makePacket(3);
    const markers = [
      makeMarker('TASK_001'),
      makeMarker('TASK_002'),
      makeMarker('TASK_003'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.checks.task_count_matches).toBe(true);
    expect(result.checks.no_duplicate_markers).toBe(true);
    expect(result.checks.marker_ids_contiguous).toBe(true);
    expect(result.summary.errors).toBe(0);
    expect(result.valid).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// TASK_015 — Required task status validation
// ─────────────────────────────────────────────────────────────

describe('required task status checks (TASK_015)', () => {

  it('LED_004: required task with no ledger marker → error', () => {
    const packet  = makePacket(2, [true, true]);
    const markers = [makeMarker('TASK_001')]; // TASK_002 missing
    // Override task_count so we get LED_004 not LED_001
    packet.executionPlan!.task_count = 1;

    const result = validateLedger(packet, markers, 'test-ledger.md');
    expect(result.issues.some(i => i.code === 'LED_004')).toBe(true);
  });

  it('LED_005: required task with FAILED status → error', () => {
    const packet  = makePacket(2, [true, true]);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'FAILED'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_005' && i.location === 'TASK_002')).toBe(true);
  });

  it('LED_005: required task with SKIPPED status → error', () => {
    const packet  = makePacket(2, [true, true]);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'SKIPPED'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_005')).toBe(true);
  });

  it('LED_005: required task with BLOCKED status → error', () => {
    const packet  = makePacket(1, [true]);
    const markers = [makeMarker('TASK_001', 'BLOCKED')];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_005')).toBe(true);
  });

  it('LED_006: RETRYING task when all others are at final status → error', () => {
    const packet  = makePacket(3);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'COMPLETE'),
      makeMarker('TASK_003', 'RETRYING'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.valid).toBe(false);
    expect(result.checks.no_retrying_at_completion).toBe(false);
    expect(result.issues.some(i => i.code === 'LED_006')).toBe(true);
  });

  it('non-required task can have SKIPPED status without LED_005', () => {
    const packet  = makePacket(2, [true, false]); // TASK_002 not required
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'SKIPPED'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    expect(result.issues.some(i => i.code === 'LED_005')).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('RETRYING task with another still-in-progress task is allowed', () => {
    const packet  = makePacket(3);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'RETRYING'),
      makeMarker('TASK_003', 'PENDING' as any), // not final
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    // LED_006 should NOT fire because TASK_003 is not at a final status
    expect(result.issues.some(i => i.code === 'LED_006')).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────
// TASK_016 — Fake checksum + SHA256 validation
// ─────────────────────────────────────────────────────────────

describe('fake checksum detection (TASK_016)', () => {

  it('isFakeChecksum returns true for known placeholder words', () => {
    const fakes = ['reviewed', 'updated', 'created', 'changed', 'new',
      'modified', 'added', 'none', 'tbd', 'todo', 'placeholder',
      'n/a', 'na', 'actual', 'computed', 'hash', 'sha256',
      'checksum', 'pending'];
    for (const f of fakes) {
      expect(isFakeChecksum(f)).toBe(true);
      expect(isFakeChecksum(f.toUpperCase())).toBe(true);
    }
  });

  it('isFakeChecksum returns false for a real hex string', () => {
    expect(isFakeChecksum('a1b2c3d4e5f60123')).toBe(false);
    expect(isFakeChecksum('deadbeef')).toBe(false);
  });

  it('LED_009: fake checksum on non-existent file → warning (not error)', () => {
    const packet  = makePacket(1);
    const markers = [{
      ...makeMarker('TASK_001', 'COMPLETE', 'file_write', 'path: /nonexistent/file.ts | checksum: reviewed'),
    }];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    const warn = result.issues.find(i => i.code === 'LED_009');
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('warning');
    // Should still be valid (it's a warning, not an error)
    expect(result.valid).toBe(true);
  });

  it('LED_010: file exists but no checksum declared → warning', () => {
    // Use a file we know exists — package.json
    const packet  = makePacket(1);
    const markers = [{
      ...makeMarker('TASK_001', 'COMPLETE', 'file_write', 'path: package.json'),
    }];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    // LED_010: file exists but no checksum declared
    const warn = result.issues.find(i => i.code === 'LED_010');
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('warning');
  });

  it('passes when no checksums declared and no file references', () => {
    const packet  = makePacket(2);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE', 'command_output', 'command: npm test | exit_code: 0 | summary: pass'),
      makeMarker('TASK_002', 'COMPLETE', 'human_confirmation', 'confirmed by erwin@asllabs.io'),
    ];
    const result = validateLedger(packet, markers, 'test-ledger.md');

    // No checksum issues expected
    expect(result.issues.filter(i => ['LED_008','LED_009','LED_010','LED_011'].includes(i.code)).length).toBe(0);
    expect(result.valid).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// LED summary fields
// ─────────────────────────────────────────────────────────────

describe('ledger result shape', () => {

  it('returns correct summary counts', () => {
    const packet  = makePacket(2, [true, false]);
    const markers = [
      makeMarker('TASK_001', 'COMPLETE'),
      makeMarker('TASK_002', 'SKIPPED'),
    ];
    const result = validateLedger(packet, markers, 'my-ledger.md');

    expect(result.ledger_file).toBe('my-ledger.md');
    expect(result.packet_task_count).toBe(2);
    expect(result.ledger_marker_count).toBe(2);
    expect(result.summary).toMatchObject({ errors: 0, warnings: 0, info: 0 });
    expect(result.valid).toBe(true);
  });

  it('evidence_validation stats are present', () => {
    const packet  = makePacket(1);
    const markers = [makeMarker('TASK_001')];
    const result = validateLedger(packet, markers, 'test.md');

    expect(result.evidence_validation).toMatchObject({
      total: expect.any(Number),
      validated: expect.any(Number),
      failed: expect.any(Number),
      skipped: expect.any(Number),
    });
  });

  it('Phase 4: ledger_count_crosscheck field always present in result', () => {
    const packet  = makePacket(1);
    const markers = [makeMarker('TASK_001')];
    const result  = validateLedger(packet, markers, 'test.md');

    expect(result.ledger_count_crosscheck).toBeDefined();
    expect(result.ledger_count_crosscheck).toHaveProperty('valid');
    expect(result.ledger_count_crosscheck).toHaveProperty('packet_declared');
    expect(result.ledger_count_crosscheck).toHaveProperty('ledger_reported');
    expect(result.ledger_count_crosscheck).toHaveProperty('matches');
    expect(result.ledger_count_crosscheck).toHaveProperty('block_absent');
  });

});

// ═════════════════════════════════════════════════════════════
// Phase 4 — Ledger Count Cross-Check (TASK_011–012)
// ═════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// parseLedgerVerificationBlock unit tests
// ─────────────────────────────────────────────────────────────

describe('parseLedgerVerificationBlock', () => {

  it('returns null when no ::VERIFICATION_LEDGER block in text', () => {
    const raw = '# Ledger\n\nSome content without a verification block.\n';
    expect(parseLedgerVerificationBlock(raw)).toBeNull();
  });

  it('parses all five count fields from a ::VERIFICATION_LEDGER block', () => {
    const raw = `
# Ledger

::VERIFICATION_LEDGER
required_task_count = 8
required_gate_count = 6
required_lock_count = 5
required_acceptance_test_count = 5
required_receipt_count = 1
ledger_status = "COMPLETE"
::END
`;
    const result = parseLedgerVerificationBlock(raw);
    expect(result).not.toBeNull();
    expect(result?.required_task_count).toBe(8);
    expect(result?.required_gate_count).toBe(6);
    expect(result?.required_lock_count).toBe(5);
    expect(result?.required_acceptance_test_count).toBe(5);
    expect(result?.required_receipt_count).toBe(1);
  });

  it('returns null fields for missing keys inside block', () => {
    const raw = `
::VERIFICATION_LEDGER
required_task_count = 3
::END
`;
    const result = parseLedgerVerificationBlock(raw);
    expect(result?.required_task_count).toBe(3);
    expect(result?.required_gate_count).toBeNull();
    expect(result?.required_lock_count).toBeNull();
    expect(result?.required_acceptance_test_count).toBeNull();
    expect(result?.required_receipt_count).toBeNull();
  });

});

// ─────────────────────────────────────────────────────────────
// AT_003–007: Per-field count mismatch tests (TASK_011)
// ─────────────────────────────────────────────────────────────

function makePacketWithVL(opts: {
  tasks?: number; gates?: number; locks?: number; ats?: number; receipts?: number;
}): ParsedPacket {
  const n = opts.tasks ?? 1;
  const packet = makePacket(n);
  packet.verificationLedger = {
    required_task_count:            opts.tasks    ?? 1,
    required_gate_count:            opts.gates    ?? 0,
    required_lock_count:            opts.locks    ?? 0,
    required_acceptance_test_count: opts.ats      ?? 0,
    required_receipt_count:         opts.receipts ?? 1,
    ledger_status: 'PENDING',
  };
  return packet;
}

function makeLedgerRaw(opts: {
  tasks?: number; gates?: number; locks?: number; ats?: number; receipts?: number;
}): string {
  return `
::VERIFICATION_LEDGER
required_task_count = ${opts.tasks ?? 1}
required_gate_count = ${opts.gates ?? 0}
required_lock_count = ${opts.locks ?? 0}
required_acceptance_test_count = ${opts.ats ?? 0}
required_receipt_count = ${opts.receipts ?? 1}
ledger_status = "COMPLETE"
::END
`;
}

describe('AT_003: required_task_count ledger mismatch (LED_012)', () => {

  it('LED_012 fires when ledger reports different task count than packet declares', () => {
    const packet = makePacketWithVL({ tasks: 5, gates: 2, locks: 2, ats: 3, receipts: 1 });
    const raw    = makeLedgerRaw({   tasks: 9, gates: 2, locks: 2, ats: 3, receipts: 1 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.task_count).toBe(false);
    expect(result.valid).toBe(false);
    expect(issues.some((i: any) => i.code === 'LED_012')).toBe(true);
  });

  it('no LED_012 when task counts match', () => {
    const packet = makePacketWithVL({ tasks: 3 });
    const raw    = makeLedgerRaw({   tasks: 3 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.task_count).toBe(true);
    expect(issues.some((i: any) => i.code === 'LED_012')).toBe(false);
  });

});

describe('AT_004: required_gate_count ledger mismatch (LED_013)', () => {

  it('LED_013 fires when ledger reports different gate count than packet declares', () => {
    const packet = makePacketWithVL({ tasks: 3, gates: 7, locks: 2, ats: 5, receipts: 1 });
    const raw    = makeLedgerRaw({   tasks: 3, gates: 0, locks: 2, ats: 5, receipts: 1 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.gate_count).toBe(false);
    expect(result.valid).toBe(false);
    expect(issues.some((i: any) => i.code === 'LED_013')).toBe(true);
  });

  it('no LED_013 when gate counts match', () => {
    const packet = makePacketWithVL({ gates: 6 });
    const raw    = makeLedgerRaw({   gates: 6 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.gate_count).toBe(true);
    expect(issues.some((i: any) => i.code === 'LED_013')).toBe(false);
  });

});

describe('AT_005: required_lock_count ledger mismatch (LED_014)', () => {

  it('LED_014 fires when ledger reports different lock count than packet declares', () => {
    const packet = makePacketWithVL({ tasks: 3, gates: 2, locks: 5, ats: 3, receipts: 1 });
    const raw    = makeLedgerRaw({   tasks: 3, gates: 2, locks: 2, ats: 3, receipts: 1 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.lock_count).toBe(false);
    expect(result.valid).toBe(false);
    expect(issues.some((i: any) => i.code === 'LED_014')).toBe(true);
  });

  it('no LED_014 when lock counts match', () => {
    const packet = makePacketWithVL({ locks: 3 });
    const raw    = makeLedgerRaw({   locks: 3 });
    const issues: any[] = [];
    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.lock_count).toBe(true);
    expect(issues.some((i: any) => i.code === 'LED_014')).toBe(false);
  });

});

describe('AT_006: required_acceptance_test_count ledger mismatch (LED_015)', () => {

  it('LED_015 fires when ledger reports different AT count than packet declares', () => {
    const packet = makePacketWithVL({ tasks: 3, gates: 2, locks: 2, ats: 12, receipts: 1 });
    const raw    = makeLedgerRaw({   tasks: 3, gates: 2, locks: 2, ats: 3,  receipts: 1 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.acceptance_test_count).toBe(false);
    expect(result.valid).toBe(false);
    expect(issues.some((i: any) => i.code === 'LED_015')).toBe(true);
  });

  it('no LED_015 when AT counts match', () => {
    const packet = makePacketWithVL({ ats: 5 });
    const raw    = makeLedgerRaw({   ats: 5 });
    const issues: any[] = [];
    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.acceptance_test_count).toBe(true);
    expect(issues.some((i: any) => i.code === 'LED_015')).toBe(false);
  });

});

describe('AT_007: required_receipt_count ledger mismatch (LED_016)', () => {

  it('LED_016 fires when ledger reports different receipt count than packet declares', () => {
    const packet = makePacketWithVL({ tasks: 3, gates: 2, locks: 2, ats: 3, receipts: 2 });
    const raw    = makeLedgerRaw({   tasks: 3, gates: 2, locks: 2, ats: 3, receipts: 0 });
    const issues: any[] = [];

    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.receipt_count).toBe(false);
    expect(result.valid).toBe(false);
    expect(issues.some((i: any) => i.code === 'LED_016')).toBe(true);
  });

  it('no LED_016 when receipt counts match', () => {
    const packet = makePacketWithVL({ receipts: 1 });
    const raw    = makeLedgerRaw({   receipts: 1 });
    const issues: any[] = [];
    const result = checkLedgerCountCrossCheck(packet, raw, issues);
    expect(result.matches.receipt_count).toBe(true);
    expect(issues.some((i: any) => i.code === 'LED_016')).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────
// AT_008: Phase 3 mismatch regression (TASK_012)
// Packet: gate_count=7, AT_count=12 — Ledger: gate_count=0, AT_count=3
// ─────────────────────────────────────────────────────────────

describe('AT_008: Phase 3 mismatch regression (TASK_012)', () => {

  it('phase3-style drift fixture fails with LED_013 + LED_015', () => {
    const packetPath  = resolve('examples/tier2-valid-build.md');
    const ledgerPath  = resolve('examples/invalid-ledger-count-drift.md');
    const rawPacket   = readFileSync(packetPath, 'utf-8');
    const rawLedger   = readFileSync(ledgerPath, 'utf-8');

    const packet  = parsePacket(rawPacket);
    const markers = parseDriftMarkers(rawLedger);

    // Temporarily override the packet's verificationLedger to simulate gate_count=7, AT_count=12
    packet.verificationLedger = {
      required_task_count:            3,
      required_gate_count:            7,   // declared 7
      required_lock_count:            2,
      required_acceptance_test_count: 12,  // declared 12
      required_receipt_count:         1,
      ledger_status: 'PENDING',
    };

    const result = validateLedger(packet, markers, ledgerPath, rawLedger);

    // Ledger reports gate_count=0, AT_count=3 — both should fail
    expect(result.ledger_count_crosscheck.valid).toBe(false);
    expect(result.ledger_count_crosscheck.matches.gate_count).toBe(false);
    expect(result.ledger_count_crosscheck.matches.acceptance_test_count).toBe(false);

    const issues = result.issues;
    expect(issues.some(i => i.code === 'LED_013')).toBe(true); // gate_count
    expect(issues.some(i => i.code === 'LED_015')).toBe(true); // AT_count
    expect(result.valid).toBe(false);
  });

  it('LED_017: ledger without ::VERIFICATION_LEDGER block triggers warning, not error', () => {
    const packet  = makePacketWithVL({ tasks: 3, gates: 2, locks: 2, ats: 1, receipts: 1 });
    const markers = [
      makeMarker('TASK_001'), makeMarker('TASK_002'), makeMarker('TASK_003'),
    ];
    const rawLedger = '# Ledger without a verification block\n\nSome content here.\n';

    const result = validateLedger(packet, markers, 'no-vl-ledger.md', rawLedger);
    expect(result.ledger_count_crosscheck.block_absent).toBe(true);
    expect(result.ledger_count_crosscheck.valid).toBe(true); // absent = skip, not fail
    expect(result.issues.some(i => i.code === 'LED_017')).toBe(true);
    expect(result.issues.find(i => i.code === 'LED_017')?.severity).toBe('warning');
    // Overall still valid (missing block is warning, not error)
    expect(result.valid).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// AT_009: JSON output includes ledger_count_crosscheck (TASK_009)
// ─────────────────────────────────────────────────────────────

describe('AT_009: JSON output includes ledger_count_crosscheck', () => {

  it('formatJson output contains ledger_count_crosscheck when ledger provided', () => {
    const packetPath = resolve('examples/tier2-valid-build.md');
    const ledgerPath = resolve('examples/valid-ledger.md');
    const rawPacket  = readFileSync(packetPath, 'utf-8');
    const rawLedger  = readFileSync(ledgerPath, 'utf-8');

    const packet  = parsePacket(rawPacket);
    const result  = validate(packet);
    validateDrift(packet, result);
    crossCheckLedger(packet, result);
    result.valid = result.summary.errors === 0;

    const markers     = parseDriftMarkers(rawLedger);
    const ledgerResult = validateLedger(packet, markers, ledgerPath, rawLedger);

    const json = JSON.parse(formatJson(result, packetPath, ledgerResult));
    expect(json.ledger_validation).toBeDefined();
    expect(json.ledger_validation.ledger_count_crosscheck).toBeDefined();
    expect(json.ledger_validation.ledger_count_crosscheck).toHaveProperty('valid');
    expect(json.ledger_validation.ledger_count_crosscheck).toHaveProperty('packet_declared');
    expect(json.ledger_validation.ledger_count_crosscheck).toHaveProperty('ledger_reported');
    expect(json.ledger_validation.ledger_count_crosscheck).toHaveProperty('matches');
  });

});

// ─────────────────────────────────────────────────────────────
// AT_010: Full dogfood with ::VERIFICATION_LEDGER in ledger
// ─────────────────────────────────────────────────────────────

describe('AT_010 Phase 4: dogfood packet + ledger with ::VERIFICATION_LEDGER block', () => {

  it('phase2 dogfood pair with VL block — all counts match, PASS', () => {
    const packetPath = resolve('examples/ledger-pair-valid.packet.md');
    const ledgerPath = resolve('examples/ledger-pair-valid.ledger.md');
    const rawPacket  = readFileSync(packetPath, 'utf-8');
    const rawLedger  = readFileSync(ledgerPath, 'utf-8');

    const packet  = parsePacket(rawPacket);
    const markers = parseDriftMarkers(rawLedger);
    const result  = validateLedger(packet, markers, ledgerPath, rawLedger);

    expect(result.ledger_count_crosscheck.block_absent).toBe(false);
    expect(result.ledger_count_crosscheck.valid).toBe(true);
    expect(result.ledger_count_crosscheck.matches.task_count).toBe(true);
    expect(result.ledger_count_crosscheck.matches.gate_count).toBe(true);
    expect(result.ledger_count_crosscheck.matches.lock_count).toBe(true);
    expect(result.ledger_count_crosscheck.matches.acceptance_test_count).toBe(true);
    expect(result.ledger_count_crosscheck.matches.receipt_count).toBe(true);

    // No LED_012-016 errors
    const crossCheckErrors = result.issues.filter(i =>
      ['LED_012','LED_013','LED_014','LED_015','LED_016'].includes(i.code)
    );
    expect(crossCheckErrors).toHaveLength(0);
    expect(result.checks.ledger_count_crosscheck_valid).toBe(true);
  });

});
