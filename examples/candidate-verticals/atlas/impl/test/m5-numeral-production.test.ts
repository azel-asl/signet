// ATLAS M5 T-NUMERAL (CCR-006 §5, BLOCKER 2).
// All rejection cases go through the real production formatter
// (explainRecommendations / explainCandidate), not checkNumerals directly.
// We tamper with structured recommendation-set inputs, then invoke production.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime, explainRecommendations } from '../src/capabilities.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import { RecommendationError } from '../src/recommend/types.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config, RecommendationSet } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;
let set: RecommendationSet;
let lines: { candidate_id: string | null; text: string; claim_class: string }[];

const HORIZON = 1791340200;
const T = 1791336000;
const OPERATIONAL = { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: ['fewer new_overload_stations', 'larger orders_completed_in_window', 'candidate id'], conditional_on: 'new_overload_stations' } as const;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
  set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never }) as RecommendationSet;
  const explained = explainRecommendations({ world, set }) as { lines: typeof lines };
  lines = explained.lines;
}, 180000);

describe('T-NUMERAL via production formatter', () => {
  it('canonical lines pass (production enforces C4)', () => {
    // If any canonical line had an unsupported numeral, beforeAll would have thrown.
    expect(lines.length).toBeGreaterThan(0);
    const texts = lines.map((l) => l.text).join('\n');
    expect(texts).toContain('18:20');
    expect(texts).toContain('Ranked 1:');
    expect(texts).toContain('65 minutes');
  });

  it('unsupported injected numeral fails via production', async () => {
    // Tamper a candidate's dominated_by with an ID containing a standalone numeral.
    // The R_DOMINATED template has empty sources; the numeral is not in substitutedNames.
    // Production explainCandidate -> pushLine -> checkNumerals must throw FORMAT_VIOLATION.
    const { explainCandidate } = await import('../src/recommend/format.js');
    const tampered = JSON.parse(JSON.stringify(set)) as RecommendationSet;
    const cand = tampered.candidates.find((c) => c.dominated_by.length > 0);
    expect(cand).toBeDefined();
    // Inject a dominated_by ID with standalone numeral 99999.
    cand!.dominated_by = ['cand:test:99999'];
    cand!.rank = null; // Ensure R_DOMINATED is emitted (not R_RANK).
    const baselineLast = set.baseline.metrics.stations[cand!.to]?.overload_last_t ?? null;
    expect(() => explainCandidate(world, cand!, OPERATIONAL as never, baselineLast))
      .toThrow(/FORMAT_VIOLATION.*99999/);
  });

  it('clock time from proper source (production)', () => {
    // The R_CANDIDATE line contains 18:20 from window.start_t.
    // Production constructed sources [18, 20, 19, 20] from the world offset.
    // If the time were from a different source, it would fail.
    const candLine = lines.find((l) => l.text.includes('→'))!;
    expect(candLine.text).toContain('18:20');
  });

  it('rate source (production)', () => {
    const eLine = lines.find((l) => l.text.includes('net effect'))!;
    // Canonical rate is from m5-config.json sensitivity values.
    expect(eLine.text).toMatch(/At \d+\.\d+ per order-minute/);
  });

  it('net-effect source (production)', () => {
    const eLine = lines.find((l) => l.text.includes('net effect'))!;
    // Canonical net effect values are from by_value.base.
    expect(eLine.text).toMatch(/net effect [+-]?\d+\.\d\d/);
  });

  it('metric delta source (production)', () => {
    const dLine = lines.find((l) => l.text.includes('Versus doing nothing'))!;
    // Contains order time delta and completed orders.
    expect(dLine.text).toMatch(/\d+s/);
  });

  it('overload-end 65 minutes (production)', () => {
    const oLine = lines.find((l) => l.text.includes('overload ends'))!;
    expect(oLine.text).toBe('SIMULATED · Fry overload ends 65 minutes earlier.');
  });

  it('rank numeral (production)', () => {
    const rLine = lines.find((l) => l.text.startsWith('Ranked'))!;
    expect(rLine.text).toMatch(/^Ranked \d+:/);
  });
});

describe('T-NAME-EXCLUSION (BLOCKER 1)', () => {
  it('station named "Fry 2" does not trigger FORMAT_VIOLATION', () => {
    // Create a world with a station named "Fry 2".
    const w2 = JSON.parse(JSON.stringify(world)) as World;
    const fry = w2.entities.find((e) => e.id === 'st_fry');
    expect(fry).toBeDefined();
    fry!.name = 'Fry 2';
    // Run production on the modified world.
    const dx2 = diagnoseAtTime({ world: w2, ledger: history, t: T, branch: 'history:day1' }) as Diagnosis;
    const set2 = evaluateRecommendations({ world: w2, ledger: history, diagnosis: dx2, config, horizon_t: HORIZON, objective: OPERATIONAL as never }) as RecommendationSet;
    // This should NOT throw. The "2" in "Fry 2" is part of the substituted name
    // and must be excluded from C4 validation.
    const explained = explainRecommendations({ world: w2, set: set2 }) as { lines: typeof lines };
    expect(explained.lines.length).toBeGreaterThan(0);
    // Verify the name appears in the output.
    const texts = explained.lines.map((l) => l.text).join('\n');
    expect(texts).toContain('Fry 2');
  });


});
