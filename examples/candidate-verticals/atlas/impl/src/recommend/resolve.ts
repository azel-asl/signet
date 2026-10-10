// ATLAS M5 evidence resolution at construction (19 §M; M4 E4 discipline).
// evaluateRecommendations throws RecommendationError('EVIDENCE_UNRESOLVED')
// rather than return a set with a dangling ref.
import type { World, AtlasEvent } from '../types.js';
import type { Diagnosis } from '../diagnose/types.js';
import type { EvidenceRef, Candidate, WindowMetrics } from './types.js';
import { RecommendationError } from './types.js';

const MISSING = Symbol('missing');

function getPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('/')) return MISSING;
  const parts = path.slice(1).split('/');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return MISSING;
    if (Array.isArray(cur)) {
      const i = Number(p);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return MISSING;
      cur = cur[i];
    } else if (typeof cur === 'object') {
      if (!(p in (cur as Record<string, unknown>))) return MISSING;
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return MISSING;
    }
  }
  return cur;
}

export interface ResolveContext {
  world: World;
  ledger: AtlasEvent[];
  diagnosis: Diagnosis;
  // run_id -> sim events for that run
  simLogs: Map<string, AtlasEvent[]>;
  config: unknown;
  // snapshot state at t (for state pointers)
  snapshot: unknown;
}

export function resolveRef(ctx: ResolveContext, ref: EvidenceRef): unknown {
  switch (ref.kind) {
    case 'event': {
      const ev = ctx.ledger.find((e) => e.event_id === ref.event_id);
      return ev ?? MISSING;
    }
    case 'state': {
      if (!ref.path.startsWith('/state/') && !ref.path.startsWith('/metrics/')) return MISSING;
      return getPath(ctx.snapshot, ref.path);
    }
    case 'world': {
      return getPath(ctx.world, ref.path);
    }
    case 'diagnosis_claim': {
      const c = ctx.diagnosis.claims.find((x) => x.id === ref.claim_id);
      return c ?? MISSING;
    }
    case 'sim_event': {
      const log = ctx.simLogs.get(ref.run_id);
      if (!log) return MISSING;
      const ev = log.find((e) => e.event_id === ref.event_id);
      return ev ?? MISSING;
    }
    case 'config': {
      return getPath(ctx.config, ref.path);
    }
  }
}

export function assertRecommendationEvidenceResolves(
  ctx: ResolveContext,
  candidates: Candidate[],
): void {
  for (const c of candidates) {
    for (const ref of [...c.evidence, ...c.eligibility.evidence]) {
      const v = resolveRef(ctx, ref);
      if (v === MISSING) {
        throw new RecommendationError('EVIDENCE_UNRESOLVED',
          `dangling evidence ref in candidate ${c.id}: ${JSON.stringify(ref)}`);
      }
    }
  }
}
