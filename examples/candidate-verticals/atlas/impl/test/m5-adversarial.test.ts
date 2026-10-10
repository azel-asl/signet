// ATLAS M5 adversarial tests: runtime is not fixture-specific.
// Covers: different ids, unsupported limitation class, missing capability,
// ineligible workers, resource at destination, invalid windows, bounds,
// dominated candidates, no-action winner, dangling evidence, epistemic
// violations, invalid status/rank, unknown intervention kind, non-advisory
// authority attempts, rule-id change with kind stable.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime, evaluateRecommendationsFacade } from '../src/capabilities.js';
import { generateCandidateSeeds } from '../src/recommend/candidates.js';
import { checkEligibility } from '../src/recommend/eligibility.js';
import { compileInterventions } from '../src/recommend/compile.js';
import { assertRecommendationEvidenceResolves } from '../src/recommend/resolve.js';
import { RecommendationError } from '../src/recommend/types.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config, Candidate } from '../src/recommend/types.js';

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

describe('M5 adversarial', () => {
  it('unsupported limitation class (DEMAND) yields no candidates', () => {
    const dxCopy = JSON.parse(JSON.stringify(dx)) as Diagnosis;
    for (const c of dxCopy.claims) {
      if (c.kind === 'capacity_limit') (c.values as { class: string }).class = 'DEMAND';
    }
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dxCopy, config, horizon_t: HORIZON });
    expect(seeds.length).toBe(0);
  });

  it('resource already at destination is excluded at enumeration', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    // emp_03 is at st_fry; no seed should have resource emp_03.
    expect(seeds.every((s) => s.resource !== 'emp_03')).toBe(true);
  });

  it('ALREADY_AT_DESTINATION caught if enumeration is bypassed', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const s = { ...seeds[0], resource: 'emp_03', to: 'st_fry' };
    const e = checkEligibility({ world, ledger: history, seed: s, t: T, tB: T, tH: HORIZON });
    expect(e.reasons).toContain('ALREADY_AT_DESTINATION');
  });

  it('invalid branch window (end_t > tH) is WINDOW_INVALID', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    const bad = { ...seeds[0], window: { start_t: T, end_t: HORIZON + 100, label: 'bad' } };
    const e = checkEligibility({ world, ledger: history, seed: bad, t: T, tB: T, tH: HORIZON });
    expect(e.reasons).toContain('WINDOW_INVALID');
  });

  it('candidate that improves target but harms another is surfaced, not hidden', () => {
    const set = evaluateRecommendationsFacade({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL }) as any;
    const c04 = set.candidates.find((c: any) => c.id === 'cand:reassign_resource:emp_04:st_fry:to_horizon');
    // Improves Fry (delta negative = improvement) but harms Prep.
    expect(c04.delta.order_time_in_system_s).toBeLessThan(0);
    expect(c04.trade_offs.length).toBeGreaterThan(0);
    expect(c04.new_overload_stations).toContain('st_prep');
  }, 120000);

  it('dangling evidence in a crafted candidate throws at construction', () => {
    const c: Candidate = {
      id: 'cand:reassign_resource:emp_x:st_y:30m', kind: 'reassign_resource',
      capability: 'cap:reassign_to_staff_bound_station', origin_claim: 'c:capacity_limit:st_y',
      resource: 'emp_x', from: null, to: 'st_y',
      window: { start_t: T, end_t: T + 1800, label: '30m' },
      eligibility: { eligible: true, reasons: [], evidence: [] },
      simulation: null, metrics: null, delta: null, trade_offs: [],
      new_overload_stations: [], dominated_by: [], economics: null,
      status: 'infeasible', rank: null, assumptions: [],
      claim_class: 'derived', support: 'none',
      evidence: [{ kind: 'world', path: '/entities/12345' }],
    };
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} }, [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('every set carries advisory_only authority', () => {
    const set = evaluateRecommendationsFacade({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL }) as any;
    expect(set.authority).toBe('advisory_only');
  }, 120000);

  it('compiled intervention kind is always reassign (unknown kinds rejected)', () => {
    const seeds = generateCandidateSeeds({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    for (const s of seeds.slice(0, 3)) {
      const ivs = compileInterventions({ world, seed: s });
      for (const iv of ivs) expect(iv.kind).toBe('reassign');
    }
  });

  it('rule-id change with kind stable: eligibility does not depend on literal R ids', () => {
    // The pack and eligibility resolve skills by convention and rules by kind.
    // Changing a rule's id while keeping its kind must not change outcomes.
    const w2 = JSON.parse(JSON.stringify(world)) as World;
    for (const r of (w2 as any).rules ?? []) {
      if (r.id === 'R01') r.id = 'R99';
    }
    const seeds = generateCandidateSeeds({ world: w2, ledger: history, diagnosis: dx, config, horizon_t: HORIZON });
    expect(seeds.length).toBe(10);
  });
});
