// ATLAS M5 T-EVIDENCE: case 7 (every ref resolves); injected dangling refs
// of each kind make evaluation throw.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
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

function baseCandidate(): Candidate {
  return {
    id: 'cand:reassign_resource:emp_99:st_x:30m',
    kind: 'reassign_resource',
    capability: 'cap:reassign_to_staff_bound_station',
    origin_claim: 'c:capacity_limit:st_x',
    resource: 'emp_99',
    from: null,
    to: 'st_x',
    window: { start_t: T, end_t: T + 1800, label: '30m' },
    eligibility: { eligible: true, reasons: [], evidence: [] },
    simulation: null, metrics: null, delta: null,
    trade_offs: [], new_overload_stations: [], dominated_by: [],
    economics: null, status: 'infeasible', rank: null,
    assumptions: [], claim_class: 'derived', support: 'none',
    evidence: [],
  };
}

describe('T-EVIDENCE', () => {
  it('case 7: every evidence ref in the canonical set resolves (no throw)', () => {
    const set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
    // If any ref dangled, evaluateRecommendations would have thrown.
    expect(set.candidates.length).toBe(10);
  }, 120000);

  it('dangling event ref throws EVIDENCE_UNRESOLVED', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'event', event_id: 'ev_nope' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('dangling state ref throws', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'state', path: '/state/nope/x' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('dangling world ref throws', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'world', path: '/entities/99999' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('dangling diagnosis_claim ref throws', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'diagnosis_claim', claim_id: 'c:nope:x' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('dangling sim_event ref throws', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'sim_event', run_id: 'run_nope', event_id: 'ev_1' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });

  it('dangling config ref throws', () => {
    const c = baseCandidate();
    c.evidence = [{ kind: 'config', path: '/nope' }];
    expect(() => assertRecommendationEvidenceResolves(
      { world, ledger: history, diagnosis: dx, simLogs: new Map(), config, snapshot: {} },
      [c],
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_UNRESOLVED' }));
  });
});
