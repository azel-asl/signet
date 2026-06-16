// Signet v0.1 — Open Receipt Verifier
// OPEN MODULE — permanently open source.
// Imports: types.ts, canon.ts ONLY.
// MUST NOT import runtime.ts (open/closed boundary — this line is the
// open/closed boundary of the whole project).

import type { GovernanceReceipt, EnforcementReceipt } from './types.js';
import { receiptSha256, h10, enforcementSha256, enforcementH10 } from './canon.js';

export type VerifyStatus = 'PASS' | 'FAIL' | 'ERROR';

/** v0.2: explicit signing state. v0.1 receipts are always UNSIGNED. */
export type SignedState = 'UNSIGNED' | 'SIGNATURE_PRESENT_UNVERIFIABLE';

export interface VerifyResult {
  status: VerifyStatus;
  signed: false;
  /** v0.2: what the signature field actually contained. */
  signed_state: SignedState;
  checks: {
    parse_ok: boolean;
    version_ok: boolean;
    structure_ok: boolean;
    sha256_ok: boolean;
    h10_ok: boolean;
  };
  failures: string[];
  /**
   * v0.2: one-sentence honest summary of what this verification proved —
   * hash integrity only, never semantic truth of the underlying work.
   */
  explanation: string;
  /** Present when structure parsed — what was proven. */
  receipt_summary?: {
    packet_id: string;
    verdict: string;
    outcome: string;
    blocks_recorded: number;
    sha256: string;
    h10: string;
  };
}

// ── v0.2: packet-to-receipt structural alignment ─────────────
// Mechanical comparison of declared packet structure vs what the
// receipt recorded. This checks COUNTS AND IDS ONLY — it does not
// and cannot prove the underlying work was done correctly.

export interface DeclaredStructure {
  packet_id: string;
  task_count: number;
  lock_count: number;
  gate_count?: number;
  acceptance_test_count?: number;
}

export interface AlignmentResult {
  aligned: boolean;
  checks: {
    packet_id_ok: boolean;
    task_count_ok: boolean;
    lock_count_ok: boolean;
    gate_count_ok: boolean | null;       // null = not declared, not checked
    acceptance_test_count_ok: boolean | null;
  };
  mismatches: string[];
  /** Honest scope statement — always present. */
  note: string;
}

const ALIGNMENT_NOTE =
  'Structural alignment compares ids and counts only. It does not prove the work itself was performed or correct.';

export function checkAlignment(receiptJson: string, declared: DeclaredStructure): AlignmentResult {
  const mismatches: string[] = [];
  const checks: AlignmentResult['checks'] = {
    packet_id_ok: false, task_count_ok: false, lock_count_ok: false,
    gate_count_ok: null, acceptance_test_count_ok: null,
  };

  let receipt: GovernanceReceipt;
  try {
    receipt = JSON.parse(receiptJson) as GovernanceReceipt;
  } catch {
    return {
      aligned: false, checks,
      mismatches: ['receipt is not valid JSON — cannot compare against packet'],
      note: ALIGNMENT_NOTE,
    };
  }

  const observed = receipt.ledger_crosscheck?.observed;
  if (!observed || !receipt.packet || !receipt.summary) {
    return {
      aligned: false, checks,
      mismatches: ['receipt is missing packet/summary/ledger_crosscheck sections — cannot compare'],
      note: ALIGNMENT_NOTE,
    };
  }

  checks.packet_id_ok = receipt.packet.id === declared.packet_id;
  if (!checks.packet_id_ok) {
    mismatches.push(
      `packet_id mismatch: packet declares "${declared.packet_id}" but receipt records "${receipt.packet.id}"`);
  }

  checks.task_count_ok = receipt.summary.tasks_total === declared.task_count;
  if (!checks.task_count_ok) {
    mismatches.push(
      `task count mismatch: packet declares ${declared.task_count} task(s) but receipt records ${receipt.summary.tasks_total}`);
  }

  checks.lock_count_ok = observed.lock_count === declared.lock_count;
  if (!checks.lock_count_ok) {
    mismatches.push(
      `lock count mismatch: packet declares ${declared.lock_count} lock(s) but receipt records ${observed.lock_count}`);
  }

  if (declared.gate_count !== undefined) {
    checks.gate_count_ok = observed.gate_count === declared.gate_count;
    if (!checks.gate_count_ok) {
      mismatches.push(
        `gate count mismatch: packet declares ${declared.gate_count} gate(s) but receipt records ${observed.gate_count}`);
    }
  }

  if (declared.acceptance_test_count !== undefined) {
    checks.acceptance_test_count_ok = observed.acceptance_test_count === declared.acceptance_test_count;
    if (!checks.acceptance_test_count_ok) {
      mismatches.push(
        `acceptance test count mismatch: packet declares ${declared.acceptance_test_count} but receipt records ${observed.acceptance_test_count}`);
    }
  }

  return { aligned: mismatches.length === 0, checks, mismatches, note: ALIGNMENT_NOTE };
}

const REQUIRED_FIELDS = [
  'receipt_version', 'receipt_id', 'packet', 'action', 'verdict', 'outcome',
  'summary', 'task_results', 'block_events', 'gate_results',
  'behavioral_reports', 'acceptance_results', 'ledger_crosscheck',
  'timestamps', 'canon', 'hashes',
] as const;

const REQUIRED_ENFORCEMENT_FIELDS = [
  'receipt_version', 'receipt_id', 'packet', 'mode', 'coverage', 'events',
  'summary', 'timestamps', 'canon', 'hashes',
] as const;

// ── v0.3: enforcement receipt path (hook interception) ───────

function verifyEnforcement(
  r: Record<string, unknown>,
  checks: VerifyResult['checks'],
  failures: string[],
): VerifyResult {
  const missing = REQUIRED_ENFORCEMENT_FIELDS.filter(f => r[f] === undefined);
  if (missing.length > 0) {
    failures.push(
      `malformed enforcement receipt: missing ${missing.join(', ')} — ` +
      `a valid enforcement receipt has all ${REQUIRED_ENFORCEMENT_FIELDS.length} required sections.`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: `Verification stopped at the structure check: ${missing.length} required field(s) are missing.`,
    };
  }
  checks.structure_ok = true;

  const receipt = r as unknown as EnforcementReceipt;
  const summary = {
    packet_id: receipt.packet.id,
    verdict: 'enforcement',
    outcome: `${receipt.summary.denials} denial(s)`,
    blocks_recorded: receipt.summary.denials,
    sha256: receipt.hashes.sha256,
    h10: receipt.hashes.h10,
  };

  const recomputedSha = enforcementSha256(receipt);
  if (recomputedSha !== receipt.hashes.sha256) {
    failures.push(
      'TAMPERED — byte content does not match stored sha256. ' +
      'The enforcement receipt was modified after it was created. ' +
      `Stored ${receipt.hashes.sha256.slice(0, 12)}…, recomputed ${recomputedSha.slice(0, 12)}….`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification failed: the enforcement receipt bytes do not match their recorded sha256 hash.',
      receipt_summary: summary,
    };
  }
  checks.sha256_ok = true;

  const recomputedH10 = enforcementH10(receipt);
  if (recomputedH10 !== receipt.hashes.h10) {
    failures.push(
      'MEANING ALTERED — semantic core does not match stored h10. ' +
      'The denial events recorded in this receipt differ from what its h10 hash committed to. ' +
      `Stored ${receipt.hashes.h10.slice(0, 12)}…, recomputed ${recomputedH10.slice(0, 12)}….`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification failed: the semantic core does not match its recorded h10 hash.',
      receipt_summary: summary,
    };
  }
  checks.h10_ok = true;

  let signed_state: SignedState = 'UNSIGNED';
  if (receipt.signature !== null && receipt.signature !== undefined) {
    signed_state = 'SIGNATURE_PRESENT_UNVERIFIABLE';
    failures.push(
      'signature present — this verifier version cannot check signatures; treating as unsigned');
  }

  return {
    status: 'PASS', signed: false, signed_state, checks, failures,
    explanation:
      'This enforcement receipt is intact: its bytes match the recorded sha256 and its denial ' +
      'events match the recorded h10. It records hook-intercepted denials only — it is UNSIGNED, ' +
      'it does not enumerate allowed calls, and it proves nothing about hosts without hook support.',
    receipt_summary: summary,
  };
}

export function verifyReceipt(receiptJson: string): VerifyResult {
  const checks = {
    parse_ok: false,
    version_ok: false,
    structure_ok: false,
    sha256_ok: false,
    h10_ok: false,
  };
  const failures: string[] = [];

  // 1. Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(receiptJson);
  } catch {
    failures.push(
      'not valid JSON — the file may be truncated, empty, or not a receipt file at all. ' +
      'Expected a .json file produced by `signet run --receipt`.');
    return {
      status: 'ERROR', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification could not start: the input is not parseable JSON.',
    };
  }
  checks.parse_ok = true;

  const r = parsed as Record<string, unknown>;

  // 2. Version (dispatch point — v0.3 adds enforcement receipts)
  if (r['receipt_version'] === 'signet-enforcement-receipt-v1') {
    checks.version_ok = true;
    return verifyEnforcement(r, checks, failures);
  }
  if (r['receipt_version'] !== 'signet-receipt-v1') {
    failures.push(
      `unknown receipt version: ${String(r['receipt_version'])} — ` +
      `this verifier understands "signet-receipt-v1" and "signet-enforcement-receipt-v1". ` +
      `The file may be from a newer Signet, a different tool, or not a receipt.`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification stopped at the version check: this is not a known Signet receipt version.',
    };
  }
  checks.version_ok = true;

  // 3. Structure
  const missing = REQUIRED_FIELDS.filter(f => r[f] === undefined);
  if (missing.length > 0) {
    failures.push(
      `malformed receipt: missing ${missing.join(', ')} — ` +
      `a valid receipt has all ${REQUIRED_FIELDS.length} required sections. ` +
      `Fields may have been deleted, or the file was hand-edited.`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: `Verification stopped at the structure check: ${missing.length} required field(s) are missing.`,
    };
  }
  checks.structure_ok = true;

  const receipt = parsed as GovernanceReceipt;
  const summary = {
    packet_id: receipt.packet.id,
    verdict: receipt.verdict,
    outcome: receipt.outcome,
    blocks_recorded: receipt.summary.blocks_recorded,
    sha256: receipt.hashes.sha256,
    h10: receipt.hashes.h10,
  };

  // 4. sha256 — byte integrity
  const recomputedSha = receiptSha256(receipt);
  if (recomputedSha !== receipt.hashes.sha256) {
    failures.push(
      'TAMPERED — byte content does not match stored sha256. ' +
      'The receipt was modified after it was created (any field change, including ' +
      'whitespace-invisible edits, triggers this). ' +
      `Stored ${receipt.hashes.sha256.slice(0, 12)}…, recomputed ${recomputedSha.slice(0, 12)}….`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification failed: the receipt bytes do not match their recorded sha256 hash.',
      receipt_summary: summary,
    };
  }
  checks.sha256_ok = true;

  // 5. h10 — semantic core (cross-checks sha256: reachable when stored hashes
  //    were edited to match tampered bytes but not the core, or vice versa)
  const recomputedH10 = h10(receipt);
  if (recomputedH10 !== receipt.hashes.h10) {
    failures.push(
      'MEANING ALTERED — semantic core does not match stored h10. ' +
      'The governance outcome recorded in this receipt (verdict, task results, blocks) ' +
      'differs from what its h10 hash committed to. ' +
      `Stored ${receipt.hashes.h10.slice(0, 12)}…, recomputed ${recomputedH10.slice(0, 12)}….`);
    return {
      status: 'FAIL', signed: false, signed_state: 'UNSIGNED', checks, failures,
      explanation: 'Verification failed: the semantic core does not match its recorded h10 hash.',
      receipt_summary: summary,
    };
  }
  checks.h10_ok = true;

  // 6. Signature — v0.1/v0.2: null expected. Present-but-unverifiable → notice, not fail.
  let signed_state: SignedState = 'UNSIGNED';
  if (receipt.signature !== null && receipt.signature !== undefined) {
    signed_state = 'SIGNATURE_PRESENT_UNVERIFIABLE';
    failures.push(
      'signature present — this verifier version cannot check signatures; treating as unsigned');
  }

  return {
    status: 'PASS', signed: false, signed_state, checks, failures,
    explanation:
      'This receipt is intact: its bytes match the recorded sha256 and its governance ' +
      'outcome matches the recorded h10. It is UNSIGNED — hash-verified, not ' +
      'authority-certified — and hash integrity does not prove the underlying work was correct.',
    receipt_summary: summary,
  };
}
