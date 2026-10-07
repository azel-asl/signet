// XAS-CANON-1 canonical JSON + sha256. The replay-equality key for ATLAS V0.
//
// Faithful behavioral port of Signet src/canon.ts `canonValue` (16 §B2).
// There is no runtime dependency on Signet; the observable behavior matches:
//   - strings and object keys NFC-normalized
//   - keys sorted by JavaScript's default string sort (UTF-16 code units) on the
//     raw key, then emitted normalized
//   - numbers via JSON.stringify (shortest round-trip); non-finite throws
//   - null/booleans as literals; arrays order-preserving
//   - undefined object fields omitted; undefined as a value or in an array throws
//   - bigint/function/symbol throw
//   - all thrown errors carry the `XAS-CANON-1:` prefix
//   - sha256 over the UTF-8 bytes of the canonical string
import { createHash } from 'node:crypto';

function canonValue(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;

  if (t === 'string') {
    return JSON.stringify((value as string).normalize('NFC'));
  }
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(`XAS-CANON-1: non-finite number not allowed: ${n}`);
    }
    return JSON.stringify(n);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') {
    throw new Error('XAS-CANON-1: undefined cannot be serialized as a value');
  }

  if (Array.isArray(value)) {
    const parts = value.map((v) => {
      if (v === undefined) {
        throw new Error('XAS-CANON-1: undefined inside array not allowed');
      }
      return canonValue(v);
    });
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k.normalize('NFC'))}:${canonValue(obj[k])}`);
    return `{${parts.join(',')}}`;
  }

  throw new Error(`XAS-CANON-1: unsupported type: ${t}`);
}

/** XAS-CANON-1: canonical JSON string of a value. */
export function canonicalJson(value: unknown): string {
  return canonValue(value);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** state_hash(T) = sha256(canonicalJson({state, metrics})) — the replay contract (04). */
export function stateHash(state: unknown, metrics: unknown): string {
  return sha256Hex(canonicalJson({ state, metrics }));
}
