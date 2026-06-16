// Signet — XAS-CANON-1 Canonical Serialization + Hashing
// OPEN MODULE — permanently open source.
// MUST NOT import governance.ts or any closed runtime module.
// Imports: node:crypto only. Consumed by governance.ts AND verify.ts.

import { createHash } from 'node:crypto';
import type { GovernanceReceipt, EnforcementReceipt } from './types.js';

// ============================================================
// XAS-CANON-1 — Canonicalization rules (normative):
//  1. Strings UTF-8, NFC-normalized
//  2. Object keys sorted by Unicode code point, every level
//  3. No insignificant whitespace; separators "," and ":"
//  4. Numbers: RFC 8785 / JCS (shortest round-trip; reject non-finite)
//  5. Booleans/null lowercase literals
//  6. Arrays order-preserving
//  7. Absent ≠ null: undefined fields omitted; undefined in arrays throws
//  8. Hash input = raw UTF-8 bytes of canonical string
// ============================================================

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
    // JSON.stringify of a JS number conforms to JCS shortest round-trip
    return JSON.stringify(n);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined') {
    throw new Error('XAS-CANON-1: undefined cannot be serialized as a value');
  }

  if (Array.isArray(value)) {
    const parts = value.map(v => {
      if (v === undefined) {
        throw new Error('XAS-CANON-1: undefined inside array not allowed');
      }
      return canonValue(v);
    });
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    // Rule 7: omit undefined-valued fields entirely
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort(); // lexicographic by code point — default JS sort on strings
    const parts = keys.map(k => {
      const keyStr = JSON.stringify(k.normalize('NFC'));
      return `${keyStr}:${canonValue(obj[k])}`;
    });
    return `{${parts.join(',')}}`;
  }

  throw new Error(`XAS-CANON-1: unsupported type: ${t}`);
}

/** RFC 8785-style canonical JSON serialization + Signet rules (XAS-CANON-1). */
export function canonicalize(value: unknown): string {
  return canonValue(value);
}

/** SHA-256 hex of canonicalize(value) as UTF-8 bytes. */
export function canonHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

/** SHA-256 hex of a raw string (used to bind receipts to exact packet text). */
export function sha256text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ============================================================
// Semantic core — h10 input for governance receipts.
// h10 answers "did the governance OUTCOME change?"
// Excluded by design: receipt_id, timestamps, summary, prose
// fields, attribution, evidence_mode, parent_receipt_id,
// hashes, signature.
// ============================================================

/** Extracts the semantic core of a governance receipt (exhaustive field list). */
export function receiptSemanticCore(receipt: GovernanceReceipt): object {
  return {
    packet_id: receipt.packet.id,
    packet_sha256: receipt.packet.sha256,
    verdict: receipt.verdict,
    outcome: receipt.outcome,
    task_results: receipt.task_results.map(t => ({
      task_id: t.task_id,
      status: t.status,
      required: t.required,
      blocked_by: t.blocked_by,
    })),
    block_events: receipt.block_events.map(b => ({
      task_id: b.task_id,
      lock_id: b.lock_id,
      matched_pattern: b.matched_pattern,
      matched_target: b.matched_target,
      pattern_source: b.pattern_source,
    })),
    gate_results: receipt.gate_results.map(g => ({
      gate_id: g.gate_id,
      result: g.result,
    })),
    acceptance_results: receipt.acceptance_results.map(a => ({
      at_id: a.at_id,
      result: a.result,
    })),
    behavioral_reports: receipt.behavioral_reports.map(r => ({
      lock_id: r.lock_id,
      result: r.result,
    })),
    ledger_matches: receipt.ledger_crosscheck.matches,
  };
}

/** h10 = canonHash(receiptSemanticCore(receipt)) */
export function h10(receipt: GovernanceReceipt): string {
  return canonHash(receiptSemanticCore(receipt));
}

/**
 * sha256 input for a receipt: the receipt with `hashes` and `signature`
 * DELETED (not nulled — per rule 7), then canonicalized.
 */
export function receiptSha256(receipt: GovernanceReceipt): string {
  const { hashes: _h, signature: _s, ...rest } = receipt;
  return canonHash(rest);
}

// ============================================================
// v0.3 — Enforcement receipt hashing (hook interception).
// Shared by the builder (enforce.ts) and the verifier (verify.ts)
// so there is exactly one definition of what the hashes commit to.
// ============================================================

/** Semantic core of an enforcement receipt: what was denied, by which lock. */
export function enforcementSemanticCore(receipt: EnforcementReceipt): object {
  return {
    packet_id: receipt.packet.id,
    packet_sha256: receipt.packet.sha256,
    mode: receipt.mode,
    denials: receipt.summary.denials,
    events: receipt.events.map(e => ({
      tool_name: e.tool_name,
      target: e.target,
      matched_pattern: e.matched_pattern,
      pattern_source: e.pattern_source,
      lock_id: e.lock_id,
      decision: e.decision,
    })),
  };
}

/** h10 for enforcement receipts = canonHash of the semantic core. */
export function enforcementH10(receipt: EnforcementReceipt): string {
  return canonHash(enforcementSemanticCore(receipt));
}

/** sha256 for enforcement receipts: hashes + signature deleted, then canonicalized. */
export function enforcementSha256(receipt: EnforcementReceipt): string {
  const { hashes: _h, signature: _s, ...rest } = receipt;
  return canonHash(rest);
}
