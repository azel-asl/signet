// World definition loader: schema validation + the semantic checks from 03.
// Any failure rejects the whole file with JSON pointers; no partial world object
// is ever returned.
import { createValidator, loadJsonFile, ValidationIssue } from './schema.js';
import type { Entity, World } from './types.js';

export class WorldLoadError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`world definition rejected: ${issues.length} issue(s); first at ${issues[0]?.pointer}: ${issues[0]?.message}`);
    this.name = 'WorldLoadError';
    this.issues = issues;
  }
}

const RULE_KINDS = new Set([
  'station_capacity', 'queue_discipline', 'no_preemption', 'single_assignment',
  'assembly_barrier', 'handoff', 'station_status', 'skills_required', 'no_balking',
]);

const REQUIRED_RULE_KINDS = ['station_capacity', 'queue_discipline', 'station_status'];

/** Station short name used by skills/step ids: strip the leading `st_` (see DECISIONS.md D5). */
export function stationShortName(stationId: string): string {
  return stationId.startsWith('st_') ? stationId.slice(3) : stationId;
}

function issue(issues: ValidationIssue[], pointer: string, message: string): void {
  issues.push({ pointer, message });
}

export interface LoadWorldOptions {
  /**
   * Contract deviations explicitly allowed by CCR number, e.g. ['CCR-001'].
   * Deviations are NEVER silent: they are returned as warnings for the caller
   * to log. Default: none — the loader is strict.
   */
  allowDeviations?: string[];
}

export interface LoadWorldResult {
  world: World;
  /** Issues downgraded from errors via an explicit allowDeviations entry. */
  warnings: ValidationIssue[];
}

/** True for the exact 10 id-pattern issues documented in CCR-001. */
function isCcr001Issue(i: ValidationIssue): boolean {
  return (
    (i.pointer === '/metadata/id' || /^\/rules\/\d+\/id$/.test(i.pointer)) &&
    i.message.includes('must match pattern')
  );
}

export async function loadWorld(
  worldPath: string,
  schemaPath: string,
  opts: LoadWorldOptions = {},
): Promise<LoadWorldResult> {
  const raw = await loadJsonFile(worldPath);
  const schemaDoc = await loadJsonFile(schemaPath);
  const issues: ValidationIssue[] = createValidator(schemaDoc as Record<string, any>).validate(raw);
  const world = raw as World;
  // Semantic checks run on the parsed document regardless; they only add issues.
  const semanticIssues: ValidationIssue[] = [];
  try {
    semanticChecks(world, semanticIssues);
  } catch {
    // semanticChecks never throws; defensive only
  }
  const all = [...issues, ...semanticIssues];
  const allowed = new Set(opts.allowDeviations ?? []);
  const warnings = allowed.has('CCR-001') ? all.filter(isCcr001Issue) : [];
  const fatal = all.filter((i) => !warnings.includes(i));
  if (fatal.length > 0) throw new WorldLoadError(fatal);
  return { world, warnings };
}

export function semanticChecks(world: World, issues: ValidationIssue[] = []): ValidationIssue[] {
  const entities = new Map<string, Entity>();
  world.entities.forEach((e, i) => {
    if (entities.has(e.id)) issue(issues, `/entities/${i}/id`, `duplicate entity id '${e.id}'`);
    entities.set(e.id, e);
  });
  const entityTypes = new Set(world.entity_types.map((t) => t.id));

  world.entities.forEach((e, i) => {
    if (!entityTypes.has(e.type)) {
      issue(issues, `/entities/${i}/type`, `unknown entity_type '${e.type}'`);
    }
  });

  world.relationships.forEach((r, i) => {
    if (!entities.has(r.from)) issue(issues, `/relationships/${i}/from`, `dangling relationship source '${r.from}'`);
    if (!entities.has(r.to)) issue(issues, `/relationships/${i}/to`, `dangling relationship target '${r.to}'`);
  });

  // processes: applies_to is a product entity or 'order'; steps reference stations
  const productIds = new Set(world.entities.filter((e) => e.type === 'product').map((e) => e.id));
  const stationIds = new Set(world.entities.filter((e) => e.type === 'station').map((e) => e.id));
  world.processes.forEach((p, pi) => {
    if (p.applies_to !== 'order' && !productIds.has(p.applies_to)) {
      issue(issues, `/processes/${pi}/applies_to`, `unknown product '${p.applies_to}'`);
    }
    p.steps.forEach((s, si) => {
      if (!entities.has(s.station)) {
        issue(issues, `/processes/${pi}/steps/${si}/station`, `dangling station '${s.station}'`);
      } else if (!stationIds.has(s.station)) {
        issue(issues, `/processes/${pi}/steps/${si}/station`, `'${s.station}' is not of type station`);
      }
    });
  });

  // rules: closed enum, required kinds present
  const kinds = new Set<string>();
  world.rules.forEach((r, i) => {
    if (!RULE_KINDS.has(r.kind)) {
      issue(issues, `/rules/${i}/kind`, `unknown rule kind '${r.kind}'`);
    }
    kinds.add(r.kind);
  });
  for (const k of REQUIRED_RULE_KINDS) {
    if (!kinds.has(k)) issue(issues, '/rules', `missing required rule kind '${k}'`);
  }

  // initial_state: every referenced id is a declared entity; assignments respect skills
  const personIds = new Set(world.entities.filter((e) => e.type === 'person').map((e) => e.id));
  (world.initial_state.clock_in ?? []).forEach((id, i) => {
    if (!entities.has(id)) issue(issues, `/initial_state/clock_in/${i}`, `unknown entity '${id}'`);
  });
  for (const [emp, station] of Object.entries(world.initial_state.assignments)) {
    const ptr = `/initial_state/assignments/${emp}`;
    if (!entities.has(emp)) {
      issue(issues, ptr, `unknown entity '${emp}'`);
      continue;
    }
    if (station === null) continue;
    if (!entities.has(station)) {
      issue(issues, ptr, `dangling station '${station}'`);
      continue;
    }
    const empEnt = entities.get(emp)!;
    const skills: string[] = (empEnt.attrs?.skills as string[]) ?? [];
    const short = stationShortName(station);
    if (!skills.includes(short)) {
      issue(issues, ptr, `skill violation: '${emp}' lacks skill '${short}' for station '${station}'`);
    }
  }
  for (const [eq, status] of Object.entries(world.initial_state.equipment)) {
    if (!entities.has(eq)) issue(issues, `/initial_state/equipment/${eq}`, `unknown entity '${eq}'`);
    void status;
  }

  // aliases: every target is a declared entity
  for (const [source, table] of Object.entries(world.aliases ?? {})) {
    for (const [local, target] of Object.entries(table)) {
      if (!entities.has(target)) {
        issue(issues, `/aliases/${source}/${local}`, `alias target '${target}' is not a declared entity`);
      }
    }
  }

  // visualization.objects keys are entity ids
  for (const key of Object.keys(world.visualization?.objects ?? {})) {
    if (!entities.has(key)) {
      issue(issues, `/visualization/objects/${key}`, `object '${key}' is not a declared entity`);
    }
  }

  return issues;
}
