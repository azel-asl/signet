// Window metrics for a comparison window (tB, tH] (16 §D6, 06-behavior-simulation.md).
// Operational only: no revenue, no cost, no economics (M2 has no economic model).
//
// Membership: orders created inside the window. completed counts those also
// completed by tH. Kitchen-time statistics over the completed subset.
// max_queue and overloaded_seconds are over SAMPLE POINTS (06, CCR-004):
// the settled state at tB, then the settled state at the end of every instant
// in (tB, tH] that has events; a sampled status holds until the next sample
// point or tH.
import { reduceTo } from './reducer.js';
import { capacity, iso, kitchenTarget, stationIds, stationStatus, utilization } from './views.js';
import type { AtlasEvent, Seconds, World } from './types.js';

export interface WindowMetrics {
  window: { from: string; to: string; minutes: number };
  orders_arrived: number;
  orders_completed: number;
  orders_open_at_horizon: number;
  throughput_per_hour: number;
  avg_kitchen_time_s: number | null;
  p90_kitchen_time_s: number | null;
  max_kitchen_time_s: number | null;
  over_target_share: number | null;
  delay_minutes_over_target: number;
  max_queue: Record<string, number>;
  overloaded_seconds: Record<string, number>;
  utilization_at_horizon_15m: Record<string, number | null>;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Compute window metrics over `log` for the window (tB, tH].
 * `log` is the history ledger (observed) or a branch log (simulated).
 * `comparisonWindow` is the scenario's {from, to} (ISO strings).
 */
export function computeWindowMetrics(
  world: World,
  _parentEvents: AtlasEvent[],
  log: AtlasEvent[],
  tB: Seconds,
  tH: Seconds,
  comparisonWindow: { from: string; to: string },
): WindowMetrics {
  const stations = stationIds(world);
  const target = kitchenTarget(world);
  const hours = (tH - tB) / 3600;

  // ── order membership from the settled state at tH ──
  const { state: sH } = reduceTo(world, log, tH);
  const arrived = Object.values(sH.orders).filter((o) => o.created_t > tB && o.created_t <= tH);
  const completed = arrived.filter((o) => o.completed_t != null && o.completed_t <= tH);
  const kt = completed.map((o) => (o.completed_t as number) - o.created_t).sort((a, b) => a - b);

  // ── sample points: settled state at tB, then each instant in (tB, tH] ──
  const instants = [...new Set(log.filter((e) => e.t > tB && e.t <= tH).map((e) => e.t))].sort((a, b) => a - b);
  const samples = [tB, ...instants];
  const max_queue: Record<string, number> = {};
  const overloaded_seconds: Record<string, number> = {};
  for (const st of stations) {
    max_queue[st] = 0;
    overloaded_seconds[st] = 0;
  }
  let prev: { t: Seconds; status: Record<string, string> } | null = null;
  for (const tau of samples) {
    const { state } = reduceTo(world, log, tau);
    if (prev) {
      const dur = tau - prev.t;
      for (const st of stations) if (prev.status[st] === 'OVERLOADED') overloaded_seconds[st] += dur;
    }
    for (const st of stations) {
      const q = state.stations[st].queue.length;
      if (q > max_queue[st]) max_queue[st] = q;
    }
    const status: Record<string, string> = {};
    for (const st of stations) status[st] = stationStatus(world, state, st, tau);
    prev = { t: tau, status };
  }
  if (prev) {
    const dur = tH - prev.t;
    for (const st of stations) if (prev.status[st] === 'OVERLOADED') overloaded_seconds[st] += dur;
  }

  // ── utilization at the horizon over the trailing 15 minutes of the log ──
  const utilization_at_horizon_15m: Record<string, number | null> = {};
  for (const st of stations) {
    utilization_at_horizon_15m[st] = utilization(world, sH, st, tH, log);
  }

  const overTarget = kt.filter((x) => x > target);
  return {
    window: { from: comparisonWindow.from, to: comparisonWindow.to, minutes: Math.round((tH - tB) / 60) },
    orders_arrived: arrived.length,
    orders_completed: completed.length,
    orders_open_at_horizon: arrived.length - completed.length,
    throughput_per_hour: +(completed.length / hours).toFixed(1),
    avg_kitchen_time_s: kt.length ? Math.round(kt.reduce((a, b) => a + b, 0) / kt.length) : null,
    p90_kitchen_time_s: percentile(kt, 0.9),
    max_kitchen_time_s: kt.length ? kt[kt.length - 1] : null,
    over_target_share: kt.length ? +(overTarget.length / kt.length).toFixed(2) : null,
    delay_minutes_over_target: +(overTarget.reduce((a, x) => a + (x - target), 0) / 60).toFixed(1),
    max_queue,
    overloaded_seconds,
    utilization_at_horizon_15m,
  };
}
