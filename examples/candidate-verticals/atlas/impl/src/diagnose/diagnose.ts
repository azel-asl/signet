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
  /** CCR-005 C3: required on simulated ledgers; {tB, tH} inclusive range. */
  branch_interval?: { tB: number; tH: number };
}

/**
 * diagnoseAtTime: build a Diagnosis for (world, ledger, t, branch?).
 * Per 18 §K. Additive; does not change existing capabilities.
 */
export function diagnoseAtTime(input: DiagnoseInput): Diagnosis {
  const { world, ledger, t, branch, branch_interval } = input;

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

  // CCR-005 C3: simulated branch interval enforcement.
  // When the ledger classifies as simulated, branch_interval is required and
  // t must lie in [tB, tH] inclusive. Pre-branch history is never relabelled
  // simulated, and nothing past tH is diagnosed.
  if (mode === 'SIMULATE') {
    if (!branch_interval) {
      throw new DiagnosisError('BRANCH_INTERVAL_REQUIRED',
        'branch_interval {tB, tH} is required for simulated ledgers');
    }
    const { tB, tH } = branch_interval;
    if (t < tB || t > tH) {
      throw new DiagnosisError('T_OUT_OF_RANGE',
        `t ${t} outside simulated branch interval [${tB}, ${tH}]`);
    }
  }

  // 2. Check pack applicability.
  const worldId = (world.metadata as { id: string }).id;
  const claims: Claim[] = [];

  if (!hasRequiredRuleKinds(world)) {
    // Pack skipped with RULE_NOT_APPLICABLE.
    // CCR-005 C1: unknown id is c:unknown_<reason>:<subject>; subject allows hyphens.
    claims.push({
      id: `c:unknown_rule_not_applicable:${worldId}`,
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
    // Phase 4A: Use the frozen findOnset/end-of-instant methodology independently.
    // Do NOT copy snapshot.diagnosis.since_t; M1 equality is a regression assertion.
    const branchPointT = branch_interval?.tB ?? null;
    for (const claim of claims) {
      if (claim.kind === 'overload') {
        // Find when the station became OVERLOADED/UNSTAFFED.
        const isOverloadedAt = (sampleT: number): boolean => {
          try {
            const s = getStateAtTime({ world, ledger, t: sampleT, branch }) as {
              metrics: { stations: Record<string, { status: string }> };
            };
            const st = s.metrics.stations[claim.subject]?.status;
            return st === 'OVERLOADED' || st === 'UNSTAFFED';
          } catch {
            return false;
          }
        };
        const onset = findOnset(ledger, t, isOverloadedAt);
        claim.onset_t = onset;
        // CCR-005 C5: onset_in_parent boundary rule.
        // For the boundary case (onset_t = tB), check if condition holds in parent at tB.
        let holdsInParentAtTB = false;
        if (onset === branchPointT && branchPointT !== null) {
          try {
            // Parent-only state: use the historical branch up to tB.
            // The ledger passed here is for the current branch; for parent check
            // we need the historical ledger. For now, approximate by checking
            // if the condition held at tB-1 (just before branch).
            holdsInParentAtTB = isOverloadedAt(branchPointT - 1);
          } catch {
            holdsInParentAtTB = false;
          }
        }
        claim.onset_in_parent = mode === 'SIMULATE'
          ? isOnsetInParent(onset, branchPointT, holdsInParentAtTB)
          : undefined;
      } else if (claim.kind === 'capacity_limit') {
        // Capacity_limit onset: when the limitation class became current.
        // For V0, derive from the overload onset if co-located (canonical cases),
        // else use findOnset with class matching.
        const overloadClaim = claims.find((c) => c.kind === 'overload' && c.subject === claim.subject);
        if (overloadClaim && overloadClaim.onset_t !== undefined) {
          claim.onset_t = overloadClaim.onset_t;
          claim.onset_in_parent = overloadClaim.onset_in_parent;
        } else {
          // Standalone capacity_limit: find when this class became active.
          // Simplified: use null for now; full pack re-run is expensive.
          claim.onset_t = null;
        }
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
