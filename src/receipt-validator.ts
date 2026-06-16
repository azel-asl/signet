import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { parseDriftMarkers, parseApprovalRecords } from './parser.js';
import { isFakeChecksum, checkLedgerCountCrossCheck } from './ledger-validator.js';
import type {
  ParsedPacket, DriftMarker, ValidationIssue, EvidenceType, TaskStatus,
  ReceiptValidationResult
} from './types.js';
import { EVIDENCE_TEMPLATES, VALID_EVIDENCE_TYPES } from './schemas.js';
import { scanForbiddenOutputs, checkHumanGateApprovals } from './governance.js';

// ============================================================
// RECEIPT VALIDATOR — Phase 5 Strict Receipt Validation
// Validates a final human-written receipt against packet rules.
// Stricter than ledger validation:
//   - REC_009: fake checksum on MISSING file = ERROR (vs LED_009 warning)
//   - REC_017: agent_assertion without Drift Report = WARNING
// Does NOT execute packets — reads and validates evidence only.
// ============================================================

// ── Issue helper ─────────────────────────────────────────────

function issue(
  severity: 'error' | 'warning' | 'info',
  code: string,
  message: string,
  location?: string
): ValidationIssue {
  return { severity, code, message, location };
}

// ── Evidence ref field parser ─────────────────────────────────

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

// ── REC_001: Receipt task count check ────────────────────────

function checkReceiptTaskCount(
  packet: ParsedPacket,
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  const declared = packet.executionPlan?.task_count ?? 0;
  const actual   = markers.length;
  if (declared === 0 && actual === 0) return true;
  if (declared !== actual) {
    issues.push(issue('error', 'REC_001',
      `Task count mismatch: packet declares ${declared} tasks, receipt has ${actual} markers`));
    return false;
  }
  return true;
}

// ── REC_002/003: Contiguity + duplicate check ─────────────────

function checkReceiptMarkerContiguity(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): { contiguous: boolean; noDuplicates: boolean } {
  let contiguous   = true;
  let noDuplicates = true;

  const seen = new Set<string>();
  for (const m of markers) {
    if (seen.has(m.task_id)) {
      issues.push(issue('error', 'REC_002',
        `Duplicate receipt marker: ${m.task_id}`, m.task_id));
      noDuplicates = false;
    }
    seen.add(m.task_id);
  }

  const nums = [...seen]
    .filter(id => /^TASK_\d{3}$/.test(id))
    .map(id => parseInt(id.replace('TASK_', ''), 10))
    .sort((a, b) => a - b);

  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      issues.push(issue('error', 'REC_003',
        `Non-contiguous marker IDs: expected TASK_${String(i + 1).padStart(3, '0')}, ` +
        `found TASK_${String(nums[i]).padStart(3, '0')}`));
      contiguous = false;
      break;
    }
  }

  return { contiguous, noDuplicates };
}

// ── REC_004/005/006: Required task status validation ──────────

const FINAL_STATUSES: TaskStatus[] = ['COMPLETE', 'SKIPPED', 'BLOCKED', 'FAILED'];
const BAD_REQUIRED_STATUSES: TaskStatus[] = ['FAILED', 'SKIPPED', 'BLOCKED', 'RETRYING'];

function checkReceiptRequiredTaskStatuses(
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
      issues.push(issue('error', 'REC_004',
        `Required task ${task.id} has no receipt marker`, task.id));
      ok = false;
      continue;
    }
    if (BAD_REQUIRED_STATUSES.includes(marker.status as TaskStatus)) {
      issues.push(issue('error', 'REC_005',
        `Required task ${task.id} has invalid status in receipt: ${marker.status}`, task.id));
      ok = false;
    }
  }

  // RETRYING at completion
  const hasRetrying = markers.some(m => m.status === 'RETRYING');
  if (hasRetrying) {
    const nonRetrying = markers.filter(m => m.status !== 'RETRYING');
    const allFinal    = nonRetrying.every(m => FINAL_STATUSES.includes(m.status as TaskStatus));
    if (allFinal) {
      for (const m of markers.filter(m => m.status === 'RETRYING')) {
        issues.push(issue('error', 'REC_006',
          `Receipt marker ${m.task_id}: RETRYING at completion — all other tasks are at final status`,
          m.task_id));
        ok = false;
      }
    }
  }

  return ok;
}

// ── REC_007: Evidence_ref template field validation ───────────

function checkReceiptEvidenceRefs(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): boolean {
  for (const m of markers) {
    if (!VALID_EVIDENCE_TYPES.has(m.evidence_type)) continue;
    const evType = m.evidence_type as EvidenceType;
    const required = EVIDENCE_TEMPLATES[evType] ?? [];
    if (!m.evidence_ref.includes(':') || !m.evidence_ref.includes('|')) continue;
    const fields  = parseRefFields(m.evidence_ref);
    const missing = required.filter(f => !fields[f]);
    if (missing.length > 0) {
      issues.push(issue('warning', 'REC_007',
        `Receipt marker ${m.task_id}: evidence_ref for "${evType}" missing fields: ${missing.join(', ')}`,
        m.task_id));
    }
  }
  return true;
}

// ── REC_008/009/010/011: Strict checksum validation ──────────
//
// STRICT MODE difference vs ledger:
//   LED_009 (ledger): fake checksum on missing file → WARNING
//   REC_009 (receipt): fake checksum on missing file → ERROR
//
// Rationale: a final receipt should have been written when files existed.
// A placeholder in a receipt for a non-existent file is a stronger signal
// of fabricated evidence than in a ledger.

export interface ReceiptEvidenceStats {
  total: number;
  validated: number;
  failed: number;
  skipped: number;
}

function checkReceiptEvidenceChecksums(
  markers: DriftMarker[],
  issues: ValidationIssue[]
): { ok: boolean; stats: ReceiptEvidenceStats } {
  let ok = true;
  const stats: ReceiptEvidenceStats = { total: 0, validated: 0, failed: 0, skipped: 0 };

  for (const m of markers) {
    if (m.evidence_type !== 'file_read' && m.evidence_type !== 'file_write') continue;
    if (!m.evidence_ref.includes(':')) continue;

    const fields           = parseRefFields(m.evidence_ref);
    const path             = fields['path'];
    const declaredChecksum = (fields['checksum'] ?? '').trim();

    if (!path) continue;

    stats.total++;

    const fileExists = existsSync(path);

    // Fake checksum check
    if (declaredChecksum && isFakeChecksum(declaredChecksum)) {
      if (fileExists) {
        // Same as ledger LED_008: error (file exists but fake checksum)
        issues.push(issue('error', 'REC_008',
          `Receipt marker ${m.task_id}: fake checksum placeholder "${declaredChecksum}" ` +
          `for existing file "${path}" — must provide actual SHA256`,
          m.task_id));
        stats.failed++;
        ok = false;
      } else {
        // STRICT: unlike LED_009 (warning), REC_009 is an ERROR
        issues.push(issue('error', 'REC_009',
          `STRICT: Receipt marker ${m.task_id}: fake checksum placeholder "${declaredChecksum}" ` +
          `for "${path}" (file not found). Final receipts must use actual SHA256 computed at ` +
          `task completion time — placeholder evidence is not accepted.`,
          m.task_id));
        stats.failed++;
        ok = false;
      }
      continue;
    }

    if (!fileExists) {
      stats.skipped++;
      continue;
    }

    // File exists — compute SHA256
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
      issues.push(issue('warning', 'REC_010',
        `Receipt marker ${m.task_id}: file "${path}" exists but no checksum declared ` +
        `(actual SHA256: ${actual.slice(0, 16)}...)`,
        m.task_id));
      continue;
    }

    const norm = declaredChecksum.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (norm.length >= 8 && !actual.startsWith(norm.slice(0, 16))) {
      issues.push(issue('error', 'REC_011',
        `Receipt marker ${m.task_id}: SHA256 mismatch for "${path}" — ` +
        `declared ${declaredChecksum}, actual ${actual.slice(0, 16)}...`,
        m.task_id));
      stats.failed++;
      ok = false;
    }
  }

  return { ok, stats };
}

// ── REC_017: agent_assertion drift report check ───────────────

function checkReceiptAgentAssertions(
  markers: DriftMarker[],
  receiptRaw: string,
  issues: ValidationIssue[]
): boolean {
  const agentMarkers = markers.filter(m => m.evidence_type === 'agent_assertion');
  if (agentMarkers.length === 0) return true;

  // Check for "Drift Report" section in receipt text (case-insensitive)
  const hasDriftReport = /drift\s+report/i.test(receiptRaw);
  if (!hasDriftReport) {
    for (const m of agentMarkers) {
      issues.push(issue('warning', 'REC_017',
        `Receipt marker ${m.task_id}: agent_assertion evidence must be listed in a ` +
        `"Drift Report" section of the receipt file (ASL policy: agent_assertion required_in_drift_report = true)`,
        m.task_id));
    }
    return false;
  }
  return true;
}

// ── Main receipt validator ────────────────────────────────────

export function validateReceipt(
  packet: ParsedPacket,
  receiptRaw: string,
  receiptPath: string
): ReceiptValidationResult {
  const markers = parseDriftMarkers(receiptRaw);
  const issues: ValidationIssue[] = [];

  const countOk             = checkReceiptTaskCount(packet, markers, issues);
  const { contiguous, noDuplicates } = checkReceiptMarkerContiguity(markers, issues);
  const requiredOk          = checkReceiptRequiredTaskStatuses(packet, markers, issues);
  checkReceiptEvidenceRefs(markers, issues);
  const { ok: checksumsOk, stats } = checkReceiptEvidenceChecksums(markers, issues);
  const agentOk             = checkReceiptAgentAssertions(markers, receiptRaw, issues);
  // v1.5.2: forbidden-output scan + signed human-gate approval enforcement
  const forbiddenClean      = scanForbiddenOutputs(packet, markers, issues);
  const approvals           = parseApprovalRecords(receiptRaw);
  const humanApprovalsOk    = checkHumanGateApprovals(packet, approvals, issues);
  // Count cross-check uses 'REC' prefix for error codes
  const crossCheck          = checkLedgerCountCrossCheck(packet, receiptRaw, issues, 'REC');

  const errors   = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const info     = issues.filter(i => i.severity === 'info').length;

  return {
    valid: errors === 0,
    receipt_file: receiptPath,
    packet_task_count: packet.executionPlan?.task_count ?? 0,
    receipt_marker_count: markers.length,
    strict_mode: true,
    issues,
    summary: { errors, warnings, info },
    checks: {
      task_count_matches:              countOk,
      marker_ids_contiguous:           contiguous,
      no_duplicate_markers:            noDuplicates,
      required_tasks_complete:         requiredOk,
      evidence_refs_valid:             !issues.some(i => i.code === 'REC_007' && i.severity === 'error'),
      checksums_valid:                 checksumsOk,
      no_retrying_at_completion:       !issues.some(i => i.code === 'REC_006'),
      agent_assertions_in_drift_report: agentOk,
      receipt_count_crosscheck_valid:  crossCheck.valid,
      forbidden_outputs_clean:         forbiddenClean,
      human_gate_approvals_present:    humanApprovalsOk,
    },
    evidence_validation: stats,
    receipt_count_crosscheck: crossCheck,
  };
}
