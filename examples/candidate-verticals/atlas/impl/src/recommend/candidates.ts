// ATLAS M5 candidate generation (19 §E).
// Deterministic, bounded, deduplicated, stable in order, world-driven.
// Fires pack capability cap:reassign_to_staff_bound_station for every M4 claim
// with kind=capacity_limit, values.class=STAFF on an observed diagnosis.
import type { World, AtlasEvent } from '../types.js';
import type { Diagnosis } from '../diagnose/types.js';
import type { Candidate, M5Config, InterventionWindow } from './types.js';
import { RecommendationError } from './types.js';
import { STATION_FLOW_CAPABILITIES } from './packs/station-flow-capabilities.js';
import { reduceTo } from '../reducer.js';

export const MAX_CANDIDATES = 16;

export interface CandidateSeed {
  id: string;
  capability: string;
  origin_claim: string;
  resource: string;
  from: string | null;
  to: string;
  window: InterventionWindow;
}

export function generateCandidateSeeds(input: {
  world: World;
  ledger: AtlasEvent[];
  diagnosis: Diagnosis;
  config: M5Config;
  horizon_t: number;
}): CandidateSeed[] {
  const { world, ledger, diagnosis, config, horizon_t } = input;
  const t = diagnosis.context.t;

  // Observed register only (19 §E).
  if (diagnosis.context.mode !== 'RECONSTRUCT') {
    throw new RecommendationError('RECOMMEND_REQUIRES_OBSERVED_BASE',
      'candidate generation requires an observed (RECONSTRUCT) diagnosis');
  }

  const seeds: CandidateSeed[] = [];
  const seen = new Set<string>();

  // World order for persons (19 §E: persons in world order).
  const persons = world.entities.filter((e) => e.type === 'person');

  // Observed assignments at t.
  const { state } = reduceTo(world, ledger, t as never);

  for (const claim of diagnosis.claims) {
    if (claim.kind !== 'capacity_limit') continue;
    const klass = (claim.values as { class?: string }).class;
    for (const cap of STATION_FLOW_CAPABILITIES) {
      if (cap.firesOn.claimKind !== 'capacity_limit') continue;
      if (cap.firesOn.claimClass !== klass) continue;
      const s = claim.subject; // destination station
      for (const p of persons) {
        const assignment = state.assignments[p.id] ?? null;
        if (assignment === s) continue; // already at destination
        for (const w of config.candidate_windows) {
          const start_t = t + w.start_offset_s;
          const end_t = w.end === 'horizon' ? horizon_t : t + (w.end_offset_s ?? 0);
          const id = `cand:reassign_resource:${p.id}:${s}:${w.label}`;
          if (seen.has(id)) continue;
          seen.add(id);
          seeds.push({
            id,
            capability: cap.id,
            origin_claim: claim.id,
            resource: p.id,
            from: assignment,
            to: s,
            window: { start_t, end_t, label: w.label },
          });
        }
      }
    }
  }

  if (seeds.length > MAX_CANDIDATES) {
    throw new RecommendationError('BOUND_EXCEEDED',
      `candidate count ${seeds.length} exceeds the frozen bound of ${MAX_CANDIDATES}`);
  }
  return seeds;
}

// No-action result when the diagnosis has no supported intervention (19 §E, §L).
export function noSupportedInterventionReason(): 'NO_SUPPORTED_INTERVENTION' {
  return 'NO_SUPPORTED_INTERVENTION';
}
