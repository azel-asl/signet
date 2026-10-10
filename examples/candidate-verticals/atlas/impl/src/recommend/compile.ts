// ATLAS M5 intervention compilation (19 §D).
// reassign_resource compiles to exactly two M2 `reassign` interventions with
// fixed ids iv_01 (from → to at start_t) and iv_02 (to → from at end_t).
// No other intervention kind is representable; no free text is executable.
import type { World } from '../types.js';
import type { CompiledIntervention } from './types.js';
import type { CandidateSeed } from './candidates.js';
import { iso } from '../views.js';

export function compileInterventions(input: {
  world: World;
  seed: CandidateSeed;
}): CompiledIntervention[] {
  const { world, seed } = input;
  return [
    {
      id: 'iv_01',
      kind: 'reassign',
      employee: seed.resource,
      from: seed.from,
      to: seed.to,
      at: iso(world, seed.window.start_t),
      at_t: seed.window.start_t,
    },
    {
      id: 'iv_02',
      kind: 'reassign',
      employee: seed.resource,
      from: seed.to,
      to: seed.from,
      at: iso(world, seed.window.end_t),
      at_t: seed.window.end_t,
    },
  ];
}
