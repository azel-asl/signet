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
  // Claim IDs must be unique.
  // CCR-005 C1: subject segment allows hyphens; unknowns use c:unknown_<reason>:<subject>.
  const ids = new Set<string>();
  for (const claim of diagnosis.claims) {
    if (ids.has(claim.id)) {
      throw new DiagnosisError('SCHEMA_VIOLATION', `duplicate claim id ${claim.id}`);
    }
    ids.add(claim.id);
    if (!/^c:[a-z_]+:[a-z0-9_-]+$/.test(claim.id)) {
      throw new DiagnosisError('SCHEMA_VIOLATION', `bad claim id ${claim.id}`);
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
