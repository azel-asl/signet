import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import type {
  ParsedPacket, DriftMarker, LedgerValidationResult, ValidationIssue,
  EvidenceType, TaskStatus, LedgerCountSet, LedgerCountCrossCheck
} from './types.js';
import { EVIDENCE_TEMPLATES, VALID_EVIDENCE_TYPES } from './schemas.js';

// ============================================================
// LEDGER VALIDATOR — Phase 3 Execution Proof Validation
// Validates a completed ledger against a packet's declared structure.
// Does NOT execute packets — reads and compares only.
// ============================================================

// ── Fake checksum placeholder detection (TASK_010) ───────────

const FAKE_CHECKSUMS = new Set([
  'reviewed', 'updated', 'created', 'changed', 'new', 'modified',
  'added', 'none', 'tbd', 'todo', 'placeholder', 'n/a', 'na',
  'actual', 'computed', 'hash', 'sha256', 'checksum', 'pending',
]);

export function isFakeChecksum(checksum: string): boolean {
  return FAKE_CHECKSUMS.has(checksum.toLowerCase().trim());
}

// ── Evidence ref field parser (inline, avoids circular dep) ──

function parseRefFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split('|').map(p => p.trim())) {
    const idx = part.indexOf(':');
    if (idx !== -1) {
      fields[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
    } else if (part) {
      fields['_raw'] = part;
    }
  }
  return fields;
}

// ── Issue helper ─────────────────────────────────────────────

function issue(
  severity: 'error' | 'warning' | 'info',
  code: string,
  message: string,
  location?: string
): ValidationIssue {
  return { severity, code, message, location };
}

// ── TASK_005: Task count comparison ─────────────────────────

function checkTaskCount(
  packet: ParsedPacket,
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  const declared = packet.executionPlan?.task_count ?? 0;
  const actual = markers.length;
  if (declared === 0 && actual === 0) return true;
  if (declared !== actual) {
    issues.push(issue('error', 'LED_001',
      `Task count mismatch: packet declares ${declared} tasks, ledger has ${actual} markers`));
    return false;
  }
  return true;
}

// ── TASK_006: Marker contiguity + duplicate check ────────────

function checkMarkerContiguity(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): { contiguous: boolean; noDuplicates: boolean } {
  let contiguous = true;
  let noDuplicates = true;

  // Duplicate check
  const seen = new Set<string>();
  for (const m of markers) {
    if (seen.has(m.task_id)) {
      issues.push(issue('error', 'LED_002',
        `Duplicate ledger marker: ${m.task_id}`, m.task_id));
      noDuplicates = false;
    }
    seen.add(m.task_id);
  }

  // Contiguity check
  const nums = [...seen]
    .filter(id => /^TASK_\d{3}$/.test(id))
    .map(id => parseInt(id.replace('TASK_', ''), 10))
    .sort((a, b) => a - b);

  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      issues.push(issue('error', 'LED_003',
        `Non-contiguous marker IDs: expected TASK_${String(i + 1).padStart(3, '0')}, ` +
        `found TASK_${String(nums[i]).padStart(3, '0')}`));
      contiguous = false;
      break;
    }
  }

  return { contiguous, noDuplicates };
}

// ── TASK_007: Required task status validation ─────────────────

const FINAL_STATUSES: TaskStatus[] = ['COMPLETE', 'SKIPPED', 'BLOCKED', 'FAILED'];
const BAD_REQUIRED_STATUSES: TaskStatus[] = ['FAILED', 'SKIPPED', 'BLOCKED', 'RETRYING'];

function checkRequiredTaskStatuses(
  packet: ParsedPacket,
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  let ok = true;
  const plan = packet.executionPlan;
  if (!plan) return true;


  const markerMap = new Map(markers.map(m => [m.task_id, m]));

  for (const task of plan.tasks) {
    if (!task.required) continue;
    const marker = markerMap.get(task.id);
    if (!marker) {
      issues.push(issue('error', 'LED_004',
        `Required task ${task.id} has no ledger marker`, task.id));
      ok = false;
      continue;
    }
    if (BAD_REQUIRED_STATUSES.includes(marker.status as TaskStatus)) {
      issues.push(issue('error', 'LED_005',
        `Required task ${task.id} has invalid completion status: ${marker.status}`, task.id));
      ok = false;
    }
  }

  // RETRYING at completion check
  const hasRetrying = markers.some(m => m.status === 'RETRYING');
  if (hasRetrying) {
    const nonRetrying = markers.filter(m => m.status !== 'RETRYING');
    const allFinal = nonRetrying.every(m => FINAL_STATUSES.includes(m.status as TaskStatus));
    if (allFinal) {
      for (const m of markers.filter(m => m.status === 'RETRYING')) {
        issues.push(issue('error', 'LED_006',
          `Ledger marker ${m.task_id}: RETRYING at completion — all other tasks are at final status`,
          m.task_id));
        ok = false;
      }
    }
  }

  return ok;
}

// ── TASK_008: Evidence_ref template field validation ──────────

function checkEvidenceRefs(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  let ok = true;
  for (const m of markers) {
    if (!VALID_EVIDENCE_TYPES.has(m.evidence_type)) continue;
    const evType = m.evidence_type as EvidenceType;
    const required = EVIDENCE_TEMPLATES[evType] ?? [];
    // Only validate structured refs (those with pipe separators or key: value format)
    if (!m.evidence_ref.includes(':') || !m.evidence_ref.includes('|')) continue;
    const fields = parseRefFields(m.evidence_ref);
    const missing = required.filter(f => !fields[f]);
    if (missing.length > 0) {
      issues.push(issue('warning', 'LED_007',
        `Ledger marker ${m.task_id}: evidence_ref for "${evType}" missing fields: ${missing.join(', ')}`,
        m.task_id));
    }
  }
  return ok;
}

// ── TASK_009–010: SHA256 validation + fake checksum rejection ─

export interface EvidenceCheckResult {
  total: number;
  validated: number;
  failed: number;
  skipped: number;
}

function checkEvidenceChecksums(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): { ok: boolean; stats: EvidenceCheckResult } {
  let ok = true;
  const stats: EvidenceCheckResult = { total: 0, validated: 0, failed: 0, skipped: 0 };

  for (const m of markers) {
    // Only file-based evidence has checksums
    if (m.evidence_type !== 'file_read' && m.evidence_type !== 'file_write') continue;
    if (!m.evidence_ref.includes(':')) continue; // plain prose ref — skip

    const fields = parseRefFields(m.evidence_ref);
    const path = fields['path'];
    const declaredChecksum = (fields['checksum'] ?? '').trim();

    if (!path) continue;

    stats.total++;

    const fileExists = existsSync(path);

    // Fake checksum check (TASK_010)
    if (declaredChecksum && isFakeChecksum(declaredChecksum)) {
      if (fileExists) {
        // File exists but checksum is a placeholder — hard fail
        issues.push(issue('error', 'LED_008',
          `Ledger marker ${m.task_id}: fake checksum placeholder "${declaredChecksum}" ` +
          `for existing file "${path}" — must provide actual SHA256`,
          m.task_id));
        stats.failed++;
        ok = false;
      } else {
        // File not found — warn but don't block
        issues.push(issue('warning', 'LED_009',
          `Ledger marker ${m.task_id}: fake checksum placeholder "${declaredChecksum}" ` +
          `for "${path}" (file not found at validation time — cannot verify)`,
          m.task_id));
        stats.skipped++;
      }
      continue;
    }

    if (!fileExists) {
      stats.skipped++;
      continue;
    }

    // File exists — compute actual SHA256 and compare (TASK_009)
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      stats.skipped++;
      continue;
    }

    const actual = createHash('sha256').update(content).digest('hex');
    stats.validated++;

    if (!declaredChecksum) {
      issues.push(issue('warning', 'LED_010',
        `Ledger marker ${m.task_id}: file "${path}" exists but no checksum declared ` +
        `(actual SHA256: ${actual.slice(0, 16)}...)`,
        m.task_id));
      continue;
    }

    // Compare — support both full hex and shortened prefix (min 8 chars)
    const norm = declaredChecksum.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (norm.length >= 8 && !actual.startsWith(norm.slice(0, 16))) {
      issues.push(issue('error', 'LED_011',
        `Ledger marker ${m.task_id}: SHA256 mismatch for "${path}" — ` +
        `declared ${declaredChecksum}, actual ${actual.slice(0, 16)}...`,
        m.task_id));
      stats.failed++;
      ok = false;
    }
  }

  return { ok, stats };
}

// ── Phase 4: Ledger ::VERIFICATION_LEDGER block parser ────────

/**
 * Parses a ::VERIFICATION_LEDGER block from raw ledger markdown.
 * Returns null if the block is absent (the block is optional in ledger files).
 */
export function parseLedgerVerificationBlock(raw: string): LedgerCountSet | null {
  // Extract ::VERIFICATION_LEDGER...::END (GCL block format)
  const pattern = /^::VERIFICATION_LEDGER\s*\n([\s\S]*?)^::END/m;
  const match = raw.match(pattern);
  if (!match) return null;

  const content = match[1];
  const kv: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    kv[k] = v;
  }

  const parseCount = (key: string): number | null => {
    const v = kv[key];
    if (v === undefined) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };

  return {
    required_task_count:             parseCount('required_task_count'),
    required_gate_count:             parseCount('required_gate_count'),
    required_lock_count:             parseCount('required_lock_count'),
    required_acceptance_test_count:  parseCount('required_acceptance_test_count'),
    required_receipt_count:          parseCount('required_receipt_count'),
  };
}

// ── Phase 4: Declared-vs-reported count cross-check ───────────

// ── Suffix table for count fields (012–016) ──────────────────
const COUNT_FIELD_SUFFIXES: Record<string, string> = {
  required_task_count:            '012',
  required_gate_count:            '013',
  required_lock_count:            '014',
  required_acceptance_test_count: '015',
  required_receipt_count:         '016',
};

const COUNT_FIELDS: Array<{
  field: keyof LedgerCountSet;
  label: string;
  matchKey: keyof LedgerCountCrossCheck['matches'];
}> = [
  { field: 'required_task_count',            label: 'required_task_count',            matchKey: 'task_count'            },
  { field: 'required_gate_count',            label: 'required_gate_count',            matchKey: 'gate_count'            },
  { field: 'required_lock_count',            label: 'required_lock_count',            matchKey: 'lock_count'            },
  { field: 'required_acceptance_test_count', label: 'required_acceptance_test_count', matchKey: 'acceptance_test_count' },
  { field: 'required_receipt_count',         label: 'required_receipt_count',         matchKey: 'receipt_count'         },
];

export function checkLedgerCountCrossCheck(
  packet: ParsedPacket,
  ledgerRaw: string,
  issues: ValidationIssue[],
  /** Code prefix: 'LED' for ledger, 'REC' for strict receipt mode */
  codePrefix: string = 'LED'
): LedgerCountCrossCheck {
  const packetVL = packet.verificationLedger;

  // Packet-declared counts (null if no ::VERIFICATION_LEDGER in packet)
  const packetDeclared: LedgerCountSet = {
    required_task_count:             packetVL?.required_task_count            ?? null,
    required_gate_count:             packetVL?.required_gate_count            ?? null,
    required_lock_count:             packetVL?.required_lock_count            ?? null,
    required_acceptance_test_count:  packetVL?.required_acceptance_test_count ?? null,
    required_receipt_count:          packetVL?.required_receipt_count         ?? null,
  };

  // Ledger-reported counts (null if no ::VERIFICATION_LEDGER in ledger)
  const ledgerReported = parseLedgerVerificationBlock(ledgerRaw);
  const blockAbsent = ledgerReported === null;

  const nullReported: LedgerCountSet = {
    required_task_count: null,
    required_gate_count: null,
    required_lock_count: null,
    required_acceptance_test_count: null,
    required_receipt_count: null,
  };

  const reported = ledgerReported ?? nullReported;

  // If no ledger ::VERIFICATION_LEDGER block present — warn only
  if (blockAbsent) {
    if (packetVL) {
      issues.push(issue('warning', `${codePrefix}_017`,
        'File has no ::VERIFICATION_LEDGER block — count cross-check skipped. ' +
        'Add a ::VERIFICATION_LEDGER block to enable full count validation.'));
    }
    return {
      packet_declared: packetDeclared,
      ledger_reported: nullReported,
      matches: { task_count: true, gate_count: true, lock_count: true, acceptance_test_count: true, receipt_count: true },
      valid: true,
      block_absent: true,
    };
  }

  // If packet has no ::VERIFICATION_LEDGER but file does — warn
  if (!packetVL) {
    issues.push(issue('warning', `${codePrefix}_018`,
      'File contains a ::VERIFICATION_LEDGER block but packet has none — no declared counts to compare against.'));
    return {
      packet_declared: packetDeclared,
      ledger_reported: reported,
      matches: { task_count: true, gate_count: true, lock_count: true, acceptance_test_count: true, receipt_count: true },
      valid: true,
      block_absent: false,
    };
  }

  // Both blocks present — compare all five fields
  const matches: LedgerCountCrossCheck['matches'] = {
    task_count: true, gate_count: true, lock_count: true,
    acceptance_test_count: true, receipt_count: true,
  };

  let allMatch = true;

  for (const { field, label, matchKey } of COUNT_FIELDS) {
    const errorCode = `${codePrefix}_${COUNT_FIELD_SUFFIXES[label]}`;
    const declared = packetDeclared[field];
    const reportedVal = reported[field];

    // Skip comparison if the file block simply doesn't include this field
    if (reportedVal === null) continue;

    if (declared !== null && declared !== reportedVal) {
      issues.push(issue('error', errorCode,
        `Count mismatch [${label}]: packet declares ${declared}, file reports ${reportedVal}`,
        'VERIFICATION_LEDGER'));
      matches[matchKey] = false;
      allMatch = false;
    }
  }

  return {
    packet_declared: packetDeclared,
    ledger_reported: reported,
    matches,
    valid: allMatch,
    block_absent: false,
  };
}

// ── Main ledger validator ─────────────────────────────────────

export function validateLedger(
  packet: ParsedPacket,
  markers: DriftMarker[],
  ledgerPath: string,
  ledgerRaw?: string
): LedgerValidationResult {
  const issues: ValidationIssue[] = [];

  const countOk             = checkTaskCount(packet, markers, issues);
  const { contiguous, noDuplicates } = checkMarkerContiguity(markers, issues);
  const requiredOk          = checkRequiredTaskStatuses(packet, markers, issues);
  checkEvidenceRefs(markers, issues);
  const { ok: checksumsOk, stats: evidenceStats } = checkEvidenceChecksums(markers, issues);

  // Phase 4: count cross-check
  const rawForCrossCheck = ledgerRaw ?? '';
  const crossCheck = checkLedgerCountCrossCheck(packet, rawForCrossCheck, issues);

  const errors   = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const info     = issues.filter(i => i.severity === 'info').length;

  return {
    valid: errors === 0,
    ledger_file: ledgerPath,
    packet_task_count: packet.executionPlan?.task_count ?? 0,
    ledger_marker_count: markers.length,
    issues,
    summary: { errors, warnings, info },
    checks: {
      task_count_matches:            countOk,
      marker_ids_contiguous:         contiguous,
      no_duplicate_markers:          noDuplicates,
      required_tasks_complete:       requiredOk,
      evidence_refs_valid:           !issues.some(i => i.code === 'LED_007' && i.severity === 'error'),
      checksums_valid:               checksumsOk,
      no_retrying_at_completion:     !issues.some(i => i.code === 'LED_006'),
      ledger_count_crosscheck_valid: crossCheck.valid,
    },
    evidence_validation: evidenceStats,
    ledger_count_crosscheck: crossCheck,
  };
}
