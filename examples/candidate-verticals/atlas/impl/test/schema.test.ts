import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createValidator, loadJsonFile } from '../src/schema.js';
import { loadLedger } from '../src/ledger.js';
import { loadWorld, WorldLoadError } from '../src/world.js';
import {
  EVENT_SCHEMA, FIX, INVALID_DIR, LEDGER_FILE, SNAPSHOT_SCHEMA, WORLD_FILE, WORLD_SCHEMA,
} from './paths.js';

const j = (p: string) => loadJsonFile(p);

describe('schema validation', () => {
  it('frozen world file validates cleanly against the corrected schema (CCR-001 resolved)', async () => {
    const schema = await j(WORLD_SCHEMA);
    const world = await j(WORLD_FILE);
    expect(createValidator(schema as Record<string, any>).validate(world)).toEqual([]);
  });

  it('strict loadWorld loads the frozen world with zero issues', async () => {
    const world = await loadWorld(WORLD_FILE, WORLD_SCHEMA);
    expect(world.metadata.id).toBe('restaurant-v0');
    expect(world.rules).toHaveLength(9);
  });

  it.each([
    ['unknown-rule-kind.json', '/rules/0/kind'],
    ['skill-violation.json', '/initial_state/assignments/emp_05'],
    ['dangling-station.json', '/processes/0/steps/0/station'],
    ['missing-capacity-rule.json', '/rules'],
    ['bad-id-pattern.json', '/entities/0/id'],
    ['object-without-entity.json', '/visualization/objects/ghost_rect'],
  ])('invalid variant %s is rejected with pointer %s', async (file, pointer) => {
    const err = await loadWorld(`${INVALID_DIR}/${file}`, WORLD_SCHEMA).catch((e) => e);
    expect(err).toBeInstanceOf(WorldLoadError);
    const pointers = err.issues.map((i: { pointer: string }) => i.pointer);
    expect(pointers).toContain(pointer);
  });

  it('all 1815 ledger lines validate against the event schema', async () => {
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    expect(ledger.count).toBe(1815);
    expect(ledger.branch).toBe('history:day1');
  });

  it('ledger seq starts at 1 and increments by 1 in file order', async () => {
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    ledger.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
  });

  it('canonical snapshots validate against the snapshot schema', async () => {
    const schema = await j(SNAPSHOT_SCHEMA);
    const validate = createValidator(schema as Record<string, any>).validate;
    for (const f of [
      'snapshots/s1_normal.json',
      'snapshots/s2_bottleneck_emerging.json',
      'snapshots/s3_bottleneck_active.json',
      'expected/s4_observed_reference.json',
    ]) {
      const snap = await j(`${FIX}/${f}`);
      expect(validate(snap)).toEqual([]);
    }
  });

  it('history ledger contains no simulated events', async () => {
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    expect(ledger.events.some((e) => e.provenance.claim_class === 'simulated')).toBe(false);
  });

  it('every derived event carries derived_from', async () => {
    const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
    for (const e of ledger.events) {
      if (e.provenance.claim_class === 'derived' || e.provenance.claim_class === 'inferred') {
        expect(e.provenance.derived_from?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
