// Shared test paths.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
export const IMPL = path.resolve(testDir, '..');
export const ATLAS = path.resolve(IMPL, '..');
export const FIX = path.join(ATLAS, 'fixtures', 'restaurant-v0');
export const SCHEMA_DIR = path.join(ATLAS, 'schema');
export const INVALID_DIR = path.join(IMPL, 'fixtures', 'invalid');

export const WORLD_SCHEMA = path.join(SCHEMA_DIR, 'atlas-world-definition.schema.json');
export const EVENT_SCHEMA = path.join(SCHEMA_DIR, 'atlas-event.schema.json');
export const SNAPSHOT_SCHEMA = path.join(SCHEMA_DIR, 'atlas-snapshot.schema.json');
export const WORLD_FILE = path.join(FIX, 'world.restaurant-v0.json');
export const LEDGER_FILE = path.join(FIX, 'normalized', 'events.ndjson');
export const SCENARIO_FILE = path.join(FIX, 'scenario.fry-rush.json');

export const CANONICAL = [
  { fixture: 'snapshots/s1_normal.json', hhmm: '17:45' },
  { fixture: 'snapshots/s2_bottleneck_emerging.json', hhmm: '18:08' },
  { fixture: 'snapshots/s3_bottleneck_active.json', hhmm: '18:20' },
  { fixture: 'expected/s4_observed_reference.json', hhmm: '19:00' },
] as const;

export function tOf(originIso: string, hhmm: string): number {
  const t0 = Math.floor(Date.parse(originIso) / 1000);
  const [h, m] = hhmm.split(':').map(Number);
  return t0 + (h - 17) * 3600 + m * 60;
}
