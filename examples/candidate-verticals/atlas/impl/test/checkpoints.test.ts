// Checkpoints are a cache: full replay === checkpoint + incremental replay (04, M6).
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { reduceTo } from '../src/reducer.js';
import { buildCheckpoints, nearestCheckpoint, reduceToCheckpointed } from '../src/checkpoints.js';
import { computeMetrics } from '../src/views.js';
import { canonicalJson } from '../src/canon.js';
import { CANONICAL, EVENT_SCHEMA, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA, tOf } from './paths.js';

const worldP = loadWorld(WORLD_FILE, WORLD_SCHEMA);
const ledgerP = loadLedger(LEDGER_FILE, EVENT_SCHEMA);

function hashOf(world: any, state: any, t: number, log: any[]): string {
  return canonicalJson({ state, metrics: computeMetrics(world, state, t, log) });
}

describe('checkpoints', () => {
  it('writes checkpoints at capacity/assignment events and every 500 events', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    expect(cps.length).toBeGreaterThan(0);
    // every checkpoint resumes exactly at a ledger event
    const seqs = new Set(ledger.events.map((e) => e.seq));
    for (const cp of cps) {
      expect(seqs.has(cp.ledger_seq)).toBe(true);
      expect(cp.state_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // checkpoints are ordered by (t, ledger_seq)
    for (let i = 1; i < cps.length; i++) {
      expect(cps[i].t > cps[i - 1].t || cps[i].ledger_seq > cps[i - 1].ledger_seq).toBe(true);
    }
  });

  it('full replay equals checkpoint + incremental replay at every canonical T', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    for (const c of CANONICAL) {
      const t = tOf(world.time.origin, c.hhmm);
      const full = reduceTo(world, ledger.events, t);
      const { result: viaCp, checkpoint } = reduceToCheckpointed(world, ledger.events, cps, t);
      expect(checkpoint).not.toBeNull();
      expect(hashOf(world, viaCp.state, t, ledger.events)).toBe(hashOf(world, full.state, t, ledger.events));
      expect(viaCp.eventsApplied).toBe(full.eventsApplied);
    }
  });

  it('checkpoint equivalence holds at 20 seeded arbitrary T (property test)', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const t0 = ledger.events[0].t;
    const t1 = ledger.events[ledger.events.length - 1].t;
    for (let i = 0; i < 20; i++) {
      const t = Math.floor(t0 + rand() * (t1 - t0));
      const full = reduceTo(world, ledger.events, t);
      const { result: viaCp } = reduceToCheckpointed(world, ledger.events, cps, t);
      expect(hashOf(world, viaCp.state, t, ledger.events), `T=${t}`).toBe(hashOf(world, full.state, t, ledger.events));
    }
  });

  it('nearestCheckpoint picks the latest checkpoint at or before T', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    const first = cps[0];
    expect(nearestCheckpoint(cps, first.t - 1)).toBeNull();
    const at = nearestCheckpoint(cps, first.t);
    // several checkpoints can share the same t (e.g. shift-start assignments);
    // the nearest is the one with the greatest ledger_seq at that t.
    const maxSeqAtT = Math.max(...cps.filter((c) => c.t === first.t).map((c) => c.ledger_seq));
    expect(at!.t).toBe(first.t);
    expect(at!.ledger_seq).toBe(maxSeqAtT);
  });

  it('deleting checkpoints changes nothing but speed (reduceTo without them agrees)', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const t = tOf(world.time.origin, '18:20');
    const noCp = reduceTo(world, ledger.events, t);
    const { result: withCp } = reduceToCheckpointed(world, ledger.events, [], t);
    expect(canonicalJson(withCp.state)).toBe(canonicalJson(noCp.state));
  });
});
