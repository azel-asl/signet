// ATLAS M5 T-SIMULATION: compiled interventions, trace parity, no parent mutation.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { diagnoseAtTime, runScenarioSpec } from '../src/capabilities.js';
import { generateCandidateSeeds } from '../src/recommend/candidates.js';
import { compileInterventions } from '../src/recommend/compile.js';
import { checkEligibility } from '../src/recommend/eligibility.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;

const HORIZON = 1791340200;
const T = 1791336000;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
});

function proj(events: AtlasEvent[]) {
  return JSON.stringify(events.map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data })));
}

describe('T-SIMULATION', () => {
  it('compiled interventions are iv_01/iv_02 with fixed semantics', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const s = seeds.find((x) => x.id === 'cand:reassign_resource:emp_04:st_fry:to_horizon')!;
    const ivs = compileInterventions({ world, seed: s });
    expect(ivs.length).toBe(2);
    expect(ivs[0].id).toBe('iv_01');
    expect(ivs[0].employee).toBe('emp_04');
    expect(ivs[0].from).toBe(s.from);
    expect(ivs[0].to).toBe('st_fry');
    expect(ivs[0].at_t).toBe(T);
    expect(ivs[1].id).toBe('iv_02');
    expect(ivs[1].from).toBe('st_fry');
    expect(ivs[1].to).toBe(s.from);
    expect(ivs[1].at_t).toBe(HORIZON);
  });

  it('emp_04 to_horizon trace reproduces frozen sim_scenario', async () => {
    const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
    const frozen = (await readFile(new URL('expected/sim_scenario.events.ndjson', base), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const frozenProj = createHash('sha256').update(proj(frozen)).digest('hex');

    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const s = seeds.find((x) => x.id === 'cand:reassign_resource:emp_04:st_fry:to_horizon')!;
    const elig = checkEligibility({ world, ledger: history, seed: s, t: T, tB: T, tH: HORIZON });
    expect(elig.eligible).toBe(true);
    const ivs = compileInterventions({ world, seed: s });
    const run = runScenarioSpec({
      world,
      ledger: history,
      scenario: {
        id: 'test', name: 'test', base_t: T, horizon_t: HORIZON,
        interventions: ivs.map((iv) => ({ id: iv.id, employee: iv.employee, from: iv.from, to: iv.to, at_t: iv.at_t })),
      },
    });
    const scenarioEvents = (run.scenario as { events: AtlasEvent[] }).events;
    const regenProj = createHash('sha256').update(proj(scenarioEvents)).digest('hex');
    expect(regenProj).toBe(frozenProj);
  }, 120000);

  it('parent ledger is not mutated by simulation', async () => {
    const before = JSON.stringify(history);
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const s = seeds.find((x) => x.id === 'cand:reassign_resource:emp_06:st_fry:30m')!;
    const ivs = compileInterventions({ world, seed: s });
    runScenarioSpec({
      world,
      ledger: history,
      scenario: {
        id: 'test2', name: 'test2', base_t: T, horizon_t: HORIZON,
        interventions: ivs.map((iv) => ({ id: iv.id, employee: iv.employee, from: iv.from, to: iv.to, at_t: iv.at_t })),
      },
    });
    expect(JSON.stringify(history)).toBe(before);
  }, 120000);
});
