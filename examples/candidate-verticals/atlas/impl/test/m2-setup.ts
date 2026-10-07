// Shared M2 test setup: world, ledger, base state, scenario, both arms.
import { readFile } from 'node:fs/promises';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { reduceTo } from '../src/reducer.js';
import { loadScenario, type Scenario } from '../src/scenario.js';
import { runArm, type ArmResult } from '../src/simulate.js';
import type { World, WorldState } from '../src/types.js';
import type { Ledger } from '../src/ledger.js';
import { FIX, LEDGER_FILE, WORLD_FILE, WORLD_SCHEMA, EVENT_SCHEMA, SCENARIO_FILE, tOf } from './paths.js';

export const TB = tOf('2026-10-06T17:00:00-07:00', '18:20');
export const TH = tOf('2026-10-06T17:00:00-07:00', '19:30');

let cache: {
  world: World; ledger: Ledger; baseState: WorldState; scenario: Scenario;
  manifest: any; baseline: ArmResult; scenarioArm: ArmResult;
} | null = null;

export async function m2Setup() {
  if (cache) return cache;
  const world = (await loadWorld(WORLD_FILE, WORLD_SCHEMA)) as World;
  const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
  const { state: baseState } = reduceTo(world, ledger.events, TB);
  const scenario = await loadScenario(SCENARIO_FILE, world, baseState, 'history:day1');
  const manifest = JSON.parse(await readFile(`${FIX}/manifest.json`, 'utf8'));
  const common = {
    world, parentEvents: ledger.events, parentBranch: 'history:day1',
    parentLedgerSha256: manifest.files['normalized/events.ndjson'],
    worldSha256: manifest.world_sha256,
    scenario, baseState,
  };
  const baseline = runArm({ ...common, arm: 'baseline' });
  const scenarioArm = runArm({ ...common, arm: 'scenario' });
  cache = { world, ledger, baseState, scenario, manifest, baseline, scenarioArm };
  return cache;
}
