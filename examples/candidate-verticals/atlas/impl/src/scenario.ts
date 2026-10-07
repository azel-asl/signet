// Scenario loading and validation (16 §D1, §D2).
// V0 accepts exactly one scenario shape (atlas-scenario/0.1, fry-rush).
// Every validation failure throws ScenarioError {code, pointer, message}
// before any event is emitted; no ledger and no receipt on failure.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stationShortName } from './world.js';
import type { Id, Seconds, World, WorldState } from './types.js';

export const ENGINE_VERSION = 'atlas-impl/0.2.0';

export class ScenarioError extends Error {
  readonly code: string;
  readonly pointer: string;
  constructor(code: string, pointer: string, message: string) {
    super(`${code} at ${pointer}: ${message}`);
    this.name = 'ScenarioError';
    this.code = code;
    this.pointer = pointer;
  }
}

export interface Intervention {
  id: string;
  kind: 'reassign';
  employee: Id;
  from: Id | null;
  to: Id | null;
  at: string; // ISODate
  at_t: Seconds;
}

export interface Scenario {
  atlas_schema: 'atlas-scenario/0.1';
  id: string;
  name: string;
  world: string;
  base: { branch: string; t: string; t_s: Seconds };
  horizon: string;
  horizon_t: Seconds;
  arrivals_source: 'historical_replay';
  duration_model: 'nominal';
  in_progress_rule: string;
  seed: number;
  baseline_interventions: Intervention[];
  scenario_interventions: Intervention[];
  comparison_window: { from: string; to: string };
  required_authority: string;
  sha256: string; // sha256 of the scenario file bytes
}

export const V0_IN_PROGRESS_RULE =
  'work in progress at the branch point completes at max(branch_t, started_t + nominal duration)';

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function parseTs(world: World, isoStr: string, pointer: string): Seconds {
  const ms = Date.parse(isoStr);
  if (!Number.isFinite(ms)) throw new ScenarioError('SCN_SCHEMA', pointer, 'not a parseable ISO date');
  return Math.floor(ms / 1000);
}

function reqStr(obj: Record<string, unknown>, key: string, pointer: string): string {
  const v = obj[key];
  if (!isStr(v)) throw new ScenarioError('SCN_SCHEMA', `${pointer}/${key}`, 'missing or not a string');
  return v;
}

function parseIntervention(raw: unknown, pointer: string, world: World): Intervention {
  if (typeof raw !== 'object' || raw === null) {
    throw new ScenarioError('SCN_SCHEMA', pointer, 'intervention must be an object');
  }
  const o = raw as Record<string, unknown>;
  const id = reqStr(o, 'id', pointer);
  const kind = reqStr(o, 'kind', pointer);
  const employee = reqStr(o, 'employee', pointer);
  const at = reqStr(o, 'at', pointer);
  const from = o.from === null || o.from === undefined ? null : o.from;
  const to = o.to === null || o.to === undefined ? null : o.to;
  if (from !== null && !isStr(from)) throw new ScenarioError('SCN_SCHEMA', `${pointer}/from`, 'must be a string or null');
  if (to !== null && !isStr(to)) throw new ScenarioError('SCN_SCHEMA', `${pointer}/to`, 'must be a string or null');
  return { id, kind: kind as 'reassign', employee, from, to, at, at_t: parseTs(world, at, `${pointer}/at`) };
}

/**
 * Load and validate a scenario. Needs the world, the base state at tB
 * (for on-shift and folded assignments), and the history ledger's branch.
 * Returns the validated scenario; throws ScenarioError on the first failure.
 */
export async function loadScenario(
  scenarioPath: string,
  world: World,
  baseState: WorldState,
  historyBranch: string,
): Promise<Scenario> {
  const bytes = await readFile(scenarioPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ScenarioError('SCN_SCHEMA', '', 'scenario file is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ScenarioError('SCN_SCHEMA', '', 'scenario must be an object');
  }
  const o = raw as Record<string, unknown>;
  const fail = (code: string, pointer: string, message: string): never => {
    throw new ScenarioError(code, pointer, message);
  };

  if (o.atlas_schema !== 'atlas-scenario/0.1') fail('SCN_SCHEMA', '/atlas_schema', 'must be atlas-scenario/0.1');
  const id = reqStr(o, 'id', '');
  const name = reqStr(o, 'name', '');
  const worldId = reqStr(o, 'world', '');
  if (worldId !== world.metadata.id) fail('SCN_WORLD_MISMATCH', '/world', `scenario world '${worldId}' != '${world.metadata.id}'`);

  if (typeof o.base !== 'object' || o.base === null) fail('SCN_SCHEMA', '/base', 'missing or not an object');
  const base = o.base as Record<string, unknown>;
  const baseBranch = reqStr(base, 'branch', '/base');
  const baseT = reqStr(base, 't', '/base');
  if (baseBranch !== historyBranch || !baseBranch.startsWith('history:')) {
    fail('SCN_BASE_BRANCH_MISMATCH', '/base/branch', `must equal the loaded history ledger branch '${historyBranch}'`);
  }
  const base_t = parseTs(world, baseT, '/base/t');

  const horizon = reqStr(o, 'horizon', '');
  const horizon_t = parseTs(world, horizon, '/horizon');
  const worldEnd = world.time.end ? Math.floor(Date.parse(world.time.end) / 1000) : Infinity;
  if (!(horizon_t > base_t)) fail('SCN_HORIZON_INVALID', '/horizon', 'horizon must be after base.t');
  if (horizon_t > worldEnd) fail('SCN_HORIZON_INVALID', '/horizon', 'horizon exceeds world.time.end');

  if (typeof o.comparison_window !== 'object' || o.comparison_window === null) {
    fail('SCN_SCHEMA', '/comparison_window', 'missing or not an object');
  }
  const cw = o.comparison_window as Record<string, unknown>;
  const cwFrom = reqStr(cw, 'from', '/comparison_window');
  const cwTo = reqStr(cw, 'to', '/comparison_window');
  if (cwFrom !== baseT || cwTo !== horizon) {
    fail('SCN_WINDOW_MISMATCH', '/comparison_window', 'must equal {base.t, horizon}');
  }

  if (typeof o.arrivals !== 'object' || o.arrivals === null) fail('SCN_SCHEMA', '/arrivals', 'missing');
  const arrivalsSource = (o.arrivals as Record<string, unknown>).source;
  const durationModel = o.duration_model;
  const inProgressRule = o.in_progress_rule;
  if (arrivalsSource !== 'historical_replay' || durationModel !== 'nominal' || inProgressRule !== V0_IN_PROGRESS_RULE) {
    const which = arrivalsSource !== 'historical_replay' ? '/arrivals/source'
      : durationModel !== 'nominal' ? '/duration_model' : '/in_progress_rule';
    fail('SCN_UNSUPPORTED', which, 'only historical_replay / nominal / the fixture in-progress rule are supported in V0');
  }

  const seed = o.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed)) fail('SCN_SCHEMA', '/seed', 'must be an integer');

  const requiredAuthority = reqStr(o, 'required_authority', '');

  const personIds = new Set(world.entities.filter((e) => e.type === 'person').map((e) => e.id));
  const stationIds = new Set(world.entities.filter((e) => e.type === 'station').map((e) => e.id));
  const skillsOf = (emp: string): string[] => {
    const ent = world.entities.find((e) => e.id === emp);
    return (ent?.attrs?.skills as string[]) ?? [];
  };

  const validateArm = (armKey: 'baseline' | 'scenario'): Intervention[] => {
    const armPointer = `/${armKey}`;
    const arm = o[armKey];
    if (typeof arm !== 'object' || arm === null) fail('SCN_SCHEMA', armPointer, 'missing or not an object');
    const listRaw = (arm as Record<string, unknown>).interventions;
    if (!Array.isArray(listRaw)) fail('SCN_SCHEMA', `${armPointer}/interventions`, 'must be an array');
    const list: unknown[] = listRaw as unknown[];
    const out: Intervention[] = [];
    const seenIds = new Set<string>();
    // fold per employee in `at` order over the base-state assignment
    const folded = new Map<string, Id | null>();
    const sorted = [...list].map((rawIv, idx) => ({ rawIv, idx })).sort((a, b) => {
      const ta = parseTs(world, (a.rawIv as Record<string, unknown>).at as string, `${armPointer}/interventions/${a.idx}/at`);
      const tb = parseTs(world, (b.rawIv as Record<string, unknown>).at as string, `${armPointer}/interventions/${b.idx}/at`);
      return ta - tb || a.idx - b.idx;
    });
    const atTimes = new Map<string, Set<number>>(); // employee -> set of at_t (conflict check)
    for (const { rawIv, idx } of sorted) {
      const pointer = `${armPointer}/interventions/${idx}`;
      const iv = parseIntervention(rawIv, pointer, world);
      if (seenIds.has(iv.id)) fail('IV_DUPLICATE_ID', `${pointer}/id`, `duplicate intervention id '${iv.id}'`);
      seenIds.add(iv.id);
      if (iv.kind !== 'reassign') fail('IV_UNSUPPORTED_KIND', `${pointer}/kind`, `kind '${iv.kind}' not supported in V0`);
      if (!personIds.has(iv.employee)) fail('IV_UNKNOWN_EMPLOYEE', `${pointer}/employee`, `unknown person '${iv.employee}'`);
      const stationsToCheck: [string, string | null][] = [['from', iv.from], ['to', iv.to]];
      for (const [key, st] of stationsToCheck) {
        if (st !== null && !stationIds.has(st)) {
          fail('IV_UNKNOWN_STATION', `${pointer}/${key}`, `unknown station '${st}'`);
        }
      }
      if (iv.at_t < base_t) fail('IV_BEFORE_BRANCH_POINT', `${pointer}/at`, 'intervention before the branch point');
      if (iv.at_t > horizon_t) fail('IV_AFTER_HORIZON', `${pointer}/at`, 'intervention after the horizon');
      if (!baseState.on_shift[iv.employee]) {
        fail('IV_EMPLOYEE_UNAVAILABLE', `${pointer}/employee`, `'${iv.employee}' not on shift at the branch point`);
      }
      if (iv.to !== null && !skillsOf(iv.employee).includes(stationShortName(iv.to))) {
        fail('IV_SKILL_VIOLATION', `${pointer}/to`, `'${iv.employee}' lacks skill '${stationShortName(iv.to)}' (R08)`);
      }
      const current = folded.has(iv.employee) ? folded.get(iv.employee)! : baseState.assignments[iv.employee] ?? null;
      if (iv.from !== current) {
        fail('IV_FROM_MISMATCH', `${pointer}/from`, `expected '${current}', got '${iv.from}'`);
      }
      const seen = atTimes.get(iv.employee) ?? new Set<number>();
      if (seen.has(iv.at_t)) fail('IV_CONFLICT', `${pointer}/at`, `two interventions for '${iv.employee}' at the same instant`);
      seen.add(iv.at_t);
      atTimes.set(iv.employee, seen);
      if (iv.from === iv.to) fail('IV_NO_OP', pointer, 'from equals to');
      folded.set(iv.employee, iv.to);
      out.push(iv);
    }
    return out;
  };

  const baseline_interventions = validateArm('baseline');
  const scenario_interventions = validateArm('scenario');

  return {
    atlas_schema: 'atlas-scenario/0.1',
    id, name, world: worldId,
    base: { branch: baseBranch, t: baseT, t_s: base_t },
    horizon, horizon_t,
    arrivals_source: 'historical_replay',
    duration_model: 'nominal',
    in_progress_rule: inProgressRule as string,
    seed: seed as number,
    baseline_interventions,
    scenario_interventions,
    comparison_window: { from: cwFrom, to: cwTo },
    required_authority: requiredAuthority,
    sha256,
  };
}
