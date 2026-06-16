import type { ValidationResult, LedgerValidationResult, ReceiptValidationResult, ProfileValidationResult } from './types.js';

// ============================================================
// REPORTER — Human-readable + JSON output (TASK_026, TASK_027)
// ============================================================

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function severityColor(s: 'error' | 'warning' | 'info'): string {
  if (s === 'error')   return RED;
  if (s === 'warning') return YELLOW;
  return DIM;
}

function severityLabel(s: 'error' | 'warning' | 'info'): string {
  if (s === 'error')   return '✗ ERROR  ';
  if (s === 'warning') return '⚠ WARNING';
  return '○ INFO   ';
}

function checkMark(v: boolean): string {
  return v ? colorize('✓', GREEN) : colorize('✗', RED);
}

// ── Human-readable report ────────────────────────────────────

export function formatReport(
  result: ValidationResult,
  filePath: string,
  ledger?: LedgerValidationResult,
  receipt?: ReceiptValidationResult,
  profile?: ProfileValidationResult
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', CYAN));
  lines.push(colorize('  ASL Packet Validator', BOLD + CYAN));
  lines.push(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', CYAN));
  lines.push('');
  lines.push(`  File:    ${filePath}`);
  if (result.packet_id)   lines.push(`  ID:      ${result.packet_id}`);
  if (result.packet_tier) lines.push(`  Tier:    ${result.packet_tier}`);
  if (result.packet_type) lines.push(`  Type:    ${result.packet_type}`);
  lines.push('');

  // Summary banner
  const banner = result.valid
    ? colorize(`  ✓  PASS  — ${result.summary.errors} errors, ${result.summary.warnings} warnings`, GREEN + BOLD)
    : colorize(`  ✗  FAIL  — ${result.summary.errors} errors, ${result.summary.warnings} warnings`, RED + BOLD);
  lines.push(banner);
  lines.push('');

  // Checks table
  lines.push(colorize('  Checks:', BOLD));
  const checks = result.checks as Record<string, boolean>;
  for (const [k, v] of Object.entries(checks)) {
    lines.push(`    ${checkMark(v)}  ${k.replace(/_/g, ' ')}`);
  }
  lines.push('');

  // Issues
  if (result.issues.length > 0) {
    lines.push(colorize('  Issues:', BOLD));
    for (const iss of result.issues) {
      const prefix = colorize(severityLabel(iss.severity), severityColor(iss.severity));
      const loc = iss.location ? colorize(` [${iss.location}]`, DIM) : '';
      const code = colorize(iss.code, DIM);
      lines.push(`    ${prefix}  ${code}${loc}`);
      lines.push(`               ${iss.message}`);
    }
  } else {
    lines.push(colorize('  No issues found.', GREEN));
  }

  // Ledger validation section (Phase 3)
  if (ledger) {
    lines.push('');
    lines.push(colorize('  Ledger Validation:', BOLD));
    lines.push(`    File:    ${ledger.ledger_file}`);
    lines.push(`    Tasks:   packet declares ${ledger.packet_task_count}, ledger has ${ledger.ledger_marker_count}`);
    const lBanner = ledger.valid
      ? colorize(`  ✓  LEDGER PASS  — ${ledger.summary.errors} errors, ${ledger.summary.warnings} warnings`, GREEN + BOLD)
      : colorize(`  ✗  LEDGER FAIL  — ${ledger.summary.errors} errors, ${ledger.summary.warnings} warnings`, RED + BOLD);
    lines.push('  ' + lBanner);
    lines.push('');
    lines.push(colorize('  Ledger Checks:', BOLD));
    const lChecks = ledger.checks as Record<string, boolean>;
    for (const [k, v] of Object.entries(lChecks)) {
      lines.push(`    ${checkMark(v)}  ${k.replace(/_/g, ' ')}`);
    }
    const ev = ledger.evidence_validation;
    lines.push('');
    lines.push(colorize('  Evidence Validation:', BOLD));
    lines.push(`    Total: ${ev.total}  Validated: ${ev.validated}  Failed: ${ev.failed}  Skipped: ${ev.skipped}`);

    // Phase 4: count cross-check display
    const cc = ledger.ledger_count_crosscheck;
    lines.push('');
    lines.push(colorize('  Count Cross-Check:', BOLD));
    if (cc.block_absent) {
      lines.push(colorize('    ○ INFO   ', DIM) + '  No ::VERIFICATION_LEDGER block in ledger file — skipped');
    } else {
      const fields: Array<[string, keyof typeof cc.matches]> = [
        ['task_count',            'task_count'],
        ['gate_count',            'gate_count'],
        ['lock_count',            'lock_count'],
        ['acceptance_test_count', 'acceptance_test_count'],
        ['receipt_count',         'receipt_count'],
      ];
      const pd = cc.packet_declared;
      const lr = cc.ledger_reported;
      for (const [label, mKey] of fields) {
        const pVal = pd[`required_${label}` as keyof typeof pd] ?? '—';
        const lVal = lr[`required_${label}` as keyof typeof lr] ?? '—';
        lines.push(`    ${checkMark(cc.matches[mKey])}  ${label.replace(/_/g, ' ')}: packet=${pVal}, ledger=${lVal}`);
      }
    }

    if (ledger.issues.length > 0) {
      lines.push('');
      lines.push(colorize('  Ledger Issues:', BOLD));
      for (const iss of ledger.issues) {
        const prefix = colorize(severityLabel(iss.severity), severityColor(iss.severity));
        const loc = iss.location ? colorize(` [${iss.location}]`, DIM) : '';
        const code = colorize(iss.code, DIM);
        lines.push(`    ${prefix}  ${code}${loc}`);
        lines.push(`               ${iss.message}`);
      }
    }
  }

  // Phase 5: Strict receipt validation section
  if (receipt) {
    lines.push('');
    lines.push(colorize('  Strict Receipt Validation:', BOLD));
    lines.push(`    File:    ${receipt.receipt_file}`);
    lines.push(`    Tasks:   packet declares ${receipt.packet_task_count}, receipt has ${receipt.receipt_marker_count}`);
    lines.push(`    Mode:    STRICT (fake checksums on missing files = error)`);
    const rBanner = receipt.valid
      ? colorize(`  ✓  RECEIPT PASS  — ${receipt.summary.errors} errors, ${receipt.summary.warnings} warnings`, GREEN + BOLD)
      : colorize(`  ✗  RECEIPT FAIL  — ${receipt.summary.errors} errors, ${receipt.summary.warnings} warnings`, RED + BOLD);
    lines.push('  ' + rBanner);
    lines.push('');
    lines.push(colorize('  Receipt Checks:', BOLD));
    const rChecks = receipt.checks as Record<string, boolean>;
    for (const [k, v] of Object.entries(rChecks)) {
      lines.push(`    ${checkMark(v)}  ${k.replace(/_/g, ' ')}`);
    }
    const rev = receipt.evidence_validation;
    lines.push('');
    lines.push(colorize('  Evidence Validation (Strict):', BOLD));
    lines.push(`    Total: ${rev.total}  Validated: ${rev.validated}  Failed: ${rev.failed}  Skipped: ${rev.skipped}`);

    // Receipt count cross-check
    const rcc = receipt.receipt_count_crosscheck;
    lines.push('');
    lines.push(colorize('  Receipt Count Cross-Check:', BOLD));
    if (rcc.block_absent) {
      lines.push(colorize('    ○ INFO   ', DIM) + '  No ::VERIFICATION_LEDGER block in receipt file — skipped');
    } else {
      const fields: Array<[string, keyof typeof rcc.matches]> = [
        ['task_count',            'task_count'],
        ['gate_count',            'gate_count'],
        ['lock_count',            'lock_count'],
        ['acceptance_test_count', 'acceptance_test_count'],
        ['receipt_count',         'receipt_count'],
      ];
      const pd = rcc.packet_declared;
      const rr = rcc.ledger_reported;
      for (const [label, mKey] of fields) {
        const pVal = pd[`required_${label}` as keyof typeof pd] ?? '—';
        const rVal = rr[`required_${label}` as keyof typeof rr] ?? '—';
        lines.push(`    ${checkMark(rcc.matches[mKey])}  ${label.replace(/_/g, ' ')}: packet=${pVal}, receipt=${rVal}`);
      }
    }

    if (receipt.issues.length > 0) {
      lines.push('');
      lines.push(colorize('  Receipt Issues:', BOLD));
      for (const iss of receipt.issues) {
        const prefix = colorize(severityLabel(iss.severity), severityColor(iss.severity));
        const loc  = iss.location ? colorize(` [${iss.location}]`, DIM) : '';
        const code = colorize(iss.code, DIM);
        lines.push(`    ${prefix}  ${code}${loc}`);
        lines.push(`               ${iss.message}`);
      }
    }
  }

  // Phase 6: Policy profile section
  if (profile && profile.profile_id !== null) {
    lines.push('');
    lines.push(colorize('  Policy Profile:', BOLD));
    lines.push(`    Profile: ${profile.profile_id}${profile.profile_name ? ` (${profile.profile_name})` : ''}`);
    const pBanner = profile.valid
      ? colorize(`  ✓  PROFILE PASS  — ${profile.summary.errors} errors, ${profile.summary.warnings} warnings`, GREEN + BOLD)
      : colorize(`  ✗  PROFILE FAIL  — ${profile.summary.errors} errors, ${profile.summary.warnings} warnings`, RED + BOLD);
    lines.push('  ' + pBanner);
    lines.push('');
    lines.push(colorize('  Profile Checks:', BOLD));
    const pChecks: Record<string, boolean> = { ...profile.checks };
    for (const [k, v] of Object.entries(pChecks)) {
      lines.push(`    ${checkMark(v)}  ${k.replace(/_/g, ' ')}`);
    }
    if (profile.issues.length > 0) {
      lines.push('');
      lines.push(colorize('  Profile Issues:', BOLD));
      for (const iss of profile.issues) {
        const prefix = colorize(severityLabel(iss.severity), severityColor(iss.severity));
        const loc = iss.location ? colorize(` [${iss.location}]`, DIM) : '';
        const code = colorize(iss.code, DIM);
        lines.push(`    ${prefix}  ${code}${loc}`);
        lines.push(`               ${iss.message}`);
      }
    }
  }

  lines.push('');
  lines.push(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', CYAN));
  lines.push('');

  return lines.join('\n');
}

// ── JSON output (AT_011: includes ledger fields) ─────────────

export function formatJson(
  result: ValidationResult,
  filePath: string,
  ledger?: LedgerValidationResult,
  receipt?: ReceiptValidationResult,
  profile?: ProfileValidationResult
): string {
  const overallValid =
    result.valid &&
    (ledger  ? ledger.valid  : true) &&
    (receipt ? receipt.valid : true) &&
    (profile ? profile.valid : true);

  const output: Record<string, unknown> = {
    file: filePath,
    valid: overallValid,
    packet_validation: result,
    ...(ledger ? {
      ledger_validation: {
        valid: ledger.valid,
        ledger_file: ledger.ledger_file,
        packet_task_count: ledger.packet_task_count,
        ledger_marker_count: ledger.ledger_marker_count,
        summary: ledger.summary,
        checks: ledger.checks,
        evidence_validation: ledger.evidence_validation,
        ledger_count_crosscheck: ledger.ledger_count_crosscheck,
        issues: ledger.issues,
      },
    } : {}),
    ...(receipt ? {
      strict_receipt_validation: {
        valid: receipt.valid,
        strict_mode: receipt.strict_mode,
        receipt_file: receipt.receipt_file,
        packet_task_count: receipt.packet_task_count,
        receipt_marker_count: receipt.receipt_marker_count,
        summary: receipt.summary,
        checks: receipt.checks,
        evidence_validation: receipt.evidence_validation,
        receipt_count_crosscheck: receipt.receipt_count_crosscheck,
        issues: receipt.issues,
      },
    } : {}),
    ...(profile && profile.profile_id !== null ? {
      policy_profile_validation: {
        valid: profile.valid,
        profile_id: profile.profile_id,
        profile_name: profile.profile_name,
        summary: profile.summary,
        checks: profile.checks,
        issues: profile.issues,
      },
    } : {}),
  };
  return JSON.stringify(output, null, 2);
}
