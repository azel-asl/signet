// ATLAS M5 eligibility (19 §F).
// Checked in contract order, before any simulation. All failures recorded.
// Uses the single skills function from the world loader (stationShortName,
// CCR-003 convention). Eligibility is DERIVED (observed state + world).
import type { World, AtlasEvent } from '../types.js';
import type { EligibilityReason, EvidenceRef } from './types.js';
import type { CandidateSeed } from './candidates.js';
import { stationShortName } from '../world.js';
import { reduceTo } from '../reducer.js';
import type { WorldState } from '../types.js';

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  evidence: EvidenceRef[];
}

function personIndex(world: World, id: string): number {
  const i = world.entities.findIndex((e) => e.id === id);
  return i;
}

function stationIndex(world: World, id: string): number {
  return world.entities.findIndex((e) => e.id === id && e.type === 'station');
}

export function checkEligibility(input: {
  world: World;
  ledger: AtlasEvent[];
  seed: CandidateSeed;
  t: number;
  tB: number;
  tH: number;
}): EligibilityResult {
  const { world, ledger, seed, t, tB, tH } = input;
  const reasons: EligibilityReason[] = [];
  const evidence: EvidenceRef[] = [];

  const { state } = reduceTo(world, ledger, t as never);
  const person = world.entities.find((e) => e.id === seed.resource);
  const pi = personIndex(world, seed.resource);

  // Eligibility evidence (19 §F): state pointers to on_shift and station,
  // world pointer to skills, destination entity. Paths resolve against the
  // wrapped WorldState ({state: {on_shift, assignments, ...}}).
  if (pi >= 0) {
    evidence.push({ kind: 'state', path: `/state/on_shift/${seed.resource}` });
    evidence.push({ kind: 'state', path: `/state/assignments/${seed.resource}` });
    evidence.push({ kind: 'world', path: `/entities/${pi}/attrs/skills` });
  }
  const di = stationIndex(world, seed.to);
  if (di >= 0) evidence.push({ kind: 'world', path: `/entities/${di}` });

  const onShift = state.on_shift[seed.resource] ?? false;
  const assignmentAtT = state.assignments[seed.resource] ?? null;

  // 1. NOT_ON_SHIFT
  if (!onShift) reasons.push('NOT_ON_SHIFT');
  // 2. ALREADY_AT_DESTINATION
  if (assignmentAtT === seed.to) reasons.push('ALREADY_AT_DESTINATION');
  // 3. SKILL_MISSING — same single skills function as the world loader.
  const skills = ((person?.attrs as { skills?: string[] } | undefined)?.skills ?? []);
  if (!skills.includes(stationShortName(seed.to))) reasons.push('SKILL_MISSING');
  // 4. DESTINATION_NOT_STATION
  const destEntity = world.entities.find((e) => e.id === seed.to);
  if (!destEntity || destEntity.type !== 'station') reasons.push('DESTINATION_NOT_STATION');
  // 5. FROM_MISMATCH
  if (seed.from !== assignmentAtT) reasons.push('FROM_MISMATCH');
  // 6. WINDOW_INVALID
  if (seed.window.start_t < t || seed.window.end_t > tH || seed.window.end_t <= seed.window.start_t) {
    reasons.push('WINDOW_INVALID');
  }
  // 7. OUTSIDE_BRANCH_INTERVAL — compiled interventions iv_01 at start_t, iv_02 at end_t.
  if (seed.window.start_t < tB || seed.window.start_t > tH ||
      seed.window.end_t < tB || seed.window.end_t > tH) {
    reasons.push('OUTSIDE_BRANCH_INTERVAL');
  }
  // 8. RESOURCE_DOUBLE_BOOKED — V0: one move per candidate, never fires.
  // (Kept for the frozen reason-code list; no second intervention exists.)

  return { eligible: reasons.length === 0, reasons, evidence };
}
