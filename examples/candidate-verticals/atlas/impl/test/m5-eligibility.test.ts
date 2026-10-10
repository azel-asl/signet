// ATLAS M5 T-ELIGIBILITY: case 4 and each §F reason.
// emp_01, emp_05: SKILL_MISSING -> infeasible, never simulated.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { generateCandidateSeeds } from '../src/recommend/candidates.js';
import { checkEligibility } from '../src/recommend/eligibility.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;

const HORIZON = 1791340200;
const T = 1791336000;
const OPERATIONAL = { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: [], conditional_on: 'new_overload_stations' } as const;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
});

describe('T-ELIGIBILITY', () => {
  it('case 4: emp_01 and emp_05 are SKILL_MISSING', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    for (const id of ['emp_01', 'emp_05']) {
      for (const s of seeds.filter((x) => x.resource === id)) {
        const e = checkEligibility({ world, ledger: history, seed: s, t: T, tB: T, tH: HORIZON });
        expect(e.eligible).toBe(false);
        expect(e.reasons).toContain('SKILL_MISSING');
      }
    }
  });

  it('infeasible candidates are never simulated (status infeasible, simulation null)', () => {
    const set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
    for (const c of set.candidates.filter((x) => x.status === 'infeasible')) {
      expect(c.simulation).toBeNull();
      expect(c.metrics).toBeNull();
      expect(c.economics).toBeNull();
      expect(c.eligibility.eligible).toBe(false);
      expect(c.claim_class).toBe('derived');
    }
  }, 120000);

  it('eligibility evidence resolves (state on_shift/assignments, world skills)', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const e = checkEligibility({ world, ledger: history, seed: seeds[0], t: T, tB: T, tH: HORIZON });
    const kinds = e.evidence.map((r) => r.kind);
    expect(kinds).toContain('state');
    expect(kinds).toContain('world');
  });

  it('WINDOW_INVALID when end_t <= start_t', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const bad = { ...seeds[0], window: { start_t: T, end_t: T, label: 'zero' } };
    const e = checkEligibility({ world, ledger: history, seed: bad, t: T, tB: T, tH: HORIZON });
    expect(e.reasons).toContain('WINDOW_INVALID');
  });

  it('DESTINATION_NOT_STATION for non-station destination', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const bad = { ...seeds[0], to: 'emp_02' };
    const e = checkEligibility({ world, ledger: history, seed: bad, t: T, tB: T, tH: HORIZON });
    expect(e.reasons).toContain('DESTINATION_NOT_STATION');
  });
});
