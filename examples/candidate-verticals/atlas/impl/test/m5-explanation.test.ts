// ATLAS M5 T-EXPLANATION: templates verbatim; forbidden words; R_AUTHORITY last.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime, evaluateRecommendationsFacade, explainRecommendations } from '../src/capabilities.js';
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

describe('T-EXPLANATION', () => {
  it('templates render structured values; R_AUTHORITY is last', async () => {
    const diagnosis = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' });
    const config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
    const objective = { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: [], conditional_on: 'new_overload_stations' };
    const set = evaluateRecommendationsFacade({ world, ledger: history, diagnosis, config, horizon_t: HORIZON, objective }) as any;
    const { lines } = explainRecommendations({ world, set });

    // R_AUTHORITY is always last, verbatim.
    const last = lines[lines.length - 1];
    expect(last.text).toBe('Advisory only. ATLAS does not execute or authorise this change.');

    // R_CANDIDATE template present.
    const cand = lines.find((l: any) => l.candidate_id === 'cand:reassign_resource:emp_06:st_fry:to_horizon');
    expect(cand).toBeDefined();

    // Forbidden words absent.
    const all = lines.map((l: any) => l.text).join(' ');
    expect(all).not.toMatch(/\bwill\b/i);
    expect(all).not.toMatch(/\bguarantee\b/i);
    expect(all).not.toMatch(/\bprofit\b/i);

    // SIMULATED prefix on delta lines; ASSUMED on economics.
    const delta = lines.find((l: any) => l.text.includes('Versus doing nothing'));
    expect(delta?.text.startsWith('SIMULATED')).toBe(true);
    const econ = lines.find((l: any) => l.text.includes('net effect'));
    expect(econ?.text.startsWith('ASSUMED')).toBe(true);
  }, 120000);
});
