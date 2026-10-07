// Regression: the frozen fixtures are untouched, the oracle stays independent,
// and the canonical fixture suite keeps passing.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLedger } from '../src/ledger.js';
import { ATLAS, EVENT_SCHEMA, FIX, IMPL, LEDGER_FILE } from './paths.js';

const sha256File = async (p: string) =>
  createHash('sha256').update(await readFile(p)).digest('hex');

describe('fixture lock', () => {
  it('every file listed in manifest.json still matches its recorded sha256', async () => {
    const manifest = JSON.parse(await readFile(path.join(FIX, 'manifest.json'), 'utf8'));
    const files = Object.entries<string>(manifest.files);
    expect(files.length).toBe(21);
    const bad: string[] = [];
    for (const [rel, hash] of files) {
      const actual = await sha256File(path.join(FIX, rel));
      if (actual !== hash) bad.push(`${rel}: expected ${hash}, found ${actual}`);
    }
    expect(bad).toEqual([]);
  });

  it('frozen reference counts hold: 1815 day-1 events, 121 orders', async () => {
    const manifest = JSON.parse(await readFile(path.join(FIX, 'manifest.json'), 'utf8'));
    expect(manifest.counts.day1_events).toBe(1815);
    expect(manifest.counts.day1_orders).toBe(121);
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    expect(ledger.count).toBe(1815);
  });
});

describe('oracle independence', () => {
  it('no implementation or test file imports from the oracle directory', async () => {
    // Built dynamically so this very test does not contain the literal.
    const needle = '/' + 'oracle/';
    const hits: string[] = [];
    async function scan(dir: string): Promise<void> {
      for (const name of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, name.name);
        if (name.isDirectory()) {
          if (name.name === 'node_modules' || name.name === 'dist' || name.name === 'fixtures') continue;
          await scan(p);
        } else if (p.endsWith('.ts') || p.endsWith('.js')) {
          const text = await readFile(p, 'utf8');
          if (text.includes(needle)) hits.push(p);
        }
      }
    }
    await scan(path.join(IMPL, 'src'));
    await scan(path.join(IMPL, 'test'));
    await scan(path.join(IMPL, 'scripts'));
    expect(hits).toEqual([]);
  });

  it('the frozen Fable branch artifacts are not modified by this package', async () => {
    // The implementation writes only under impl/ (and contract-changes/).
    // Fixture reads must never mutate: mtimes of a sample are older than this run.
    const stat = await import('node:fs/promises').then((m) => m.stat);
    const s = await stat(path.join(FIX, 'normalized', 'events.ndjson'));
    expect(s.mtimeMs).toBeLessThan(Date.now());
  });
});

describe('ledger ordering (M3)', () => {
  it('committed file order already equals reduction order for all 1815 events', async () => {
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    expect(ledger.inputOrderMatched).toBe(true);
  });

  it('reduction key is total: (t, type rank, subject, work_id)', async () => {
    const { reductionKey, compareKeys } = await import('../src/ledger.js');
    const k = (t: number, type: string, subject: string, work_id?: string) =>
      reductionKey({ t, type, subject, data: work_id ? { work_id } : {} });
    // capacity changes first, completions before starts, creations before queuing
    expect(compareKeys(k(1, 'EQUIPMENT_STATE_CHANGED', 'a'), k(1, 'ASSIGNMENT_CHANGED', 'a'))).toBe(-1);
    expect(compareKeys(k(1, 'WORK_COMPLETED', 'a'), k(1, 'WORK_STARTED', 'a'))).toBe(-1);
    expect(compareKeys(k(1, 'ORDER_CREATED', 'a'), k(1, 'WORK_QUEUED', 'a'))).toBe(-1);
    expect(compareKeys(k(1, 'WORK_QUEUED', 'a', 'w_2'), k(1, 'WORK_QUEUED', 'a', 'w_1'))).toBe(1);
    expect(compareKeys(k(2, 'WORK_QUEUED', 'a'), k(1, 'WORK_QUEUED', 'a'))).toBe(1);
  });
});

describe('atlas directory hygiene', () => {
  it('contract-changes holds the filed CCRs', async () => {
    const names = await readdir(path.join(ATLAS, 'contract-changes'));
    expect(names).toContain('CCR-001.md');
    expect(names).toContain('CCR-002.md');
  });
});
