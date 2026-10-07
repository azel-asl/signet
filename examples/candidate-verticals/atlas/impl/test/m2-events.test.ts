// F5: simulated event identity and provenance (16 §D4).
import { describe, expect, it } from 'vitest';
import { createValidator, loadJsonFile } from '../src/schema.js';
import { m2Setup, TB, TH } from './m2-setup.js';
import { EVENT_SCHEMA, LEDGER_FILE } from './paths.js';
import { readFile } from 'node:fs/promises';

describe('F5 simulated events', () => {
  it('all branch events validate against atlas-event.schema.json', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    const schema = await loadJsonFile(EVENT_SCHEMA);
    const validate = createValidator(schema as Record<string, any>).validate;
    for (const r of [baseline, scenarioArm]) {
      for (const e of r.events) {
        expect(validate(e)).toEqual([]);
      }
    }
  });

  it('event_id unique and seq contiguous from 545', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    for (const r of [baseline, scenarioArm]) {
      const ids = new Set(r.events.map((e) => e.event_id));
      expect(ids.size).toBe(r.events.length);
      r.events.forEach((e, i) => expect(e.seq).toBe(545 + i));
    }
  });

  it('claim_class simulated except replayed arrivals (observed + note)', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    for (const r of [baseline, scenarioArm]) {
      for (const e of r.events) {
        if (e.type === 'ORDER_CREATED') {
          expect(e.provenance.claim_class).toBe('observed');
          expect(e.provenance.note).toBe('historical arrival replayed into the branch');
        } else {
          expect(e.provenance.claim_class).toBe('simulated');
          expect(e.provenance.note).toBeUndefined();
        }
        expect(e.provenance.source).toBe('simulation');
        expect(e.provenance.adapter).toBe('atlas-impl/0.2.0');
        expect(e.branch).toBe(r.branch);
      }
    }
  });

  it('history ledger contains no sim: events after runs', async () => {
    const { ledger } = await m2Setup();
    expect(ledger.events.every((e) => e.branch.startsWith('history:'))).toBe(true);
    // and the file on disk is unchanged (no sim: branch)
    const text = await readFile(LEDGER_FILE, 'utf8');
    expect(text).not.toContain('sim:baseline');
    expect(text).not.toContain('sim:scenario');
  });

  it('intervention events carry reason intervention:<id>', async () => {
    const { scenarioArm } = await m2Setup();
    const ivs = scenarioArm.events.filter((e) => e.type === 'ASSIGNMENT_CHANGED');
    expect(ivs).toHaveLength(2);
    expect(ivs[0].data.reason).toBe('intervention:iv_01');
    expect(ivs[1].data.reason).toBe('intervention:iv_02');
  });
});
