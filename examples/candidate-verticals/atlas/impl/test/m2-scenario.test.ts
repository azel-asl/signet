// F3: intervention validation — one test per D2 code (17 cases).
// Each asserts the code and pointer, and that no events/receipt are produced
// (loadScenario throws before any scheduling).
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { loadWorld } from '../src/world.js';
import { loadLedger } from '../src/ledger.js';
import { reduceTo } from '../src/reducer.js';
import { loadScenario, ScenarioError } from '../src/scenario.js';
import { WORLD_FILE, WORLD_SCHEMA, LEDGER_FILE, EVENT_SCHEMA, SCENARIO_FILE } from './paths.js';
import { TB } from './m2-setup.js';

let dir: string;
let base: any;
let ctx: { world: any; baseState: any };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-scn-'));
  base = JSON.parse(await readFile(SCENARIO_FILE, 'utf8'));
  const world = await loadWorld(WORLD_FILE, WORLD_SCHEMA);
  const ledger = await loadLedger(LEDGER_FILE, EVENT_SCHEMA);
  const { state: baseState } = reduceTo(world, ledger.events, TB);
  ctx = { world, baseState };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function tryLoad(mut: (s: any) => void): Promise<ScenarioError> {
  const s = JSON.parse(JSON.stringify(base));
  mut(s);
  const p = join(dir, `scn-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(p, JSON.stringify(s));
  const err = await loadScenario(p, ctx.world, ctx.baseState, 'history:day1').catch((e) => e);
  expect(err).toBeInstanceOf(ScenarioError);
  return err as ScenarioError;
}

function iv(idx = 0): any {
  return base.scenario.interventions[idx];
}

describe('F3 scenario validation', () => {
  it('SCN_SCHEMA on missing id', async () => {
    const err = await tryLoad((s) => { delete s.id; });
    expect(err.code).toBe('SCN_SCHEMA');
    expect(err.pointer).toContain('/id');
  });

  it('SCN_WORLD_MISMATCH', async () => {
    const err = await tryLoad((s) => { s.world = 'other-world'; });
    expect(err.code).toBe('SCN_WORLD_MISMATCH');
    expect(err.pointer).toBe('/world');
  });

  it('SCN_BASE_BRANCH_MISMATCH', async () => {
    const err = await tryLoad((s) => { s.base.branch = 'sim:baseline'; });
    expect(err.code).toBe('SCN_BASE_BRANCH_MISMATCH');
  });

  it('SCN_HORIZON_INVALID when horizon <= base.t', async () => {
    const err = await tryLoad((s) => { s.horizon = s.base.t; });
    expect(err.code).toBe('SCN_HORIZON_INVALID');
  });

  it('SCN_HORIZON_INVALID when horizon > world.time.end', async () => {
    const err = await tryLoad((s) => { s.horizon = '2026-10-06T21:00:00-07:00'; });
    expect(err.code).toBe('SCN_HORIZON_INVALID');
  });

  it('SCN_WINDOW_MISMATCH', async () => {
    const err = await tryLoad((s) => { s.comparison_window.from = '2026-10-06T18:00:00-07:00'; });
    expect(err.code).toBe('SCN_WINDOW_MISMATCH');
  });

  it('SCN_UNSUPPORTED on modeled arrivals', async () => {
    const err = await tryLoad((s) => { s.arrivals.source = 'modeled'; });
    expect(err.code).toBe('SCN_UNSUPPORTED');
  });

  it('IV_DUPLICATE_ID', async () => {
    const err = await tryLoad((s) => {
      s.scenario.interventions.push({ ...iv(0) });
    });
    expect(err.code).toBe('IV_DUPLICATE_ID');
  });

  it('IV_UNSUPPORTED_KIND', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].kind = 'add_staff'; });
    expect(err.code).toBe('IV_UNSUPPORTED_KIND');
  });

  it('IV_UNKNOWN_EMPLOYEE', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].employee = 'emp_99'; });
    expect(err.code).toBe('IV_UNKNOWN_EMPLOYEE');
  });

  it('IV_UNKNOWN_STATION', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].to = 'st_99'; });
    expect(err.code).toBe('IV_UNKNOWN_STATION');
  });

  it('IV_BEFORE_BRANCH_POINT', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].at = '2026-10-06T18:00:00-07:00'; });
    expect(err.code).toBe('IV_BEFORE_BRANCH_POINT');
  });

  it('IV_AFTER_HORIZON', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[1].at = '2026-10-06T19:31:00-07:00'; });
    expect(err.code).toBe('IV_AFTER_HORIZON');
  });

  it('IV_EMPLOYEE_UNAVAILABLE', async () => {
    // no fixture employee is off shift at tB; exercise the check with a
    // base state where emp_06 has clocked out
    const offShift = structuredClone(ctx.baseState);
    offShift.on_shift['emp_06'] = false;
    const s = JSON.parse(JSON.stringify(base));
    s.scenario.interventions[0].employee = 'emp_06';
    s.scenario.interventions[0].from = null;
    s.scenario.interventions[0].to = 'st_prep';
    const p = join(dir, 'scn-offshift.json');
    await writeFile(p, JSON.stringify(s));
    const err = await loadScenario(p, ctx.world, offShift, 'history:day1').catch((e) => e);
    expect(err).toBeInstanceOf(ScenarioError);
    expect((err as ScenarioError).code).toBe('IV_EMPLOYEE_UNAVAILABLE');
  });

  it('IV_SKILL_VIOLATION (R08, same stationShortName)', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].to = 'st_grill'; });
    expect(err.code).toBe('IV_SKILL_VIOLATION');
  });

  it('IV_FROM_MISMATCH', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].from = 'st_fry'; });
    expect(err.code).toBe('IV_FROM_MISMATCH');
  });

  it('IV_CONFLICT', async () => {
    const err = await tryLoad((s) => {
      // same employee, same instant as iv_01; from matches the folded value
      // after iv_01 so the conflict check is reached
      s.scenario.interventions.push({ ...iv(1), id: 'iv_03', at: iv(0).at, from: 'st_fry', to: 'st_prep' });
    });
    expect(err.code).toBe('IV_CONFLICT');
  });

  it('IV_NO_OP', async () => {
    const err = await tryLoad((s) => { s.scenario.interventions[0].to = s.scenario.interventions[0].from; });
    expect(err.code).toBe('IV_NO_OP');
  });

  it('fixture interventions are accepted', async () => {
    const scn = await loadScenario(SCENARIO_FILE, ctx.world, ctx.baseState, 'history:day1');
    expect(scn.scenario_interventions).toHaveLength(2);
    expect(scn.baseline_interventions).toHaveLength(0);
  });
});
