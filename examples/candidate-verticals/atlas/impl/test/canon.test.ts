import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalize, sha256Hex, stateHash } from '../src/canon.js';

describe('canonicalJson (XAS-CANON-1)', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson({ k: [3, 1, 2] })).toBe('{"k":[3,1,2]}');
  });

  it('emits no whitespace', () => {
    const s = canonicalJson({ a: [1, { b: null }] });
    expect(s).not.toMatch(/\s/);
  });

  it('is order-insensitive: same content, different insertion order -> same string', () => {
    const a = { z: 1, a: 2, m: { y: 1, b: 2 } };
    const b = { a: 2, m: { b: 2, y: 1 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('emits numbers as shortest round-trip', () => {
    expect(canonicalJson({ u: 0.228 })).toBe('{"u":0.228}');
    expect(canonicalJson({ u: 1 })).toBe('{"u":1}');
    expect(canonicalJson({ r: 575.5 })).toBe('{"r":575.5}');
  });

  it('canonicalize does not mutate its input', () => {
    const v = { b: 1, a: 2 };
    canonicalize(v);
    expect(Object.keys(v)).toEqual(['b', 'a']);
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('stateHash', () => {
  it('is stable across key order and covers {state, metrics}', () => {
    const h1 = stateHash({ b: 1, a: 2 }, { m: 1 });
    const h2 = stateHash({ a: 2, b: 1 }, { m: 1 });
    const h3 = stateHash({ a: 2, b: 1 }, { m: 2 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
