// ATLAS M4 DIAGNOSE: pack-agnostic core per 18 §A, §D, §H.
// Knows no domain words. Handles: claim model, link validation,
// epistemic non-escalation (E1-E6), DAG acyclicity, hashing.
import { canonHash } from '../simulate.js';
import type { Claim, Diagnosis, DiagnosisContext } from './types.js';
import { DiagnosisError } from './types.js';

export const DIAGNOSTICS_VERSION = 'atlas-diagnose/0.1.0';

/** Kind order for claim sorting per §C.2. */
export const KIND_ORDER: string[] = [
  'overload', 'backlog', 'backlog_growth', 'demand_vs_capacity',
  'at_capacity', 'capacity_limit', 'equipment_degradation',
  'assembly_blocking', 'unknown',
];

/**
 * Validate epistemic non-escalation rules E1-E6.
 * Throws DiagnosisError('EPISTEMIC_VIOLATION') on violation.
 */
export function validateEpistemic(diagnosis: Diagnosis): void {
  const byId = new Map(diagnosis.claims.map((c) => [c.id, c]));
  const ctxClass = diagnosis.context.claim_class;

  for (const claim of diagnosis.claims) {
    // E1: non-inference claim_class equals context.claim_class.
    if (claim.basis !== 'inference' && claim.claim_class !== ctxClass) {
      throw new DiagnosisError('EPISTEMIC_VIOLATION',
        `E1: claim ${claim.id} class ${claim.claim_class} != context ${ctxClass}`);
    }
    // E2: inference requires inferred/bounded/confidence.
    if (claim.basis === 'inference') {
      if (claim.claim_class !== 'inferred' || claim.support !== 'bounded' || !claim.confidence) {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E2: inference claim ${claim.id} must be inferred/bounded/with-confidence`);
      }
    } else {
      if (claim.claim_class === 'inferred') {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E2: non-inference claim ${claim.id} cannot be inferred`);
      }
    }
    // E4: deterministic requires evidence (unknown exempted by schema).
    if (claim.support === 'deterministic' && claim.kind !== 'unknown' && claim.evidence.length === 0) {
      throw new DiagnosisError('EPISTEMIC_VIOLATION',
        `E4: deterministic claim ${claim.id} has no evidence`);
    }
    // E5: only three link types.
    for (const link of claim.links) {
      if (!['supports', 'limited_by', 'blocks'].includes(link.rel)) {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E5: claim ${claim.id} has forbidden link rel ${link.rel}`);
      }
      if (!byId.has(link.to)) {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E5: claim ${claim.id} links to unknown ${link.to}`);
      }
    }
  }

  // E3 (CCR-005 C2): for every link, rank(dependent.support) <= rank(dependency.support).
  // Dependent/dependency per link direction:
  //   supports   A→B (A supports B):    dependent=B, dependency=A
  //   limited_by A→B (A limited by B):   dependent=A, dependency=B
  //   blocks     A→B (A blocks B):       dependent=B, dependency=A
  // Ranks: deterministic=2 > bounded=1 > none=0.
  const rank = (s: string): number =>
    s === 'deterministic' ? 2 : s === 'bounded' ? 1 : 0;
  for (const claim of diagnosis.claims) {
    for (const link of claim.links) {
      const other = byId.get(link.to);
      if (!other) continue; // E5 already rejects dangling links.
      let dependent: typeof claim;
      let dependency: typeof claim;
      if (link.rel === 'supports') {
        dependent = other;      // B depends on A
        dependency = claim;     // A is the support
      } else if (link.rel === 'limited_by') {
        dependent = claim;      // A depends on B
        dependency = other;     // B is the limitation
      } else { // blocks
        dependent = other;      // B (downstream) depends on A
        dependency = claim;     // A is the blocker
      }
      if (rank(dependent.support) > rank(dependency.support)) {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E3: ${dependent.id} (${dependent.support}) cannot depend on ` +
          `${dependency.id} (${dependency.support}) via ${link.rel}`);
      }
    }
  }
}

/**
 * Validate the claim DAG is acyclic.
 * Throws DiagnosisError('CYCLIC_CLAIMS') on cycle.
 */
export function validateAcyclic(claims: Claim[]): void {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new DiagnosisError('CYCLIC_CLAIMS', `cycle detected at ${id}`);
    }
    visiting.add(id);
    const claim = byId.get(id);
    if (claim) {
      for (const link of claim.links) {
        visit(link.to);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const claim of claims) {
    visit(claim.id);
  }
}

/**
 * Compute diagnosis_id: 'dx_' + first 16 hex of canonHash({context, claims}).
 */
export function computeDiagnosisId(context: DiagnosisContext, claims: Claim[]): string {
  const hash = canonHash({ context, claims });
  return 'dx_' + hash.slice(0, 16);
}

/**
 * Compute diagnosis_hash: canonHash(diagnosis minus diagnosis_hash).
 * Must be called last, after diagnosis_id is set.
 */
export function computeDiagnosisHash(diagnosis: Omit<Diagnosis, 'diagnosis_hash'>): string {
  return canonHash(diagnosis);
}

/**
 * Sort claims by (subject in world order, kind order §C.2).
 */
export function sortClaims(claims: Claim[], worldOrder: string[]): Claim[] {
  const orderIdx = new Map(worldOrder.map((id, i) => [id, i]));
  return [...claims].sort((a, b) => {
    const ao = orderIdx.get(a.subject) ?? 9999;
    const bo = orderIdx.get(b.subject) ?? 9999;
    if (ao !== bo) return ao - bo;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });
}

/**
 * Compute roots: claim ids with role symptom, plus unknowns.
 * Ordered by world order.
 */
export function computeRoots(claims: Claim[], worldOrder: string[]): string[] {
  const orderIdx = new Map(worldOrder.map((id, i) => [id, i]));
  return claims
    .filter((c) => c.role === 'symptom' || c.role === 'unknown')
    .sort((a, b) => (orderIdx.get(a.subject) ?? 9999) - (orderIdx.get(b.subject) ?? 9999))
    .map((c) => c.id);
}
