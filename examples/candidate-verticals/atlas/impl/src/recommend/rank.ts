// ATLAS M5 statuses, trade-offs, dominance, ranking (19 §J, §K).
// Objective: minimize order_time_in_system_s (operational) with frozen
// tie-breakers; economic is the explicit opt-in path. No hidden weights.
import type { WindowMetrics, MetricDelta, TradeOff, CandidateStatus, RecommendationObjective } from './types.js';

export function newOverloadStations(baseline: WindowMetrics, scenario: WindowMetrics): string[] {
  return Object.keys(baseline.stations).filter(
    (st) => baseline.stations[st].overload_s === 0 && scenario.stations[st].overload_s > 0,
  );
}

export function tradeOffs(input: {
  baseline: WindowMetrics;
  scenario: WindowMetrics;
  to: string;
}): TradeOff[] {
  const { baseline, scenario, to } = input;
  const out: TradeOff[] = [];
  for (const st of Object.keys(baseline.stations)) {
    if (st === to) continue;
    const bq = baseline.stations[st].queue_burden_s;
    const sq = scenario.stations[st].queue_burden_s;
    if (sq > bq) out.push({ station: st, metric: 'queue_burden_s', baseline: bq, scenario: sq });
    const bo = baseline.stations[st].overload_s;
    const so = scenario.stations[st].overload_s;
    if (so > bo) out.push({ station: st, metric: 'overload_s', baseline: bo, scenario: so });
  }
  return out;
}

interface Rankable {
  id: string;
  metrics: WindowMetrics;
  delta: MetricDelta;
  new_overload_stations: string[];
}

// Dominance vector: (order_time_in_system_s ↓, orders_completed ↑, Σ new overload_s ↓).
function domVector(r: Rankable): [number, number, number] {
  const newOverloadS = r.new_overload_stations.reduce((a, st) => a + r.metrics.stations[st].overload_s, 0);
  return [r.metrics.order_time_in_system_s, -r.metrics.orders_completed_in_window, newOverloadS];
}

function dominates(a: Rankable, b: Rankable): boolean {
  const va = domVector(a), vb = domVector(b);
  return va.every((v, i) => v <= vb[i]) && va.some((v, i) => v < vb[i]);
}

export function computeDominatedBy(pool: Rankable[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of pool) {
    const dom = pool.filter((o) => o.id !== r.id && dominates(o, r)).map((o) => o.id).sort();
    out.set(r.id, dom);
  }
  return out;
}

export function assignStatus(input: {
  improvement: number; // -delta.order_time_in_system_s
  dominatedBy: string[];
  newOverloadStations: string[];
}): CandidateStatus {
  if (input.improvement <= 0) return 'not_recommended';
  if (input.dominatedBy.length > 0) return 'dominated';
  if (input.newOverloadStations.length > 0) return 'conditionally_recommended';
  return 'recommended';
}

// Ranking only over recommended + conditionally_recommended.
// Recommended before conditionally_recommended, then objective, tie-breakers.
export function rankCandidates(input: {
  pool: (Rankable & { status: CandidateStatus })[];
  objective: RecommendationObjective;
  economicsById?: Map<string, { net_effect: number }>;
}): string[] {
  const { pool, objective, economicsById } = input;
  const rankable = pool.filter((r) => r.status === 'recommended' || r.status === 'conditionally_recommended');

  const score = (r: Rankable & { status: CandidateStatus }): number => {
    if (objective.id === 'operational') {
      return -r.delta.order_time_in_system_s; // improvement; higher is better
    }
    const key = objective.economic_value_key ?? 'base';
    return economicsById?.get(r.id)?.net_effect ?? Number.NEGATIVE_INFINITY;
  };

  return rankable
    .slice()
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'recommended' ? -1 : 1;
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sb - sa;
      // Tie-breakers: fewer new_overload_stations, larger completed, candidate id.
      if (a.new_overload_stations.length !== b.new_overload_stations.length) {
        return a.new_overload_stations.length - b.new_overload_stations.length;
      }
      if (a.metrics.orders_completed_in_window !== b.metrics.orders_completed_in_window) {
        return b.metrics.orders_completed_in_window - a.metrics.orders_completed_in_window;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((r) => r.id);
}
