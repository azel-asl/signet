// ATLAS M5 T-EPISTEMIC: case 8.
// Eligibility derived; metrics/status/rank simulated; economics assumed;
// nothing escalates.
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
const ECONOMIC = { id: 'economic', primary_metric: 'net_economic_effect', direction: 'maximize', tie_breakers: [], conditional_on: 'new_overload_stations', economic_value_key: 'base' } as const;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
});

describe('T-EPISTEMIC', () => {
  it('case 8: eligibility derived; metrics/status/rank simulated; economics assumed', () => {
    const set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
    for (const c of set.candidates) {
      if (c.status === 'infeasible') {
        expect(c.claim_class).toBe('derived');
      } else {
        expect(c.claim_class).toBe('simulated');
        expect(c.support).toBe('deterministic');
      }
      if (c.economics) {
        expect(c.economics.claim_class).toBe('assumed');
        expect(c.economics.support).toBe('bounded');
        for (const inp of c.economics.inputs) {
          expect(['assumed', 'configured']).toContain(inp.claim_class);
        }
      }
      // Nothing is observed or inferred.
      expect(['derived', 'simulated']).toContain(c.claim_class);
    }
  }, 120000);

  it('top under operational is simulated/deterministic; under economic is assumed/bounded', () => {
    const opSet = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
    expect(opSet.top.claim_class).toBe('simulated');
    expect(opSet.top.support).toBe('deterministic');

    const ecSet = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: ECONOMIC as never });
    expect(ecSet.top.claim_class).toBe('assumed');
    expect(ecSet.top.support).toBe('bounded');
  }, 180000);

  it('no M5 output is ever observed', () => {
    const set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
    const text = JSON.stringify(set);
    expect(text).not.toMatch(/"claim_class":"observed"/);
  }, 120000);
});
