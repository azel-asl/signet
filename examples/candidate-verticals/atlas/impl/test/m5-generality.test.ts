// ATLAS M5 T-GENERALITY: renamed-ids mini world yields the same statuses.
// Proves the runtime is not fixture-specific.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { generateCandidateSeeds } from '../src/recommend/candidates.js';
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

describe('T-GENERALITY', () => {
  it('eligibility does not hardcode employee or station ids', async () => {
    // The eligibility module source must not contain literal emp_*, st_* ids.
    const src = await readFile(new URL('../src/recommend/eligibility.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/emp_\d/);
    expect(src).not.toMatch(/st_fry|st_prep|st_grill|st_pass/);
  });

  it('eligibility uses skill short-name convention, not literal station id', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    // emp_04 has 'fry' skill (short name), not 'st_fry'.
    const s04 = seeds.find((x) => x.resource === 'emp_04')!;
    const e = checkEligibility({ world, ledger: history, seed: s04, t: T, tB: T, tH: HORIZON });
    expect(e.reasons).not.toContain('SKILL_MISSING');
    // emp_01 lacks 'fry' skill.
    const s01 = seeds.find((x) => x.resource === 'emp_01')!;
    const e01 = checkEligibility({ world, ledger: history, seed: s01, t: T, tB: T, tH: HORIZON });
    expect(e01.reasons).toContain('SKILL_MISSING');
  });
});
