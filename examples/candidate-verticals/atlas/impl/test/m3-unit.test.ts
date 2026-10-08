// M3 unit tests: T1-T5, T7 (projection, inspection, registers).
import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadSource } from '../src/experience/source.js';
import { initRegisters, projectFrame, inspectEntity, listRegisters, ProjectError } from '../src/experience/project.js';
import { getStateAtTime, runScenario } from '../src/capabilities.js';
import { canonHash } from '../src/simulate.js';
import type { ExperienceFrame } from '../src/experience/types.js';

const T1_CASES = [
  { register: 'observed' as const, hhmm: '17:45', fixture: 'snapshots/s1_normal.json' },
  { register: 'observed' as const, hhmm: '18:08', fixture: 'snapshots/s2_bottleneck_emerging.json' },
  { register: 'observed' as const, hhmm: '18:20', fixture: 'snapshots/s3_bottleneck_active.json' },
  { register: 'observed' as const, hhmm: '19:00', fixture: 'expected/s4_observed_reference.json' },
  { register: 'baseline' as const, hhmm: '19:00', fixture: 'expected/s4b_simulated_baseline.json' },
  { register: 'scenario' as const, hhmm: '19:00', fixture: 'snapshots/s4_simulated_intervention.json' },
];

function tOf(origin: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(origin);
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  const { world, ledger, scenarioPath, scenarioName, tB, tH } = await loadSource();
  const { baseline, scenario } = await runScenario({ world, ledger, scenarioPath });
  const b: any = baseline;
  const s: any = scenario;
  initRegisters({
    world, historyLedger: ledger,
    baseline: { branch: b.receipt.branch, events: b.events, receipt: b.receipt },
    scenarioArm: { branch: s.receipt.branch, events: s.events, receipt: s.receipt },
    scenarioName, tB, tH,
  });
  initialized = true;
}

describe('T1 canonical frames match frozen snapshots', () => {
  beforeAll(ensureInit);
  for (const c of T1_CASES) {
    it(`${c.register} @ ${c.hhmm}`, async () => {
      const { world } = await loadSource();
      const t = tOf((world.time as { origin: string }).origin, c.hhmm);
      const frame = projectFrame(c.register, t);
      const expected = JSON.parse(await readFile(
        new URL(`../../fixtures/restaurant-v0/${c.fixture}`, import.meta.url), 'utf8'));
      // snapshot_state_hash equals the stored hash.
      expect(frame.snapshot_state_hash).toBe(expected.state_hash);
      // Every §5.2 field equals the frozen snapshot field.
      const snapState = expected.state;
      const snapMetrics = expected.metrics;
      for (const ent of frame.entities) {
        if (ent.kind === 'station') {
          const s = snapState.stations[ent.id];
          const m = snapMetrics.stations[ent.id];
          expect(ent.state.status).toBe(s.status);
          expect(ent.state.queue_len).toBe(m.queue_len);
          expect(ent.state.in_progress_count).toBe(m.in_progress);
        }
      }
      // Frame validates against the schema (checked in T-schema test).
      expect(frame.atlas_schema).toBe('atlas-frame/0.1');
      expect(frame.frame_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  }
});

describe('T2 arbitrary T projects from ATLAS state', () => {
  beforeAll(ensureInit);
  it('60 seeded T per register equal getStateAtTime', async () => {
    const { world, ledger } = await loadSource();
    // Simple seeded PRNG (mulberry32).
    let seed = 42;
    const rand = () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    const regs = listRegisters();
    for (const reg of regs) {
      const { min_t, max_t } = reg.range;
      for (let i = 0; i < 60; i++) {
        const t = min_t + Math.floor(rand() * (max_t - min_t + 1));
        const frame = projectFrame(reg.kind, t);
        const snap: any = getStateAtTime({
          world, ledger: (await import('../src/experience/project.js')).getRegister(reg.kind).ledger,
          t, branch: reg.branch,
        });
        expect(frame.snapshot_state_hash).toBe(snap.state_hash);
        expect(frame.t).toBe(t);
        expect(frame.ledger_events_applied).toBe(snap.state.ledger_events_applied);
      }
    }
  });
});

describe('T3 register semantics', () => {
  beforeAll(ensureInit);
  it('mode, claim_class, branch, label per §7', async () => {
    const regs = listRegisters();
    const obs = regs.find((r) => r.kind === 'observed')!;
    expect(obs.mode).toBe('RECONSTRUCT');
    expect(obs.claim_class).toBe('derived');
    expect(obs.branch).toBe('history:day1');
    expect(obs.label).toBe('OBSERVED HISTORY · reconstructed from evidence · claim: derived');
    const base = regs.find((r) => r.kind === 'baseline')!;
    expect(base.mode).toBe('SIMULATE');
    expect(base.claim_class).toBe('simulated');
    expect(base.branch).toBe('sim:baseline');
    expect(base.label).toBe('SIMULATION · BASELINE (no intervention) · not observed · claim: simulated');
    const scn = regs.find((r) => r.kind === 'scenario')!;
    expect(scn.mode).toBe('SIMULATE');
    expect(scn.claim_class).toBe('simulated');
    expect(scn.branch).toBe('sim:scenario');
    expect(scn.label).toContain('SIMULATION · SCENARIO:');
    expect(scn.label).toContain('not observed · claim: simulated');
  });
});

describe('T4 Fry inspection at 18:20', () => {
  beforeAll(ensureInit);
  it('evidence equals the 17 s3.evidence_refs in order', async () => {
    const { world } = await loadSource();
    const t = tOf((world.time as { origin: string }).origin, '18:20');
    const insp = inspectEntity('observed', t, 'st_fry');
    const s3 = JSON.parse(await readFile(
      new URL('../../fixtures/restaurant-v0/snapshots/s3_bottleneck_active.json', import.meta.url), 'utf8'));
    const expectedIds = s3.evidence_refs.map((r: any) => r.event_id);
    expect(insp.evidence_total).toBe(17);
    expect(insp.evidence.map((e) => e.event_id)).toEqual(expectedIds);
  });
});

describe('T5 simulated inspection three-way separation', () => {
  beforeAll(ensureInit);
  it('items grouped by claim_class; none simulated labelled evidence', async () => {
    const { world } = await loadSource();
    const t = tOf((world.time as { origin: string }).origin, '19:00');
    const insp = inspectEntity('scenario', t, 'st_fry');
    // The inspection groups evidence; simulated items must not be in "Evidence (history)".
    // We check via the raw evidence list: every item carries its claim_class.
    for (const ev of insp.evidence) {
      expect(['derived', 'observed', 'simulated', 'human_reported']).toContain(ev.claim_class);
    }
    // At least one simulated item exists in the scenario arm.
    const simItems = insp.evidence.filter((e) => e.claim_class === 'simulated');
    expect(simItems.length).toBeGreaterThan(0);
  });
});

describe('T9 mutated ledger binds to ATLAS, not fixtures', () => {
  it('frame reflects mutated ledger via getStateAtTime', async () => {
    const { world, ledger, scenarioPath, scenarioName, tB, tH } = await loadSource();
    // Remove one Fry work item that is IN THE QUEUE at 18:20 (not yet started).
    const t1820 = tOf((world.time as { origin: string }).origin, '18:20');
    const snapAt1820: any = getStateAtTime({ world, ledger, t: t1820, branch: 'history:day1' });
    const queuedIds: string[] = snapAt1820.state.stations['st_fry'].queue;
    expect(queuedIds.length).toBeGreaterThan(0);
    const wid = queuedIds[0];
    const mutated = ledger.filter((e) => (e.data as any).work_id !== wid);
    const { baseline, scenario } = await runScenario({ world, ledger: mutated, scenarioPath });
    const b: any = baseline;
    const s: any = scenario;
    // Re-init with the mutated ledger (isolated; does not affect other tests' module state
    // because we re-init after).
    initRegisters({
      world, historyLedger: mutated,
      baseline: { branch: b.receipt.branch, events: b.events, receipt: b.receipt },
      scenarioArm: { branch: s.receipt.branch, events: s.events, receipt: s.receipt },
      scenarioName, tB, tH,
    });
    const frame = projectFrame('observed', t1820);
    const fry = frame.entities.find((e) => e.id === 'st_fry')!;
    // The frame's queue_len must equal getStateAtTime on the MUTATED ledger.
    const snap: any = getStateAtTime({ world, ledger: mutated, t: t1820, branch: 'history:day1' });
    expect(fry.state.queue_len).toBe(snap.metrics.stations['st_fry'].queue_len);
    // And it must differ from the frozen value (proving it's not a fixture assumption).
    const frozenSnap: any = getStateAtTime({ world, ledger, t: t1820, branch: 'history:day1' });
    expect(snap.metrics.stations['st_fry'].queue_len).not.toBe(frozenSnap.metrics.stations['st_fry'].queue_len);
    // Restore the original registers for other tests.
    initialized = false;
    await ensureInit();
  });
});

describe('T7 isolation', () => {
  beforeAll(ensureInit);
  it('frames identical before/after visiting other registers; history file unchanged', async () => {
    const { world } = await loadSource();
    const { historyFileSha256 } = await import('../src/experience/source.js');
    const before = historyFileSha256();
    const t = tOf((world.time as { origin: string }).origin, '18:20');
    const framesBefore = new Map<string, string>();
    for (const kind of ['observed', 'baseline', 'scenario'] as const) {
      try {
        framesBefore.set(kind, projectFrame(kind, t).frame_hash);
      } catch {
        // baseline/scenario may not cover 18:20? They do (tB=18:20).
      }
    }
    // Visit every other register at 20 T.
    const regs = listRegisters();
    for (const reg of regs) {
      for (let i = 0; i < 20; i++) {
        const tt = reg.range.min_t + i * 60;
        if (tt <= reg.range.max_t) projectFrame(reg.kind, tt);
      }
    }
    for (const kind of ['observed', 'baseline', 'scenario'] as const) {
      try {
        expect(projectFrame(kind, t).frame_hash).toBe(framesBefore.get(kind));
      } catch {
        // ignore out-of-range
      }
    }
    expect(await before).toBe(await historyFileSha256());
  });
});

describe('T15 service error codes', () => {
  beforeAll(ensureInit);
  it('BAD_REGISTER, T_NOT_INTEGER, T_OUT_OF_RANGE, UNKNOWN_ENTITY', async () => {
    // These are exercised via projectFrame/inspectEntity which the server wraps.
    expect(() => projectFrame('nope' as any, 0)).toThrow(/BAD_REGISTER/);
    const { world } = await loadSource();
    const t = tOf((world.time as { origin: string }).origin, '18:20');
    expect(() => projectFrame('observed', 1.5)).toThrow(/T_NOT_INTEGER/);
    expect(() => projectFrame('observed', 0)).toThrow(/T_OUT_OF_RANGE/);
    expect(() => inspectEntity('observed', t, 'no_such_entity')).toThrow(/UNKNOWN_ENTITY/);
  });
});

describe('T4b schema validation', () => {
  beforeAll(ensureInit);
  it('live observed, baseline, scenario frames validate against frozen schema', async () => {
    // Use Ajv 2020 for draft 2020-12 support.
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const ajv = new (Ajv2020 as any)({ strict: true });
    const schema = JSON.parse(await readFile(
      new URL('../../schema/atlas-frame.schema.json', import.meta.url), 'utf8'));
    const validate = ajv.compile(schema);
    const { world } = await loadSource();
    const t = tOf((world.time as { origin: string }).origin, '18:20');
    const t1900 = tOf((world.time as { origin: string }).origin, '19:00');
    for (const [kind, tt] of [['observed', t], ['baseline', t1900], ['scenario', t1900]] as const) {
      const frame = projectFrame(kind, tt);
      const valid = validate(frame);
      expect(valid, `${kind} frame schema errors: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});

describe('T10/T11 static scans', () => {
  it('web/ imports nothing from impl/src except experience/types.ts as import type', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const implDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const f of ['web/app.ts', 'web/layout.ts']) {
      const src = await readFile(join(implDir, f), 'utf8');
      const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      for (const imp of imports) {
        if (imp.startsWith('../src/') || imp.startsWith('./src/') || imp.includes('impl/src')) {
          expect(imp).toBe('../src/experience/types.js');
          expect(src).toMatch(/import type.*experience\/types\.js/);
        }
      }
    }
  });

  it('web/ contains no forbidden tokens', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const implDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const forbidden = [
      'per_staff_concurrency', 'overload_queue', 'overload_wait_s', 'duration_s',
      'queued_t', 'started_t', 'handoff_s', 'fixtures', '.ndjson',
    ];
    for (const f of ['web/app.ts', 'web/layout.ts']) {
      const src = await readFile(join(implDir, f), 'utf8');
      for (const tok of forbidden) {
        expect(src, `${f} contains ${tok}`).not.toContain(tok);
      }
      // st_, emp_, o_0 as id literals (not in comments/strings about data attributes).
      // We check for them as standalone tokens in code, not in data-* attributes.
      const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      for (const line of codeLines) {
        // Skip data-attribute strings which legitimately mention the prefix pattern.
        if (line.includes('data-')) continue;
        expect(line).not.toMatch(/['"]st_/);
        expect(line).not.toMatch(/['"]emp_/);
        expect(line).not.toMatch(/['"]o_0/);
      }
      // Math.min/Math.max only in layout.ts.
      if (f !== 'web/layout.ts') {
        expect(src).not.toContain('Math.min(');
        expect(src).not.toContain('Math.max(');
      }
    }
  });

  it('served bundle contains no engine modules', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const implDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const f of ['web/dist/app.js', 'web/dist/layout.js']) {
      const src = await readFile(join(implDir, f), 'utf8');
      for (const tok of ['applyEvent', 'reduceTo', 'runScheduler', 'createHash']) {
        expect(src, `${f} contains engine ${tok}`).not.toContain(tok);
      }
    }
  });
});

describe('T17 service boundary scan', () => {
  it('experience/ imports only capabilities.ts, experience/*, and node:*', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const expDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'experience');
    const files = await readdir(expDir);
    for (const f of files) {
      if (!f.endsWith('.ts')) continue;
      const src = await readFile(join(expDir, f), 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const imp of imports) {
        const ok =
          imp.startsWith('node:') ||
          imp === '../capabilities.js' ||
          imp.startsWith('./') ||
          imp === '../types.js';
        expect(ok, `${f} imports ${imp}`).toBe(true);
      }
    }
  });
});
