// ATLAS M4 DIAGNOSE: orchestrator per 18 §A, §G, §K.
// Builds a Diagnosis from a snapshot + branch log + world.
// Never mutates inputs. Does not rerun simulation.
import { getStateAtTime } from '../capabilities.js';
import { canonHash } from '../simulate.js';
import type { AtlasEvent, World } from '../types.js';
import type { Claim, Diagnosis } from './types.js';
import { DiagnosisError } from './types.js';
import {
  DIAGNOSTICS_VERSION,
  computeDiagnosisId,
  computeDiagnosisHash,
  sortClaims,
  computeRoots,
} from './core.js';
import { validateDiagnosis } from './validate.js';
import {
  PACK_ID,
  PACK_VERSION,
  REQUIRES_RULE_KINDS,
  hasRequiredRuleKinds,
  diagnoseStation,
} from './packs/station-flow.js';
import { findOnset, isOnsetInParent } from './temporal.js';

export interface DiagnoseInput {
  world: World;
  ledger: AtlasEvent[];
  t: number;
  branch?: string;
}

/**
 * diagnoseAtTime: build a Diagnosis for (world, ledger, t, branch?).
 * Per 18 §K. Additive; does not change existing capabilities.
 */
export function diagnoseAtTime(input: DiagnoseInput): Diagnosis {
  const { world, ledger, t, branch } = input;

  if (!Number.isInteger(t)) {
    throw new DiagnosisError('T_NOT_INTEGER', `t must be an integer: ${t}`);
  }

  // 0. Validate t is in the branch range per §G.
  // We need to determine the range. For observed, it's [origin, end].
  // For simulated, getStateAtTime will classify; we check after.
  const time = (world as { time?: { origin?: string; end?: string } }).time;
  if (time?.origin && time?.end) {
    const originT = Math.floor(new Date(time.origin).getTime() / 1000);
    const endT = Math.floor(new Date(time.end).getTime() / 1000);
    // If branch is explicitly historical or undefined, check observed range.
    const isHist = !branch || branch.startsWith('history:');
    if (isHist && (t < originT || t > endT)) {
      throw new DiagnosisError('T_OUT_OF_RANGE', `t ${t} outside [${originT}, ${endT}]`);
    }
  }

  // 1. Get the snapshot via getStateAtTime (classifies branch per M2 C1).
  const snap = getStateAtTime({ world, ledger, t, branch }) as {
    t: number;
    ts: string;
    state_hash: string;
    branch: string;
    mode: 'RECONSTRUCT' | 'SIMULATE';
    claim_class: 'derived' | 'simulated';
    diagnosis?: { bottleneck?: string | null; since_t?: number | null; binding_constraint?: string | null };
    metrics: { stations: Record<string, unknown> };
    state: unknown;
  };

  const claim_class = snap.claim_class;
  const mode = snap.mode;
  const branchId = snap.branch;

  // 2. Check pack applicability.
  const worldId = (world.metadata as { id: string }).id;
  const claims: Claim[] = [];

  if (!hasRequiredRuleKinds(world)) {
    // Pack skipped with RULE_NOT_APPLICABLE.
    claims.push({
      id: `c:unknown:${worldId}`,
      kind: 'unknown',
      role: 'unknown',
      subject: worldId,
      template: 'T_UNKNOWN',
      values: {
        subject_name: worldId,
        detail: 'diagnosis',
        reason: 'RULE_NOT_APPLICABLE',
      },
      basis: 'rule',
      rule: { id: `${PACK_ID}/unknown`, version: PACK_VERSION, world_rules: [] },
      claim_class,
      support: 'none',
      confidence: null,
      assumptions: [],
      evidence: [],
      links: [],
      reason: 'RULE_NOT_APPLICABLE',
    });
  } else {
    // 3. Run the pack for each station.
    const stationIds = (world.entities as { id: string; type: string }[])
      .filter((e) => e.type === 'station')
      .map((e) => e.id);

    const packCtx = {
      world,
      ledger,
      snapshot: snap as unknown as Record<string, unknown>,
      t,
      branch: branchId,
      claim_class,
    };

    for (const stationId of stationIds) {
      const stationClaims = diagnoseStation(packCtx, stationId);
      claims.push(...stationClaims);
    }

    // 4. Compute onset for overload and capacity_limit claims.
    // For overload, use M1's since_t (guarantees T-LEGACY agreement).
    const m1SinceT = snap.diagnosis?.since_t ?? null;
    const m1Bottleneck = snap.diagnosis?.bottleneck ?? null;

    for (const claim of claims) {
      if (claim.kind === 'overload' && m1Bottleneck === claim.subject) {
        claim.onset_t = m1SinceT;
        // Check if onset is in parent (for simulated branches).
        // The branch point is tB; we need to get it from the register.
        // For now, onset_in_parent is false unless we can determine otherwise.
        // TODO: Get branch point from experience layer.
        claim.onset_in_parent = false;
      }
    }
  }

  // 5. Sort claims and compute roots.
  const worldOrder = (world.entities as { id: string }[]).map((e) => e.id);
  const sorted = sortClaims(claims, worldOrder);
  const roots = computeRoots(sorted, worldOrder);

  // 6. Build context.
  const context = {
    branch: branchId,
    mode,
    claim_class,
    t,
    ts: snap.ts,
    window_s: 900 as const,
    snapshot_state_hash: snap.state_hash,
    ledger_events_applied: (snap as { state: { ledger_events_applied: number } }).state.ledger_events_applied,
  };

  // 7. Compute IDs and hashes.
  const diagnosis_id = computeDiagnosisId(context, sorted);
  const partial: Omit<Diagnosis, 'diagnosis_hash'> = {
    atlas_schema: 'atlas-diagnosis/0.1',
    diagnosis_id,
    diagnostics_version: 'atlas-diagnose/0.1.0',
    packs: [{ id: PACK_ID, version: PACK_VERSION, requires_rule_kinds: REQUIRES_RULE_KINDS }],
    world: { id: worldId },
    context,
    claims: sorted,
    roots,
  };
  const diagnosis_hash = computeDiagnosisHash(partial);

  const diagnosis: Diagnosis = { ...partial, diagnosis_hash };

  // 8. Validate.
  validateDiagnosis(diagnosis);

  return diagnosis;
}
