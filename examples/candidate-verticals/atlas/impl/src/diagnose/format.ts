// ATLAS M4 DIAGNOSE: checked-template formatter per 18 §L.
// Pure function of a claim: template + values → one line.
// Post-check: numerals match values; no forbidden words.
import type { Claim } from './types.js';
import { DiagnosisError } from './types.js';

/** The 9 templates, verbatim from §L. */
const TEMPLATES: Record<string, string> = {
  T_OVERLOAD: '{subject_name} is {status}: queue {queue_len}, oldest wait {oldest_wait_s}s (thresholds: queue {overload_queue}, wait {overload_wait_s}s).',
  T_BACKLOG: '{subject_name} has {queue_len} waiting; oldest {oldest_wait_s}s.',
  T_BACKLOG_GROWTH: '{subject_name} queue grew from {queue_at_window_start} to {queue_at_t} in the last {window_minutes} minutes.',
  T_DEMAND_VS_CAPACITY: '{subject_name} received {demand_work_s}s of required work against {capacity_work_s}s of capacity in the last {window_minutes} minutes (ratio {ratio}, using nominal durations).',
  T_AT_CAPACITY: '{subject_name} is at capacity: {in_progress} in progress of {effective}.',
  T_CAPACITY_LIMIT: '{subject_name} capacity {effective} is limited by {class_text}: one more staff member adds {add_one_staff}; one more equipment slot adds {add_one_equipment_slot_text}.',
  T_EQUIPMENT_DEGRADATION: '{equipment_name} is {status} ({capacity}/{nominal_capacity}); restoring it {raises_text} {subject_name} capacity.',
  T_ASSEMBLY_BLOCKING: '{count_sole} open orders are held only by work at {subject_name}: {order_list}.',
  T_UNKNOWN: 'ATLAS cannot determine {detail} for {subject_name} ({reason}).',
};

/** Forbidden words from §E. */
const FORBIDDEN = [
  'cause', 'caused', 'causes', 'because of', 'due to',
  'resulted in', 'led to', 'unhappy', 'revenue', 'should', 'recommend',
];

/**
 * Format a claim into one line.
 * @param claim The claim to format.
 * @param simulated Whether to prefix with 'SIMULATED · '.
 */
export function formatClaim(claim: Claim, simulated: boolean): string {
  const template = TEMPLATES[claim.template];
  if (!template) {
    throw new DiagnosisError('FORMAT_VIOLATION', `unknown template ${claim.template}`);
  }

  // Substitute values.
  let text = template;
  for (const [key, value] of Object.entries(claim.values)) {
    const placeholder = `{${key}}`;
    if (text.includes(placeholder)) {
      text = text.split(placeholder).join(String(value ?? ''));
    }
  }

  // Check for unsubstituted placeholders (except names which are optional).
  const remaining = text.match(/\{[a-z_]+\}/g);
  if (remaining) {
    throw new DiagnosisError('FORMAT_VIOLATION',
      `unsubstituted placeholders in ${claim.id}: ${remaining.join(', ')}`);
  }

  // Post-check: numerals must match values.
  // Remove text from *_name fields and order_list before checking.
  let checkText = text;
  for (const [key, value] of Object.entries(claim.values)) {
    if (key.endsWith('_name') || key === 'order_list') {
      checkText = checkText.split(String(value ?? '')).join('');
    }
  }
  const numerals = checkText.match(/\d+(\.\d+)?/g) || [];
  const valueNumbers = new Set<string>();
  for (const value of Object.values(claim.values)) {
    if (typeof value === 'number') {
      valueNumbers.add(String(value));
      // Also allow the value rounded/formatted differently.
      if (Number.isInteger(value)) valueNumbers.add(String(value));
    }
  }
  for (const num of numerals) {
    if (!valueNumbers.has(num)) {
      throw new DiagnosisError('FORMAT_VIOLATION',
        `numeral ${num} in ${claim.id} not in values`);
    }
  }

  // Post-check: no forbidden words.
  const lowerText = text.toLowerCase();
  for (const word of FORBIDDEN) {
    if (lowerText.includes(word.toLowerCase())) {
      throw new DiagnosisError('FORMAT_VIOLATION',
        `forbidden word '${word}' in ${claim.id}`);
    }
  }

  return simulated ? `SIMULATED · ${text}` : text;
}

/**
 * Format all claims in a diagnosis.
 * Returns lines with claim_id, text, claim_class.
 */
export function formatDiagnosis(
  claims: Claim[],
  claimClass: 'derived' | 'simulated',
): { claim_id: string; text: string; claim_class: string }[] {
  const simulated = claimClass === 'simulated';
  return claims.map((claim) => ({
    claim_id: claim.id,
    text: formatClaim(claim, simulated),
    claim_class: claim.claim_class,
  }));
}
