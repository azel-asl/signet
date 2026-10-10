// ATLAS M5 T-EPISTEMIC-REJECT (CCR-006 §5, BLOCKER 1).
// Uses AJV 2020 against the frozen schema.
// Canonical set validates; tampered sets are rejected.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
// @ts-ignore: AJV 2020 dist import
import Ajv2020 from 'ajv/dist/2020.js';
import { diagnoseAtTime } from '../src/capabilities.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config, RecommendationSet } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;
let canonicalSet: RecommendationSet;
let validate: (data: unknown) => boolean;

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
  canonicalSet = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never }) as RecommendationSet;

  // Load frozen schema and compile with AJV 2020.
  const schema = JSON.parse(await readFile(new URL('../../schema/atlas-recommendation.schema.json', import.meta.url), 'utf8'));
  const ajv = new (Ajv2020 as any)({ strict: false, validateFormats: false });
  validate = ajv.compile(schema);
}, 180000);

describe('T-EPISTEMIC-REJECT via AJV 2020', () => {
  it('canonical set validates against frozen schema', () => {
    const valid = validate(canonicalSet);
    expect(valid).toBe(true);
  });

  it('economics input labelled SIMULATED is rejected', () => {
    const tampered = JSON.parse(JSON.stringify(canonicalSet));
    const cand = tampered.candidates.find((c: any) => c.economics);
    expect(cand).toBeDefined();
    // Tamper: set economics input claim_class to 'simulated'.
    cand.economics.inputs[0].claim_class = 'simulated';
    const valid = validate(tampered);
    // The frozen schema must reject this.
    expect(valid).toBe(false);
  });

  it('simulated candidate labelled DERIVED is rejected', () => {
    const tampered = JSON.parse(JSON.stringify(canonicalSet));
    const cand = tampered.candidates.find((c: any) => c.simulation);
    expect(cand).toBeDefined();
    // Tamper: set candidate claim_class to 'derived'.
    cand.claim_class = 'derived';
    const valid = validate(tampered);
    expect(valid).toBe(false);
  });

  it('top labelled DERIVED is rejected', () => {
    const tampered = JSON.parse(JSON.stringify(canonicalSet));
    tampered.top.claim_class = 'derived';
    const valid = validate(tampered);
    expect(valid).toBe(false);
  });
});
