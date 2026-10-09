// ATLAS M4 DIAGNOSE: evidence reference resolution per 18 §I.
// Used at construction (E4) and by the facade resolveDiagnosticEvidence.
// Every reference must resolve; a dangling ref is a defect.
import type { AtlasEvent, World } from '../types.js';
import type { Claim, Ref } from './types.js';
import { DiagnosisError } from './types.js';

/**
 * Resolve a JSON pointer (RFC 6901) against an object.
 * Returns undefined if the pointer does not resolve.
 */
export function resolvePointer(obj: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) return undefined;
  const parts = pointer.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      if (!(part in (current as Record<string, unknown>))) return undefined;
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Resolve a single evidence reference.
 * Returns the resolved value, or undefined if it does not resolve.
 */
export function resolveRef(
  world: World,
  ledger: AtlasEvent[],
  snap: Record<string, unknown>,
  ref: Ref,
): unknown {
  if (ref.kind === 'event') {
    const event = ledger.find((e) => e.event_id === ref.event_id);
    return event;
  }
  if (ref.kind === 'state') {
    return resolvePointer(snap, ref.path!);
  }
  if (ref.kind === 'world') {
    return resolvePointer(world as unknown as Record<string, unknown>, ref.path!);
  }
  if (ref.kind === 'world_rule') {
    const rules = (world.rules as { id: string }[] | undefined) ?? [];
    return rules.find((r) => r.id === ref.rule);
  }
  return undefined;
}

/**
 * Assert that every evidence reference in every claim resolves.
 * Throws DiagnosisError('EPISTEMIC_VIOLATION') on the first dangling ref (E4).
 * Called by diagnoseAtTime before returning (Fix 3).
 */
export function assertEvidenceResolves(
  world: World,
  ledger: AtlasEvent[],
  snap: Record<string, unknown>,
  claims: Claim[],
): void {
  for (const claim of claims) {
    for (const ref of claim.evidence) {
      const value = resolveRef(world, ledger, snap, ref);
      if (value === undefined || value === null) {
        throw new DiagnosisError('EPISTEMIC_VIOLATION',
          `E4: dangling evidence reference in ${claim.id}: ${JSON.stringify(ref)}`);
      }
    }
  }
}
