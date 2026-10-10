// ATLAS M5 T-NOACTION: cases 6 and 10, plus all-worse mini world.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
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

describe('T-NOACTION', () => {
  it('case 6: restricted to emp_02 candidates (net worse) -> no_action', () => {
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON,
      objective: OPERATIONAL as never,
      candidate_ids: [
        'cand:reassign_resource:emp_02:st_fry:30m',
        'cand:reassign_resource:emp_02:st_fry:to_horizon',
      ],
    });
    expect(set.top.kind).toBe('no_action');
    expect(set.top.reason).toBe('NO_CANDIDATE_BETTER_THAN_BASELINE');
    expect(set.ranking).toEqual([]);
  }, 120000);

  it('case 10: EQUIPMENT diagnosis -> 0 candidates, NO_SUPPORTED_INTERVENTION', () => {
    const dxCopy = JSON.parse(JSON.stringify(dx)) as Diagnosis;
    for (const c of dxCopy.claims) {
      if (c.kind === 'capacity_limit') (c.values as { class: string }).class = 'EQUIPMENT';
    }
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dxCopy, config, horizon_t: HORIZON,
      objective: OPERATIONAL as never,
    });
    expect(set.candidates.length).toBe(0);
    expect(set.top.kind).toBe('no_action');
    expect(set.top.reason).toBe('NO_SUPPORTED_INTERVENTION');
  });

  it('no-action is a valid complete result with reason', () => {
    const set = evaluateRecommendations({
      world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON,
      objective: OPERATIONAL as never,
      candidate_ids: ['cand:reassign_resource:emp_02:st_fry:30m'],
    });
    expect(set.top.kind).toBe('no_action');
    expect(['NO_CANDIDATE_BETTER_THAN_BASELINE', 'NO_SUPPORTED_INTERVENTION', 'NO_ELIGIBLE_CANDIDATE']).toContain(set.top.reason);
  }, 120000);
});
