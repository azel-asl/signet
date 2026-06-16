// Signet v0.2 tests — verifier hardening + XAS-MEM usage memory.
// Governed by packet signet-v02-build-001 (TASK_007).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePacket } from '../src/parser.js';
import { govern } from '../src/runtime.js';
import { verifyReceipt, checkAlignment } from '../src/verify.js';
import {
  recordRun, priorRuns, recentRuns, scoreFromReceipt, lessonsFromReceipt, usageEntry,
} from '../src/xas-memory.js';

// node:sqlite via getBuiltinModule — Vite's transform predates the builtin
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const DEMO = readFileSync(resolve(__dirname, '../examples/runtime-lock.packet.md'), 'utf-8');
const receipt = govern(parsePacket(DEMO)).receipt;
const receiptJson = JSON.stringify(receipt);

// ── verifier hardening (TASK_002) ────────────────────────────

describe('v0.2 verifier: UNSIGNED reporting and explanations', () => {
  it('PASS result reports signed_state UNSIGNED with honest explanation', () => {
    const v = verifyReceipt(receiptJson);
    expect(v.status).toBe('PASS');
    expect(v.signed).toBe(false);
    expect(v.signed_state).toBe('UNSIGNED');
    expect(v.explanation).toContain('UNSIGNED');
    expect(v.explanation).toContain('not');           // "...not authority-certified..."
    expect(v.explanation).not.toContain('tamper-proof');
  });

  it('signature present but uncheckable → SIGNATURE_PRESENT_UNVERIFIABLE, still PASS', () => {
    // signature is excluded from both hashes, so adding one does not break them
    const withSig = { ...JSON.parse(receiptJson), signature: 'ed25519:deadbeef' };
    const v = verifyReceipt(JSON.stringify(withSig));
    expect(v.status).toBe('PASS');
    expect(v.signed_state).toBe('SIGNATURE_PRESENT_UNVERIFIABLE');
    expect(v.failures.some(f => f.includes('cannot check signatures'))).toBe(true);
  });

  it('invalid JSON → ERROR with actionable message', () => {
    const v = verifyReceipt('not json{');
    expect(v.status).toBe('ERROR');
    expect(v.failures[0]).toContain('not valid JSON');
    expect(v.failures[0]).toContain('signet run');     // points at the producing command
    expect(v.explanation.length).toBeGreaterThan(10);
  });

  it('tampered verdict → FAIL with both stored and recomputed hash prefixes shown', () => {
    const tampered = { ...JSON.parse(receiptJson), verdict: 'complete' };
    const v = verifyReceipt(JSON.stringify(tampered));
    expect(v.status).toBe('FAIL');
    expect(v.failures[0]).toContain('TAMPERED');
    expect(v.failures[0]).toContain('Stored');
    expect(v.failures[0]).toContain('recomputed');
  });

  it('unknown version → FAIL naming the only understood version', () => {
    const wrong = { ...JSON.parse(receiptJson), receipt_version: 'v999' };
    const v = verifyReceipt(JSON.stringify(wrong));
    expect(v.status).toBe('FAIL');
    expect(v.failures[0]).toContain('signet-receipt-v1');
  });
});

// ── structural alignment (TASK_002) ──────────────────────────

describe('v0.2 verifier: packet-to-receipt structural alignment', () => {
  const declared = {
    packet_id: receipt.packet.id,
    task_count: receipt.summary.tasks_total,
    lock_count: receipt.ledger_crosscheck.observed.lock_count,
    gate_count: receipt.ledger_crosscheck.observed.gate_count,
    acceptance_test_count: receipt.ledger_crosscheck.observed.acceptance_test_count,
  };

  it('matching packet aligns on all five checks', () => {
    const a = checkAlignment(receiptJson, declared);
    expect(a.aligned).toBe(true);
    expect(a.checks.packet_id_ok).toBe(true);
    expect(a.checks.task_count_ok).toBe(true);
    expect(a.checks.lock_count_ok).toBe(true);
    expect(a.mismatches).toHaveLength(0);
  });

  it('always carries the honest scope note — counts, not semantic truth', () => {
    const a = checkAlignment(receiptJson, declared);
    expect(a.note).toContain('ids and counts only');
    expect(a.note).toContain('does not prove');
  });

  it('wrong packet_id → named mismatch with both values', () => {
    const a = checkAlignment(receiptJson, { ...declared, packet_id: 'some-other-packet' });
    expect(a.aligned).toBe(false);
    expect(a.mismatches[0]).toContain('some-other-packet');
    expect(a.mismatches[0]).toContain(receipt.packet.id);
  });

  it('wrong task_count → named mismatch', () => {
    const a = checkAlignment(receiptJson, { ...declared, task_count: declared.task_count + 5 });
    expect(a.aligned).toBe(false);
    expect(a.mismatches.some(m => m.includes('task count mismatch'))).toBe(true);
  });

  it('optional counts are skipped (null) when not declared', () => {
    const a = checkAlignment(receiptJson, {
      packet_id: declared.packet_id,
      task_count: declared.task_count,
      lock_count: declared.lock_count,
    });
    expect(a.aligned).toBe(true);
    expect(a.checks.gate_count_ok).toBeNull();
    expect(a.checks.acceptance_test_count_ok).toBeNull();
  });

  it('unparseable receipt → not aligned, explains why', () => {
    const a = checkAlignment('garbage', declared);
    expect(a.aligned).toBe(false);
    expect(a.mismatches[0]).toContain('not valid JSON');
  });
});

// ── XAS-MEM (TASK_005, LOCK_005, AT_005) ─────────────────────

describe('v0.2 XAS-MEM: minimal run memory', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'xas-mem-test-'));
    process.env['SIGNET_DATA_DIR'] = tmp;
  });

  afterAll(() => {
    delete process.env['SIGNET_DATA_DIR'];
    rmSync(tmp, { recursive: true, force: true });
  });

  it('recordRun writes a row; priorRuns and recentRuns read it back', () => {
    const row = recordRun(receipt, '/tmp/some-receipt.json');
    expect(row.handle).toContain(receipt.packet.id);
    expect(row.verdict).toBe(receipt.verdict);

    const prior = priorRuns(receipt.packet.id);
    expect(prior.length).toBeGreaterThan(0);
    expect(prior[0].packet_id).toBe(receipt.packet.id);
    expect(prior[0].receipt_path).toBe('/tmp/some-receipt.json');

    const recent = recentRuns(5);
    expect(recent.some(r => r.handle === row.handle)).toBe(true);
  });

  it('schema is exactly 7 columns with the locked names (LOCK_005 / AT_005)', () => {
    expect(existsSync(join(tmp, 'xas_mem.db'))).toBe(true);
    const db = new DatabaseSync(join(tmp, 'xas_mem.db'));
    const cols = db.prepare(`PRAGMA table_info(xas_mem)`).all() as Array<{ name: string }>;
    db.close();
    expect(cols.map(c => c.name)).toEqual([
      'handle', 'packet_id', 'receipt_path', 'verdict',
      'alignment_score', 'lessons', 'created_at',
    ]);
  });

  it('no extra tables beyond xas_mem (no authority signing, no tag tables)', () => {
    const db = new DatabaseSync(join(tmp, 'xas_mem.db'));
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    ).all() as Array<{ name: string }>;
    db.close();
    expect(tables.map(t => t.name)).toEqual(['xas_mem']);
  });

  it('alignment score = passed/(gates+ATs) × 10, per packet contract', () => {
    // demo receipt: GATE_001 PASS + AT_001 PASS → 2/2 → 10
    expect(scoreFromReceipt(receipt)).toBe(10);

    const unevaluated = {
      ...receipt,
      acceptance_results: [{ ...receipt.acceptance_results[0], result: 'UNEVALUATED' as const }],
    };
    // 1 PASS of 2 checks → 5
    expect(scoreFromReceipt(unevaluated)).toBe(5);
  });

  it('lessons capture fired blocks honestly', () => {
    const lessons = lessonsFromReceipt(receipt);
    // demo packet fires LOCK_001 on .env
    expect(lessons).toContain('LOCK_001');
    expect(lessons).toContain('.env');
  });
});

// ── SIGNET-USAGE.md (TASK_003, AT_004) ───────────────────────

const NINE_FIELDS = [
  'Date', 'Packet name', 'Action', 'Result', 'Alignment score',
  'Significance', 'Time spent', 'Receipt path', 'Notes / drift / blockers',
];

describe('v0.2 SIGNET-USAGE.md', () => {
  it('template documents all 9 required fields (AT_004)', () => {
    const usage = readFileSync(resolve(__dirname, '../SIGNET-USAGE.example.md'), 'utf-8');
    for (const field of NINE_FIELDS) expect(usage).toContain(field);
  });

  it('auto-generated entries contain all 9 fields', () => {
    const row = {
      handle: 'demo-20260611-abcd', packet_id: 'demo', receipt_path: 'r.json',
      verdict: 'warned', alignment_score: 10, lessons: '1 block(s) fired',
      created_at: '2026-06-11T00:00:00Z',
    };
    const entry = usageEntry(row);
    for (const field of NINE_FIELDS) expect(entry).toContain(field);
    expect(entry).toContain('10/10');
  });
});
