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
    // Production simulation bound: MAX_SIMULATIONS = 12 (19 §S).
    // Construction: 5 eligible people × 3 windows = 15 eligible simulations.
    // - Give 'fry' skill to emp_01 and emp_05 (on-shift, lack fry).
    // - Add a third 15-minute window to the config.
    // 15 < 16 (candidate bound OK), 15 > 12 (simulation bound fires).
    const w2 = JSON.parse(JSON.stringify(world)) as World;
    for (const pid of ['emp_01', 'emp_05']) {
      const p = w2.entities.find((e) => e.id === pid);
      const attrs = (p as any).attrs as { skills: string[] };
      if (!attrs.skills.includes('fry')) attrs.skills.push('fry');
    }
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    config.candidate_windows.push({ label: '15m', start_offset_s: 0, end_offset_s: 900 });

    const dx2 = diagnoseAtTime({ world: w2, ledger: history, t: T, branch: 'history:day1' }) as any;

    // Verify candidate count stays <= 16 before the simulation bound.
    const { generateCandidateSeeds } = await import('../src/recommend/candidates.js');
    const seeds = generateCandidateSeeds({ world: w2, ledger: history, diagnosis: dx2, config, horizon_t: HORIZON });
    expect(seeds.length).toBeLessThanOrEqual(16);
    expect(seeds.length).toBeGreaterThan(12);

    // Production path must hit the simulation guard, not the candidate guard.
    let thrown: any = null;
    try {
      evaluateRecommendations({
        world: w2, ledger: history, diagnosis: dx2, config,
        horizon_t: HORIZON,
        objective: { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: [], conditional_on: 'new_overload_stations' } as never,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('BOUND_EXCEEDED');
    // Must be the simulation guard: "eligible candidates 15 exceed the frozen simulation bound of 12".
    // The 16-candidate guard says "candidate count ... exceeds the frozen bound of 16" — must NOT match.
    expect(thrown.message).toContain('eligible candidates');
    expect(thrown.message).toContain('frozen simulation bound of 12');
    expect(thrown.message).not.toContain('frozen bound of 16');
  });
});
