// ATLAS M5 T-CANDIDATE: candidate generation.
// Case 1: 10 candidates = 5 persons x 2 windows; emp_03 excluded (already at Fry).
// Ordering, dedup, bound, non-STAFF and unknown claims yield none.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { generateCandidateSeeds, MAX_CANDIDATES } from '../src/recommend/candidates.js';
import { RecommendationError } from '../src/recommend/types.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
});

const HORIZON = 1791340200;

describe('T-CANDIDATE', () => {
  it('case 1: 10 candidates (5 persons x 2 windows), emp_03 excluded', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    expect(seeds.length).toBe(10);
    // emp_03 is already at Fry, excluded.
    expect(seeds.some((s) => s.resource === 'emp_03')).toBe(false);
    // 5 persons x 2 windows.
    const persons = new Set(seeds.map((s) => s.resource));
    expect(persons.size).toBe(5);
  });

  it('ordering: persons in world order, windows in config order', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const ids = seeds.map((s) => s.id);
    // emp_01 first (world order), 30m before to_horizon (config order).
    expect(ids[0]).toBe('cand:reassign_resource:emp_01:st_fry:30m');
    expect(ids[1]).toBe('cand:reassign_resource:emp_01:st_fry:to_horizon');
    expect(ids[2]).toBe('cand:reassign_resource:emp_02:st_fry:30m');
  });

  it('dedup: ids are unique', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const ids = seeds.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bound: exceeding 16 throws BOUND_EXCEEDED, never truncates', () => {
    // Craft a config with many windows to exceed the bound.
    const bigConfig: M5Config = {
      ...config,
      candidate_windows: Array.from({ length: 10 }, (_, i) => ({
        label: `w${i}`,
        start_offset_s: 0,
        end_offset_s: 300 * (i + 1),
      })),
    };
    // 5 persons x 10 windows = 50 > 16.
    expect(() => generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config: bigConfig, horizon_t: HORIZON }))
      .toThrowError(expect.objectContaining({ code: 'BOUND_EXCEEDED' }));
  });

  it('non-STAFF limitation class yields no candidates', () => {
    // Modify a copy of the observed diagnosis to EQUIPMENT class.
    const dxCopy = JSON.parse(JSON.stringify(dx)) as Diagnosis;
    for (const c of dxCopy.claims) {
      if (c.kind === 'capacity_limit') (c.values as { class: string }).class = 'EQUIPMENT';
    }
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dxCopy, config, horizon_t: HORIZON });
    expect(seeds.length).toBe(0);
  });

  it('simulated register diagnosis is refused', async () => {
    // Build a sim ledger for the scenario branch.
    const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
    const trace = (await readFile(new URL('expected/sim_scenario.events.ndjson', base), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const simLedger = [...history.filter((e) => e.t <= 1791336000), ...trace];
    const simDx = diagnoseAtTime({
      world,
      ledger: simLedger,
      t: 1791338400,
      branch: 'sim:scenario',
      branch_interval: { tB: 1791336000, tH: 1791340200 },
    }) as Diagnosis;
    expect(() => generateCandidateSeeds({ world, ledger: simLedger, diagnosis: simDx, config, horizon_t: HORIZON }))
      .toThrowError(expect.objectContaining({ code: 'RECOMMEND_REQUIRES_OBSERVED_BASE' }));
  });

  it('MAX_CANDIDATES is 16', () => {
    expect(MAX_CANDIDATES).toBe(16);
  });
});
