// ATLAS M5 T-API: facade + service bounds, observed-only, required horizon_t.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  diagnoseAtTime, generateCandidates, evaluateRecommendationsFacade,
  runScenarioSpec,
} from '../src/capabilities.js';
import { RecommendationError } from '../src/recommend/types.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import type { AtlasEvent, World } from '../src/types.js';

let world: World;
let history: AtlasEvent[];

const HORIZON = 1791340200;
const T = 1791336000;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
});

describe('T-API', () => {
  it('runScenarioSpec runs baseline and scenario arms via M2', () => {
    const { baseline, scenario } = runScenarioSpec({
      world,
      ledger: history,
      scenario: { id: 't', name: 't', base_t: T, horizon_t: HORIZON, interventions: [] },
    });
    expect((baseline as any).events.length).toBeGreaterThan(0);
    expect((scenario as any).events.length).toBeGreaterThan(0);
  }, 60000);

  it('generateCandidates returns seeds (JSON)', async () => {
    const diagnosis = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' });
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    const seeds = generateCandidates({ world, ledger: history, diagnosis, config, horizon_t: HORIZON }) as any[];
    expect(seeds.length).toBe(10);
  });

  it('evaluateRecommendationsFacade requires explicit objective', async () => {
    const diagnosis = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' });
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    expect(() => evaluateRecommendationsFacade({ world, ledger: history, diagnosis, config, horizon_t: HORIZON, objective: null }))
      .toThrowError(expect.objectContaining({ code: 'OBJECTIVE_REQUIRED' }));
  });

  it('horizon_t bound: >7200s throws BOUND_EXCEEDED', async () => {
    const diagnosis = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' });
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    const objective = { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: [], conditional_on: 'new_overload_stations' };
    expect(() => evaluateRecommendationsFacade({ world, ledger: history, diagnosis, config, horizon_t: T + 7201, objective }))
      .toThrowError(expect.objectContaining({ code: 'BOUND_EXCEEDED' }));
  });

  it('too many eligible candidates throws BOUND_EXCEEDED (12+1)', async () => {
    // Production bound: MAX_SIMULATIONS = 12 (19 §S).
    // Create a world with >12 eligible persons by cloning.
    const w2 = JSON.parse(JSON.stringify(world)) as World;
    const basePersons = w2.entities.filter((e) => e.type === 'person');
    // Clone persons to exceed 12 eligible. Each person × 2 windows × stations
    // generates candidates; we need >12 eligible seeds.
    for (let i = 0; i < 15; i++) {
      const src = basePersons[i % basePersons.length];
      const clone = JSON.parse(JSON.stringify(src));
      clone.id = `emp_clone_${i}`;
      clone.name = `Clone${i}`;
      w2.entities.push(clone);
      // Ensure on_shift and unassigned in initial_state.
      if (w2.initial_state) {
        // Persons not in assignments are treated as unassigned.
      }
    }
    const dx2 = diagnoseAtTime({ world: w2, ledger: history, t: T, branch: 'history:day1' }) as any;
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    // The production path should throw BOUND_EXCEEDED.
    expect(() => {
      // Use the internal evaluateRecommendations via facade.
      evaluateRecommendations({
        world: w2, ledger: history, diagnosis: dx2, config,
        horizon_t: HORIZON,
        objective: { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: [], conditional_on: 'new_overload_stations' } as never,
      });
    }).toThrowError(expect.objectContaining({ code: 'BOUND_EXCEEDED' }));
  });
});
