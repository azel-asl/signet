// ATLAS M4 final narrow correction pass: regression tests for the five fixes.
// Fix 1: independent capacity_limit onset.
// Fix 2: complete Section I evidence.
// Fix 3: E4 resolution at construction.
// Fix 4: exact parent-only-at-tB onset_in_parent semantics.
// Fix 5: runtime id validation parity with the amended schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { diagnoseAtTime } from '../src/capabilities.js';
import { validateDiagnosis } from '../src/diagnose/validate.js';
import { assertEvidenceResolves } from '../src/diagnose/resolve.js';
import { isOnsetInParent } from '../src/diagnose/temporal.js';
import type { AtlasEvent, World } from '../src/types.js';
import type { Claim } from '../src/diagnose/types.js';

let world: World;
let history: AtlasEvent[];

async function loadFixtures() {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  world = JSON.parse(await readFile(new URL('world.restaurant-v0.json', base), 'utf8'));
  const ndjson = await readFile(new URL('normalized/events.ndjson', base), 'utf8');
  history = ndjson.trim().split('\n').map((l) => JSON.parse(l));
}

beforeAll(loadFixtures);

const SIM_BRANCH_INTERVAL = { tB: 1791336000, tH: 1791342000 };

async function getSimLedger(branch: 'baseline' | 'scenario'): Promise<AtlasEvent[]> {
  const base = new URL('../../fixtures/restaurant-v0/', import.meta.url);
  const traceFile = branch === 'baseline'
    ? 'expected/sim_baseline.events.ndjson'
    : 'expected/sim_scenario.events.ndjson';
  const trace = (await readFile(new URL(traceFile, base), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const tB = 1791336000;
  return [...history.filter((e) => e.t <= tB), ...trace];
}

describe('Fix 1: capacity_limit onset is independently derived', () => {
  it('observed 18:20 Fry: capacity_limit onset 17:58:06 differs from overload onset 18:15:00', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' });
    const overload = dx.claims.find((c) => c.kind === 'overload' && c.subject === 'st_fry');
    const capLimit = dx.claims.find((c) => c.kind === 'capacity_limit' && c.subject === 'st_fry');
    expect(overload).toBeDefined();
    expect(capLimit).toBeDefined();
    expect(overload!.onset_t).toBe(1791335700); // 18:15:00
    expect(capLimit!.onset_t).toBe(1791334686); // 17:58:06
    expect(capLimit!.onset_t).not.toBe(overload!.onset_t);
  });

  it('observed 17:45 Fry: capacity_limit has independent onset even without overload', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791333900, branch: 'history:day1' });
    const overload = dx.claims.find((c) => c.kind === 'overload' && c.subject === 'st_fry');
    const capLimit = dx.claims.find((c) => c.kind === 'capacity_limit' && c.subject === 'st_fry');
    expect(overload).toBeUndefined(); // No overload at 17:45.
    expect(capLimit).toBeDefined();
    // Onset must be populated independently, not null merely because there is no overload.
    expect(capLimit!.onset_t).not.toBeNull();
    expect(typeof capLimit!.onset_t).toBe('number');
  });
});

describe('Fix 2: Section I evidence is complete', () => {
  it('backlog_growth includes all window events (no truncation)', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' });
    const bg = dx.claims.find((c) => c.kind === 'backlog_growth' && c.subject === 'st_fry');
    if (!bg) return; // No growth claim at this t; skip.
    const eventRefs = bg.evidence.filter((r) => r.kind === 'event');
    // Count the actual window events in the ledger.
    const windowStart = 1791336000 - 900;
    const expected = history.filter((e) =>
      (e.type === 'WORK_QUEUED' || e.type === 'WORK_STARTED') &&
      (e.data as { station_id?: string }).station_id === 'st_fry' &&
      e.t > windowStart && e.t <= 1791336000
    ).length;
    expect(eventRefs.length).toBe(expected);
    expect(expected).toBeGreaterThan(5); // Would fail if slice(0, 5) were still in place.
  });

  it('capacity_limit carries staff-assignment events and attached_to relationships', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' });
    const cl = dx.claims.find((c) => c.kind === 'capacity_limit' && c.subject === 'st_fry');
    expect(cl).toBeDefined();
    const eventRefs = cl!.evidence.filter((r) => r.kind === 'event');
    const worldRefs = cl!.evidence.filter((r) => r.kind === 'world');
    // At least one ASSIGNMENT_CHANGED event for assigned staff.
    expect(eventRefs.length).toBeGreaterThan(0);
    // At least one attached_to relationship pointer.
    const relRefs = worldRefs.filter((r) => r.path!.startsWith('/relationships/'));
    expect(relRefs.length).toBeGreaterThan(0);
  });

  it('equipment_degradation carries its EQUIPMENT_STATE_CHANGED event', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' });
    const deg = dx.claims.find((c) => c.kind === 'equipment_degradation');
    if (!deg) return;
    const eventRefs = deg.evidence.filter((r) => r.kind === 'event');
    expect(eventRefs.length).toBeGreaterThan(0);
    // The event must exist in the ledger and be an EQUIPMENT_STATE_CHANGED.
    const ev = history.find((e) => e.event_id === eventRefs[0].event_id);
    expect(ev).toBeDefined();
    expect(ev!.type).toBe('EQUIPMENT_STATE_CHANGED');
  });

  it('assembly_blocking carries open-work state pointers and the barrier rule', () => {
    const dx = diagnoseAtTime({ world, ledger: history, t: 1791336000, branch: 'history:day1' });
    const ab = dx.claims.find((c) => c.kind === 'assembly_blocking');
    if (!ab) return;
    const stateRefs = ab.evidence.filter((r) => r.kind === 'state');
    const worldRefs = ab.evidence.filter((r) => r.kind === 'world');
    // State pointers to blocked orders' open work.
    expect(stateRefs.length).toBeGreaterThan(0);
    expect(stateRefs.every((r) => r.path!.startsWith('/state/work_open/'))).toBe(true);
    // The order process barrier in the world.
    expect(worldRefs.length).toBeGreaterThan(0);
  });
});

describe('Fix 3: E4 enforced at construction', () => {
  function baseClaim(): Claim {
    return {
      id: 'c:backlog:st_test',
      kind: 'backlog',
      role: 'condition',
      subject: 'st_test',
      template: 'T_BACKLOG',
      values: { subject_name: 'Test', queue_len: 1, oldest_wait_s: 5 },
      basis: 'state',
      rule: { id: 'station-flow/backlog', version: '0.1', world_rules: [] },
      claim_class: 'derived',
      support: 'deterministic',
      confidence: null,
      assumptions: [],
      evidence: [],
      links: [],
    };
  }

  const fakeSnap = { metrics: { stations: {} }, state: {} };

  it('dangling event reference is rejected', () => {
    const c = baseClaim();
    c.evidence = [{ kind: 'event', event_id: 'ev_does_not_exist_zzz' }];
    expect(() => assertEvidenceResolves(world, history, fakeSnap, [c]))
      .toThrow('EPISTEMIC_VIOLATION');
  });

  it('dangling state pointer is rejected', () => {
    const c = baseClaim();
    c.evidence = [{ kind: 'state', path: '/metrics/stations/nope/status' }];
    expect(() => assertEvidenceResolves(world, history, fakeSnap, [c]))
      .toThrow('EPISTEMIC_VIOLATION');
  });

  it('dangling world pointer is rejected', () => {
    const c = baseClaim();
    c.evidence = [{ kind: 'world', path: '/entities/9999/attrs' }];
    expect(() => assertEvidenceResolves(world, history, fakeSnap, [c]))
      .toThrow('EPISTEMIC_VIOLATION');
  });

  it('dangling rule reference is rejected', () => {
    const c = baseClaim();
    c.evidence = [{ kind: 'world_rule', rule: 'R99' }];
    expect(() => assertEvidenceResolves(world, history, fakeSnap, [c]))
      .toThrow('EPISTEMIC_VIOLATION');
  });

  it('resolvable references pass', () => {
    const c = baseClaim();
    c.evidence = [
      { kind: 'event', event_id: history[0].event_id },
      { kind: 'world_rule', rule: 'R01' },
    ];
    expect(() => assertEvidenceResolves(world, history, fakeSnap, [c])).not.toThrow();
  });
});

describe('Fix 4: exact parent-only-at-tB semantics', () => {
  it('onset < tB implies onset_in_parent true', () => {
    expect(isOnsetInParent(1791335700, 1791336000, false)).toBe(true);
  });

  it('onset = tB with parent condition true implies true', () => {
    expect(isOnsetInParent(1791336000, 1791336000, true)).toBe(true);
  });

  it('onset = tB with parent condition false implies false', () => {
    expect(isOnsetInParent(1791336000, 1791336000, false)).toBe(false);
  });

  it('onset > tB implies false', () => {
    expect(isOnsetInParent(1791336100, 1791336000, true)).toBe(false);
  });

  it('baseline 19:00 Fry onset_in_parent is true (onset 18:15 < tB 18:20)', async () => {
    const simLedger = await getSimLedger('baseline');
    const dx = diagnoseAtTime({
      world,
      ledger: simLedger,
      t: 1791338400,
      branch: 'sim:baseline',
      branch_interval: SIM_BRANCH_INTERVAL,
    });
    const ov = dx.claims.find((c) => c.kind === 'overload' && c.subject === 'st_fry');
    expect(ov).toBeDefined();
    expect(ov!.onset_t).toBe(1791335700);
    expect(ov!.onset_in_parent).toBe(true);
  });
});

describe('Fix 5: runtime id validation', () => {
  function baseDiagnosisWith(claim: Partial<Claim> & { id: string; kind: Claim['kind'] }) {
    const full: Claim = {
      role: 'condition',
      subject: 'st_fry',
      template: 'T_BACKLOG',
      values: { subject_name: 'Fry', queue_len: 1, oldest_wait_s: 5 },
      basis: 'state',
      rule: { id: 'station-flow/backlog', version: '0.1', world_rules: [] },
      claim_class: 'derived',
      support: 'deterministic',
      confidence: null,
      assumptions: [],
      evidence: [{ kind: 'state', path: '/metrics/stations/st_fry/queue_len' }],
      links: [],
      ...claim,
    } as Claim;
    return {
      atlas_schema: 'atlas-diagnosis/0.1' as const,
      diagnosis_id: 'dx_0123456789abcdef',
      diagnostics_version: 'atlas-diagnose/0.1.0',
      packs: [],
      world: { id: 'restaurant-v0' },
      context: {
        branch: 'history:day1',
        mode: 'RECONSTRUCT' as const,
        claim_class: 'derived' as const,
        t: 1791336000,
        ts: '2026-10-06T18:20:00-07:00',
        window_s: 900 as const,
        snapshot_state_hash: 'a'.repeat(64),
        ledger_events_applied: 1,
      },
      claims: [full],
      roots: [],
      diagnosis_hash: 'b'.repeat(64),
    };
  }

  it('rejects old-form unknown id without reason', () => {
    const dx = baseDiagnosisWith({
      id: 'c:unknown:st_fry',
      kind: 'unknown',
      role: 'unknown',
      reason: 'RULE_NOT_APPLICABLE',
      support: 'none',
      evidence: [],
    });
    expect(() => validateDiagnosis(dx as never)).toThrow('SCHEMA_VIOLATION');
  });

  it('rejects unsupported unknown reason', () => {
    const dx = baseDiagnosisWith({
      id: 'c:unknown_bogus_reason:st_fry',
      kind: 'unknown',
      role: 'unknown',
      reason: 'RULE_NOT_APPLICABLE',
      support: 'none',
      evidence: [],
    });
    expect(() => validateDiagnosis(dx as never)).toThrow('SCHEMA_VIOLATION');
  });

  it('rejects mismatched kind/id prefix', () => {
    const dx = baseDiagnosisWith({
      id: 'c:backlog:st_fry',
      kind: 'overload', // kind says overload, id says backlog.
    });
    expect(() => validateDiagnosis(dx as never)).toThrow('SCHEMA_VIOLATION');
  });

  it('rejects malformed id', () => {
    const dx = baseDiagnosisWith({
      id: 'not-a-claim-id',
      kind: 'backlog',
    });
    expect(() => validateDiagnosis(dx as never)).toThrow('SCHEMA_VIOLATION');
  });

  it('accepts valid unknown id with hyphenated subject', () => {
    const dx = baseDiagnosisWith({
      id: 'c:unknown_rule_not_applicable:restaurant-v0',
      kind: 'unknown',
      role: 'unknown',
      subject: 'restaurant-v0',
      reason: 'RULE_NOT_APPLICABLE',
      support: 'none',
      evidence: [],
    });
    expect(() => validateDiagnosis(dx as never)).not.toThrow();
  });
});
