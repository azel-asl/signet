// ATLAS M5 core orchestration (19 §B).
// M4 diagnosis → pack capability → candidate enumeration → eligibility →
// compile → M2 simulator → baseline/scenario comparison → economics →
// trade-offs → dominance → ranking → deterministic explanation.
// Core is domain-free; pack capabilities supply the domain firing rules.
import { createHash } from 'node:crypto';
import type { World, AtlasEvent, Seconds } from '../types.js';
import type { Diagnosis } from '../diagnose/types.js';
import type {
  Candidate, M5Config, RecommendationSet, RecommendationObjective,
  EvidenceRef, WindowMetrics,
} from './types.js';
import { RecommendationError } from './types.js';
import { resolveRef } from './resolve.js';
import { generateCandidateSeeds, MAX_CANDIDATES } from './candidates.js';
import { checkEligibility } from './eligibility.js';
import { compileInterventions } from './compile.js';
import { computeWindowMetrics, diffMetrics } from './metrics.js';
import { computeEconomics, sensitivityTops } from './economics.js';
import { newOverloadStations, tradeOffs, computeDominatedBy, assignStatus, rankCandidates } from './rank.js';
import { assertRecommendationEvidenceResolves } from './resolve.js';
import { runScenarioSpec } from '../capabilities.js';
import { reduceTo } from '../reducer.js';
import { canonHash } from '../simulate.js';
import { STATION_FLOW_PACK_ID, STATION_FLOW_PACK_VERSION, STATION_FLOW_CAPABILITIES } from './packs/station-flow-capabilities.js';

export const RECOMMEND_VERSION = 'atlas-recommend/0.1.0';
export const MAX_SIMULATIONS = 12; // eligible candidates; +1 baseline

function h16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function configSha256(config: M5Config): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export interface EvaluateInput {
  world: World;
  ledger: AtlasEvent[];
  diagnosis: Diagnosis;
  config: M5Config;
  horizon_t: Seconds;
  objective: RecommendationObjective;
  candidate_ids?: string[];
}

export function evaluateRecommendations(input: EvaluateInput): RecommendationSet {
  const { world, ledger, diagnosis, config, horizon_t, objective } = input;
  const t = diagnosis.context.t as Seconds;
  const tB = t; // M2 branch interval is [t, horizon_t]
  const tH = horizon_t;

  // 15s request bound (19 §S). Deadline checked at each simulation.
  const deadline = Date.now() + 15000;
  const checkDeadline = () => {
    if (Date.now() > deadline) {
      throw new RecommendationError('BOUND_EXCEEDED', 'request exceeded 15s bound');
    }
  };

  // Bounds (19 §S).
  if (!(tH > tB)) {
    throw new RecommendationError('BOUND_EXCEEDED', 'horizon_t must be after t');
  }
  if (tH - tB > 7200) {
    throw new RecommendationError('BOUND_EXCEEDED', 'horizon_t - t exceeds 7200 s');
  }
  const worldEnd = world.time.end ? Math.floor(Date.parse(world.time.end) / 1000) : Infinity;
  if (tH > worldEnd) {
    throw new RecommendationError('BOUND_EXCEEDED', 'horizon_t exceeds world.time.end');
  }
  if (!objective || (objective.id !== 'operational' && objective.id !== 'economic')) {
    throw new RecommendationError('OBJECTIVE_REQUIRED', 'an explicit objective (operational|economic) is required');
  }

  const cfgSha = configSha256(config);
  const seeds = generateCandidateSeeds({ world, ledger, diagnosis, config, horizon_t });
  const filtered = input.candidate_ids
    ? seeds.filter((s) => input.candidate_ids!.includes(s.id))
    : seeds;

  // No supported intervention (19 §E, §L).
  if (filtered.length === 0) {
    return buildNoActionSet({
      world, diagnosis, config, cfgSha, horizon_t, objective,
      reason: 'NO_SUPPORTED_INTERVENTION',
      claimClass: objective.id === 'economic' ? 'assumed' : 'simulated',
    });
  }

  // Eligibility (before simulation).
  const candidates: Candidate[] = [];
  const eligibleSeeds: typeof filtered = [];
  for (const seed of filtered) {
    const elig = checkEligibility({ world, ledger, seed, t, tB, tH });
    if (!elig.eligible) {
      candidates.push({
        id: seed.id,
        kind: 'reassign_resource',
        capability: seed.capability,
        origin_claim: seed.origin_claim,
        resource: seed.resource,
        from: seed.from,
        to: seed.to,
        window: seed.window,
        eligibility: elig,
        simulation: null,
        metrics: null,
        delta: null,
        trade_offs: [],
        new_overload_stations: [],
        dominated_by: [],
        economics: null,
        status: 'infeasible',
        rank: null,
        assumptions: seed.from === null ? ['resource has no modeled assignment at the source; any unmodeled duties are not represented'] : [],
        claim_class: 'derived',
        support: 'none',
        evidence: buildCandidateEvidence({ world, config, seed, t }),
      });
    } else {
      eligibleSeeds.push(seed);
    }
  }

  if (eligibleSeeds.length === 0) {
    return buildNoActionSet({
      world, diagnosis, config, cfgSha, horizon_t, objective,
      reason: 'NO_ELIGIBLE_CANDIDATE',
      claimClass: objective.id === 'economic' ? 'assumed' : 'simulated',
      candidates,
    });
  }

  // Simulation bound (19 §S): 12 eligible + 1 baseline.
  if (eligibleSeeds.length > MAX_SIMULATIONS) {
    throw new RecommendationError('BOUND_EXCEEDED',
      `eligible candidates ${eligibleSeeds.length} exceed the frozen simulation bound of ${MAX_SIMULATIONS}`);
  }

  // Baseline run (once) via the M2 facade.
  const baselineSpec = { id: 'm5-baseline', name: 'm5 baseline', base_t: tB, horizon_t: tH, interventions: [] };
  const baselineRun = runScenarioSpec({ world, ledger, scenario: baselineSpec });
  const baselineArm = baselineRun.baseline as { receipt: { run_id: string }; events: AtlasEvent[] };
  const baselineLog = [...ledger.filter((e) => e.t <= tB), ...baselineArm.events];
  const baselineMetrics = computeWindowMetrics({ world, log: baselineLog, tB, tH });

  // Candidate simulations.
  const simLogs = new Map<string, AtlasEvent[]>();
  simLogs.set(baselineArm.receipt.run_id, baselineArm.events);
  const simulated: { seed: typeof eligibleSeeds[number]; metrics: WindowMetrics; runId: string; events: AtlasEvent[]; interventions: ReturnType<typeof compileInterventions> }[] = [];

  for (const seed of eligibleSeeds) {
    checkDeadline(); // 15s bound
    const interventions = compileInterventions({ world, seed });
    const spec = {
      id: `m5-${seed.id}`,
      name: `m5 ${seed.id}`,
      base_t: tB,
      horizon_t: tH,
      interventions: interventions.map((iv) => ({
        id: iv.id, employee: iv.employee, from: iv.from, to: iv.to, at_t: iv.at_t,
      })),
    };
    let run: { scenario: { receipt: { run_id: string }; events: AtlasEvent[] } };
    try {
      const r = runScenarioSpec({ world, ledger, scenario: spec });
      run = { scenario: r.scenario as { receipt: { run_id: string }; events: AtlasEvent[] } };
    } catch (e) {
      // insufficient_evidence: simulation could not be produced.
      candidates.push({
        id: seed.id,
        kind: 'reassign_resource',
        capability: seed.capability,
        origin_claim: seed.origin_claim,
        resource: seed.resource,
        from: seed.from,
        to: seed.to,
        window: seed.window,
        eligibility: checkEligibility({ world, ledger, seed, t, tB, tH }),
        simulation: null,
        metrics: null,
        delta: null,
        trade_offs: [],
        new_overload_stations: [],
        dominated_by: [],
        economics: null,
        status: 'insufficient_evidence',
        rank: null,
        assumptions: [],
        claim_class: 'derived',
        support: 'none',
        evidence: buildCandidateEvidence({ world, config, seed, t }),
      });
      continue;
    }
    const log = [...ledger.filter((e) => e.t <= tB), ...run.scenario.events];
    const metrics = computeWindowMetrics({ world, log, tB, tH });
    simLogs.set(run.scenario.receipt.run_id, run.scenario.events);
    simulated.push({ seed, metrics, runId: run.scenario.receipt.run_id, events: run.scenario.events, interventions });
  }

  // Comparison, economics, trade-offs, dominance, statuses.
  const rankable = simulated.map((s) => {
    const delta = diffMetrics(baselineMetrics, s.metrics);
    const newOver = newOverloadStations(baselineMetrics, s.metrics);
    return {
      id: s.seed.id,
      metrics: s.metrics,
      delta,
      new_overload_stations: newOver,
    };
  });
  const dominatedBy = computeDominatedBy(rankable);

  const econById = new Map<string, { net_effect: number }>();
  for (const s of simulated) {
    const seed = s.seed;
    const r = rankable.find((x) => x.id === seed.id)!;
    const economics = computeEconomics({ world, config, baseline: baselineMetrics, scenario: s.metrics });
    const valueKey = objective.economic_value_key ?? 'base';
    const netEffect = economics.by_value[valueKey].net_effect;
    econById.set(seed.id, { net_effect: netEffect });

    // CCR-006 §3: under the economic objective, improvement is net economic
    // effect at the chosen rate; net_effect <= 0 → not_recommended.
    const improvement = objective.id === 'economic'
      ? netEffect
      : -r.delta.order_time_in_system_s;
    const status = assignStatus({ improvement, dominatedBy: dominatedBy.get(seed.id) ?? [], newOverloadStations: r.new_overload_stations });
    const toffs = tradeOffs({ baseline: baselineMetrics, scenario: s.metrics, to: seed.to });

    candidates.push({
      id: seed.id,
      kind: 'reassign_resource',
      capability: seed.capability,
      origin_claim: seed.origin_claim,
      resource: seed.resource,
      from: seed.from,
      to: seed.to,
      window: seed.window,
      eligibility: checkEligibility({ world, ledger, seed, t, tB, tH }),
      simulation: {
        run_id: s.runId,
        interventions: s.interventions,
        sim_events: s.events.length,
        trace_content_sha256: traceContentSha256(s.events),
      },
      metrics: s.metrics,
      delta: r.delta,
      trade_offs: toffs,
      new_overload_stations: r.new_overload_stations,
      dominated_by: dominatedBy.get(seed.id) ?? [],
      economics,
      status,
      rank: null, // assigned after ranking
      assumptions: seed.from === null ? ['resource has no modeled assignment at the source; any unmodeled duties are not represented'] : [],
      claim_class: 'simulated',
      support: 'deterministic',
      evidence: buildCandidateEvidence({ world, config, seed, t, runId: s.runId, events: s.events }),
    });
  }

  // Ranking.
  const rankedIds = rankCandidates({
    pool: candidates
      .filter((c) => c.metrics && c.delta)
      .map((c) => ({
        id: c.id,
        metrics: c.metrics!,
        delta: c.delta!,
        new_overload_stations: c.new_overload_stations,
        status: c.status,
      })),
    objective,
    economicsById: econById,
  });
  const rankById = new Map(rankedIds.map((id, i) => [id, i + 1]));
  for (const c of candidates) {
    c.rank = rankById.get(c.id) ?? null;
  }

  // Sensitivity (19 §P).
  const sens = sensitivityTops({ candidates: candidates.map((c) => ({ id: c.id, economics: c.economics, status: c.status })) });
  const rates = config.sensitivity.delay_cost_per_order_minute;

  // Evidence resolution at construction (19 §M).
  // Use the raw WorldState wrapped for state pointers. Ensure every person has
  // an entry (unassigned → null) so eligibility evidence always resolves.
  const { state: rawState } = reduceTo(world, ledger, t as never);
  for (const p of world.entities.filter((e) => e.type === 'person')) {
    if (!(p.id in rawState.assignments)) rawState.assignments[p.id] = null;
    if (!(p.id in rawState.on_shift)) rawState.on_shift[p.id] = false;
  }
  const snapshot = { state: rawState };
  assertRecommendationEvidenceResolves(
    { world, ledger, diagnosis, simLogs, config, snapshot },
    candidates,
  );

  // Assemble the set.
  const setId = 'rs_' + h16(canonHash({ context: { branch: diagnosis.context.branch, t, horizon_t }, objective, config_sha256: cfgSha, candidates: candidates.map((c) => c.id) }));
  const topCandidateId = rankedIds[0] ?? null;
  const top: RecommendationSet['top'] = topCandidateId
    ? {
        kind: 'candidate',
        candidate_id: topCandidateId,
        reason: 'RANKED_FIRST',
        claim_class: objective.id === 'economic' ? 'assumed' : 'simulated',
        support: objective.id === 'economic' ? 'bounded' : 'deterministic',
      }
    : {
        kind: 'no_action',
        candidate_id: null,
        reason: 'NO_CANDIDATE_BETTER_THAN_BASELINE',
        claim_class: objective.id === 'economic' ? 'assumed' : 'simulated',
        support: objective.id === 'economic' ? 'bounded' : 'deterministic',
      };

  const set: RecommendationSet = {
    atlas_schema: 'atlas-recommendation/0.1',
    set_id: setId,
    recommend_version: RECOMMEND_VERSION,
    authority: 'advisory_only',
    packs: [{ id: STATION_FLOW_PACK_ID, version: STATION_FLOW_PACK_VERSION, capabilities: STATION_FLOW_CAPABILITIES.map((c) => c.id) }],
    world: { id: world.metadata.id },
    context: {
      branch: diagnosis.context.branch,
      claim_class: 'derived',
      t,
      ts: diagnosis.context.ts,
      horizon_t: tH,
      diagnosis_id: diagnosis.diagnosis_id,
      diagnosis_hash: diagnosis.diagnosis_hash,
      snapshot_state_hash: diagnosis.context.snapshot_state_hash,
    },
    objective,
    config_sha256: cfgSha,
    baseline: { run_id: baselineArm.receipt.run_id, metrics: baselineMetrics },
    candidates,
    ranking: rankedIds,
    top,
    sensitivity: {
      parameter: 'delay_cost_per_order_minute',
      values: { low: rates.low, base: rates.base, high: rates.high },
      economic_top_by_value: { low: sens.low, base: sens.base, high: sens.high },
      stable: sens.stable,
    },
    set_hash: '',
  };
  set.set_hash = createHash('sha256').update(canonHash({ ...set, set_hash: '' })).digest('hex');

  // CCR-006 §M: resolve every ref at construction (including no-action sets).
  resolveAllEvidence({ world, ledger, diagnosis, config, set, simLogs });

  return set;
}



function traceContentSha256(events: AtlasEvent[]): string {
  const proj = events.map((e) => ({ t: e.t, type: e.type, subject: e.subject, data: e.data }));
  return createHash('sha256').update(JSON.stringify(proj)).digest('hex');
}

function buildCandidateEvidence(input: {
  world: World;
  config: M5Config;
  seed: { id: string; origin_claim: string; resource: string; to: string; window: { label: string } };
  t: number;
  runId?: string;
  events?: AtlasEvent[];
}): EvidenceRef[] {
  const { world, config, seed, runId, events } = input;
  const refs: EvidenceRef[] = [
    { kind: 'diagnosis_claim', claim_id: seed.origin_claim },
  ];
  // Config pointer to the window used.
  const wi = config.candidate_windows.findIndex((w) => w.label === seed.window.label);
  if (wi >= 0) refs.push({ kind: 'config', path: `/candidate_windows/${wi}` });
  // Destination station capacity attributes (world pointer).
  const di = world.entities.findIndex((e) => e.id === seed.to);
  if (di >= 0) refs.push({ kind: 'world', path: `/entities/${di}/attrs` });
  // Compiled intervention sim_event refs.
  if (runId && events) {
    for (const ev of events) {
      const reason = (ev.data as { reason?: string } | undefined)?.reason;
      if (ev.type === 'ASSIGNMENT_CHANGED' && (reason === 'intervention:iv_01' || reason === 'intervention:iv_02')) {
        refs.push({ kind: 'sim_event', run_id: runId, event_id: ev.event_id });
      }
    }
  }
  return refs;
}

function buildNoActionSet(input: {
  world: World;
  diagnosis: Diagnosis;
  config: M5Config;
  cfgSha: string;
  horizon_t: number;
  objective: RecommendationObjective;
  reason: 'NO_SUPPORTED_INTERVENTION' | 'NO_ELIGIBLE_CANDIDATE';
  claimClass: 'simulated' | 'assumed';
  candidates?: Candidate[];
}): RecommendationSet {
  const { world, diagnosis, cfgSha, horizon_t, objective, reason, claimClass } = input;
  const t = diagnosis.context.t;
  const candidates = input.candidates ?? [];
  const rates = input.config.sensitivity.delay_cost_per_order_minute;
  const sens = sensitivityTops({ candidates: candidates.map((c) => ({ id: c.id, economics: c.economics, status: c.status })) });
  const setId = 'rs_' + h16(canonHash({ context: { branch: diagnosis.context.branch, t, horizon_t }, objective, config_sha256: cfgSha, candidates: candidates.map((c) => c.id) }));
  const set: RecommendationSet = {
    atlas_schema: 'atlas-recommendation/0.1',
    set_id: setId,
    recommend_version: RECOMMEND_VERSION,
    authority: 'advisory_only',
    packs: [{ id: STATION_FLOW_PACK_ID, version: STATION_FLOW_PACK_VERSION, capabilities: STATION_FLOW_CAPABILITIES.map((c) => c.id) }],
    world: { id: world.metadata.id },
    context: {
      branch: diagnosis.context.branch,
      claim_class: 'derived',
      t,
      ts: diagnosis.context.ts,
      horizon_t,
      diagnosis_id: diagnosis.diagnosis_id,
      diagnosis_hash: diagnosis.diagnosis_hash,
      snapshot_state_hash: diagnosis.context.snapshot_state_hash,
    },
    objective,
    config_sha256: cfgSha,
    baseline: { run_id: '', metrics: emptyMetrics() },
    candidates,
    ranking: [],
    top: {
      kind: 'no_action',
      candidate_id: null,
      reason,
      claim_class: claimClass,
      support: claimClass === 'assumed' ? 'bounded' : 'deterministic',
    },
    sensitivity: {
      parameter: 'delay_cost_per_order_minute',
      values: { low: rates.low, base: rates.base, high: rates.high },
      economic_top_by_value: { low: sens.low, base: sens.base, high: sens.high },
      stable: sens.stable,
    },
    set_hash: '',
  };
  set.set_hash = createHash('sha256').update(canonHash({ ...set, set_hash: '' })).digest('hex');
  return set;
}

function emptyMetrics(): WindowMetrics {
  return {
    order_time_in_system_s: 0,
    orders_completed_in_window: 0,
    orders_open_at_horizon: 0,
    delay_s_over_target_censored: 0,
    stations: {},
  };
}

function resolveAllEvidence(input: {
  world: World;
  ledger: AtlasEvent[];
  diagnosis: Diagnosis;
  config: M5Config;
  set: RecommendationSet;
  simLogs: Map<string, AtlasEvent[]>;
}): void {
  const { world, ledger, diagnosis, config, set, simLogs } = input;
  const t = diagnosis.context.t;
  const { state: rawState } = reduceTo(world, ledger, t as Seconds);
  // Ensure all persons are represented in the state (for evidence resolution).
  for (const p of world.entities.filter((e) => e.type === 'person')) {
    if (!(p.id in rawState.assignments)) rawState.assignments[p.id] = null;
    if (!(p.id in rawState.on_shift)) rawState.on_shift[p.id] = false;
  }
  // resolve.ts expects snapshot to be the wrapped WorldState ({state: {...}}).
  const ctx = {
    world,
    ledger,
    diagnosis: diagnosis as never,
    simLogs,
    config,
    snapshot: { state: rawState },
  };
  for (const c of set.candidates) {
    const allRefs = [...c.evidence, ...c.eligibility.evidence];
    for (const ref of allRefs) {
      const resolved = resolveRef(ctx, ref as never);
      // null is a valid resolution (e.g., unassigned station); only undefined/MISSING is dangling.
      if (resolved === undefined) {
        throw new RecommendationError('EVIDENCE_UNRESOLVED', `dangling ref: ${JSON.stringify(ref)}`);
      }
    }
  }
}
