// F8: determinism. F9: isolation. F10: workload identity.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runArm, buildWorkload, canonHash } from '../src/simulate.js';
import { buildSnapshot } from '../src/views.js';
import { getStateAtTime } from '../src/capabilities.js';
import { m2Setup, TB, TH } from './m2-setup.js';
import { FIX, LEDGER_FILE } from './paths.js';
import { CANONICAL } from './paths.js';
import { tOf } from './paths.js';

const execFileP = promisify(execFile);

describe('F8 determinism', () => {
  it('run twice → equal trace_sha256 and receipt bytes', async () => {
    const { world, ledger, baseState, scenario, manifest } = await m2Setup();
    const common = {
      world, parentEvents: ledger.events, parentBranch: 'history:day1',
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
      worldSha256: manifest.world_sha256, scenario, baseState,
    };
    const a = runArm({ ...common, arm: 'scenario' });
    const b = runArm({ ...common, arm: 'scenario' });
    expect(a.receipt.outputs.trace_sha256).toBe(b.receipt.outputs.trace_sha256);
    expect(JSON.stringify(a.receipt)).toBe(JSON.stringify(b.receipt));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('scenario-then-baseline vs baseline-then-scenario → identical', async () => {
    const { world, ledger, baseState, scenario, manifest } = await m2Setup();
    const common = {
      world, parentEvents: ledger.events, parentBranch: 'history:day1',
      parentLedgerSha256: manifest.files['normalized/events.ndjson'],
      worldSha256: manifest.world_sha256, scenario, baseState,
    };
    const s1 = runArm({ ...common, arm: 'scenario' });
    const b1 = runArm({ ...common, arm: 'baseline' });
    const b2 = runArm({ ...common, arm: 'baseline' });
    const s2 = runArm({ ...common, arm: 'scenario' });
    expect(b1.receipt.receipt_sha256).toBe(b2.receipt.receipt_sha256);
    expect(s1.receipt.receipt_sha256).toBe(s2.receipt.receipt_sha256);
  });

  it('run in a child process → identical receipt', async () => {
    const { baseline } = await m2Setup();
    // Portable paths derived from the test file location (no machine hardcode).
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const testDir = dirname(fileURLToPath(import.meta.url));
    const implDir = dirname(testDir);
    const atlasDir = dirname(implDir);
    const { stdout } = await execFileP(
      'node',
      [
        '-e',
        `
      (async () => {
        const I = process.env.ATLAS_IMPL_DIST;
        const A = process.env.ATLAS_DIR;
        const {readFile} = await import('node:fs/promises');
        const {loadWorld} = await import(I + '/src/world.js');
        const {loadLedger} = await import(I + '/src/ledger.js');
        const {reduceTo} = await import(I + '/src/reducer.js');
        const {loadScenario} = await import(I + '/src/scenario.js');
        const {runArm} = await import(I + '/src/simulate.js');
        const manifest = JSON.parse(await readFile(A + '/fixtures/restaurant-v0/manifest.json', 'utf8'));
        const world = await loadWorld(A + '/fixtures/restaurant-v0/world.restaurant-v0.json', A + '/schema/atlas-world-definition.schema.json');
        const ledger = await loadLedger(A + '/fixtures/restaurant-v0/normalized/events.ndjson', A + '/schema/atlas-event.schema.json');
        const tB = Math.floor(Date.parse('2026-10-06T18:20:00-07:00')/1000);
        const {state: baseState} = reduceTo(world, ledger.events, tB);
        const scenario = await loadScenario(A + '/fixtures/restaurant-v0/scenario.fry-rush.json', world, baseState, 'history:day1');
        const r = runArm({world, parentEvents: ledger.events, parentBranch: 'history:day1',
          parentLedgerSha256: manifest.files['normalized/events.ndjson'], worldSha256: manifest.world_sha256,
          scenario, arm: 'baseline', baseState});
        console.log(r.receipt.receipt_sha256);
      })();
      `,
      ],
      {
        env: {
          ...process.env,
          ATLAS_IMPL_DIST: join(implDir, 'dist'),
          ATLAS_DIR: atlasDir,
        },
      },
    );
    expect(stdout.trim()).toBe(baseline.receipt.receipt_sha256);
  });
});

describe('F9 isolation', () => {
  it('history file sha256 unchanged by runs', async () => {
    const { manifest } = await m2Setup();
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const bytes = await readFile(LEDGER_FILE);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files['normalized/events.ndjson']);
  });

  it('base state is not mutated by runs (deep-frozen input)', async () => {
    const { world, ledger, scenario, manifest } = await m2Setup();
    const { reduceTo } = await import('../src/reducer.js');
    const { state: base } = reduceTo(world, ledger.events, TB);
    const frozen = structuredClone(base);
    Object.freeze(base);
    // runArm clones the base state; if it mutated the input, the freeze would throw
    const { runArm: ra } = await import('../src/simulate.js');
    expect(() =>
      ra({
        world, parentEvents: ledger.events, parentBranch: 'history:day1',
        parentLedgerSha256: manifest.files['normalized/events.ndjson'],
        worldSha256: manifest.world_sha256, scenario, arm: 'scenario', baseState: base,
      }),
    ).not.toThrow();
    expect(JSON.stringify(base)).toBe(JSON.stringify(frozen));
  });

  it('getStateAtTime on history after runs still reproduces s1–s4', async () => {
    const { world, ledger } = await m2Setup();
    for (const c of CANONICAL) {
      const expected = JSON.parse(await readFile(`${FIX}/${c.fixture}`, 'utf8'));
      const t = tOf((world as any).time.origin, c.hhmm);
      const snap: any = getStateAtTime({ world, ledger: ledger.events, t, branch: 'history:day1' });
      expect(snap.state_hash).toBe(expected.state_hash);
    }
  });
});

describe('F10 workload identity', () => {
  it('both receipts workload_sha256 equal ae7ad2b2…', async () => {
    const { baseline, scenarioArm } = await m2Setup();
    const w = 'ae7ad2b264fc003cd70413c2e0ad96baa726861ace6f85d6aab9258880bd471d';
    expect(baseline.receipt.inputs.workload.workload_sha256).toBe(w);
    expect(scenarioArm.receipt.inputs.workload.workload_sha256).toBe(w);
    expect(baseline.receipt.inputs.workload.count).toBe(65);
    expect(scenarioArm.receipt.inputs.workload.count).toBe(65);
  });

  it('ORDER_CREATED projections equal across arms and equal the 65 history arrivals', async () => {
    const { ledger, baseline, scenarioArm } = await m2Setup();
    const hist65 = ledger.events.filter((e) => e.type === 'ORDER_CREATED' && e.t > TB && e.t <= TH);
    expect(hist65.length).toBe(65);
    for (const r of [baseline, scenarioArm]) {
      const arrivals = r.events.filter((e) => e.type === 'ORDER_CREATED');
      expect(arrivals.length).toBe(65);
      arrivals.forEach((e, i) => {
        expect(e.subject).toBe(hist65[i].subject);
        expect(e.t).toBe(hist65[i].t);
        expect(JSON.stringify(e.data)).toBe(JSON.stringify(hist65[i].data));
      });
    }
  });
});
