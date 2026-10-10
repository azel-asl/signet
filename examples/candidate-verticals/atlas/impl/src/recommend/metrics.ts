// ATLAS M5 comparison metrics (19 §G, §H).
// Window (tB, tH]. Sample points: settled state at tB, then settled state at
// the end of every instant in (tB, tH] with events. A sampled value holds until
// the next sample point or tH. "Overloaded" = OVERLOADED or UNSTAFFED.
// Exact integer/event-based semantics; no sampling approximations.
import type { World, AtlasEvent, Seconds } from '../types.js';
import type { WindowMetrics, MetricDelta } from './types.js';
import { createState, applyEvent } from '../reducer.js';
import { stationStatus } from '../views.js';

function isOverloaded(status: string): boolean {
  return status === 'OVERLOADED' || status === 'UNSTAFFED';
}

function stationIds(world: World): string[] {
  return world.entities.filter((e) => e.type === 'station').map((e) => e.id);
}

function kitchenTarget(world: World): number {
  const g = world.goals.find((x) => x.metric === 'avg_kitchen_time_s');
  if (!g || typeof g.target !== 'number') throw new Error('world has no avg_kitchen_time_s goal target');
  return g.target;
}

export function computeWindowMetrics(input: {
  world: World;
  log: AtlasEvent[]; // parent ledger (t <= tB) followed by sim events (t in (tB, tH])
  tB: Seconds;
  tH: Seconds;
}): WindowMetrics {
  const { world, log, tB, tH } = input;
  const stations = stationIds(world);
  const target = kitchenTarget(world);

  // Replay and snapshot (19 §G sample-point rule).
  const s = createState(world);
  let i = 0;
  const samples: { t: number; q: Record<string, number>; status: Record<string, string> }[] = [];
  const snap = (t: number) => {
    const q: Record<string, number> = {};
    const status: Record<string, string> = {};
    for (const st of stations) {
      const stState = (s as unknown as { stations: Record<string, { queue: unknown[] }> }).stations[st];
      q[st] = stState ? stState.queue.length : 0;
      status[st] = stationStatus(world, s as never, st, t as Seconds);
    }
    samples.push({ t, q, status });
  };
  for (; i < log.length && log[i].t <= tB; i++) applyEvent(s, log[i]);
  snap(tB);
  while (i < log.length && log[i].t <= tH) {
    const t = log[i].t;
    while (i < log.length && log[i].t === t) { applyEvent(s, log[i]); i++; }
    snap(t);
  }

  const per: Record<string, { queue_burden_s: number; overload_s: number; max_queue: number; overload_last_t: number | null }> = {};
  for (const st of stations) per[st] = { queue_burden_s: 0, overload_s: 0, max_queue: 0, overload_last_t: null };
  samples.forEach((p, k) => {
    const end = k + 1 < samples.length ? samples[k + 1].t : tH;
    for (const st of stations) {
      const v = per[st];
      v.queue_burden_s += p.q[st] * (end - p.t);
      v.max_queue = Math.max(v.max_queue, p.q[st]);
      if (isOverloaded(p.status[st])) {
        v.overload_s += end - p.t;
        v.overload_last_t = p.t;
      }
    }
  });

  // Order-level metrics from the replayed state.
  const orders = Object.values((s as unknown as { orders: Record<string, { created_t: number; completed_t: number | null }> }).orders ?? {});
  let tis = 0, completed = 0, open = 0, delay_s = 0;
  for (const o of orders) {
    const c = o.completed_t ?? Infinity;
    const a = Math.max(o.created_t, tB), b = Math.min(c, tH);
    if (b > a) tis += b - a;
    if (o.completed_t != null && o.completed_t > tB && o.completed_t <= tH) completed++;
    if (o.created_t > tB && o.created_t <= tH) {
      if (!(o.completed_t != null && o.completed_t <= tH)) open++;
      delay_s += Math.max(0, (Math.min(c, tH) - o.created_t) - target);
    }
  }

  return {
    order_time_in_system_s: tis,
    orders_completed_in_window: completed,
    orders_open_at_horizon: open,
    delay_s_over_target_censored: delay_s,
    stations: per,
  };
}

export function diffMetrics(baseline: WindowMetrics, scenario: WindowMetrics): MetricDelta {
  const stations: MetricDelta['stations'] = {};
  for (const st of Object.keys(baseline.stations)) {
    stations[st] = {
      queue_burden_s: scenario.stations[st].queue_burden_s - baseline.stations[st].queue_burden_s,
      overload_s: scenario.stations[st].overload_s - baseline.stations[st].overload_s,
    };
  }
  return {
    order_time_in_system_s: scenario.order_time_in_system_s - baseline.order_time_in_system_s,
    orders_completed_in_window: scenario.orders_completed_in_window - baseline.orders_completed_in_window,
    orders_open_at_horizon: scenario.orders_open_at_horizon - baseline.orders_open_at_horizon,
    delay_s_over_target_censored: scenario.delay_s_over_target_censored - baseline.delay_s_over_target_censored,
    stations,
  };
}
