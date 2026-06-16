import type { ParsedPacket, ValidationResult } from './types.js';

// ============================================================
// LEDGER — Verification ledger cross-check
// ============================================================

/**
 * Cross-check the VERIFICATION_LEDGER declared counts against
 * what was actually found in the parsed packet.
 */
export function crossCheckLedger(
  packet: ParsedPacket,
  result: ValidationResult
): { passed: boolean; discrepancies: string[] } {
  const ledger = packet.verificationLedger;
  const discrepancies: string[] = [];

  if (!ledger) {
    return { passed: true, discrepancies: [] };
  }

  const actualTasks = packet.executionPlan?.tasks.length ?? 0;
  const actualGates = packet.gates.length;
  const actualLocks = packet.locks.length;
  const actualATs   = packet.acceptanceTests?.tests.length ?? 0;

  if (ledger.required_task_count !== actualTasks) {
    discrepancies.push(
      `LEDGER task_count: declared ${ledger.required_task_count}, found ${actualTasks}`
    );
  }
  if (ledger.required_gate_count !== actualGates) {
    discrepancies.push(
      `LEDGER gate_count: declared ${ledger.required_gate_count}, found ${actualGates}`
    );
  }
  if (ledger.required_lock_count !== actualLocks) {
    discrepancies.push(
      `LEDGER lock_count: declared ${ledger.required_lock_count}, found ${actualLocks}`
    );
  }
  if (ledger.required_acceptance_test_count !== actualATs) {
    discrepancies.push(
      `LEDGER acceptance_test_count: declared ${ledger.required_acceptance_test_count}, found ${actualATs}`
    );
  }

  for (const d of discrepancies) {
    result.issues.push({
      severity: 'warning',
      code: 'LEDGER_004',
      message: d,
      location: 'VERIFICATION_LEDGER',
    });
    result.summary.warnings++;
  }

  return { passed: discrepancies.length === 0, discrepancies };
}
