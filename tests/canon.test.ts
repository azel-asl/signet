// XAS-CANON-1 test suite — the keystone tests.
// Two semantically-equal records MUST hash identically;
// one edited meaning field MUST NOT.

import { describe, it, expect } from 'vitest';
import { canonicalize, canonHash, receiptSemanticCore, h10, receiptSha256 } from '../src/canon.js';
import { parsePacket } from '../src/parser.js';
import { govern } from '../src/runtime.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEMO = readFileSync(resolve(__dirname, '../examples/runtime-lock.packet.md'), 'utf-8');

function fixedClock(start: string): () => Date {
  let calls = 0;
  return () => new Date(new Date(start).getTime() + (calls++) * 1000);
}

describe('XAS-CANON-1: canonicalize', () => {
  it('1. key order independence — same entries, different insertion order', () => {
    const a = { x: 1, y: 'two', z: [3] };
    const b: Record<string, unknown> = {};
    b['z'] = [3]; b['x'] = 1; b['y'] = 'two';
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonHash(a)).toBe(canonHash(b));
  });

  it('1b. nested key sorting', () => {
    const a = { outer: { b: 2, a: 1 } };
    const b = { outer: { a: 1, b: 2 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"outer":{"a":1,"b":2}}');
  });

  it('2. NFC normalization — composed vs decomposed café', () => {
    const composed = { v: 'café' };          // é as single code point
    const decomposed = { v: 'café' };       // e + combining acute
    expect(canonHash(composed)).toBe(canonHash(decomposed));
  });

  it('3. absent vs null are different; undefined is absent', () => {
    expect(canonHash({ a: 1 })).not.toBe(canonHash({ a: 1, b: null }));
    expect(canonHash({ a: 1, b: undefined })).toBe(canonHash({ a: 1 }));
  });

  it('3b. undefined inside array throws', () => {
    expect(() => canonicalize({ a: [1, undefined, 3] })).toThrow();
  });

  it('4. number formats — 1.0 → 1, 1e2 → 100, non-finite throws', () => {
    expect(canonicalize({ n: 1.0 })).toBe('{"n":1}');
    expect(canonicalize({ n: 1e2 })).toBe('{"n":100}');
    expect(() => canonicalize({ n: NaN })).toThrow();
    expect(() => canonicalize({ n: Infinity })).toThrow();
  });

  it('6. arrays are order-preserving (order is semantic)', () => {
    expect(canonHash({ a: [1, 2] })).not.toBe(canonHash({ a: [2, 1] }));
  });

  it('7. round-trip stability', () => {
    const x = { b: [1, 'two', { d: null, c: true }], a: 'café' };
    const once = canonicalize(x);
    expect(canonicalize(JSON.parse(once))).toBe(once);
  });
});

describe('XAS-CANON-1: receipt hashing', () => {
  it('5. receipt stability — same packet, different timestamps → same h10, different sha256', () => {
    const p1 = parsePacket(DEMO);
    const p2 = parsePacket(DEMO);
    const r1 = govern(p1, { now: fixedClock('2026-06-10T00:00:00Z') }).receipt;
    const r2 = govern(p2, { now: fixedClock('2026-06-11T12:34:56Z') }).receipt;

    expect(r1.hashes.h10).toBe(r2.hashes.h10);          // same governance outcome
    expect(r1.hashes.sha256).not.toBe(r2.hashes.sha256); // different bytes
  });

  it('6. meaning change — flipping a task status changes h10', () => {
    const r = govern(parsePacket(DEMO), { now: fixedClock('2026-06-10T00:00:00Z') }).receipt;
    const original = h10(r);

    const mutated = structuredClone(r);
    mutated.task_results[0].status = 'BLOCKED';
    expect(h10(mutated)).not.toBe(original);
  });

  it('h10 ignores prose and timestamps; sha256 does not', () => {
    const r = govern(parsePacket(DEMO), { now: fixedClock('2026-06-10T00:00:00Z') }).receipt;
    const mutated = structuredClone(r);
    mutated.task_results[0].note = 'edited prose';
    expect(h10(mutated)).toBe(r.hashes.h10);
    expect(receiptSha256(mutated)).not.toBe(r.hashes.sha256);
  });

  it('semantic core contains exactly the spec field set', () => {
    const r = govern(parsePacket(DEMO), { now: fixedClock('2026-06-10T00:00:00Z') }).receipt;
    const core = receiptSemanticCore(r) as Record<string, unknown>;
    expect(Object.keys(core).sort()).toEqual([
      'acceptance_results', 'behavioral_reports', 'block_events',
      'gate_results', 'ledger_matches', 'outcome',
      'packet_id', 'packet_sha256', 'task_results', 'verdict',
    ]);
  });
});
