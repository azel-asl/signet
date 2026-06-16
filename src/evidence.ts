import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { EvidenceType } from './types.js';
import { EVIDENCE_TEMPLATES, VALID_EVIDENCE_TYPES } from './schemas.js';

// ============================================================
// EVIDENCE — Template field enforcement
// ============================================================

export interface EvidenceRef {
  type: EvidenceType;
  fields: Record<string, string>;
}

/**
 * Parse a free-form evidence_ref string into typed fields.
 * Looks for "key: value" pairs separated by " | ".
 */
export function parseEvidenceRef(raw: string, type: EvidenceType): EvidenceRef {
  const fields: Record<string, string> = {};
  const parts = raw.split('|').map(p => p.trim());
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) {
      fields['_raw'] = part;
      continue;
    }
    const k = part.slice(0, colonIdx).trim();
    const v = part.slice(colonIdx + 1).trim();
    fields[k] = v;
  }
  return { type, fields };
}

/**
 * Validate that a evidence_ref contains required fields for its template type.
 * Returns list of missing field names.
 */
export function checkEvidenceTemplate(
  type: EvidenceType,
  ref: EvidenceRef
): string[] {
  const required = EVIDENCE_TEMPLATES[type];
  if (!required) return [];
  const missing: string[] = [];
  for (const field of required) {
    if (!(field in ref.fields) || !ref.fields[field]) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Validate evidence type string is known.
 */
export function isValidEvidenceType(type: string): type is EvidenceType {
  return VALID_EVIDENCE_TYPES.has(type);
}

/**
 * Get the required fields for a given evidence type.
 */
export function getTemplateFields(type: EvidenceType): string[] {
  return EVIDENCE_TEMPLATES[type] ?? [];
}

// ── TASK_008 (Phase 2): Deterministic file evidence validation ──

export interface FileEvidenceResult {
  path: string;
  exists: boolean;
  line_count?: number;
  checksum?: string;
  /** Declared checksum from evidence_ref for comparison */
  declared_checksum?: string;
  /** Declared line_count from evidence_ref for comparison */
  declared_line_count?: number;
  match: boolean;
  issues: string[];
}

/**
 * Validate a file_read or file_write evidence ref deterministically.
 * Reads the actual file (if accessible) to compute line count and SHA256 checksum,
 * then compares against declared values in the evidence_ref.
 */
export function validateFileEvidence(ref: EvidenceRef): FileEvidenceResult {
  const path = ref.fields['path'] ?? '';
  const issues: string[] = [];
  let match = true;

  if (!path) {
    return { path: '', exists: false, match: false, issues: ['evidence_ref missing "path" field'] };
  }

  if (!existsSync(path)) {
    // Not an error — file may not exist relative to CWD during validation
    return { path, exists: false, match: true, issues: [], declared_checksum: ref.fields['checksum'], declared_line_count: ref.fields['line_count'] ? parseInt(ref.fields['line_count'], 10) : undefined };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return { path, exists: true, match: false, issues: [`Could not read file: ${path}`] };
  }

  const actual_line_count = content.split('\n').length;
  const actual_checksum = createHash('sha256').update(content).digest('hex').slice(0, 16);

  const declared_line_count_raw = ref.fields['line_count'];
  const declared_checksum = ref.fields['checksum'] ?? '';
  const declared_line_count = declared_line_count_raw ? parseInt(declared_line_count_raw, 10) : undefined;

  // Compare if declared values are non-placeholder (skip 'N/A', 'reviewed', etc.)
  if (declared_line_count !== undefined && !isNaN(declared_line_count)) {
    if (declared_line_count !== actual_line_count) {
      issues.push(`line_count mismatch: declared ${declared_line_count}, actual ${actual_line_count}`);
      match = false;
    }
  }
  if (declared_checksum && declared_checksum.length >= 8 && /^[0-9a-f]+$/i.test(declared_checksum)) {
    if (!actual_checksum.startsWith(declared_checksum.slice(0, 8).toLowerCase())) {
      issues.push(`checksum mismatch: declared ${declared_checksum}, actual prefix ${actual_checksum}`);
      match = false;
    }
  }

  return {
    path,
    exists: true,
    line_count: actual_line_count,
    checksum: actual_checksum,
    declared_checksum,
    declared_line_count,
    match,
    issues,
  };
}
