// ATLAS M5 T-OBJECTIVE-5B (CCR-006 §5).
// Calls the real production path: evaluateRecommendations with economic objective.
// Does NOT independently recompute ranking/status logic.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config, RecommendationSet } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;

const HORIZON = 1791340200;
const T = 1791336000;

function economicObjective(valueKey: 'low' | 'base' | 'high') {
  return {
    id: 'economic',
    primary_metric: 'net_economic_effect',
    direction: 'maximize',
    tie_breakers: ['fewer new_overload_stations', 'larger orders_completed_in_window', 'candidate id'],
    conditional_on: 'new_overload_stations',
    economic_value_key: valueKey,
  } as const;
}

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
  // Set move cost to 80 (canonical case 5b).
  config.economics.reassignment_cost_per_move = 80;
}, 180000);

describe('T-OBJECTIVE-5B: economic objective via production path', () => {
  it('low → no_action, every simulated candidate not_recommended', () => {
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dx, config,
      horizon_t: HORIZON, objective: economicObjective('low') as never,
    }) as RecommendationSet;
    expect(set.top.kind).toBe('no_action');
    expect(set.top.reason).toBe('NO_CANDIDATE_BETTER_THAN_BASELINE');
    for (const c of set.candidates) {
      if (c.status !== 'infeasible') {
        expect(c.status).toBe('not_recommended');
      }
    }
  });

  it('base → no_action, every simulated candidate not_recommended', () => {
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dx, config,
      horizon_t: HORIZON, objective: economicObjective('base') as never,
    }) as RecommendationSet;
    expect(set.top.kind).toBe('no_action');
    expect(set.top.reason).toBe('NO_CANDIDATE_BETTER_THAN_BASELINE');
    for (const c of set.candidates) {
      if (c.status !== 'infeasible') {
        expect(c.status).toBe('not_recommended');
      }
    }
  });

  it('high → emp_06 top, net_effect 281.95, assumed/bounded', () => {
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dx, config,
      horizon_t: HORIZON, objective: economicObjective('high') as never,
    }) as RecommendationSet;
    expect(set.top.kind).toBe('candidate');
    expect(set.top.candidate_id).toBe('cand:reassign_resource:emp_06:st_fry:to_horizon');
    const top = set.candidates.find((c) => c.id === set.top.candidate_id)!;
    expect(top.economics!.by_value.high.net_effect).toBeCloseTo(281.95, 2);
    expect(set.top.claim_class).toBe('assumed');
  });
});
