// B1: positional checkpoint cursor (16 §B1).
// The cursor is ledger_pos in the ordered event array, verified by last_event_id.
// seq plays no role in replay.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/world.js';
import { loadLedger, sortByReductionOrder } from '../src/ledger.js';
import { reduceTo, StaleCheckpointError, UnorderedLedgerError } from '../src/reducer.js';
import { buildCheckpoints, nearestCheckpoint, reduceToCheckpointed } from '../src/checkpoints.js';
import { buildSnapshot, computeMetrics } from '../src/views.js';
import { canonicalJson } from '../src/canon.js';
import { CANONICAL, EVENT_SCHEMA, FIX, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA, tOf } from './paths.js';

const worldP = loadWorld(WORLD_FILE, WORLD_SCHEMA);
const ledgerP = loadLedger(LEDGER_FILE, EVENT_SCHEMA);

function hashOf(world: any, state: any, t: number, log: any[]): string {
  return canonicalJson({ state, metrics: computeMetrics(world, state, t, log) });
}

/** 54 test timestamps: 4 canonical + 50 seeded. */
async function testTimes(): Promise<number[]> {
  const { time } = (await worldP) as any;
  const ledger = await ledgerP;
  const times = CANONICAL.map((c) => tOf(time.origin, c.hhmm));
  let seed = 1234;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const t0 = ledger.events[0].t;
  const t1 = ledger.events[ledger.events.length - 1].t;
  for (let i = 0; i < 50; i++) times.push(Math.floor(t0 + rand() * (t1 - t0)));
  return [...new Set(times)].sort((a, b) => a - b);
}

async function rawLines(): Promise<any[]> {
  const text = await readFile(LEDGER_FILE, 'utf8');
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe('B1.1 moved-event ledger', () => {
  it('checkpoint vs full replay equal at 54 T when an event moves in the file', async () => {
    const world = await worldP;
    const lines = await rawLines();
    // move line 901 (index 900) to the end, renumber seq in file order
    const moved = lines.splice(900, 1)[0];
    lines.push(moved);
    lines.forEach((e, i) => { e.seq = i + 1; });
    // simulate loadLedger's ordering: sort by reduction key, ignore seq
    const ordered = sortByReductionOrder(lines);
    const cps = buildCheckpoints(world, ordered);
    let mismatches = 0;
    for (const t of await testTimes()) {
      const full = reduceTo(world, ordered, t);
      const { result: viaCp } = reduceToCheckpointed(world, ordered, cps, t);
      if (hashOf(world, viaCp.state, t, ordered) !== hashOf(world, full.state, t, ordered)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('B1.2 shuffled ledger', () => {
  it('seeded full shuffle: full replay hashes equal the stored s1-s4 hashes', async () => {
    const world = await worldP;
    const lines = await rawLines();
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lines[i], lines[j]] = [lines[j], lines[i]];
    }
    lines.forEach((e, i) => { e.seq = i + 1; });
    const ordered = sortByReductionOrder(lines);
    for (const c of CANONICAL) {
      const expected = JSON.parse(await readFile(`${FIX}/${c.fixture}`, 'utf8'));
      const t = tOf((world as any).time.origin, c.hhmm);
      const snap: any = buildSnapshot(world, {
        id: expected.id, title: expected.title, log: ordered, t,
        branch: 'history:day1', mode: 'RECONSTRUCT', claim_class: 'derived',
        narrative: expected.narrative ?? '',
      });
      expect(snap.state_hash).toBe(expected.state_hash);
    }
  });

  it('seeded full shuffle: checkpoint equivalence at 54 T', async () => {
    const world = await worldP;
    const lines = await rawLines();
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = lines.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lines[i], lines[j]] = [lines[j], lines[i]];
    }
    lines.forEach((e, i) => { e.seq = i + 1; });
    const ordered = sortByReductionOrder(lines);
    const cps = buildCheckpoints(world, ordered);
    let mismatches = 0;
    for (const t of await testTimes()) {
      const full = reduceTo(world, ordered, t);
      const { result: viaCp } = reduceToCheckpointed(world, ordered, cps, t);
      if (hashOf(world, viaCp.state, t, ordered) !== hashOf(world, full.state, t, ordered)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('B1.3 stale checkpoint', () => {
  it('inserting an event early makes resume throw StaleCheckpointError', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    const cp = cps[cps.length - 1];
    // insert a copy of an early event at position 10 of the ordered array
    const tampered = [...ledger.events];
    tampered.splice(10, 0, { ...ledger.events[5] });
    expect(() => reduceTo(world, tampered, cp.t, cp)).toThrow(StaleCheckpointError);
  });

  it('a checkpoint beyond the array length throws StaleCheckpointError', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    const cp = { ...cps[0], ledger_pos: ledger.events.length + 1 };
    expect(() => reduceTo(world, ledger.events, cp.t, cp)).toThrow(StaleCheckpointError);
  });

  it('no silent fallback: the error is thrown, not swallowed', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    const cp = cps[cps.length - 1];
    // remove one event well before the checkpoint's cursor
    const tampered = ledger.events.filter((_, i) => i !== 20);
    expect(cp.ledger_pos).toBeGreaterThan(20);
    let threw = false;
    try {
      reduceTo(world, tampered, cp.t, cp);
    } catch (e) {
      threw = e instanceof StaleCheckpointError;
    }
    expect(threw).toBe(true);
  });
});

describe('B1.4 unordered ledger', () => {
  it('reduceTo throws UnorderedLedgerError on a non-monotonic array', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const bad = [...ledger.events];
    // swap two adjacent events with strictly increasing t, inside the walked range
    const i = bad.findIndex((e, j) => j > 0 && e.t > bad[j - 1].t);
    [bad[i - 1], bad[i]] = [bad[i], bad[i - 1]];
    // after the swap, bad[i-1].t is the larger t: walk past the inversion
    expect(() => reduceTo(world, bad, bad[i - 1].t)).toThrow(UnorderedLedgerError);
  });
});

describe('B1.5 branch-log checkpoint equivalence', () => {
  it('prefix ++ oracle sim_scenario trace: checkpoint equivalence at 54 T in [18:20, 19:30]', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const tB = tOf((world as any).time.origin, '18:20');
    const tH = tOf((world as any).time.origin, '19:30');
    const traceText = await readFile(`${FIX}/expected/sim_scenario.events.ndjson`, 'utf8');
    const trace = traceText.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const branchLog = [...ledger.events.filter((e) => e.t <= tB), ...sortByReductionOrder(trace)];
    const cps = buildCheckpoints(world, branchLog);
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const times = new Set<number>([tB, tH]);
    for (let i = 0; i < 52; i++) times.add(Math.floor(tB + rand() * (tH - tB)));
    let mismatches = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      const full = reduceTo(world, branchLog, t);
      const { result: viaCp } = reduceToCheckpointed(world, branchLog, cps, t);
      if (hashOf(world, viaCp.state, t, branchLog) !== hashOf(world, full.state, t, branchLog)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('B1 cursor selection', () => {
  it('nearestCheckpoint picks the greatest ledger_pos with t <= T', async () => {
    const world = await worldP;
    const ledger = await ledgerP;
    const cps = buildCheckpoints(world, ledger.events);
    const t = tOf((world as any).time.origin, '18:20');
    const at = nearestCheckpoint(cps, t);
    const maxPos = Math.max(...cps.filter((c) => c.t <= t).map((c) => c.ledger_pos));
    expect(at!.ledger_pos).toBe(maxPos);
    expect(nearestCheckpoint(cps, cps[0].t - 1)).toBeNull();
  });
});
