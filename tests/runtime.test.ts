// Signet v0.1 governance runtime tests — the 12 spec scenarios (§9).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePacket } from '../src/parser.js';
import { govern, GovernanceError, deriveActions, evaluateAction, buildForbiddenSet } from '../src/runtime.js';
import { verifyReceipt } from '../src/verify.js';

const DEMO = readFileSync(resolve(__dirname, '../examples/runtime-lock.packet.md'), 'utf-8');

function fixedClock(start = '2026-06-10T00:00:00Z'): () => Date {
  let calls = 0;
  return () => new Date(new Date(start).getTime() + (calls++) * 1000);
}

/** Patch the demo packet text with simple replacements. */
function variant(replacements: Array<[string | RegExp, string]>): string {
  let out = DEMO;
  for (const [from, to] of replacements) out = out.replace(from, to);
  return out;
}

describe('1. demo packet end-to-end', () => {
  const result = govern(parsePacket(DEMO), { now: fixedClock() });
  const r = result.receipt;

  it('2 COMPLETE, 1 BLOCKED', () => {
    expect(r.summary.tasks_complete).toBe(2);
    expect(r.summary.tasks_blocked).toBe(1);
    const t3 = r.task_results.find(t => t.task_id === 'TASK_003')!;
    expect(t3.status).toBe('BLOCKED');
  });

  it('block attributed to LOCK_001 with matched_pattern ".env"', () => {
    expect(r.block_events.length).toBeGreaterThan(0);
    for (const b of r.block_events) {
      expect(b.lock_id).toBe('LOCK_001');
      expect(b.matched_pattern).toBe('.env');
      expect(b.attribution).toBe('rule_token');
      expect(b.task_id).toBe('TASK_003');
    }
  });

  it('GATE_001 PASS via dependency_order, AT_001 PASS via scope_containment', () => {
    expect(r.gate_results[0]).toMatchObject({ gate_id: 'GATE_001', result: 'PASS', method: 'dependency_order' });
    expect(r.acceptance_results[0]).toMatchObject({ at_id: 'AT_001', result: 'PASS', method: 'scope_containment' });
  });

  it('behavioral LOCK_002 inherits AT_001 PASS', () => {
    expect(r.behavioral_reports[0]).toMatchObject({
      lock_id: 'LOCK_002', verified_by: 'acceptance_test', result: 'PASS',
    });
  });

  it('verdict PASS (TASK_003 non-required), receipt verdict "warned"', () => {
    expect(result.verdict).toBe('PASS');
    expect(r.verdict).toBe('warned');
    expect(r.outcome).toBe('passed');
  });

  it('ledger crosscheck matches', () => {
    expect(r.ledger_crosscheck.matches).toBe(true);
  });
});

describe('2. required task blocked → verdict FAIL', () => {
  it('TASK_003 required=true → FAIL, receipt verdict "blocked"', () => {
    const raw = variant([
      [/description = "Write API key to \.env file\."\n  required = false/,
       'description = "Write API key to .env file."\n  required = true'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    expect(result.verdict).toBe('FAIL');
    expect(result.receipt.verdict).toBe('blocked');
    expect(result.receipt.outcome).toBe('failed');
  });
});

describe('3. dependency HALT propagation', () => {
  it('blocked dep → dependent BLOCKED via dependency check, note names dep', () => {
    // Make TASK_001 itself violate a lock (read .env) so TASK_002/003 lose their dep
    const raw = variant([
      ['description = "Read ./src/index.ts and extract summary."',
       'description = "Read .env and extract summary."'],
      ['expected_result = "src/index.ts contents read successfully."',
       'expected_result = "contents read successfully."'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const t1 = result.receipt.task_results.find(t => t.task_id === 'TASK_001')!;
    const t2 = result.receipt.task_results.find(t => t.task_id === 'TASK_002')!;
    expect(t1.status).toBe('BLOCKED');
    expect(t1.blocked_by).toContain('LOCK_001');
    expect(t2.status).toBe('BLOCKED');
    expect(t2.note).toContain('TASK_001');
    expect(result.verdict).toBe('FAIL'); // TASK_001/002 are required
  });
});

describe('4. SKIP path', () => {
  it('non-required task with failed dep + SKIP → SKIPPED, verdict unaffected', () => {
    // TASK_003 depends on TASK_001; make TASK_003 dep on a task we block.
    // Simpler: flip TASK_003 to depend on itself failing — instead make
    // TASK_003 SKIP when its dep fails, and block its dep via lock.
    const raw = variant([
      // TASK_002 becomes the violator (write credentials), TASK_003 depends on it with SKIP
      ['description = "Write summary to ./output/result.json."',
       'description = "Write secrets to ./output/credentials.json."'],
      ['expected_result = "./output/result.json written."',
       'expected_result = "./output/credentials.json written."'],
      // TASK_002 must be non-required for run to still PASS… keep required and expect FAIL
      // TASK_003: dep on TASK_002, SKIP, and remove its own violation
      [/TASK_003:\n  description = "Write API key to \.env file\."\n  required = false\n  depends_on = \["TASK_001"\]\n  on_dependency_fail = "HALT"/,
       'TASK_003:\n  description = "Write log to ./output/log.txt."\n  required = false\n  depends_on = ["TASK_002"]\n  on_dependency_fail = "SKIP"'],
      ['expected_result = ".env written with API_KEY."',
       'expected_result = "./output/log.txt written."'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const t3 = result.receipt.task_results.find(t => t.task_id === 'TASK_003')!;
    expect(t3.status).toBe('SKIPPED');
    expect(t3.note).toContain('TASK_002');
    // verdict FAIL is from required TASK_002 being blocked — not from the skip
    expect(result.verdict).toBe('FAIL');
  });
});

describe('5. RETRY in simulation → exhausted → BLOCKED', () => {
  it('RETRY dep-fail behaves as exhausted', () => {
    const raw = variant([
      ['description = "Read ./src/index.ts and extract summary."',
       'description = "Read .env and extract summary."'],
      ['expected_result = "src/index.ts contents read successfully."',
       'expected_result = "contents read."'],
      [/TASK_002:\n  description = "([^"]+)"\n  required = true\n  depends_on = \["TASK_001"\]\n  on_dependency_fail = "HALT"\n  retry_max = 0/,
       'TASK_002:\n  description = "$1"\n  required = true\n  depends_on = ["TASK_001"]\n  on_dependency_fail = "RETRY"\n  retry_max = 2'],
      [/(TASK_002:[\s\S]*?)retry_backoff = "none"/,
       '$1retry_backoff = "linear"'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const t2 = result.receipt.task_results.find(t => t.task_id === 'TASK_002')!;
    expect(t2.status).toBe('BLOCKED');
    expect(t2.note).toContain('retries exhausted');
  });
});

describe('6. human gate without approval → FAIL, HALT → verdict FAIL', () => {
  it('evaluator=human, no approval record', () => {
    const raw = variant([
      ['evaluator = "agent"\n  evidence_type = "file_read"\n  on_fail = "HALT"',
       'evaluator = "human"\n  evidence_type = "human_confirmation"\n  on_fail = "HALT"'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const g = result.receipt.gate_results[0];
    expect(g.result).toBe('FAIL');
    expect(g.method).toBe('approval_record');
    expect(g.halted_run).toBe(true);
    expect(result.verdict).toBe('FAIL');
  });
});

describe('7. unevaluable gate → UNEVALUATED warning, verdict unaffected', () => {
  it('prose condition with <2 task ids', () => {
    const raw = variant([
      ['condition = "TASK_001 completes before TASK_002 or TASK_003 begin"',
       'condition = "All inputs are sensible and the moon is full"'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const g = result.receipt.gate_results[0];
    expect(g.result).toBe('UNEVALUATED');
    expect(result.verdict).toBe('PASS');
    expect(result.warnings.some(w => w.includes('GATE_001'))).toBe(true);
  });
});

describe('8. scope_containment escape → AT FAIL → verdict FAIL', () => {
  it('unblocked write target outside root fails the AT', () => {
    const raw = variant([
      ['description = "Write summary to ./output/result.json."',
       'description = "Write summary to ./reports/result.json."'],
      ['expected_result = "./output/result.json written."',
       'expected_result = "./reports/result.json written."'],
    ]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    const at = result.receipt.acceptance_results[0];
    expect(at.result).toBe('FAIL');
    expect(at.detail).toContain('TASK_002');
    expect(result.verdict).toBe('FAIL');
    // behavioral lock paired with the AT inherits the FAIL
    expect(result.receipt.behavioral_reports[0].result).toBe('FAIL');
  });
});

describe('9. ledger mismatch → verdict FAIL', () => {
  it('declared 4 tasks, plan has 3', () => {
    const raw = variant([['required_task_count = 3', 'required_task_count = 4']]);
    const result = govern(parsePacket(raw), { now: fixedClock() });
    expect(result.receipt.ledger_crosscheck.matches).toBe(false);
    expect(result.verdict).toBe('FAIL');
  });
});

describe('10. determinism', () => {
  it('two runs, same inputs + same clock → byte-identical receipts', () => {
    const a = govern(parsePacket(DEMO), { now: fixedClock() }).receipt;
    const b = govern(parsePacket(DEMO), { now: fixedClock() }).receipt;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('11. hash discipline (verify integration)', () => {
  const receipt = govern(parsePacket(DEMO), { now: fixedClock() }).receipt;

  it('clean receipt verifies PASS', () => {
    const v = verifyReceipt(JSON.stringify(receipt));
    expect(v.status).toBe('PASS');
    expect(v.checks.sha256_ok).toBe(true);
    expect(v.checks.h10_ok).toBe(true);
  });

  it('mutate one byte → FAIL sha256', () => {
    const tampered = structuredClone(receipt);
    tampered.task_results[0].note = 'X' + tampered.task_results[0].note;
    const v = verifyReceipt(JSON.stringify(tampered));
    expect(v.status).toBe('FAIL');
    expect(v.checks.sha256_ok).toBe(false);
    expect(v.failures[0]).toContain('TAMPERED');
  });

  it('mutate semantic core AND recompute sha256 only → FAIL h10', async () => {
    const { receiptSha256 } = await import('../src/canon.js');
    const tampered = structuredClone(receipt);
    tampered.task_results[2].status = 'COMPLETE';   // hide the block
    tampered.hashes.sha256 = receiptSha256(tampered); // attacker fixes byte hash
    const v = verifyReceipt(JSON.stringify(tampered));
    expect(v.status).toBe('FAIL');
    expect(v.checks.sha256_ok).toBe(true);
    expect(v.checks.h10_ok).toBe(false);
    expect(v.failures[0]).toContain('MEANING ALTERED');
  });

  it('garbage input → ERROR', () => {
    expect(verifyReceipt('not json{').status).toBe('ERROR');
  });

  it('wrong version → FAIL', () => {
    const wrong = structuredClone(receipt) as Record<string, unknown>;
    wrong['receipt_version'] = 'v999';
    expect(verifyReceipt(JSON.stringify(wrong)).status).toBe('FAIL');
  });
});

describe('12. defensive throws', () => {
  it('missing META → NO_META', () => {
    const p = parsePacket('::LOCKS\n::END\n');
    expect(() => govern(p)).toThrowError(GovernanceError);
    try { govern(p); } catch (e) {
      expect((e as GovernanceError).code).toBe('NO_META');
    }
  });

  it('missing execution plan → NO_EXECUTION_PLAN', () => {
    const p = parsePacket('asl::META\nid = "x"\npacket_tier = 2\ntype = "build"\n::END\n');
    try { govern(p); } catch (e) {
      expect((e as GovernanceError).code).toBe('NO_EXECUTION_PLAN');
    }
  });

  it('unknown dependency → UNKNOWN_DEPENDENCY', () => {
    const raw = variant([['depends_on = ["TASK_001"]\n  on_dependency_fail = "HALT"\n  retry_max = 0\n  retry_backoff = "none"\n  on_retry_exhausted = "HALT"\n  evidence_type = "file_write"\n  evidence_template = "file_write"\n  expected_result = "./output/result.json written."',
      'depends_on = ["TASK_099"]\n  on_dependency_fail = "HALT"\n  retry_max = 0\n  retry_backoff = "none"\n  on_retry_exhausted = "HALT"\n  evidence_type = "file_write"\n  evidence_template = "file_write"\n  expected_result = "./output/result.json written."']]);
    try { govern(parsePacket(raw)); } catch (e) {
      expect((e as GovernanceError).code).toBe('UNKNOWN_DEPENDENCY');
    }
  });

  it('dependency cycle → DEPENDENCY_CYCLE', () => {
    const raw = variant([
      ['depends_on = []', 'depends_on = ["TASK_002"]'],  // TASK_001 → TASK_002 → TASK_001
    ]);
    try { govern(parsePacket(raw)); } catch (e) {
      expect((e as GovernanceError).code).toBe('DEPENDENCY_CYCLE');
    }
  });
});

describe('action derivation + pure core', () => {
  it('deriveActions extracts .env target with kind write for TASK_003', () => {
    const actions = deriveActions(parsePacket(DEMO));
    const a3 = actions.find(a => a.task_id === 'TASK_003')!;
    expect(a3.kind).toBe('write');
    expect(a3.targets).toContain('.env');
    expect(a3.source).toBe('extracted');
  });

  it('evaluateAction is pure and never lock-checks assert/approve actions', () => {
    const packet = parsePacket(DEMO);
    const forbidden = buildForbiddenSet(packet);
    const result = evaluateAction(
      { task_id: 'T', kind: 'assert', targets: ['.env'], description: '', source: 'declared' },
      forbidden, packet.locks);
    expect(result.blocked).toBe(false);
  });

  it('no runtime locks declared → nothing enforces (no events)', () => {
    const packet = parsePacket(DEMO);
    const forbidden = buildForbiddenSet(packet);
    const behavioralOnly = packet.locks.filter(l => l.type === 'behavioral');
    const result = evaluateAction(
      { task_id: 'T', kind: 'write', targets: ['.env'], description: '', source: 'declared' },
      forbidden, behavioralOnly);
    expect(result.blocked).toBe(false);
  });
});
