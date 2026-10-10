// ATLAS M5 economics (19 §I).
// Separate layer; never inside the simulator. Only the frozen economics model.
// No revenue is assigned to completed orders (R09; lost_demand_model is null).
// All economic outputs are claim_class assumed, support bounded.
import type { World } from '../types.js';
import type { WindowMetrics, CandidateEconomics, EvidenceRef } from './types.js';
import type { M5Config } from './types.js';

function roundCents(x: number): number {
  return Math.round(x * 100) / 100;
}

export function delayCostRate(world: World): { value: number; source: EvidenceRef } {
  const econ = (world as unknown as { economics?: { delay_cost_per_order_minute_over_target?: { value: number } } }).economics;
  const v = econ?.delay_cost_per_order_minute_over_target?.value;
  if (typeof v !== 'number') throw new Error('world.economics.delay_cost_per_order_minute_over_target.value missing');
  return { value: v, source: { kind: 'world', path: '/economics/delay_cost_per_order_minute_over_target/value' } };
}

function runCost(delay_s: number, rate: number, moves: number, moveCost: number): number {
  return roundCents((delay_s / 60) * rate + moves * moveCost);
}

export function computeEconomics(input: {
  world: World;
  config: M5Config;
  baseline: WindowMetrics;
  scenario: WindowMetrics;
}): CandidateEconomics {
  const { world, config, baseline, scenario } = input;
  const { value: baseRate, source: rateSource } = delayCostRate(world);
  const moveCost = config.economics.reassignment_cost_per_move;
  const rates = config.sensitivity.delay_cost_per_order_minute;

  const by_value = {} as CandidateEconomics['by_value'];
  for (const key of ['low', 'base', 'high'] as const) {
    const r = key === 'base' ? baseRate : rates[key];
    const baseline_cost = runCost(baseline.delay_s_over_target_censored, r, 0, moveCost);
    const scenario_cost = runCost(scenario.delay_s_over_target_censored, r, 2, moveCost);
    by_value[key] = {
      baseline_cost,
      scenario_cost,
      net_effect: roundCents(baseline_cost - scenario_cost),
    };
  }

  return {
    inputs: [
      { name: 'delay_cost_per_order_minute', value: baseRate, claim_class: 'assumed', source: rateSource },
      { name: 'reassignment_cost_per_move', value: moveCost, claim_class: 'assumed', source: { kind: 'config', path: '/economics/reassignment_cost_per_move' } },
      // Incremental labor is zero for reassign_resource: no paid hours change (§I).
      // Source is the economics config object (the zero is definitional).
      { name: 'incremental_labor_cost', value: 0, claim_class: 'configured', source: { kind: 'config', path: '/economics' } },
    ],
    by_value,
    claim_class: 'assumed',
    support: 'bounded',
  };
}

// Sensitivity (19 §P): top economic choice at each rate point and stability.
export function sensitivityTops(input: {
  candidates: { id: string; economics: CandidateEconomics | null; status: string }[];
}): { low: string; base: string; high: string; stable: boolean } {
  const { candidates } = input;
  const top = (key: 'low' | 'base' | 'high'): string => {
    let best: string | null = null;
    let bestNet = 0;
    for (const c of candidates) {
      if (!c.economics) continue;
      const net = c.economics.by_value[key].net_effect;
      if (net > 0 && (best === null || net > bestNet || (net === bestNet && c.id < best))) {
        best = c.id;
        bestNet = net;
      }
    }
    return best ?? 'no_action';
  };
  const low = top('low'), base = top('base'), high = top('high');
  return { low, base, high, stable: low === base && base === high };
}
