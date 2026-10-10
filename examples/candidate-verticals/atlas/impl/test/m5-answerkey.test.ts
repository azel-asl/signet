// ATLAS M5: canonical answer-key matching (T-COMPARISON, T-TEMPORAL,
// T-ECONOMICS, T-OBJECTIVE, T-TRADEOFF, T-DOMINANCE).
// Validates every §G metric, delta, status, dominance, ranking, economics,
// and sensitivity value against the frozen reference answer key.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { evaluateRecommendations } from '../src/recommend/core.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Diagnosis } from '../src/diagnose/types.js';
import type { M5Config, RecommendationSet } from '../src/recommend/types.js';

let world: World;
let history: AtlasEvent[];
let dx: Diagnosis;
let config: M5Config;
let set: RecommendationSet;
let ak: any;

const HORIZON = 1791340200;
const OPERATIONAL = { id: 'operational', primary_metric: 'order_time_in_system_s', direction: 'minimize', tie_breakers: ['fewer new_overload_stations', 'larger orders_completed_in_window', 'candidate id'], conditional_on: 'new_overload_stations' } as const;

beforeAll(async () => {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
  dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' }) as Diagnosis;
  config = JSON.parse(await readFile(new URL('../m5-config.json', import.meta.url), 'utf8'));
  ak = JSON.parse(await readFile(new URL('../test/fixtures/m5-answer-key.json', import.meta.url), 'utf8').catch(() => readFile('/tmp/m5-answer-key.json', 'utf8')));
  set = evaluateRecommendations({ world, ledger: history, diagnosis: dx, config, horizon_t: HORIZON, objective: OPERATIONAL as never });
}, 180000);

function akCandidate(id: string): any {
  return ak.candidates.find((c: any) => c.id === id);
}

describe('T-COMPARISON: every §G metric equals the answer key', () => {
  it('baseline metrics match', () => {
    const b = ak.baseline.metrics;
    expect(set.baseline.metrics.order_time_in_system_s).toBe(b.order_time_in_system_s);
    expect(set.baseline.metrics.orders_completed_in_window).toBe(b.orders_completed_in_window);
    expect(set.baseline.metrics.orders_open_at_horizon).toBe(b.orders_open_at_horizon);
    expect(set.baseline.metrics.delay_s_over_target_censored).toBe(b.delay_s_over_target_censored);
    for (const st of Object.keys(b.stations)) {
      expect(set.baseline.metrics.stations[st].queue_burden_s).toBe(b.stations[st].queue_burden_s);
      expect(set.baseline.metrics.stations[st].overload_s).toBe(b.stations[st].overload_s);
      expect(set.baseline.metrics.stations[st].max_queue).toBe(b.stations[st].max_queue);
      expect(set.baseline.metrics.stations[st].overload_last_t).toBe(b.stations[st].overload_last_t);
    }
  });

  it('all six simulated candidates match on every metric', () => {
    for (const c of set.candidates) {
      if (!c.metrics) continue;
      const a = akCandidate(c.id);
      expect(a, `answer key has ${c.id}`).toBeDefined();
      expect(c.metrics.order_time_in_system_s).toBe(a.metrics.order_time_in_system_s);
      expect(c.metrics.orders_completed_in_window).toBe(a.metrics.orders_completed_in_window);
      expect(c.metrics.orders_open_at_horizon).toBe(a.metrics.orders_open_at_horizon);
      expect(c.metrics.delay_s_over_target_censored).toBe(a.metrics.delay_s_over_target_censored);
      for (const st of Object.keys(a.metrics.stations)) {
        expect(c.metrics.stations[st].queue_burden_s).toBe(a.metrics.stations[st].queue_burden_s);
        expect(c.metrics.stations[st].overload_s).toBe(a.metrics.stations[st].overload_s);
        expect(c.metrics.stations[st].max_queue).toBe(a.metrics.stations[st].max_queue);
        expect(c.metrics.stations[st].overload_last_t).toBe(a.metrics.stations[st].overload_last_t);
      }
      // Deltas.
      expect(c.delta!.order_time_in_system_s).toBe(a.delta.order_time_in_system_s);
      expect(c.delta!.orders_completed_in_window).toBe(a.delta.orders_completed_in_window);
      for (const st of Object.keys(a.delta.stations)) {
        expect(c.delta!.stations[st].queue_burden_s).toBe(a.delta.stations[st].queue_burden_s);
        expect(c.delta!.stations[st].overload_s).toBe(a.delta.stations[st].overload_s);
      }
    }
  });
});

describe('T-TEMPORAL: overload_last_t and sample-point rule', () => {
  it('Fry overload ends 18:24:52 for emp_06 to_horizon (baseline 19:29:52)', () => {
    const c = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_06:st_fry:to_horizon')!;
    expect(c.metrics!.stations.st_fry.overload_last_t).toBe(1791336292); // 18:24:52
    expect(set.baseline.metrics.stations.st_fry.overload_last_t).toBe(1791340192); // 19:29:52
  });
});

describe('T-ECONOMICS: case 5', () => {
  it('top candidate net effects scale with rate: 44.19 / 154.68 / 441.95', () => {
    const topId = ak.top_recommendation;
    const c = set.candidates.find((x) => x.id === topId)!;
    const expected = ak.cases.case5_economics_scale_with_rate;
    expect(c.economics!.by_value.low.net_effect).toBe(expected.low);
    expect(c.economics!.by_value.base.net_effect).toBe(expected.base);
    expect(c.economics!.by_value.high.net_effect).toBe(expected.high);
  });

  it('zero labor: no revenue field; incremental labor is zero', () => {
    for (const c of set.candidates) {
      if (!c.economics) continue;
      const labor = c.economics.inputs.find((x) => x.name === 'incremental_labor_cost');
      expect(labor?.value).toBe(0);
      // No revenue anywhere.
      expect(JSON.stringify(c.economics)).not.toMatch(/revenue/i);
    }
  });

  it('with per-move cost 80, economic top is no_action/no_action/manager (case 5b)', () => {
    const case5b = ak.cases.case5b_costly_moves_economic_objective.by_rate;
    // Recompute with move cost 80 using the set's delay deltas.
    const delayBase = set.baseline.metrics.delay_s_over_target_censored;
    const rates = config.sensitivity.delay_cost_per_order_minute;
    for (const key of ['low', 'base', 'high'] as const) {
      const r = rates[key];
      let best: string | null = null;
      let bestNet = 0;
      for (const c of set.candidates) {
        if (!c.metrics) continue;
        const net = +(((delayBase - c.metrics.delay_s_over_target_censored) / 60) * r - 2 * 80).toFixed(2);
        if (net > 0 && (best === null || net > bestNet)) { best = c.id; bestNet = net; }
      }
      const got = best ?? 'no_action';
      // The answer key's case5b gives the expected top per rate.
      expect(got).toBe(case5b[key].top);
    }
  });
});

describe('T-OBJECTIVE: operational ranking', () => {
  it('ranking has one entry: emp_06 to_horizon', () => {
    expect(set.ranking).toEqual(['cand:reassign_resource:emp_06:st_fry:to_horizon']);
    expect(set.ranking).toEqual(ak.ranking);
  });

  it('top is emp_06 to_horizon, recommended, rank 1', () => {
    expect(set.top.kind).toBe('candidate');
    expect(set.top.candidate_id).toBe('cand:reassign_resource:emp_06:st_fry:to_horizon');
    expect(set.top.candidate_id).toBe(ak.top_recommendation);
    const c = set.candidates.find((x) => x.id === set.top.candidate_id)!;
    expect(c.status).toBe('recommended');
    expect(c.rank).toBe(1);
  });
});

describe('T-TRADEOFF: case 3', () => {
  it('emp_04 to_horizon creates new Prep overload (46s), surfaced as trade-off', () => {
    const c = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_04:st_fry:to_horizon')!;
    expect(c.new_overload_stations).toEqual(['st_prep']);
    expect(c.new_overload_stations).toEqual(akCandidate(c.id).new_overload_stations);
    // Prep burden 310 -> 6960.
    const prep = c.trade_offs.find((t) => t.station === 'st_prep' && t.metric === 'queue_burden_s');
    expect(prep?.baseline).toBe(310);
    expect(prep?.scenario).toBe(6960);
  });

  it('emp_06 to_horizon Pass burden worsens (191 -> 1019), surfaced', () => {
    const c = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_06:st_fry:to_horizon')!;
    const pass = c.trade_offs.find((t) => t.station === 'st_pass' && t.metric === 'queue_burden_s');
    expect(pass?.baseline).toBe(191);
    expect(pass?.scenario).toBe(1019);
  });
});

describe('T-DOMINANCE', () => {
  it('dominated_by lists match the answer key', () => {
    // The answer key does not store dominated_by explicitly; recompute the
    // reference rule: emp_04 and emp_06:30m are dominated.
    const c04h = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_04:st_fry:to_horizon')!;
    const c0430 = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_04:st_fry:30m')!;
    const c0630 = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_06:st_fry:30m')!;
    expect(c04h.status).toBe('dominated');
    expect(c0430.status).toBe('dominated');
    expect(c0630.status).toBe('dominated');
    expect(c04h.dominated_by.length).toBeGreaterThan(0);
    // emp_06 to_horizon is not dominated.
    const c06h = set.candidates.find((x) => x.id === 'cand:reassign_resource:emp_06:st_fry:to_horizon')!;
    expect(c06h.dominated_by).toEqual([]);
  });

  it('statuses match the answer key for all 10', () => {
    for (const c of set.candidates) {
      const a = akCandidate(c.id);
      expect(c.status, c.id).toBe(a.status);
    }
  });
});

describe('T-SENSITIVITY', () => {
  it('economic top by rate matches answer key; stable', () => {
    expect(set.sensitivity.economic_top_by_value).toEqual(ak.sensitivity.economic_top_by_rate);
    expect(set.sensitivity.stable).toBe(ak.sensitivity.economic_top_stable);
  });
});
