// ATLAS M5 explanation (19 §O as amended by CCR-006).
// Fixed deterministic templates rendering only structured values.
// C1: R_ASSUMPTION template. C2: forbidden-word narrow exception.
// C3: objective-aware R_RANK (4 variants) and R_ECONOMICS rate.
// C4: numeral post-check with per-template sources (production-enforced).
// World-local times. Entity names from world.
// Every set's explanation ends with R_AUTHORITY. No generative prose.
import type { World } from '../types.js';
import type { Candidate, RecommendationSet, RecommendationObjective } from './types.js';
import { RecommendationError } from './types.js';
import { offsetSeconds } from '../views.js';

export interface ExplainLine {
  candidate_id: string | null;
  text: string;
  claim_class: string;
}

// Internal: line with its template for C4 source construction.
interface TemplatedLine extends ExplainLine {
  template: string;
  // Structured sources for C4 numeral check.
  numeralSources: number[];
}

type TemplateId =
  | 'R_CANDIDATE' | 'R_ASSUMPTION' | 'R_INFEASIBLE' | 'R_DELTA'
  | 'R_OVERLOAD_END' | 'R_TRADEOFF' | 'R_NEW_OVERLOAD' | 'R_ECONOMICS'
  | 'R_RANK' | 'R_DOMINATED' | 'R_NO_ACTION' | 'R_AUTHORITY';

// M4 §E terms + M5 additions, whole-word case-insensitive.
const FORBIDDEN_TERMS = [
  'cause', 'caused', 'causes', 'because of', 'due to', 'resulted in',
  'led to', 'unhappy', 'revenue', 'should', 'recommend',
  'will', 'guarantee', 'profit',
];

const FROZEN_ASSUMPTION = 'resource has no modeled assignment at the source; any unmodeled duties are not represented';

// C1 canonical rendering.
const ASSUMPTION_TEMPLATE = 'ASSUMED · Observed state: {resource_name} is on shift with no assigned station at {start_hhmm}. Duties outside the modeled stations are not represented in this simulation.';

function entityName(world: World, id: string): string {
  const e = world.entities.find((x) => x.id === id);
  return e?.name ?? id;
}

function hhmm(world: World, t: number): string {
  const local = t + offsetSeconds(world);
  const d = new Date(local * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Extract hour and minute as numbers from a world-local HH:MM.
function hhmmParts(world: World, t: number): [number, number] {
  const local = t + offsetSeconds(world);
  const d = new Date(local * 1000);
  return [d.getUTCHours(), d.getUTCMinutes()];
}

function fmtDeltaSeconds(v: number): string {
  const a = Math.abs(v);
  if (v === 0) return 'unchanged';
  return v < 0 ? `down ${a}s` : `up ${a}s`;
}

// C2: forbidden-word check with narrow R_ECONOMICS exception.
function checkForbidden(line: ExplainLine, template: TemplateId): void {
  let text = line.text;
  if (template === 'R_ECONOMICS') {
    const exempt = '(delay cost only; no revenue is assumed).';
    if (text.endsWith(exempt)) {
      text = text.slice(0, -exempt.length);
    }
  }
  for (const term of FORBIDDEN_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'i');
    if (pattern.test(text)) {
      throw new RecommendationError('FORMAT_VIOLATION', `forbidden term '${term}' in: ${line.text}`);
    }
  }
}

// C4: numeral post-check. Every numeral token must equal (ignoring sign)
// a number from the template's permitted structured sources.
function checkNumerals(line: ExplainLine, template: TemplateId, sources: number[]): void {
  // Match standalone numerals (word boundaries), allowing optional 's' unit suffix.
  // Digits within IDs like emp_04 are not standalone numerals.
  const tokens = line.text.match(/\b\d+(\.\d+)?s?\b/g) ?? [];
  for (let tok of tokens) {
    // Strip trailing 's' unit.
    if (tok.endsWith('s') && !tok.endsWith('.s')) {
      tok = tok.slice(0, -1);
    }
    const v = parseFloat(tok);
    if (!sources.some((s) => Math.abs(Math.abs(s) - v) < 1e-9)) {
      throw new RecommendationError('FORMAT_VIOLATION', `unsupported numeral '${tok}' in ${template}: ${line.text}`);
    }
  }
}

function pushLine(
  lines: TemplatedLine[],
  template: TemplateId,
  candidate_id: string | null,
  text: string,
  claim_class: string,
  numeralSources: number[],
): void {
  const line: TemplatedLine = { candidate_id, text, claim_class, template, numeralSources };
  // C2 and C4 enforced at construction for every line.
  checkForbidden(line, template);
  checkNumerals(line, template, numeralSources);
  lines.push(line);
}

export function explainCandidate(
  world: World,
  c: Candidate,
  objective: RecommendationObjective,
  baselineOverloadLast: number | null,
  effectiveRate?: number,
): ExplainLine[] {
  const lines: TemplatedLine[] = [];
  const rName = entityName(world, c.resource);
  const toName = entityName(world, c.to);
  const fromName = c.from ? entityName(world, c.from) : 'unassigned';
  const startHhmm = hhmm(world, c.window.start_t);
  const endHhmm = hhmm(world, c.window.end_t);
  const [startH, startM] = hhmmParts(world, c.window.start_t);
  const [endH, endM] = hhmmParts(world, c.window.end_t);

  // R_CANDIDATE — sources: hour/minute of start_t and end_t (world-local).
  pushLine(lines, 'R_CANDIDATE', c.id,
    `${rName}: ${fromName} → ${toName}, ${startHhmm}–${endHhmm}.`,
    'derived', [startH, startM, endH, endM]);

  // C1: R_ASSUMPTION — sources: hour/minute of start_t.
  if (c.eligibility.eligible && c.assumptions.includes(FROZEN_ASSUMPTION)) {
    pushLine(lines, 'R_ASSUMPTION', c.id,
      ASSUMPTION_TEMPLATE.replace('{resource_name}', rName).replace('{start_hhmm}', startHhmm),
      'assumed', [startH, startM]);
  }

  if (c.status === 'infeasible') {
    // R_INFEASIBLE — sources: none.
    pushLine(lines, 'R_INFEASIBLE', c.id,
      `${rName} cannot be moved to ${toName}: ${c.eligibility.reasons.join(', ')}.`,
      'derived', []);
    return lines;
  }

  if (c.delta && c.metrics) {
    // R_DELTA — sources: delta.order_time_in_system_s,
    // delta.orders_completed_in_window, delta.stations[to].queue_burden_s.
    const tis = c.delta.order_time_in_system_s;
    const tisText = tis < 0 ? `improves by ${-tis}s` : tis > 0 ? `worsens by ${tis}s` : 'unchanged';
    const qb = c.delta.stations[c.to]?.queue_burden_s ?? 0;
    const completed = c.delta.orders_completed_in_window;
    pushLine(lines, 'R_DELTA', c.id,
      `SIMULATED · Versus doing nothing: order time in system ${tisText}, ${completed} more orders completed, ${toName} queue burden ${fmtDeltaSeconds(qb)}.`,
      'simulated', [tis, completed, qb]);

    // R_OVERLOAD_END — sources: minutes_earlier.
    const candLast = c.metrics.stations[c.to]?.overload_last_t ?? null;
    if (baselineOverloadLast != null && candLast != null) {
      const minutesEarlier = Math.floor((baselineOverloadLast - candLast) / 60);
      if (minutesEarlier >= 1) {
        pushLine(lines, 'R_OVERLOAD_END', c.id,
          `SIMULATED · ${toName} overload ends ${minutesEarlier} minutes earlier.`,
          'simulated', [minutesEarlier]);
      }
    }

    // R_TRADEOFF / R_NEW_OVERLOAD — sources: baseline and scenario.
    for (const t of c.trade_offs) {
      const sName = entityName(world, t.station);
      if (t.metric === 'overload_s' && c.new_overload_stations.includes(t.station)) {
        pushLine(lines, 'R_NEW_OVERLOAD', c.id,
          `SIMULATED · New overload at ${sName} (${t.scenario}s).`,
          'simulated', [t.scenario]);
      } else {
        const metricText = t.metric === 'queue_burden_s' ? 'queue burden' : 'overload time';
        pushLine(lines, 'R_TRADEOFF', c.id,
          `SIMULATED · Trade-off: ${sName} ${metricText} rises from ${t.baseline} to ${t.scenario}.`,
          'simulated', [t.baseline, t.scenario]);
      }
    }

    // R_ECONOMICS — sources: rate and by_value[key].net_effect.
    if (c.economics) {
      const valueKey = objective.id === 'economic' ? (objective.economic_value_key ?? 'base') : 'base';
      // C3: rate for base is world value; low/high from sensitivity.
      // effectiveRate is provided by explainSet from set.sensitivity.values.
      const rate = effectiveRate
        ?? c.economics.inputs.find((x) => x.name === 'delay_cost_per_order_minute')?.value
        ?? 0;
      const net = c.economics.by_value[valueKey].net_effect;
      const netText = net >= 0 ? `+${net.toFixed(2)}` : net.toFixed(2);
      pushLine(lines, 'R_ECONOMICS', c.id,
        `ASSUMED · At ${rate} per order-minute over target, net effect ${netText} (delay cost only; no revenue is assumed).`,
        'assumed', [rate, net]);
    }

    // R_RANK — sources: rank.
    if (c.rank != null) {
      const isEconomic = objective.id === 'economic';
      const valueKey = objective.economic_value_key ?? 'base';
      let text: string;
      if (!isEconomic && c.status === 'recommended') {
        text = `Ranked ${c.rank}: lowest order time in system among non-dominated candidates without new overloads.`;
      } else if (!isEconomic) {
        text = `Ranked ${c.rank} (conditional): lowest order time in system among non-dominated candidates with new overloads.`;
      } else if (c.status === 'recommended') {
        text = `Ranked ${c.rank}: largest net effect at the ${valueKey} rate among non-dominated candidates without new overloads.`;
      } else {
        text = `Ranked ${c.rank} (conditional): largest net effect at the ${valueKey} rate among non-dominated candidates with new overloads.`;
      }
      pushLine(lines, 'R_RANK', c.id, text,
        isEconomic ? 'assumed' : 'simulated', [c.rank]);
    } else if (c.dominated_by.length > 0) {
      // R_DOMINATED — sources: none (ids are not numerals).
      pushLine(lines, 'R_DOMINATED', c.id,
        `Dominated by ${c.dominated_by.join(', ')}.`,
        'simulated', []);
    }
  }

  return lines;
}

export function explainSet(world: World, set: RecommendationSet): ExplainLine[] {
  const lines: TemplatedLine[] = [];
  // C3: effective rate for R_ECONOMICS.
  const valueKey = set.objective.id === 'economic' ? (set.objective.economic_value_key ?? 'base') : 'base';
  const effectiveRate = set.sensitivity.values[valueKey as 'low' | 'base' | 'high'];
  for (const c of set.candidates) {
    const baselineLast = set.baseline.metrics.stations[c.to]?.overload_last_t ?? null;
    const cLines = explainCandidate(world, c, set.objective, baselineLast, effectiveRate) as TemplatedLine[];
    lines.push(...cLines);
  }
  if (set.top.kind === 'no_action') {
    const reasonText = set.top.reason.replace(/_/g, ' ').toLowerCase();
    // R_NO_ACTION — sources: none.
    pushLine(lines, 'R_NO_ACTION', null,
      `No evaluated intervention is better than doing nothing (${reasonText}).`,
      set.top.claim_class, []);
  }
  // R_AUTHORITY always last — sources: none.
  pushLine(lines, 'R_AUTHORITY', null,
    'Advisory only. ATLAS does not execute or authorise this change.',
    'derived', []);

  return lines;
}

// Export for testing.
export { checkForbidden, checkNumerals, FROZEN_ASSUMPTION };
