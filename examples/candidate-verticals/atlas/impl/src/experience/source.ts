// Experience source (17 §4). The ONLY module that knows fixture paths.
// Returns { world, ledger, scenarioPath }. Swapping this for a database,
// replay service or live source must not change the projection, server routes
// or renderer.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorldFile, loadLedgerFile } from '../capabilities.js';
import type { AtlasEvent, World } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
// Find the impl/ directory (works from src/ or dist/src/): go up until package.json is found.
import { existsSync } from 'node:fs';
let dir = here;
while (!existsSync(join(dir, 'package.json')) && dir !== dirname(dir)) {
  dir = dirname(dir);
}
const IMPL_DIR = dir;
const ATLAS_DIR = join(IMPL_DIR, '..');
const FIX = join(ATLAS_DIR, 'fixtures', 'restaurant-v0');

export interface ExperienceSource {
  world: World;
  ledger: AtlasEvent[];
  scenarioPath: string;
  scenarioName: string;
  scenarioId: string;
  tB: number;
  tH: number;
}

let cached: ExperienceSource | null = null;

/** Load the world, ledger, scenario path and scenario metadata. Fails loudly on invalid input. */
export async function loadSource(): Promise<ExperienceSource> {
  if (cached) return cached;
  const world = await loadWorldFile(
    join(FIX, 'world.restaurant-v0.json'),
    join(ATLAS_DIR, 'schema', 'atlas-world-definition.schema.json'),
  );
  const ledgerEvents = await loadLedgerFile(
    join(FIX, 'normalized', 'events.ndjson'),
    join(ATLAS_DIR, 'schema', 'atlas-event.schema.json'),
  );
  const scenarioPath = join(FIX, 'scenario.fry-rush.json');
  const scenarioJson = JSON.parse(await readFile(scenarioPath, 'utf8'));
  cached = {
    world,
    ledger: ledgerEvents,
    scenarioPath,
    scenarioName: scenarioJson.name,
    scenarioId: scenarioJson.id,
    tB: Math.floor(Date.parse(scenarioJson.base.t) / 1000),
    tH: Math.floor(Date.parse(scenarioJson.horizon) / 1000),
  };
  return cached;
}

/** SHA-256 of the history ledger file bytes (for the T7 isolation check). */
export async function historyFileSha256(): Promise<string> {
  const { createHash } = await import('node:crypto');
  const bytes = await readFile(join(FIX, 'normalized', 'events.ndjson'));
  return createHash('sha256').update(bytes).digest('hex');
}
