// XAS-CANON-1 canonical JSON + sha256. The replay-equality key for ATLAS V0.
//
// canonicalJson: recursively sorted object keys, no whitespace, numbers as
// shortest round-trip (JSON.stringify already emits shortest round-trip for
// finite numbers). Objects with the same content hash identically regardless
// of key insertion order.
import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** XAS-CANON-1: canonical JSON string of a JSON value. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** state_hash(T) = sha256(canonicalJson({state, metrics})) — the replay contract (04). */
export function stateHash(state: unknown, metrics: unknown): string {
  return sha256Hex(canonicalJson({ state, metrics }));
}
