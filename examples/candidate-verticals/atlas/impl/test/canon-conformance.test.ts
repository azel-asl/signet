// B2: XAS-CANON-1 conformance (16 §B2).
// ATLAS canon.ts is a faithful behavioral port of Signet src/canon.ts canonValue.
// This file: (1) vector table with Signet's literal outputs, (2) test-only
// differential check against Signet's canonicalizer, (3) source scan proving
// no runtime dependency, (4) all six fixture state_hash values reproduce.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canon.js';
// Test-only differential import (relative path, per 16 §B2). Never in src/.
import { canonicalize as signetCanonicalize } from '../../../../../src/canon.js';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { buildSnapshot } from '../src/views.js';
import { FIX, IMPL, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA, EVENT_SCHEMA, tOf } from './paths.js';

const ASTRAL = String.fromCodePoint(0x1f600); // 😀, UTF-16 D83D DE00
const PUA = ''; // U+E000, UTF-16 E000 — sorts AFTER astral in UTF-16, BEFORE in code points

describe('B2.1 conformance vectors (Signet literal outputs)', () => {
  const vectors: [string, unknown, string | 'throws'][] = [
    ['nfc value normalizes', 'caf\u00e9', '"caf\u00e9"'],
    ['nfd value normalizes to nfc', 'cafe\u0301', '"caf\u00e9"'],
    ['nfd key normalizes', { ['cafe\u0301']: 1 }, '{"caf\u00e9":1}'],
    ['-0 emits as 0', -0, '0'],
    ['1e21', 1e21, '1e+21'],
    ['0.1+0.2 shortest round-trip', 0.1 + 0.2, '0.30000000000000004'],
    ['undefined field omitted', { a: 1, b: undefined }, '{"a":1}'],
    ['empty object', {}, '{}'],
    ['empty array', [], '[]'],
    ['nested mixed', [1, 'a', null, true, { z: [2] }], '[1,"a",null,true,{"z":[2]}]'],
    // UTF-16 key order: 'a' (0061) < astral lead (D83D) < PUA (E000)
    ['astral vs pua key order', { [ASTRAL]: 1, [PUA]: 2, a: 3 }, `{"a":3,"${ASTRAL}":1,"${PUA}":2}`],
    ['nan throws', NaN, 'throws'],
    ['+infinity throws', Infinity, 'throws'],
    ['-infinity throws', -Infinity, 'throws'],
    ['undefined top-level throws', undefined, 'throws'],
    ['undefined in array throws', [1, undefined], 'throws'],
    ['bigint throws', 10n, 'throws'],
  ];
  for (const [name, value, expected] of vectors) {
    it(name, () => {
      if (expected === 'throws') {
        expect(() => canonicalJson(value)).toThrow(/^XAS-CANON-1:/);
      } else {
        expect(canonicalJson(value)).toBe(expected);
      }
    });
  }
});

describe('B2.2 differential vs Signet (test-only)', () => {
  // Seeded pseudo-random JSON-like values, biased toward edge cases.
  function genValue(rand: () => number, depth: number): unknown {
    const r = rand();
    if (depth > 3 || r < 0.15) {
      const scalars: unknown[] = [
        null, true, false, 0, -0, 1, -1, 0.1 + 0.2, 1e21, -1e21, 123.456,
        '', 'a', 'caf\u00e9', 'cafe\u0301', ASTRAL, PUA, '\u0000', 'x'.repeat(100),
      ];
      return scalars[Math.floor(rand() * scalars.length)];
    }
    if (r < 0.45) {
      const n = Math.floor(rand() * 5);
      return Array.from({ length: n }, () => genValue(rand, depth + 1));
    }
    const keys = ['a', 'b', 'zz', ASTRAL, PUA, 'caf\u00e9', 'cafe\u0301', 'k1', 'k2'];
    const n = Math.floor(rand() * 4);
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) o[keys[Math.floor(rand() * keys.length)]] = genValue(rand, depth + 1);
    return o;
  }

  it('1000 seeded values: identical strings or both throw', () => {
    let seed = 20261007;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let throws = 0;
    for (let i = 0; i < 1000; i++) {
      const v = genValue(rand, 0);
      let a: string | null = null;
      let b: string | null = null;
      let aErr = false;
      let bErr = false;
      try { a = canonicalJson(v); } catch { aErr = true; }
      try { b = signetCanonicalize(v); } catch { bErr = true; }
      expect(aErr, `value ${i}: atlas threw=${aErr} signet threw=${bErr}`).toBe(bErr);
      if (!aErr) expect(a).toBe(b);
      else throws++;
    }
    expect(throws).toBe(0); // generator only makes JSON-like values; documents the run
  });

  it('vectors agree with Signet directly', () => {
    expect(canonicalJson('cafe\u0301')).toBe(signetCanonicalize('cafe\u0301'));
    expect(canonicalJson({ [ASTRAL]: 1, [PUA]: 2 })).toBe(signetCanonicalize({ [ASTRAL]: 1, [PUA]: 2 }));
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => signetCanonicalize(NaN)).toThrow();
  });
});

describe('B2.3 no runtime dependency on Signet', () => {
  it('nothing under impl/src imports from Signet', async () => {
    const hits: string[] = [];
    async function scan(dir: string): Promise<void> {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'dist') continue;
          await scan(p);
        } else if (p.endsWith('.ts')) {
          const text = await readFile(p, 'utf8');
          if (/signet\/src|from ['"]\.\.\//.test(text) && /canon/.test(text)) hits.push(p);
        }
      }
    }
    await scan(path.join(IMPL, 'src'));
    expect(hits).toEqual([]);
  });
});

describe('B2.4 six fixture state_hash values reproduce', () => {
  const worldP = loadWorld(WORLD_FILE, WORLD_SCHEMA);
  const ledgerP = loadLedger(LEDGER_FILE, EVENT_SCHEMA);
  const cases: [string, string][] = [
    ['snapshots/s1_normal.json', '17:45'],
    ['snapshots/s2_bottleneck_emerging.json', '18:08'],
    ['snapshots/s3_bottleneck_active.json', '18:20'],
    ['expected/s4_observed_reference.json', '19:00'],
    ['snapshots/s4_simulated_intervention.json', '19:00'],
    ['expected/s4b_simulated_baseline.json', '19:00'],
  ];
  for (const [fixture] of cases) {
    it(`${fixture}: stateHash(stored state, stored metrics) == stored state_hash`, async () => {
      const expected = JSON.parse(await readFile(`${FIX}/${fixture}`, 'utf8'));
      const { stateHash } = await import('../src/canon.js');
      expect(stateHash(expected.state, expected.metrics)).toBe(expected.state_hash);
    });
  }

  it('M1 historical snapshots reproduce end-to-end with the new canonicalizer', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    for (const [fixture, hhmm] of cases.slice(0, 4)) {
      const expected = JSON.parse(await readFile(`${FIX}/${fixture}`, 'utf8'));
      const t = tOf((world as any).time.origin, hhmm);
      const snap: any = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: ledger.events, t,
        branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
        narrative: expected.narrative ?? '',
      });
      expect(snap.state_hash).toBe(expected.state_hash);
    }
  });
});
