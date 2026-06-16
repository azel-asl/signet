import type {
  ParsedPacket, ValidationResult, ValidationIssue, TaskStatus, EvidenceType
} from './types.js';
import { VALID_EVIDENCE_TYPES, EVIDENCE_TEMPLATES } from './schemas.js';

// Lightweight inline helpers (avoid circular dep with evidence.ts)
function parseEvidenceRefSimple(raw: string, _type: EvidenceType): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split('|').map(p => p.trim())) {
    const idx = part.indexOf(':');
    if (idx !== -1) {
      fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return fields;
}

function getTemplateRequiredFields(type: EvidenceType): string[] {
  return EVIDENCE_TEMPLATES[type] ?? [];
}

// ============================================================
// DRIFT — Marker scanner + validation (TASK_022, TASK_023)
// ============================================================

const VALID_STATUSES: TaskStatus[] = ['COMPLETE', 'FAILED', 'SKIPPED', 'BLOCKED', 'RETRYING'];

function issue(
  severity: 'error' | 'warning' | 'info',
  code: string, message: string, location?: string
): ValidationIssue {
  return { severity, code, message, location };
}

// ── TASK_022: Drift marker scanner ──────────────────────────
// (parsing is done in parser.ts — parseDriftMarkers)
// This module validates the parsed markers against the plan.

// ── TASK_023: Drift marker validation ───────────────────────

export function validateDrift(packet: ParsedPacket, result: ValidationResult): void {
  const markers = packet.driftMarkers;
  const plan = packet.executionPlan;
  const issues: ValidationIssue[] = [];

  // 1. declared_task_count == actual_marker_count
  if (plan && markers.length > 0) {
    if (plan.task_count !== markers.length) {
      issues.push(issue('warning', 'DRIFT_001',
        `Drift: declared task_count (${plan.task_count}) ≠ marker count (${markers.length})`));
    }
  }

  // 2. No duplicate marker task IDs
  const seenIds = new Set<string>();
  for (const m of markers) {
    if (seenIds.has(m.task_id)) {
      issues.push(issue('error', 'DRIFT_002',
        `Drift: duplicate marker for ${m.task_id}`, m.task_id));
    }
    seenIds.add(m.task_id);
  }

  // 3. Valid statuses
  for (const m of markers) {
    if (!VALID_STATUSES.includes(m.status)) {
      issues.push(issue('error', 'DRIFT_003',
        `Drift marker ${m.task_id}: invalid status "${m.status}". Valid: ${VALID_STATUSES.join(', ')}`,
        m.task_id));
    }
  }

  // 4. Valid evidence_type in markers
  for (const m of markers) {
    if (!VALID_EVIDENCE_TYPES.has(m.evidence_type)) {
      issues.push(issue('error', 'DRIFT_004',
        `Drift marker ${m.task_id}: invalid evidence_type "${m.evidence_type}"`, m.task_id));
    }
  }

  // 5. All COMPLETE markers must have non-empty evidence_ref
  for (const m of markers) {
    if (m.status === 'COMPLETE' && (!m.evidence_ref || m.evidence_ref.trim() === '')) {
      issues.push(issue('error', 'DRIFT_005',
        `Drift marker ${m.task_id}: status=COMPLETE but evidence_ref is empty`, m.task_id));
    }
  }

  // 6. No RETRYING at completion
  // RETRYING is invalid when all non-RETRYING markers have reached a final status.
  // Final statuses: COMPLETE, SKIPPED, BLOCKED, FAILED.
  const FINAL_STATUSES = ['COMPLETE', 'SKIPPED', 'BLOCKED', 'FAILED'];
  const hasRetrying = markers.some(m => m.status === 'RETRYING');
  if (hasRetrying) {
    const nonRetrying = markers.filter(m => m.status !== 'RETRYING');
    const allNonRetryingFinal = nonRetrying.every(m => FINAL_STATUSES.includes(m.status));
    if (allNonRetryingFinal) {
      for (const m of markers) {
        if (m.status === 'RETRYING') {
          issues.push(issue('error', 'DRIFT_006',
            `Drift marker ${m.task_id}: status=RETRYING at completion — all other tasks are at final status`,
            m.task_id));
        }
      }
    }
  }

  // 7. Check against plan: required tasks must not have SKIPPED/BLOCKED/FAILED status
  if (plan) {
    const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
    for (const m of markers) {
      const t = taskMap.get(m.task_id);
      if (!t) continue;
      if (t.required && m.status === 'SKIPPED') {
        issues.push(issue('error', 'DRIFT_007',
          `Drift marker ${m.task_id}: required task has status=SKIPPED`, m.task_id));
      }
      if (t.required && m.status === 'BLOCKED') {
        issues.push(issue('error', 'DRIFT_008',
          `Drift marker ${m.task_id}: required task has status=BLOCKED`, m.task_id));
      }
      if (t.required && m.status === 'FAILED') {
        issues.push(issue('error', 'DRIFT_009',
          `Drift marker ${m.task_id}: required task has status=FAILED`, m.task_id));
      }
    }
  }

  // 8. agent_assertion markers must appear in drift report (warning)
  for (const m of markers) {
    if (m.evidence_type === 'agent_assertion') {
      issues.push(issue('warning', 'DRIFT_010',
        `Drift marker ${m.task_id}: uses agent_assertion evidence — must be listed in drift report`,
        m.task_id));
    }
  }

  // 9. TASK_010 (Phase 2): Unresolved drift event validation
  // If any FAILED/BLOCKED markers exist, require "Drift Report" section in the packet
  const hasProblemMarkers = markers.some(m =>
    m.status === 'FAILED' || m.status === 'BLOCKED' || m.status === 'RETRYING'
  );
  if (hasProblemMarkers) {
    const hasDriftReport = /drift\s+report/i.test(packet.raw) ||
                           /## drift/i.test(packet.raw) ||
                           /drift_event/i.test(packet.raw);
    if (!hasDriftReport) {
      issues.push(issue('error', 'DRIFT_011',
        'Drift markers include FAILED/BLOCKED/RETRYING status but no Drift Report section found. ' +
        'All drift events require documented cause, impact, and owner acknowledgment before completion.'));
    }
  }

  // 10. Evidence_ref template field validation on drift markers (TASK_007 Phase 2)
  for (const m of markers) {
    if (!VALID_EVIDENCE_TYPES.has(m.evidence_type)) continue; // already caught by DRIFT_004
    const evType = m.evidence_type as EvidenceType;
    const ref = parseEvidenceRefSimple(m.evidence_ref, evType);
    const requiredFields = getTemplateRequiredFields(evType);
    // Only validate if evidence_ref is structured (contains key: value pairs)
    if (m.evidence_ref.includes(':') && m.evidence_ref.includes('|')) {
      const missing = requiredFields.filter(f => !ref[f]);
      if (missing.length > 0) {
        issues.push(issue('warning', 'DRIFT_012',
          `Drift marker ${m.task_id}: evidence_ref for type "${evType}" is missing template fields: ${missing.join(', ')}`,
          m.task_id));
      }
    }
  }

  // Apply drift issues to result
  result.issues.push(...issues);
  const driftErrors = issues.filter(i => i.severity === 'error').length;
  result.checks.drift_markers_valid = driftErrors === 0;
  result.summary.errors += issues.filter(i => i.severity === 'error').length;
  result.summary.warnings += issues.filter(i => i.severity === 'warning').length;
  result.summary.info += issues.filter(i => i.severity === 'info').length;
  if (driftErrors > 0) result.valid = false;
}
