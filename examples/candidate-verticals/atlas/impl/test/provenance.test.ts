// Provenance: evidence stays first-class and resolvable (05).
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world.js';
import { indexByEventId, indexByRecordId, loadLedger } from '../src/ledger.js';
import { CANONICAL, EVENT_SCHEMA, FIX, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA } from './paths.js';

const worldP = loadWorld(WORLD_FILE, WORLD_SCHEMA);
const ledgerP = loadLedger(LEDGER_FILE, EVENT_SCHEMA);

describe('provenance', () => {
  it('every evidence_refs entry in every canonical snapshot resolves to a ledger event', async () => {
    const ledger = await ledgerP;
    const byEventId = indexByEventId(ledger.events);
    for (const c of CANONICAL) {
      const snap = JSON.parse(await readFile(`${FIX}/${c.fixture}`, 'utf8'));
      expect(snap.evidence_refs.length).toBeGreaterThan(0);
      for (const ref of snap.evidence_refs) {
        const e = byEventId.get(ref.event_id);
        expect(e, `${c.fixture}: evidence_ref ${ref.event_id} resolves`).toBeDefined();
        expect(e!.type).toBe(ref.type);
        expect(e!.provenance.claim_class).toBe(ref.claim_class);
      }
    }
  });

  it('historical state contains no simulated events', async () => {
    const ledger = await ledgerP;
    const sim = ledger.events.filter((e) => e.provenance.claim_class === 'simulated');
    expect(sim).toEqual([]);
  });

  it('every derived_from reference resolves to a ledger record_id', async () => {
    const ledger = await ledgerP;
    const byRecordId = indexByRecordId(ledger.events);
    const missing: string[] = [];
    for (const e of ledger.events) {
      for (const parent of e.provenance.derived_from ?? []) {
        if (!byRecordId.has(parent)) missing.push(`${e.event_id} -> ${parent}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('claim classes are intact: only expected classes appear on history:day1', async () => {
    const ledger = await ledgerP;
    const classes = new Set(ledger.events.map((e) => e.provenance.claim_class));
    expect([...classes].sort()).toEqual(['derived', 'human_reported', 'observed']);
  });

  it('every ledger event carries provenance with source, record_id and adapter', async () => {
    const ledger = await ledgerP;
    for (const e of ledger.events) {
      expect(e.provenance.source).toBeTruthy();
      expect(e.provenance.record_id).toBeTruthy();
      expect(e.provenance.adapter).toBeTruthy();
      expect(e.provenance.record_ts).toBeTruthy();
    }
  });
});
