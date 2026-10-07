// Milestone 1 replay parity: the independent runtime rebuilds the four canonical
// historical snapshots from the frozen world + ledger and matches the fixtures.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { buildSnapshot } from '../src/views.js';
import { compareSnapshots } from '../src/parity.js';
import { canonicalJson, sha256Hex } from '../src/canon.js';
import { CANONICAL, FIX, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA, EVENT_SCHEMA, tOf } from './paths.js';

const worldP = loadWorld(WORLD_FILE, WORLD_SCHEMA, { allowDeviations: ['CCR-001'] });
const ledgerP = loadLedger(LEDGER_FILE, EVENT_SCHEMA);

describe('historical reconstruction', () => {
  for (const c of CANONICAL) {
    it(`${c.fixture} @ ${c.hhmm}: state, metrics, diagnosis, evidence_refs match`, async () => {
      const { world } = await worldP;
      const ledger = await ledgerP;
      const expected = JSON.parse(await readFile(`${FIX}/${c.fixture}`, 'utf8'));
      const t = tOf(world.time.origin, c.hhmm);
      const actual = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: ledger.events, t,
        branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
        narrative: expected.narrative ?? '',
      });
      const cmp = compareSnapshots(expected, actual);
      for (const [section, r] of Object.entries(cmp.sections)) {
        expect(r.match, `${c.fixture} section '${section}' first diff: ${JSON.stringify(r.diffs[0])}`).toBe(true);
      }
    });

    it(`${c.fixture} @ ${c.hhmm}: runtime hash equals the CCR-002 re-stamp value`, async () => {
      const { world } = await worldP;
      const ledger = await ledgerP;
      const expected = JSON.parse(await readFile(`${FIX}/${c.fixture}`, 'utf8'));
      const t = tOf(world.time.origin, c.hhmm);
      const actual = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: ledger.events, t,
        branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
        narrative: expected.narrative ?? '',
      });
      // The re-stamp value is derived from the frozen file's own content,
      // independent of the runtime. Equality proves the only delta is key order.
      const restamp = sha256Hex(canonicalJson({ state: expected.state, metrics: expected.metrics }));
      expect(actual.state_hash).toBe(restamp);
    });
  }

  it('repeated runs produce identical state hashes at every canonical T (RUN A = RUN B)', async () => {
    const { world } = await worldP;
    const ledger = await ledgerP;
    for (const c of CANONICAL) {
      const t = tOf(world.time.origin, c.hhmm);
      const mk = () => buildSnapshot(world, {
        id: 'x', title: 'x', log: ledger.events, t,
        branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived', narrative: '',
      });
      expect(mk().state_hash).toBe(mk().state_hash);
    }
  });
});
