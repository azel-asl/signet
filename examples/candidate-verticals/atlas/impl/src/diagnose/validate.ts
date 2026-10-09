// ATLAS M4 DIAGNOSE: schema + epistemic validation per 18 §D, §N (T-SCHEMA, T-EPISTEMIC).
import type { Diagnosis } from './types.js';
import { DiagnosisError } from './types.js';
import { validateEpistemic, validateAcyclic } from './core.js';

/**
 * Validate a diagnosis against the frozen schema (structural checks).
 * Full JSON Schema validation is done in tests via Ajv.
 * This provides fast structural validation for runtime use.
 */
export function validateStructure(diagnosis: Diagnosis): void {
  if (diagnosis.atlas_schema !== 'atlas-diagnosis/0.1') {
    throw new DiagnosisError('SCHEMA_VIOLATION', 'atlas_schema must be atlas-diagnosis/0.1');
  }
  if (!/^dx_[0-9a-f]{16}$/.test(diagnosis.diagnosis_id)) {
    throw new DiagnosisError('SCHEMA_VIOLATION', 'diagnosis_id must match ^dx_[0-9a-f]{16}$');
  }
  if (!/^[0-9a-f]{64}$/.test(diagnosis.diagnosis_hash)) {
    throw new DiagnosisError('SCHEMA_VIOLATION', 'diagnosis_hash must be 64 hex');
  }
  // Claim IDs must be unique and match the amended schema (Fix 5).
  // CCR-005 C1: subject segment allows hyphens; unknowns use c:unknown_<reason>:<subject>.
  // Runtime validation must reject: old-form unknown ids, unsupported reasons,
  // mismatched kind/id prefixes, and malformed ids — not just rely on JSON Schema elsewhere.
  const UNKNOWN_ID_RE = /^c:unknown_(model_unexplained_idle|rule_not_applicable|missing_relationship|insufficient_window|conflicting_facts):[a-z0-9_-]+$/;
  const KNOWN_ID_RE = /^c:(overload|backlog|backlog_growth|demand_vs_capacity|at_capacity|capacity_limit|equipment_degradation|assembly_blocking):[a-z0-9_-]+$/;
  const ids = new Set<string>();
  for (const claim of diagnosis.claims) {
    if (ids.has(claim.id)) {
      throw new DiagnosisError('SCHEMA_VIOLATION', `duplicate claim id ${claim.id}`);
    }
    ids.add(claim.id);
    if (claim.kind === 'unknown') {
      if (!UNKNOWN_ID_RE.test(claim.id)) {
        throw new DiagnosisError('SCHEMA_VIOLATION',
          `bad unknown claim id ${claim.id}: must match ^c:unknown_<reason>:<subject> with a supported reason`);
      }
      // The id's reason slug must match the claim's reason field.
      const m = /^c:unknown_([a-z_]+):/.exec(claim.id);
      const slugReason = m ? m[1].toUpperCase() : null;
      if (claim.reason && slugReason !== claim.reason) {
        throw new DiagnosisError('SCHEMA_VIOLATION',
          `unknown claim id reason slug ${slugReason} mismatches reason field ${claim.reason} in ${claim.id}`);
      }
    } else {
      if (!KNOWN_ID_RE.test(claim.id)) {
        throw new DiagnosisError('SCHEMA_VIOLATION', `bad claim id ${claim.id}`);
      }
      // The id's kind prefix must match the claim's kind.
      const kindPrefix = claim.id.slice(2).split(':')[0];
      if (kindPrefix !== claim.kind) {
        throw new DiagnosisError('SCHEMA_VIOLATION',
          `claim id kind prefix ${kindPrefix} mismatches kind ${claim.kind} in ${claim.id}`);
      }
    }
  }
  // Roots must reference existing claims.
  for (const root of diagnosis.roots) {
    if (!ids.has(root)) {
      throw new DiagnosisError('SCHEMA_VIOLATION', `root ${root} not in claims`);
    }
  }
}

/**
 * Full validation: structure + epistemic + acyclicity.
 */
export function validateDiagnosis(diagnosis: Diagnosis): void {
  validateStructure(diagnosis);
  validateEpistemic(diagnosis);
  validateAcyclic(diagnosis.claims);
}
